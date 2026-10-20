import { paths } from "./db.js";
import { fail } from "./errors.js";
import { isValidDate } from "./time.js";
import { LIMITS } from "./config.js";
import type { Caller } from "./identity.js";

// Opaque, stable cursor: the last returned award date, base64url-encoded with a version tag.
const encodeCursor = (date: string) => Buffer.from("v1:" + date).toString("base64url");
function decodeCursor(cursor: unknown): string {
  if (typeof cursor !== "string" || cursor.length > 64) fail("BAD_REQUEST");
  const text = Buffer.from(cursor as string, "base64url").toString("utf8");
  const date = text.startsWith("v1:") ? text.slice(3) : "";
  if (!isValidDate(date)) fail("BAD_REQUEST");
  return date;
}

/**
 * POST /v1/me/awards/claim — read-only. Returns the caller's immutable receipts in date
 * order, including historical ones, so a device that failed to save can safely retry.
 * Replays always return the same receipts; nothing is minted here.
 */
export async function claimAwards(caller: Caller, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("BAD_REQUEST");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "cursor")) fail("BAD_REQUEST");
  let query = paths.awards(caller.uid).orderBy("date").limit(LIMITS.claimPageSize + 1);
  if (b.cursor !== undefined) query = query.startAfter(decodeCursor(b.cursor));
  const snap = await query.get();
  const docs = snap.docs.slice(0, LIMITS.claimPageSize);
  const receipts = docs.map((d) => {
    const r = d.data();
    // Exactly the fields the game's validPodiumReceipt expects; nothing else.
    return { awardId: r.awardId, playerId: r.playerId, date: r.date, rank: r.rank, coins: r.coins, finalized: true };
  });
  const nextCursor = snap.docs.length > LIMITS.claimPageSize ? encodeCursor(docs[docs.length - 1].get("date")) : null;
  return { receipts, nextCursor };
}
