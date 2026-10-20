// Private cloud save — an UNTRUSTED backup of the player's local game, nothing more.
// Never copy its coins, levels, receipts or trophies into wallet, ranked or Champions data.
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db.js";
import { fail, ApiError } from "./errors.js";
import { readBackup } from "./game/backup.mjs";
import type { Flags } from "./flags.js";
import type { Caller } from "./identity.js";

export const MAX_SAVE_BYTES = 600_000;
const saveRef = (uid: string) => db.doc(`privateGameSaves/${uid}`);

function requireLinked(caller: Caller, flags: Flags) {
  if (!flags.cloudSaveEnabled) fail("NOT_OPEN");
  // Anonymous identities cannot be recovered, so they cannot own a cloud copy.
  if (caller.anonymous) fail("ACCOUNT_REQUIRED");
}

/** GET /v1/me/save */
export async function getSave(caller: Caller, flags: Flags) {
  requireLinked(caller, flags);
  const snap = await saveRef(caller.uid).get();
  if (!snap.exists) return { version: 0, snapshot: null, updatedAt: null };
  const d = snap.data()!;
  return { version: d.version as number, snapshot: d.snapshot as string, updatedAt: new Date(d.updatedAtMs).toISOString() };
}

/** POST /v1/me/save {snapshot, expectedVersion} — optimistic concurrency, never merges. */
export async function putSave(caller: Caller, body: unknown, flags: Flags, nowMs: number) {
  requireLinked(caller, flags);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("BAD_REQUEST");
  const { snapshot, expectedVersion, ...extra } = body as Record<string, unknown>;
  if (Object.keys(extra).length) fail("BAD_REQUEST");
  if (typeof snapshot !== "string" || Buffer.byteLength(snapshot, "utf8") > MAX_SAVE_BYTES) fail("INVALID_SAVE");
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) fail("INVALID_SAVE");
  try {
    readBackup(snapshot as string); // the game's own checksum/schema/puzzle validation
  } catch {
    fail("INVALID_SAVE");
  }
  const ref = saveRef(caller.uid);
  const version = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const actual = current.exists ? (current.get("version") as number) : 0;
    if (actual !== expectedVersion) throw new ApiError("SAVE_CONFLICT");
    const next = actual + 1;
    tx.set(ref, { snapshot, version: next, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  // Same shape as GET so the app can show the copy it just saved.
  return { version, snapshot: snapshot as string, updatedAt: new Date(nowMs).toISOString() };
}

/** DELETE /v1/me/save — player-initiated removal. Also run automatically on account deletion. */
export async function deleteSave(caller: Caller, flags: Flags) {
  requireLinked(caller, flags);
  await saveRef(caller.uid).delete();
  return { deleted: true };
}

export async function deleteSaveForUid(uid: string) {
  await saveRef(uid).delete();
}
