import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { logger } from "firebase-functions";
import { ApiError, fail } from "./errors.js";
import { now } from "./time.js";
import { LIMITS } from "./config.js";
import { getFlags } from "./flags.js";
import { requireCaller } from "./identity.js";
import { limitPlayer, limitPublic } from "./ratelimit.js";
import { startAttempt, finishAttempt, parseBoardDate, boardView, rankOf, nearby } from "./competition.js";
import { startJourney, finishJourney, journeyProgress, championsPage } from "./journey.js";
import { getSave, putSave, deleteSave } from "./saves.js";
import { claimAwards } from "./claims.js";

export interface Deps {
  /** Exact website origins (scheme://host[:port]); paths are never part of an origin. */
  allowedOrigins: string[];
  /** Server-only secret that salts ranked board seeds. */
  challengeSalt: string;
}

const publicCache = new Map<string, { at: number; ttl: number; body: unknown }>();
export function clearPublicCacheForTests(): void {
  publicCache.clear();
}

function send(res: Response, status: number, body: unknown, cache = "private, no-store") {
  res.set("Cache-Control", cache);
  res.set("X-Content-Type-Options", "nosniff");
  res.status(status).json({ ...(body as object), serverNow: new Date(now()).toISOString() });
}

function applyCors(req: Request, res: Response, deps: Deps): boolean {
  const origin = req.get("Origin");
  res.set("Vary", "Origin");
  if (!origin) return true; // Native app requests carry no Origin. CORS is not authentication.
  if (!deps.allowedOrigins.includes(origin)) return false;
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck");
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.set("Access-Control-Max-Age", "3600");
  return true;
}

export async function handle(req: Request, res: Response, deps: Deps): Promise<void> {
  try {
    if (!applyCors(req, res, deps)) fail("FORBIDDEN_ORIGIN");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    const path = req.path.replace(/\/+$/, "");
    const bodyLimit = path === "/v1/me/save" ? LIMITS.maxSaveBodyBytes : LIMITS.maxBodyBytes;
    if ((req.rawBody?.length ?? 0) > bodyLimit) fail("PAYLOAD_TOO_LARGE");

    // ---- Public, unauthenticated, read-only -------------------------------------------
    if (path === "/v1/public/leaderboard") {
      if (req.method !== "GET") fail("METHOD_NOT_ALLOWED");
      limitPublic(req.ip ?? "unknown", LIMITS.publicRead);
      const date = parseBoardDate(req.query.date);
      const hit = publicCache.get(date);
      if (hit && now() >= hit.at && now() - hit.at < hit.ttl) {
        send(res, 200, hit.body, (hit.body as any).finalized ? "public, max-age=3600" : "public, max-age=30");
        return;
      }
      const view = await boardView(date);
      const body = { date, finalized: view.finalized, entries: view.rows.map((r) => r.e) };
      publicCache.set(date, { at: now(), ttl: view.finalized ? 300_000 : 15_000, body });
      send(res, 200, body, view.finalized ? "public, max-age=3600" : "public, max-age=30");
      return;
    }

    // ---- Private, authenticated --------------------------------------------------------
    const isPost = req.method === "POST";
    if (isPost && !req.is("application/json")) fail("BAD_REQUEST");
    const flags = await getFlags();
    const caller = await requireCaller(req.get("Authorization"), req.get("X-Firebase-AppCheck"), flags);

    if (path === "/v1/leaderboard") {
      if (req.method !== "GET") fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "read", LIMITS.privateRead);
      const date = parseBoardDate(req.query.date);
      const [view, me] = await Promise.all([boardView(date), rankOf(date, caller.uid)]);
      send(res, 200, {
        date,
        finalized: view.finalized,
        entries: view.rows.map((r) => ({ ...r.e, isYou: r.uid === caller.uid })),
        me,
      });
      return;
    }
    if (path === "/v1/leaderboard/nearby") {
      if (req.method !== "GET") fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "read", LIMITS.privateRead);
      const date = parseBoardDate(req.query.date);
      const [view, near] = await Promise.all([boardView(date), nearby(date, caller.uid, req.query.above, req.query.below)]);
      send(res, 200, { date, finalized: view.finalized, ...near });
      return;
    }
    if (path === "/v1/attempts/start") {
      if (!isPost) fail("METHOD_NOT_ALLOWED");
      if (Object.keys(req.body ?? {}).length) fail("BAD_REQUEST");
      await limitPlayer(caller.uid, "start", LIMITS.start);
      send(res, 200, await startAttempt(caller, deps.challengeSalt, flags));
      return;
    }
    const finish = /^\/v1\/attempts\/([^/]{1,128})\/finish$/.exec(path);
    if (finish) {
      if (!isPost) fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "finish", LIMITS.finish);
      send(res, 200, await finishAttempt(caller, decodeURIComponent(finish[1]), req.body, flags));
      return;
    }
    if (path === "/v1/me/awards/claim") {
      if (!isPost) fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "claim", LIMITS.claim);
      send(res, 200, await claimAwards(caller, req.body ?? {}));
      return;
    }
    // ---- 300-Level Champions ("Recorded online") ----------------------------------------
    if (path === "/v1/journey/start") {
      if (!isPost) fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "journey", LIMITS.journey);
      send(res, 200, await startJourney(caller, req.body, flags));
      return;
    }
    const journeyFinish = /^\/v1\/journey\/([^/]{1,128})\/finish$/.exec(path);
    if (journeyFinish) {
      if (!isPost) fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "journey", LIMITS.journey);
      send(res, 200, await finishJourney(caller, decodeURIComponent(journeyFinish[1]), req.body, flags));
      return;
    }
    if (path === "/v1/journey/progress") {
      if (req.method !== "GET") fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "read", LIMITS.privateRead);
      send(res, 200, await journeyProgress(caller));
      return;
    }
    if (path === "/v1/champions") {
      if (req.method !== "GET") fail("METHOD_NOT_ALLOWED");
      await limitPlayer(caller.uid, "read", LIMITS.privateRead);
      send(res, 200, await championsPage(req.query.cursor, deps.challengeSalt));
      return;
    }
    // ---- Private cloud save (linked accounts only) ---------------------------------------
    if (path === "/v1/me/save") {
      await limitPlayer(caller.uid, "save", LIMITS.save);
      if (req.method === "GET") send(res, 200, await getSave(caller, flags));
      else if (isPost) send(res, 200, await putSave(caller, req.body, flags, now()));
      else if (req.method === "DELETE") send(res, 200, await deleteSave(caller, flags));
      else fail("METHOD_NOT_ALLOWED");
      return;
    }
    fail("NOT_FOUND");
  } catch (e) {
    if (e instanceof ApiError) {
      send(res, e.status, { error: { code: e.code } });
      return;
    }
    // Log the message only: never request bodies, headers or tokens.
    logger.error("unhandled", { message: (e as Error)?.message });
    send(res, 500, { error: { code: "INTERNAL" } });
  }
}
