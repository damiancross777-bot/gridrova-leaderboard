import { FieldValue } from "firebase-admin/firestore";
import { auth, appCheck, db, paths } from "./db.js";
import { fail } from "./errors.js";
import { generateAlias } from "./alias.js";
import type { Flags } from "./flags.js";

export interface Caller {
  uid: string;
  alias: string;
  anonymous: boolean;
}

/**
 * Verifies the Firebase ID token (signature, expiry, this project's audience/issuer) and
 * checks revocation/disabled status. The UID only ever comes from the verified token.
 */
export async function requireCaller(
  authorization: string | undefined,
  appCheckToken: string | undefined,
  flags: Flags,
): Promise<Caller> {
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(authorization ?? "");
  if (!match) fail("UNAUTHENTICATED");
  let decoded;
  try {
    decoded = await auth().verifyIdToken(match![1], true);
  } catch {
    fail("UNAUTHENTICATED");
  }
  if (flags.enforceAppCheck) {
    if (!appCheckToken) fail("UNAUTHENTICATED");
    try {
      await appCheck().verifyToken(appCheckToken!);
    } catch {
      fail("UNAUTHENTICATED");
    }
  }
  const provider = decoded!.firebase?.sign_in_provider ?? "unknown";
  const anonymous = provider === "anonymous";
  if (flags.requireLinkedAccount && anonymous) fail("ACCOUNT_REQUIRED");

  const uid = decoded!.uid;
  const ref = paths.player(uid);
  const player = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data()!;
      if (d.provider !== provider) tx.update(ref, { provider, providerUpdatedAt: FieldValue.serverTimestamp() });
      return d;
    }
    const created = {
      alias: generateAlias(),
      provider,
      banned: false,
      createdAt: FieldValue.serverTimestamp(),
      serverWallet: { balance: 0, prizeCoinsTotal: 0 },
    };
    tx.create(ref, created);
    return created;
  });
  if (player.banned === true) fail("INELIGIBLE");
  return { uid, alias: player.alias, anonymous };
}
