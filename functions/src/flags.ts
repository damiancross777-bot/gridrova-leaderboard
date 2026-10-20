import { paths } from "./db.js";
import { now } from "./time.js";

/**
 * Operator switches stored at config/leaderboard (edit in the Firebase console or with
 * scripts/admin.mjs). Every default is the SAFE value, so a missing document means:
 * no ranked starts, no prizes.
 */
export interface Flags {
  /** Master switch for creating new ranked attempts (rollback lever). */
  rankedStartsEnabled: boolean;
  /** Frozen into each newly created daily challenge; settlement only pays prize-enabled days. */
  prizesEnabled: boolean;
  /** Reject anonymous-only identities (turn on once the game links Google sign-in). */
  requireLinkedAccount: boolean;
  /** Require a valid X-Firebase-AppCheck header on private routes (turn on only after the app sends it). */
  enforceAppCheck: boolean;
  /** Finishes faster than this are stored but held for review, not ranked. */
  minPlausibleElapsedMs: number;
}

export const DEFAULT_FLAGS: Flags = Object.freeze({
  rankedStartsEnabled: false,
  prizesEnabled: false,
  requireLinkedAccount: false,
  enforceAppCheck: false,
  minPlausibleElapsedMs: 20_000,
});

let cache: { at: number; value: Flags } | null = null;
const TTL_MS = 10_000;

export async function getFlags(): Promise<Flags> {
  if (cache && now() - cache.at < TTL_MS) return cache.value;
  const snap = await paths.config().get();
  const d = snap.exists ? snap.data()! : {};
  const value: Flags = {
    rankedStartsEnabled: d.rankedStartsEnabled === true,
    prizesEnabled: d.prizesEnabled === true,
    requireLinkedAccount: d.requireLinkedAccount === true,
    enforceAppCheck: d.enforceAppCheck === true,
    minPlausibleElapsedMs:
      Number.isInteger(d.minPlausibleElapsedMs) && d.minPlausibleElapsedMs >= 0
        ? d.minPlausibleElapsedMs
        : DEFAULT_FLAGS.minPlausibleElapsedMs,
  };
  cache = { at: now(), value };
  return value;
}

export function clearFlagCacheForTests(): void {
  cache = null;
}
