#!/usr/bin/env node
// Live acceptance checks against the DEPLOYED staging API (not emulators).
// Creates fresh anonymous test players, exercises the real routes and writes a PASS/FAIL report.
//
// Usage (PowerShell, from the repo root):
//   node scripts/staging-acceptance.mjs --api-key <staging Web API key>
// Optional: --base <api base URL>  --out <report.json>  --skip-slow
//
// Effects on staging: a few anonymous test players, today's ranked attempt for each (one finished
// after ~21 s so it appears in today's standings) and one recorded journey level. No production
// project is ever contacted; the script refuses any base URL that doesn't contain "staging".
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBoard } from "../functions/src/game/core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []),
);
const BASE = String(args.base || "https://australia-southeast1-gridrova-lb-staging.cloudfunctions.net/api").replace(/\/$/, "");
const KEY = args["api-key"] || process.env.STAGING_FIREBASE_API_KEY;
const SLOW = !args["skip-slow"];
// Emulator self-test only (CI): --emulator points auth at the local Auth emulator.
const EMULATOR = !!args.emulator;
const AUTH = EMULATOR ? "http://127.0.0.1:9099/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com";
if (EMULATOR ? !/^http:\/\/127\.0\.0\.1:/.test(BASE) : !/staging/.test(BASE)) throw new Error("Refusing: this script only runs against staging (or the local emulator with --emulator).");
if (!KEY) throw new Error("Pass --api-key <staging Web API key> (public client config, not a secret).");
const levels = JSON.parse(readFileSync(resolve(here, "../functions/src/game/levels.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(id, name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: "PASS", ms: Date.now() - t, ...(detail ? { detail } : {}) });
    console.log(`PASS ${id} ${name}`);
  } catch (e) {
    results.push({ id, name, status: "FAIL", ms: Date.now() - t, error: String(e?.message || e) });
    console.log(`FAIL ${id} ${name} — ${e?.message || e}`);
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

async function http(method, path, { token, body, origin } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: Object.fromEntries(res.headers) };
}
async function newPlayer() {
  const r = await fetch(`${AUTH}/v1/accounts:signUp?key=${encodeURIComponent(KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const d = await r.json();
  ok(r.ok && d.idToken, "anonymous sign-up failed: " + JSON.stringify(d.error || d).slice(0, 120));
  return { uid: d.localId, token: d.idToken };
}
const code = (r) => r.json?.error?.code;

let a, b, attemptA, boardA;
await check("C0", "Public leaderboard returns structured JSON for today", async () => {
  const r = await http("GET", `/v1/public/leaderboard?date=${today}`);
  ok(r.status === 200 && r.json?.date === today && Array.isArray(r.json.entries), `status ${r.status}`);
  ok(r.json.entries.every((e) => Object.keys(e).sort().join() === "displayName,elapsedMs,rank"), "public entries expose extra fields");
  return { entries: r.json.entries.length, finalized: r.json.finalized, csp: r.headers["content-security-policy"] || "(not deployed yet)" };
});
await check("C1", "Unknown route and bare base return API JSON, not a Google HTML page", async () => {
  const r = await http("GET", "/v1/nope");
  ok(r.json && (r.json.error?.code === "UNAUTHENTICATED" || r.json.error?.code === "NOT_FOUND"), `status ${r.status}`);
});
await check("C2", "Missing and garbage tokens are rejected", async () => {
  ok(code(await http("POST", "/v1/attempts/start", { body: {} })) === "UNAUTHENTICATED", "no token accepted");
  ok(code(await http("POST", "/v1/attempts/start", { token: "x".repeat(60), body: {} })) === "UNAUTHENTICATED", "garbage token accepted");
});
await check("C3", "Disallowed website origin is refused (CORS)", async () => {
  const r = await http("GET", `/v1/public/leaderboard?date=${today}`, { origin: "https://evil.example" });
  ok(r.status === 403 && code(r) === "FORBIDDEN_ORIGIN", `status ${r.status}`);
});
await check("C4", "Two anonymous test players can sign in", async () => {
  a = await newPlayer();
  b = await newPlayer();
});
await check("C5", "Ranked start returns today's board that the app's own validator accepts", async () => {
  const r = await http("POST", "/v1/attempts/start", { token: a.token, body: {} });
  if (code(r) === "NOT_OPEN") throw new Error("NOT_OPEN — config/leaderboard.rankedStartsEnabled is not true on staging");
  ok(r.status === 200 && r.json.challengeDate === today, `status ${r.status} ${code(r)}`);
  ok(validateBoard(r.json.board).length === 0, "board failed the game's validateBoard (content version mismatch?)");
  ok(!String(r.json.board.seed).startsWith("fallback:"), "ranked board is a bundled fallback");
  attemptA = r.json; boardA = r.json.board;
  return { seedPrefix: String(boardA.seed).split(":").slice(0, 2).join(":"), contentVersion: boardA.contentVersion, closesAt: r.json.closesAt };
});
await check("C6", "Repeated and concurrent starts return the same attempt and original start time", async () => {
  const rs = await Promise.all([1, 2, 3].map(() => http("POST", "/v1/attempts/start", { token: a.token, body: {} })));
  ok(rs.every((r) => r.json?.attemptId === attemptA.attemptId && r.json?.startedAt === attemptA.startedAt), "attempt or start time changed");
});
await check("C7", "Board is the same for every player on the same UTC day", async () => {
  const r = await http("POST", "/v1/attempts/start", { token: b.token, body: {} });
  ok(JSON.stringify(r.json?.board) === JSON.stringify(boardA), "different boards for the same day");
});
await check("C8", "Incomplete and forged solutions are rejected", async () => {
  const paths = boardA.targets.map((t) => t.path);
  const body = (o) => ({ challengeDate: today, seed: boardA.seed, paths, ...o });
  ok(code(await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: a.token, body: body({ paths: paths.slice(1) }) })) === "INVALID_SOLUTION", "missing target accepted");
  ok(code(await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: a.token, body: body({ seed: "ranked:forged" }) })) === "INVALID_SOLUTION", "forged seed accepted");
  ok(code(await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: a.token, body: body({ elapsedMs: 1 }) })) === "BAD_REQUEST", "forged elapsed accepted");
});
await check("C9", "Another player cannot submit this attempt", async () => {
  const r = await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: b.token, body: { challengeDate: today, seed: boardA.seed, paths: boardA.targets.map((t) => t.path) } });
  ok(code(r) === "NOT_FOUND", `got ${code(r)}`);
});
if (SLOW) {
  await check("C10", "A valid finish after 21 s is accepted with server-measured time; repeat is idempotent", async () => {
    const wait = Math.max(0, Date.parse(attemptA.startedAt) + 21_500 - Date.now());
    await sleep(wait);
    const body = { challengeDate: today, seed: boardA.seed, paths: boardA.targets.map((t) => t.path) };
    const f1 = await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: a.token, body });
    ok(f1.json?.accepted === true && f1.json.attemptId === attemptA.attemptId, `finish: ${f1.status} ${code(f1)}`);
    const f2 = await http("POST", `/v1/attempts/${attemptA.attemptId}/finish`, { token: a.token, body });
    ok(f2.json?.elapsedMs === f1.json.elapsedMs, "repeat changed the result");
    return { elapsedMs: f1.json.elapsedMs };
  });
  await check("C11", "Leaderboard and nearby show the player; nearby is bounded with one 'you' row", async () => {
    const lb = await http("GET", `/v1/leaderboard?date=${today}`, { token: a.token });
    ok(lb.json?.me?.rank >= 1, "player not ranked");
    const nb = await http("GET", `/v1/leaderboard/nearby?date=${today}&above=5&below=5`, { token: a.token });
    ok(nb.status === 200 && nb.json.status === "ranked" && nb.json.entries.length <= 11 && nb.json.entries.filter((e) => e.isYou).length === 1, `nearby ${nb.status} ${code(nb)}`);
    ok(!JSON.stringify(nb.json).includes(a.uid), "UID leaked in nearby");
    return { rank: lb.json.me.rank, nearbyRows: nb.json.entries.length };
  });
  await check("C12", "Journey level 1 records online after a server-timed attempt (Champions)", async () => {
    const s = await http("POST", "/v1/journey/start", { token: a.token, body: { level: 1, contentVersion: 5, seed: levels[0].seed } });
    if (code(s) === "NOT_OPEN") throw new Error("NOT_OPEN — championsRecordingEnabled is not true on staging");
    ok(s.status === 200 && s.json.attemptId, `start ${s.status} ${code(s)}`);
    await sleep(8_500);
    const f = await http("POST", `/v1/journey/${s.json.attemptId}/finish`, { token: a.token, body: { level: 1, seed: levels[0].seed, paths: levels[0].targets.map((t) => t.path) } });
    ok(f.json?.recorded === true && f.json.recordedLevels === 1, `finish ${f.status} ${code(f)}`);
    const p = await http("GET", "/v1/journey/progress", { token: a.token });
    ok(JSON.stringify(p.json?.levels) === "[1]", "progress mismatch");
  });
}
await check("C13", "Champions gallery responds with the recorded-online shape and no UIDs", async () => {
  const r = await http("GET", "/v1/champions", { token: b.token });
  ok(r.status === 200 && Array.isArray(r.json.entries), `status ${r.status}`);
  ok(r.json.entries.every((e) => e.recorded === true && e.completedLevels === 300 && !("playerId" in e)), "bad entry shape");
});
await check("C14", "Prize claim for a brand-new player returns no receipts and mints nothing", async () => {
  const r = await http("POST", "/v1/me/awards/claim", { token: b.token, body: {} });
  ok(r.status === 200 && Array.isArray(r.json.receipts) && r.json.receipts.length === 0 && r.json.nextCursor === null, `status ${r.status}`);
});
await check("C15", "Cloud save is unavailable to anonymous players (1.0 ships without accounts)", async () => {
  const r = await http("GET", "/v1/me/save", { token: b.token });
  ok(["NOT_OPEN", "ACCOUNT_REQUIRED"].includes(code(r)), `got ${r.status} ${code(r)}`);
});

const report = { base: BASE, ranAt: new Date().toISOString(), utcDate: today, passed: results.filter((r) => r.status === "PASS").length, failed: results.filter((r) => r.status === "FAIL").length, results };
const out = resolve(args.out || `reports/staging-acceptance-${report.ranAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${report.failed} failed → ${out}`);
process.exitCode = report.failed ? 1 : 0;
