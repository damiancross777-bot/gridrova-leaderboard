import { randomUUID } from "node:crypto";
import { FieldValue, Filter } from "firebase-admin/firestore";
import { db, paths } from "./db.js";
import { fail, ApiError } from "./errors.js";
import { now, utcDay, closesAt, isValidDate } from "./time.js";
import { RULES, LIMITS, EARLIEST_DATE } from "./config.js";
import { generateRankedBoard, gameContentVersion, sha256, parseFinishBody, checkSolution, Board } from "./game.js";
import { safeDisplayName } from "./alias.js";
import type { Flags } from "./flags.js";
import type { Caller } from "./identity.js";

export interface Challenge {
  date: string;
  seed: string;
  board: Board;
  prizesEnabled: boolean;
  prizes: Record<number, number>;
  rulesVersion: number;
}

function parseChallenge(d: FirebaseFirestore.DocumentData): Challenge {
  return {
    date: d.date,
    seed: d.seed,
    board: JSON.parse(d.boardJson),
    prizesEnabled: d.prizesEnabled === true,
    prizes: d.prizes,
    rulesVersion: d.rulesVersion,
  };
}

/**
 * Immutable daily snapshot. Generated once (deterministically from the secret-salted seed)
 * and never overwritten: `create` fails if another request created it first, and we then
 * read the winner. Firestore cannot store nested arrays, so the board is stored as JSON.
 */
export async function getOrCreateChallenge(date: string, salt: string, flags: Flags): Promise<Challenge> {
  const ref = paths.challenge(date);
  const existing = await ref.get();
  if (existing.exists) return parseChallenge(existing.data()!);
  const board = await generateRankedBoard(date, salt);
  const boardJson = JSON.stringify(board);
  const doc = {
    date,
    seed: board.seed,
    contentVersion: gameContentVersion,
    rulesVersion: RULES.version,
    prizes: { ...RULES.prizes },
    prizesEnabled: flags.prizesEnabled,
    boardJson,
    boardSha256: sha256(boardJson),
    createdAt: FieldValue.serverTimestamp(),
  };
  try {
    await ref.create(doc);
    return parseChallenge(doc);
  } catch (e: any) {
    if (e?.code !== 6 /* ALREADY_EXISTS */) throw e;
    return parseChallenge((await ref.get()).data()!);
  }
}

async function readChallenge(date: string): Promise<Challenge | null> {
  const snap = await paths.challenge(date).get();
  return snap.exists ? parseChallenge(snap.data()!) : null;
}

/** POST /v1/attempts/start */
export async function startAttempt(caller: Caller, salt: string, flags: Flags) {
  const t = now();
  const date = utcDay(t);
  const ref = paths.attempt(date, caller.uid);

  // Resuming never depends on the feature flag: an in-progress player keeps their attempt.
  const resume = await ref.get();
  if (!resume.exists && !flags.rankedStartsEnabled) fail("NOT_OPEN");
  const challenge = await getOrCreateChallenge(date, salt, flags);

  const attempt = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data()!;
    const created = {
      uid: caller.uid,
      date,
      attemptId: randomUUID(),
      seed: challenge.seed,
      startedAtMs: t,
      status: "started",
      invalidSubmissions: 0,
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref, created);
    return created;
  });
  if (attempt.status === "finished") fail("ALREADY_FINISHED");
  return {
    attemptId: attempt.attemptId as string,
    challengeDate: date,
    board: challenge.board,
    startedAt: new Date(attempt.startedAtMs).toISOString(),
    closesAt: new Date(closesAt(date)).toISOString(),
  };
}

