// CI helper: writes the staging-like feature switches into the Firestore EMULATOR only.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Emulator only.");
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-gridrova" });
await getFirestore().doc("config/leaderboard").set({ rankedStartsEnabled: true, prizesEnabled: true, championsRecordingEnabled: true, cloudSaveEnabled: false });
console.log("emulator config seeded");
