import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { REGION } from "./config.js";
import { handle } from "./api.js";
import { settleDue } from "./settlement.js";
import { purgeOrphanSaves } from "./saves.js";

// Non-secret, per-project value set in functions/.env.<projectId> (committed examples only).
const ALLOWED_ORIGINS = defineString("ALLOWED_ORIGINS", {
  description: "Comma-separated exact website origins, e.g. https://damiancross777-bot.github.io",
});
// Stored in Google Secret Manager; never in Git, Pages or EXPO_PUBLIC variables.
const CHALLENGE_SALT = defineSecret("CHALLENGE_SALT");

export const api = onRequest(
  {
    region: REGION,
    secrets: [CHALLENGE_SALT],
    maxInstances: 10,
    concurrency: 80,
    memory: "512MiB",
    timeoutSeconds: 30,
    invoker: "public", // Public HTTP endpoint; every private route verifies a Firebase ID token itself.
  },
  (req, res) =>
    handle(req, res, {
      allowedOrigins: ALLOWED_ORIGINS.value()
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
      challengeSalt: CHALLENGE_SALT.value(),
    }),
);

export const settleDaily = onSchedule(
  {
    region: REGION,
    schedule: "5 0 * * *",
    timeZone: "Etc/UTC",
    retryCount: 3,
    maxInstances: 1,
    timeoutSeconds: 300,
  },
  async () => {
    await settleDue();
  },
);

// Removes private cloud saves whose Firebase account no longer exists. (1st-gen auth onDelete
// triggers don't support Node 24 and 2nd gen has no equivalent, so this runs weekly instead.)
// Receipts, ledgers and settlements are kept as the prize audit trail.
export const purgeDeletedAccountSaves = onSchedule(
  {
    region: REGION,
    schedule: "30 1 * * 1",
    timeZone: "Etc/UTC",
    retryCount: 1,
    maxInstances: 1,
    timeoutSeconds: 540,
  },
  async () => {
    await purgeOrphanSaves();
  },
);
