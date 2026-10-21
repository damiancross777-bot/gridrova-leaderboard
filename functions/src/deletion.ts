// DELETE /v1/me — "Delete my online data". Works for anonymous players (no email needed): the
// verified token identifies them. Removes everything the server holds about that player, redacts
// them from public final standings, deletes the anonymous Firebase account, and leaves a minimal
// tombstone (UID + time) so a settlement already in progress can never pay a deleted player.
// The player's game progress on their phone is untouched.
import { FieldValue } from "firebase-admin/firestore";
import { auth, db, paths } from "./db.js";
import type { Caller } from "./identity.js";

export const DELETED_UID = "deleted";
export const DELETED_NAME = "Deleted player";
export const tombstone = (uid: string) => db.doc(`deletedPlayers/${uid}`);

async function deleteQuery(q: FirebaseFirestore.Query) {
  for (;;) {
    const snap = await q.limit(200).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function deleteMyData(caller: Caller) {
  const uid = caller.uid;
  // Tombstone first, so any concurrent settlement skips this player from now on.
  await tombstone(uid).set({ deletedAt: FieldValue.serverTimestamp() });

  await db.recursiveDelete(paths.player(uid)); // profile, prize receipts, wallet ledger
  await Promise.all([
    db.doc(`journeyProgress/${uid}`).delete(),
    db.doc(`champions/${uid}`).delete(),
    db.doc(`privateGameSaves/${uid}`).delete(),
  ]);
  await deleteQuery(db.collection("attempts").where("uid", "==", uid));
  await deleteQuery(db.collection("journeyAttempts").where("uid", "==", uid));
  await deleteQuery(db.collectionGroup("entries").where("uid", "==", uid));

  // Final standings keep their ranks but no longer identify the player. Settlement documents are
  // one per UTC day, so this scan stays small (hundreds of documents per year).
  const settlements = await db.collection("settlements").get();
  for (const s of settlements.docs) {
    const redact = (rows: any[] | undefined) =>
      Array.isArray(rows) ? rows.map((r) => (r?.uid === uid ? { ...r, uid: DELETED_UID, displayName: DELETED_NAME } : r)) : rows;
    const winners = s.get("winners"), standings = s.get("finalStandings");
    const touched = (rows: any[] | undefined) => Array.isArray(rows) && rows.some((r) => r?.uid === uid);
    if (touched(winners) || touched(standings)) await s.ref.update({ winners: redact(winners), finalStandings: redact(standings) });
  }

  try {
    await auth().deleteUser(uid);
  } catch (e: any) {
    if (e?.code !== "auth/user-not-found") throw e;
  }
  return { deleted: true };
}

/** True when a winner must not be paid (deleted before or during settlement). */
export async function isDeleted(tx: FirebaseFirestore.Transaction, uid: string) {
  if (uid === DELETED_UID) return true;
  return (await tx.get(tombstone(uid))).exists;
}
