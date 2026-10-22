// Operator tool for emailed deletion requests ("I no longer have the app"). Not reachable over HTTP:
// it runs only from scripts/operator-delete-player.mjs with the operator's own Google credentials.
//
// Ownership: an anonymous account has no email or password; its sign-in key lived only on the phone.
// So an emailed request can't prove ownership. The rule that protects current players:
//   - exactly one account must carry the player name given (names are random but not guaranteed unique);
//   - that account must have been inactive (no sign-in or token refresh) for MIN_INACTIVE_DAYS.
// A player who still has the app uses Settings -> "Delete my online data", which is self-proving.
import { auth, db } from "./db.js";
import { now } from "./time.js";
import { deletePlayerData } from "./deletion.js";

export const MIN_INACTIVE_DAYS = 30;

export type Match = { uid: string; alias: string; lastActiveMs: number | null };

export async function findByPlayerName(name: string): Promise<Match[]> {
  const snap = await db.collection("players").where("alias", "==", name).limit(5).get();
  const out: Match[] = [];
  for (const d of snap.docs) {
    let lastActiveMs: number | null = null;
    try {
      const u = await auth().getUser(d.id);
      const times = [u.metadata.lastRefreshTime, u.metadata.lastSignInTime, u.metadata.creationTime]
        .map((s) => (s ? Date.parse(s) : NaN))
        .filter((n) => Number.isFinite(n));
      lastActiveMs = times.length ? Math.max(...times) : null;
    } catch (e: any) {
      if (e?.code !== "auth/user-not-found") throw e; // sign-in already gone: inactive by definition
    }
    out.push({ uid: d.id, alias: d.get("alias"), lastActiveMs });
  }
  return out;
}

export type OperatorResult =
  | { outcome: "not-found" }
  | { outcome: "ambiguous"; matches: number }
  | { outcome: "recently-active"; lastActive: string; inactiveDays: number }
  | { outcome: "would-delete" | "deleted"; uid: string; lastActive: string | null };

export async function operatorDeleteByName(
  name: string,
  opts: { execute: boolean; nowMs?: number } = { execute: false },
): Promise<OperatorResult> {
  const matches = await findByPlayerName(name);
  if (matches.length === 0) return { outcome: "not-found" };
  if (matches.length > 1) return { outcome: "ambiguous", matches: matches.length };
  const m = matches[0];
  const t = opts.nowMs ?? now();
  if (m.lastActiveMs !== null) {
    const inactiveDays = Math.floor((t - m.lastActiveMs) / 86_400_000);
    if (inactiveDays < MIN_INACTIVE_DAYS) {
      return { outcome: "recently-active", lastActive: new Date(m.lastActiveMs).toISOString(), inactiveDays };
    }
  }
  const lastActive = m.lastActiveMs === null ? null : new Date(m.lastActiveMs).toISOString();
  if (!opts.execute) return { outcome: "would-delete", uid: m.uid, lastActive };
  await deletePlayerData(m.uid);
  return { outcome: "deleted", uid: m.uid, lastActive };
}
