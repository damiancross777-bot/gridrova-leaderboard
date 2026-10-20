import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { REGION } from "./config.js";
import { handle } from "./api.js";
import { settleDue } from "./settlement.js";
import { deleteSaveForUid } from "./saves.js";
import * as functionsV1 from "firebase-functions/v1";

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

// Account deletion removes the private cloud save. Receipts, ledgers and settlements are kept
// as the prize audit trail (they hold no personal data beyond the UID).
export const deleteAccountData = functionsV1
  .region(REGION)
  .auth.user()
  .onDelete(async (user) => {
    await deleteSaveForUid(user.uid);
  });
