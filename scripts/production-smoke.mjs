#!/usr/bin/env node
// Controlled closed-testing smoke checks against the DEPLOYED PRODUCTION API.
// Separate from scripts/staging-acceptance.mjs (which refuses non-staging URLs); this one refuses any
// URL that doesn't contain "gridrova-lb-prod", so neither script can be pointed at the wrong project.
//
// What it does, and its limits:
//  - Read-only route/security checks (P0-P3) that touch no data.
//  - P4-P9 create ONE disposable anonymous identity, play today's ranked board once (a real finish,
//    >= the 20 s floor), read the board back, then DELETE that identity. Champions and cloud save are
//    expected OFF in 1.0, so P8/P9 assert they are refused, not exercised.
//  - It never mints a prize (that only happens at the daily close-off) and never edits a frozen day.
//  - It is safe to run before ranked starts are switched on: P5 then reports ranked-not-open and the
//    data checks are skipped (still a PASS for "closed correctly").
//
// Usage (PowerShell, repo root):
//   node scripts/production-smoke.mjs --api-key <PROD Web API key>
// Optional: --base <api base URL>  --out <report.json>  --origin <allowed site origin>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBoard } from "../functions/src/game/core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []),
);
const BASE = String(args.base || "https://australia-southeast1-gridrova-lb-prod.cloudfunctions.net/api").replace(/\/$/, "");
const KEY = args["api-key"] || process.env.PROD_FIREBASE_API_KEY;
const ALLOWED_ORIGIN = args.origin || "https://phoneporium.au";
const AUTH = "https://identitytoolkit.googleapis.com";
if (!/gridrova-lb-prod/.test(BASE)) throw new Error("Refusing: this script only runs against the production project (URL must contain 'gridrova-lb-prod').");
if (!KEY) throw new Error("Pass --api-key <production Web API key> (public client config, not a secret).");

const today = new Date().toISOString().slice(0, 10);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const code = (r) => r.json?.error?.code;

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

let p = null;
await check("P0", "Public leaderboard returns structured JSON for today", async () => {
  const r = await http("GET", `/v1/public/leaderboard?date=${today}`);
  ok(r.status === 200 && r.json?.date === today && Array.isArray(r.json.entries), `status ${r.status}`);
  return { finalized: r.json.finalized, entries: r.json.entries.length };
});
await check("P1", "Unknown route and bare base return API JSON, not a Google HTML page", async () => {
  const r = await http("GET", "/v1/not-a-route");
  ok(r.json && typeof r.json === "object", `got ${r.status}`);
});
await check("P2", "Missing and garbage tokens are rejected", async () => {
  ok(code(await http("POST", "/v1/attempts/start", { body: {} })) && code(await http("POST", "/v1/attempts/start", { token: "garbage", body: {} })), "a token was accepted");
});
await check("P3", "CORS: the configured origin is allowed and another is refused", async () => {
  const good = await http("GET", `/v1/public/leaderboard?date=${today}`, { origin: ALLOWED_ORIGIN });
  const bad = await http("GET", `/v1/public/leaderboard?date=${today}`, { origin: "https://evil.example" });
  const acao = (h) => h["access-control-allow-origin"];
  ok(acao(good.headers) === ALLOWED_ORIGIN, `allowed origin not echoed: ${acao(good.headers)}`);
  ok(acao(bad.headers) !== "https://evil.example", "a disallowed origin was allowed");
  return { allowed: acao(good.headers) ?? null };
});
await check("P4", "An anonymous identity can sign in", async () => {
  p = await newPlayer();
  ok(p.token, "no token");
  return { uid: p.uid.slice(0, 6) + "…" };
});

let started = null;
await check("P5", "Ranked start: open → today's valid board; closed → NOT_OPEN (both acceptable pre-launch)", async () => {
  const r = await http("POST", "/v1/attempts/start", { token: p.token, body: {} });
  if (code(r) === "NOT_OPEN") return { rankedStarts: "off (NOT_OPEN) — expected before launch" };
  ok(r.status === 200 && r.json.challengeDate === today, `status ${r.status} ${code(r)}`);
  ok(validateBoard(r.json.board).length === 0, "board failed the app's validateBoard");
  ok(!String(r.json.board.seed).startsWith("fallback:"), "ranked board is a bundled fallback");
  started = { ...r.json, receivedAtLocal: Date.now() };
  return { seedPrefix: String(r.json.board.seed).split(":").slice(0, 2).join(":"), contentVersion: r.json.board.contentVersion };
});
await check("P6", "Ranked finish after the 20 s floor is accepted and appears on the board", async () => {
  if (!started) return { skipped: "ranked starts are off" };
  const wait = Math.max(0, started.receivedAtLocal + 23_000 - Date.now());
  await sleep(wait);
  const paths = started.board.targets.map((t) => t.path);
  const f = await http("POST", `/v1/attempts/${encodeURIComponent(started.attemptId)}/finish`, { token: p.token, body: { challengeDate: today, seed: started.board.seed, paths } });
  ok(f.json?.accepted === true && f.json.elapsedMs >= 20_000, `finish ${f.status} ${code(f)} elapsed ${f.json?.elapsedMs}`);
  const lb = await http("GET", `/v1/leaderboard?date=${today}`, { token: p.token });
  ok(lb.json?.me?.rank >= 1, `not ranked: ${lb.status} me=${JSON.stringify(lb.json?.me)}`);
  return { elapsedMs: f.json.elapsedMs, rank: lb.json.me.rank };
});
await check("P7", "Prize claim for this fresh player returns no receipts and mints nothing", async () => {
  const r = await http("POST", "/v1/me/awards/claim", { token: p.token, body: {} });
  ok(r.status === 200 && !(r.json?.receipts && r.json.receipts.length), `status ${r.status} receipts ${JSON.stringify(r.json?.receipts)}`);
});
await check("P8", "Champions recording is OFF (journey start → NOT_OPEN)", async () => {
  const r = await http("POST", "/v1/journey/start", { token: p.token, body: { level: 1, contentVersion: 6, seed: "x" } });
  ok(code(r) === "NOT_OPEN", `expected NOT_OPEN, got ${r.status} ${code(r)}`);
});
await check("P9", "Cloud save is unavailable to anonymous players", async () => {
  const r = await http("GET", "/v1/me/save", { token: p.token });
  ok(["NOT_OPEN", "ACCOUNT_REQUIRED"].includes(code(r)), `got ${r.status} ${code(r)}`);
});
await check("P10", "Delete my online data removes the test identity and its sign-in stops working", async () => {
  if (!p) return { skipped: "no identity" };
  const d = await http("DELETE", "/v1/me", { token: p.token });
  ok(d.json?.deleted === true, `delete ${d.status} ${code(d)}`);
  const after = await http("POST", "/v1/attempts/start", { token: p.token, body: {} });
  ok(code(after) === "UNAUTHENTICATED", `token still works: ${code(after)}`);
});

const report = { base: BASE, ranAt: new Date().toISOString(), utcDate: today, mode: "production closed-test smoke",
  passed: results.filter((r) => r.status === "PASS").length, failed: results.filter((r) => r.status === "FAIL").length, results };
const out = resolve(args.out || `reports/production-smoke-${report.ranAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${report.failed} failed → ${out}`);
process.exitCode = report.failed ? 1 : 0;
