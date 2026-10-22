// 300-Level Champions — "Recorded online".
//
// What this records: each journey level completed against a server-timed attempt on the exact
// published board (the game's current CONTENT_VERSION), with a complete valid solution, no faster than a minimum
// per-level time, and at most a capped number of new levels per UTC day. Once all 300 distinct
// levels are recorded, one permanent gallery entry is created with a server timestamp.
//
// What this does NOT prove: that a human solved every puzzle. Every journey board and its answers
// ship inside the app, so a determined person can submit valid solutions. The minimum times and
// daily cap make that slow (≥5 days), and the gallery is labelled "Recorded online", never
// "verified". Rescues are recorded as reported by the app; they are not authoritative purchases
// because the coin wallet is local in this release.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db.js";
import { fail } from "./errors.js";
import { now, utcDay } from "./time.js";
import { checkSolution, parseFinishBody, Board, gameContentVersion } from "./game.js";
import { safeDisplayName } from "./alias.js";
import type { Flags } from "./flags.js";
import type { Caller } from "./identity.js";

// Must equal the app's CONTENT_VERSION; the vendored catalogue below is checked against it at startup.
export const JOURNEY_CONTENT_VERSION = 6;
export const JOURNEY_LEVELS = 300;

const boards: Board[] = JSON.parse(readFileSync(new URL("./game/levels.json", import.meta.url), "utf8"));
if (
  gameContentVersion !== JOURNEY_CONTENT_VERSION ||
  boards.length !== JOURNEY_LEVELS ||
  boards.some((b, i) => b.id !== i + 1 || b.contentVersion !== JOURNEY_CONTENT_VERSION)
) {
  throw new Error(`Journey catalogue does not match content version ${JOURNEY_CONTENT_VERSION} (game CONTENT_VERSION ${gameContentVersion})`);
}

const ref = {
  attempt: (uid: string, level: number) => db.doc(`journeyAttempts/${uid}_${level}`),
  progress: (uid: string) => db.doc(`journeyProgress/${uid}`),
  champion: (uid: string) => db.doc(`champions/${uid}`),
};

/** Minimum believable time for a level: 1.5 s per target word, never under 8 s. */
export function minLevelMs(board: Board): number {
  return Math.max(8_000, board.targets.length * 1_500);
}

function parseLevel(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > JOURNEY_LEVELS) fail("BAD_REQUEST");
  return n as number;
}

function requireRecording(flags: Flags) {
  if (!flags.championsRecordingEnabled) fail("NOT_OPEN");
}

/** POST /v1/journey/start {level, contentVersion, seed} */
export async function startJourney(caller: Caller, body: unknown, flags: Flags) {
  requireRecording(flags);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("BAD_REQUEST");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !["level", "contentVersion", "seed"].includes(k))) fail("BAD_REQUEST");
  const level = parseLevel(b.level);
  const board = boards[level - 1];
  // Saves can embed older boards. Those plays stay local and can be replayed online later.
  if (b.contentVersion !== JOURNEY_CONTENT_VERSION || b.seed !== board.seed) fail("CONTENT_MISMATCH");

  const progress = await ref.progress(caller.uid).get();
  const levels: number[] = progress.exists ? progress.get("levels") ?? [] : [];
  if (levels.includes(level)) return { attemptId: null, level, recorded: true, recordedLevels: levels.length };

  const attemptRef = ref.attempt(caller.uid, level);
  const attempt = await db.runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef);
    if (snap.exists && snap.get("status") === "started") return snap.data()!;
    const created = {
      uid: caller.uid,
      level,
      attemptId: randomUUID(),
      contentVersion: JOURNEY_CONTENT_VERSION,
      seed: board.seed,
      startedAtMs: now(),
      status: "started",
    };
    tx.set(attemptRef, created);
    return created;
  });
  return { attemptId: attempt.attemptId as string, level, recorded: false, recordedLevels: levels.length };
}