/** POST /v1/attempts/{attemptId}/finish */
export async function finishAttempt(caller: Caller, attemptId: string, body: unknown, flags: Flags) {
  if (!attemptId || attemptId.length > LIMITS.maxAttemptIdLength) fail("BAD_REQUEST");
  const parsed = parseFinishBody(body);
  if (!parsed || !isValidDate(parsed.challengeDate)) fail("BAD_REQUEST");
  const { challengeDate: date, seed, paths: submitted } = parsed!;
  const ref = paths.attempt(date, caller.uid);
  const entryRef = paths.entry(date, caller.uid);
  const t = now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Another player's attemptId simply does not exist under this caller's UID.
    if (!snap.exists || snap.get("attemptId") !== attemptId) fail("NOT_FOUND");
    const attempt = snap.data()!;
    const challengeSnap = await tx.get(paths.challenge(date));
    if (!challengeSnap.exists) fail("NOT_FOUND");
    const challenge = parseChallenge(challengeSnap.data()!);

    const resultHash = seed === challenge.seed ? checkSolution(challenge.board, submitted) : null;

    if (attempt.status === "finished") {
      // Idempotent replay returns the original result; anything different is a conflict.
      if (resultHash && resultHash === attempt.resultHash) {
        return { accepted: true, attemptId, elapsedMs: attempt.elapsedMs as number };
      }
      throw new ApiError("CONFLICT");
    }
    if (t >= closesAt(date)) fail("SUBMISSION_CLOSED");
    if (!resultHash) {
      tx.update(ref, { invalidSubmissions: FieldValue.increment(1) });
      return { invalid: true } as const;
    }

    const elapsedMs = t - (attempt.startedAtMs as number);
    const held = elapsedMs < flags.minPlausibleElapsedMs;
    tx.update(ref, {
      status: "finished",
      finishedAtMs: t,
      elapsedMs,
      resultHash,
      verification: held ? "held-too-fast" : "verified",
      finishedAt: FieldValue.serverTimestamp(),
    });
    tx.create(entryRef, {
      uid: caller.uid,
      displayName: caller.alias,
      elapsedMs,
      finishedAtMs: t,
      eligible: !held,
      verification: held ? "held-too-fast" : "verified",
      attemptId,
    });
    return { accepted: true, attemptId, elapsedMs };
  }).then((r) => {
    // Counted outside the throw so the invalid-submission counter is committed.
    if ("invalid" in r) fail("INVALID_SOLUTION");
    return r as { accepted: true; attemptId: string; elapsedMs: number };
  });
}

export function parseBoardDate(value: unknown): string {
  const today = utcDay(now());
  if (!isValidDate(value) || value < EARLIEST_DATE || value > today) fail("BAD_REQUEST");
  return value as string;
}

export type PublicEntry = { rank: number; displayName: string; elapsedMs: number };

function rankedQuery(date: string) {
  return paths
    .entries(date)
    .where("eligible", "==", true)
    .orderBy("elapsedMs")
    .orderBy("finishedAtMs")
    .orderBy("uid");
}

/** Ordered eligible entries: elapsed asc, then finish time asc, then UID (deterministic). */
export async function topEntries(date: string, limit: number): Promise<{ uid: string; e: PublicEntry }[]> {
  const snap = await rankedQuery(date).limit(limit).get();
  return snap.docs.map((d, i) => ({
    uid: d.get("uid"),
    e: { rank: i + 1, displayName: safeDisplayName(d.get("displayName")), elapsedMs: d.get("elapsedMs") },
  }));
}

/**
 * Scalable private rank: three COUNT aggregations (billed ~1 read per 1,000 entries)
 * instead of reading the whole board on every refresh.
 */
export async function rankOf(date: string, uid: string): Promise<{ rank: number | null; elapsedMs: number } | null> {
  const snap = await paths.entry(date, uid).get();
  if (!snap.exists) return null;
  const { elapsedMs, finishedAtMs, eligible } = snap.data()!;
  if (eligible !== true) return { rank: null, elapsedMs };
  const base = paths.entries(date).where("eligible", "==", true);
  const [a, b, c] = await Promise.all([
    base.where("elapsedMs", "<", elapsedMs).count().get(),
    base.where("elapsedMs", "==", elapsedMs).where("finishedAtMs", "<", finishedAtMs).count().get(),
    base
      .where(Filter.and(Filter.where("elapsedMs", "==", elapsedMs), Filter.where("finishedAtMs", "==", finishedAtMs), Filter.where("uid", "<", uid)))
      .count()
      .get(),
  ]);
  return { rank: a.data().count + b.data().count + c.data().count + 1, elapsedMs };
}

/** Final results come from the immutable settlement snapshot; live ones from the index. */
export async function boardView(date: string): Promise<{ finalized: boolean; rows: { uid: string; e: PublicEntry }[] }> {
  const settlement = await paths.settlement(date).get();
  if (settlement.exists && settlement.get("status") === "complete") {
    const rows = (settlement.get("finalStandings") ?? []) as { uid: string; rank: number; displayName: string; elapsedMs: number }[];
    return {
      finalized: true,
      rows: rows.map((r) => ({ uid: r.uid, e: { rank: r.rank, displayName: safeDisplayName(r.displayName), elapsedMs: r.elapsedMs } })),
    };
  }
  return { finalized: false, rows: await topEntries(date, LIMITS.publicEntries) };
}

export { readChallenge };
