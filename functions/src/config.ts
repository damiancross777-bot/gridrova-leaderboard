// Central constants. Anything an operator may need to change without a redeploy lives in
// Firestore at config/leaderboard (see flags.ts); everything here is fixed per release.

/** Region for every function. Firestore's location is chosen separately at database creation. */
export const REGION = "australia-southeast1";

/** Frozen into each day's challenge snapshot. Bump the version if values ever change. */
export const RULES = Object.freeze({
  version: 1,
  prizes: Object.freeze({ 1: 500, 2: 300, 3: 150 } as Record<number, number>),
  maxDailyIssuance: 950,
  contentDifficulty: "Balanced",
  boardSeedVersion: "v1",
});

export const LIMITS = Object.freeze({
  maxBodyBytes: 64 * 1024,
  maxGridDimension: 10,
  maxPaths: 20,
  maxCellsPerPath: 10,
  maxAttemptIdLength: 128,
  publicEntries: 100,
  claimPageSize: 100,
  displayNameMax: 24,
  /** Fixed-window per-player limits (window seconds, max requests). */
  start: { windowSec: 60, max: 10 },
  finish: { windowSec: 60, max: 10 },
  claim: { windowSec: 60, max: 20 },
  privateRead: { windowSec: 60, max: 60 },
  /** Per-instance, per-IP limit for the unauthenticated public endpoint. */
  publicRead: { windowSec: 60, max: 120 },
});

/** Settlement lease duration. A crashed run's lease expires and the next run resumes it. */
export const SETTLEMENT_LEASE_MS = 5 * 60 * 1000;
/** How many past days the scheduler re-checks for unfinished settlements. */
export const SETTLEMENT_LOOKBACK_DAYS = 7;
/** First UTC date the service will answer for (prevents enumerating arbitrary history). */
export const EARLIEST_DATE = "2026-10-01";
