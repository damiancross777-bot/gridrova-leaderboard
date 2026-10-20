import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";

// Admin SDK uses the function's runtime service account (Application Default Credentials).
// No service-account key file is used or required anywhere in this repository.
if (!getApps().length) initializeApp();

export const db: Firestore = getFirestore();
export const auth = () => getAuth();
export const appCheck = () => getAppCheck();

export const paths = {
  config: () => db.doc("config/leaderboard"),
  challenge: (date: string) => db.doc(`challenges/${date}`),
  player: (uid: string) => db.doc(`players/${uid}`),
  attempt: (date: string, uid: string) => db.doc(`attempts/${date}_${uid}`),
  entries: (date: string) => db.collection(`standings/${date}/entries`),
  entry: (date: string, uid: string) => db.doc(`standings/${date}/entries/${uid}`),
  settlement: (date: string) => db.doc(`settlements/${date}`),
  award: (uid: string, date: string) => db.doc(`players/${uid}/awards/${date}`),
  awards: (uid: string) => db.collection(`players/${uid}/awards`),
  ledgerTx: (uid: string, txId: string) => db.doc(`players/${uid}/walletLedger/${txId}`),
  rate: (key: string) => db.doc(`rateLimits/${key}`),
};
