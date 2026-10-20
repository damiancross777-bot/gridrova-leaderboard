import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db, paths } from "./db.js";
import { now } from "./time.js";
import { fail } from "./errors.js";

/**
 * Durable fixed-window limit for authenticated actions, shared by all instances.
 * Documents carry expireAt so a Firestore TTL policy on rateLimits.expireAt can clean them.
 */
export async function limitPlayer(uid: string, bucket: string, rule: { windowSec: number; max: number }) {
  const window = Math.floor(now() / (rule.windowSec * 1000));
  const ref = paths.rate(`${bucket}_${uid}_${window}`);
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.get("count") as number) : 0;
    if (count >= rule.max) return false;
    tx.set(ref, {
      count: count + 1,
      expireAt: Timestamp.fromMillis((window + 2) * rule.windowSec * 1000),
    });
    return true;
  });
  if (!allowed) fail("RATE_LIMITED");
}

// Per-instance memory limiter for the unauthenticated endpoint. IPs are hashed in memory
// only and never written anywhere. maxInstances on the function bounds the global total.
const memory = new Map<string, { window: number; count: number }>();
export function limitPublic(ip: string, rule: { windowSec: number; max: number }) {
  const window = Math.floor(now() / (rule.windowSec * 1000));
  const key = createHash("sha256").update(ip).digest("base64url").slice(0, 16);
  const cur = memory.get(key);
  if (!cur || cur.window !== window) {
    if (memory.size > 10_000) memory.clear();
    memory.set(key, { window, count: 1 });
    return;
  }
  if (++cur.count > rule.max) fail("RATE_LIMITED");
}