/** POST /v1/journey/{attemptId}/finish {level, seed, paths, rescues} */
export async function finishJourney(caller: Caller, attemptId: string, body: unknown, flags: Flags) {
  requireRecording(flags);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("BAD_REQUEST");
  const { level: levelRaw, rescues, ...rest } = body as Record<string, unknown>;
  const level = parseLevel(levelRaw);
  const board = boards[level - 1];
  if (rescues !== undefined && (!Number.isInteger(rescues) || (rescues as number) < 0 || (rescues as number) > board.targets.length)) fail("BAD_REQUEST");
  // Reuse the ranked parser for bounds; challengeDate is not part of journey bodies.
  const parsed = parseFinishBody({ challengeDate: "2000-01-01", ...rest });
  if (!parsed) fail("BAD_REQUEST");
  if (parsed!.seed !== board.seed) fail("CONTENT_MISMATCH");
  const resultHash = checkSolution(board, parsed!.paths);
  if (!resultHash) fail("INVALID_SOLUTION");

  const t = now();
  const today = utcDay(t);
  const attemptRef = ref.attempt(caller.uid, level);
  const progressRef = ref.progress(caller.uid);
  const championRef = ref.champion(caller.uid);

  return db.runTransaction(async (tx) => {
    const [attemptSnap, progressSnap, championSnap] = await Promise.all([
      tx.get(attemptRef),
      tx.get(progressRef),
      tx.get(championRef),
    ]);
    const p = progressSnap.exists ? progressSnap.data()! : {};
    const levels: number[] = p.levels ?? [];
    if (levels.includes(level)) {
      // Idempotent replay of an already-recorded level: nothing changes.
      return { recorded: true, level, recordedLevels: levels.length, champion: championSnap.exists };
    }
    if (!attemptSnap.exists || attemptSnap.get("attemptId") !== attemptId || attemptSnap.get("status") !== "started") fail("NOT_FOUND");
    const elapsed = t - (attemptSnap.get("startedAtMs") as number);
    if (elapsed < minLevelMs(board)) fail("TOO_FAST");
    const dayCount = p.day === today ? (p.dayCount as number) : 0;
    if (dayCount >= flags.journeyDailyCap) fail("DAILY_LIMIT");

    const next = [...levels, level].sort((a, b) => a - b);
    tx.update(attemptRef, { status: "recorded", finishedAtMs: t, elapsedMs: elapsed, resultHash, rescues: rescues ?? 0 });
    tx.set(
      progressRef,
      {
        uid: caller.uid,
        levels: next,
        count: next.length,
        assistedLevels: (p.assistedLevels ?? 0) + ((rescues as number) > 0 ? 1 : 0),
        day: today,
        dayCount: dayCount + 1,
        contentVersion: JOURNEY_CONTENT_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    let champion = championSnap.exists;
    // Set coverage, not a count: exactly the 300 distinct level IDs.
    if (!champion && next.length === JOURNEY_LEVELS && next.every((v, i) => v === i + 1)) {
      tx.create(championRef, {
        galleryId: randomBytes(12).toString("base64url"),
        displayName: caller.alias,
        published: true,
        completedLevels: JOURNEY_LEVELS,
        completedAtMs: t,
        completedAt: FieldValue.serverTimestamp(),
        assistedLevels: (p.assistedLevels ?? 0) + ((rescues as number) > 0 ? 1 : 0),
      });
      champion = true;
    }
    return { recorded: true, level, recordedLevels: next.length, champion };
  });
}

/** GET /v1/journey/progress — which levels are recorded online, so the app can show what's missing. */
export async function journeyProgress(caller: Caller) {
  const [p, c] = await Promise.all([ref.progress(caller.uid).get(), ref.champion(caller.uid).get()]);
  const levels: number[] = p.exists ? p.get("levels") ?? [] : [];
  return {
    recordedLevels: levels.length,
    levels,
    champion: c.exists ? { recorded: true, completedAt: new Date(c.get("completedAtMs")).toISOString() } : null,
  };
}

// Opaque cursor: HMAC-protected so it cannot be forged into arbitrary queries.
const cursorKey = randomBytes(32);
function encodeCursor(ms: number, gid: string, key: Buffer = cursorKey) {
  const body = `${ms}:${gid}`;
  const mac = createHmac("sha256", key).update(body).digest("base64url").slice(0, 16);
  return Buffer.from(`${body}:${mac}`).toString("base64url");
}
function decodeCursor(c: unknown, key: Buffer = cursorKey): [number, string] {
  if (typeof c !== "string" || c.length > 512) fail("BAD_REQUEST");
  const [ms, gid, mac] = Buffer.from(c as string, "base64url").toString("utf8").split(":");
  const expected = createHmac("sha256", key).update(`${ms}:${gid}`).digest("base64url").slice(0, 16);
  if (!mac || mac !== expected || !Number.isSafeInteger(Number(ms))) fail("BAD_REQUEST");
  return [Number(ms), gid];
}

/**
 * GET /v1/champions[?cursor=] — permanent gallery ordered by recorded completion time, then an
 * opaque gallery ID. No UIDs, emails or save data. Cursors are signed per deployment secret.
 */
export async function championsPage(cursor: unknown, secret: string) {
  const key = Buffer.from(createHmac("sha256", secret).update("champions-cursor").digest());
  let q = db.collection("champions").where("published", "==", true).orderBy("completedAtMs").orderBy("galleryId").limit(101);
  if (cursor !== undefined) q = q.startAfter(...decodeCursor(cursor, key));
  const snap = await q.get();
  const docs = snap.docs.slice(0, 100);
  return {
    entries: docs.map((d) => ({
      galleryId: d.get("galleryId") as string,
      displayName: safeDisplayName(d.get("displayName")),
      completedLevels: JOURNEY_LEVELS,
      recorded: true,
      completedAt: new Date(d.get("completedAtMs")).toISOString(),
    })),
    nextCursor: snap.docs.length > 100 ? encodeCursor(docs[99].get("completedAtMs"), docs[99].get("galleryId"), key) : null,
  };
}

