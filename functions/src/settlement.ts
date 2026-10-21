import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, paths } from "./db.js";
import { now, utcDay, addDays } from "./time.js";
import { RULES, LIMITS, SETTLEMENT_LEASE_MS, SETTLEMENT_LOOKBACK_DAYS, EARLIEST_DATE } from "./config.js";
import { logger } from "firebase-functions";
import { isDeleted } from "./deletion.js";

type Winner = { uid: string; rank: number; elapsedMs: number; displayName: string };
export type SettleResult = "not-closed" | "already-complete" | "leased-elsewhere" | "complete";

export interface SettleHooks {
  /** Test-only: called after each winner is paid, to simulate a crash mid-settlement. */
  afterWinnerPaid?: (w: Winner) => void | Promise<void>;
}

/**
 * Exactly-once settlement for one closed UTC date.
 *  1. A transactional lease on settlements/{date} stops overlapping runs. The winner list and
 *     final standings are written ONCE, the first time a lease is taken, then never recomputed.
 *  2. Each winner is paid in its own transaction guarded by the existence of
 *     players/{uid}/awards/{date} — re-running after a crash skips anyone already paid.
 *  3. Status becomes "complete" only when every occupied podium place has a durable receipt.
 */
export async function settleDate(date: string, hooks: SettleHooks = {}): Promise<SettleResult> {
  if (date >= utcDay(now())) return "not-closed";
  const leaseId = randomUUID();
  const ref = paths.settlement(date);

  const lease = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data()! : null;
    if (s?.status === "complete") return null;
    if (s?.status === "running" && s.leaseUntilMs > now() && s.leaseId !== leaseId) return "busy" as const;

    const challengeSnap = await tx.get(paths.challenge(date));
    const challenge = challengeSnap.exists ? challengeSnap.data()! : null;
    let winners: Winner[] = s?.winners;
    let finalStandings = s?.finalStandings;
    if (!winners) {
      const q = await tx.get(
        paths.entries(date).where("eligible", "==", true).orderBy("elapsedMs").orderBy("finishedAtMs").orderBy("uid").limit(LIMITS.publicEntries),
      );
      finalStandings = q.docs.map((d, i) => ({
        uid: d.get("uid") as string,
        rank: i + 1,
        displayName: d.get("displayName") as string,
        elapsedMs: d.get("elapsedMs") as number,
      }));
      winners = finalStandings.slice(0, 3);
    }
    const prizesEnabled = challenge?.prizesEnabled === true;
    const prizes = (challenge?.prizes ?? RULES.prizes) as Record<number, number>;
    tx.set(
      ref,
      {
        date,
        status: "running",
        leaseId,
        leaseUntilMs: now() + SETTLEMENT_LEASE_MS,
        rulesVersion: challenge?.rulesVersion ?? RULES.version,
        prizesEnabled,
        winners,
        finalStandings,
        ...(s ? {} : { firstRunAt: FieldValue.serverTimestamp() }),
        runs: FieldValue.increment(1),
      },
      { merge: true },
    );
    return { winners, prizesEnabled, prizes };
  });
  if (lease === null) return "already-complete";
  if (lease === "busy") return "leased-elsewhere";

  const total = lease.winners.reduce((sum, w) => sum + (lease.prizes[w.rank] ?? 0), 0);
  if (total > RULES.maxDailyIssuance) throw new Error(`Issuance ${total} exceeds cap for ${date}`);

  if (lease.prizesEnabled) {
    for (const w of lease.winners) {
      await payWinner(date, w, lease.prizes[w.rank]);
      await hooks.afterWinnerPaid?.(w);
    }
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") === "complete") return "already-complete" as const;
    if (snap.get("leaseId") !== leaseId) return "leased-elsewhere" as const;
    if (lease.prizesEnabled) {
      for (const w of lease.winners) {
        if (await isDeleted(tx, w.uid)) continue;
        const award = await tx.get(paths.award(w.uid, date));
        if (!award.exists) throw new Error(`Missing receipt for ${date} rank ${w.rank}`);
      }
    }
    tx.update(ref, {
      status: "complete",
      prizesIssued: lease.prizesEnabled,
      completedAt: FieldValue.serverTimestamp(),
      leaseUntilMs: 0,
    });
    return "complete" as const;
  });
}

/** One immutable receipt + one wallet-ledger delta per winner per date, at most once. */
async function payWinner(date: string, w: Winner, coins: number) {
  if (!Number.isInteger(coins) || coins <= 0) throw new Error("Invalid prize");
  const awardRef = paths.award(w.uid, date);
  const playerRef = paths.player(w.uid);
  const txId = `prize_daily_${date}`;
  const ledgerRef = paths.ledgerTx(w.uid, txId);
  await db.runTransaction(async (tx) => {
    // A player who deleted their online data is never paid (their place stays, the prize lapses).
    if (await isDeleted(tx, w.uid)) return;
    const [award, player, ledger] = await Promise.all([tx.get(awardRef), tx.get(playerRef), tx.get(ledgerRef)]);
    if (award.exists) return;
    if (ledger.exists) throw new Error("Ledger entry without award: manual review required");
    const balance = (player.get("serverWallet.balance") as number | undefined) ?? 0;
    const prizeTotal = (player.get("serverWallet.prizeCoinsTotal") as number | undefined) ?? 0;
    const awardId = `daily:${date}:${w.uid}`;
    tx.create(ledgerRef, {
      delta: coins,
      balanceAfter: balance + coins,
      reason: "daily-podium",
      awardId,
      settlementId: date,
      at: FieldValue.serverTimestamp(),
    });
    tx.create(awardRef, {
      awardId,
      playerId: w.uid,
      date,
      rank: w.rank,
      coins,
      finalized: true,
      ledgerTxId: txId,
      issuedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      playerRef,
      { serverWallet: { balance: balance + coins, prizeCoinsTotal: prizeTotal + coins } },
      { merge: true },
    );
  });
}

/** Scheduled entry point: settle yesterday and retry any unfinished day in the lookback window. */
export async function settleDue(): Promise<Record<string, SettleResult>> {
  const today = utcDay(now());
  const out: Record<string, SettleResult> = {};
  for (let i = SETTLEMENT_LOOKBACK_DAYS; i >= 1; i--) {
    const date = addDays(today, -i);
    if (date < EARLIEST_DATE) continue;
    out[date] = await settleDate(date);
  }
  logger.info("settlement run", { results: out });
  return out;
}
