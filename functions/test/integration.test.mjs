// Acceptance tests against the Firebase Auth + Firestore emulators.
// Run with `npm run test:emulators` (CI runs this on every push).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getAuth } from "firebase-admin/auth";
import { db } from "../lib/db.js";
import { handle, clearPublicCacheForTests } from "../lib/api.js";
import { setClockForTests } from "../lib/time.js";
import { clearFlagCacheForTests } from "../lib/flags.js";
import { settleDate, settleDue } from "../lib/settlement.js";
import { validPodiumReceipt } from "../lib/game/leaderboard.mjs";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-gridrova";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(AUTH_HOST && FS_HOST, "Run under `firebase emulators:exec`");

const ORIGIN = "https://damiancross777-bot.github.io";
const DEPS = { allowedOrigins: [ORIGIN, "http://localhost:8000"], challengeSalt: "integration-test-salt-0123456789" };
const T = (iso) => Date.parse(iso);
let clock = T("2026-10-20T10:00:00Z");
setClockForTests(() => clock);

async function setFlags(f) {
  await db.doc("config/leaderboard").set(
    { rankedStartsEnabled: true, prizesEnabled: true, requireLinkedAccount: false, enforceAppCheck: false, minPlausibleElapsedMs: 20000, ...f },
  );
  clearFlagCacheForTests();
}

beforeEach(async () => {
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  clock = T("2026-10-20T10:00:00Z");
  clearPublicCacheForTests();
  await setFlags({});
});

async function player() {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function call(method, path, { token, body, origin, query = {}, raw } = {}) {
  const headers = {
    authorization: token ? `Bearer ${token}` : undefined,
    origin,
    "content-type": body !== undefined ? "application/json" : undefined,
  };
  const req = {
    method,
    path,
    query,
    body,
    rawBody: raw ?? Buffer.from(body === undefined ? "" : JSON.stringify(body)),
    ip: "203.0.113.7",
    get: (h) => headers[h.toLowerCase()],
    is: (t) => (headers["content-type"] === t ? t : false),
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handle(req, res, DEPS);
  return res;
}

const start = (p) => call("POST", "/v1/attempts/start", { token: p.token, body: {} });
const solvePaths = (board) => board.targets.map((t) => t.path);
const finish = (p, s, over = {}) =>
  call("POST", `/v1/attempts/${encodeURIComponent(over.attemptId ?? s.attemptId)}/finish`, {
    token: p.token,
    body: { challengeDate: s.challengeDate, seed: s.board.seed, paths: solvePaths(s.board), ...(over.body ?? {}) },
  });
const code = (r) => r.body?.error?.code;

async function playAt(p, startIso, finishIso) {
  clock = T(startIso);
  const s = (await start(p)).body;
  clock = T(finishIso);
  const f = await finish(p, s);
  assert.equal(f.statusCode, 200, JSON.stringify(f.body));
  return s;
}

// ---------------------------------------------------------------- attempts & clock
test("every player gets the same UTC board regardless of when in the UTC day they start", async () => {
  const [a, b] = [await player(), await player()];
  clock = T("2026-10-20T00:10:00Z"); // 11:10 Sydney
  const sa = await start(a);
  clock = T("2026-10-20T23:30:00Z"); // 10:30 next day in Sydney, still 20th UTC
  const sb = await start(b);
  assert.equal(sa.statusCode, 200);
  assert.equal(sa.body.challengeDate, "2026-10-20");
  assert.equal(sb.body.challengeDate, "2026-10-20");
  assert.deepEqual(sa.body.board, sb.body.board);
  assert.equal(sa.body.closesAt, "2026-10-21T00:00:00.000Z");
  assert.ok(sa.body.serverNow);
});

test("concurrent starts create exactly one attempt and a restart resumes the original server clock", async () => {
  const p = await player();
  const results = await Promise.all(Array.from({ length: 5 }, () => start(p)));
  const ids = new Set(results.map((r) => r.body.attemptId));
  assert.equal(ids.size, 1);
  assert.equal(new Set(results.map((r) => r.body.startedAt)).size, 1);
  clock += 90_000;
  const again = await start(p);
  assert.equal(again.body.attemptId, results[0].body.attemptId);
  assert.equal(again.body.startedAt, results[0].body.startedAt);
  const attempts = await db.collection("attempts").get();
  assert.equal(attempts.size, 1);
});

test("valid finish is accepted with server-measured time; duplicate is idempotent; conflicting repeat is rejected", async () => {
  const p = await player();
  clock = T("2026-10-20T10:00:00Z");
  const s = (await start(p)).body;
  clock = T("2026-10-20T10:01:32.341Z");
  const f = await finish(p, s);
  assert.deepEqual({ ...f.body, serverNow: undefined }, { accepted: true, attemptId: s.attemptId, elapsedMs: 92341, serverNow: undefined });
  clock += 3_600_000;
  const again = await finish(p, s);
  assert.equal(again.body.elapsedMs, 92341);
  const conflicting = await finish(p, s, { body: { paths: solvePaths(s.board).slice(1) } });
  assert.equal(code(conflicting), "CONFLICT");
  const entry = await db.doc(`standings/2026-10-20/entries/${p.uid}`).get();
  assert.equal(entry.get("elapsedMs"), 92341);
  assert.equal(code(await start(p)), "ALREADY_FINISHED");
});

test("another player cannot submit someone else's attempt", async () => {
  const [a, b] = [await player(), await player()];
  const sa = (await start(a)).body;
  await start(b);
  clock += 60_000;
  const r = await finish(b, sa);
  assert.equal(code(r), "NOT_FOUND");
});

test("finish at 23:59:59.999 UTC is accepted; at 00:00:00.000 it is rejected whatever the phone says", async () => {
  const [a, b] = [await player(), await player()];
  clock = T("2026-10-20T23:50:00Z");
  const sa = (await start(a)).body;
  const sb = (await start(b)).body;
  clock = T("2026-10-20T23:59:59.999Z");
  assert.equal((await finish(a, sa)).statusCode, 200);
  clock = T("2026-10-21T00:00:00.000Z");
  assert.equal(code(await finish(b, sb)), "SUBMISSION_CLOSED");
  // Starting now opens the NEW day, never the closed one.
  const next = (await start(b)).body;
  assert.equal(next.challengeDate, "2026-10-21");
});

test("forged or malformed submissions are rejected and never change rankings", async () => {
  const p = await player();
  const s = (await start(p)).body;
  clock += 60_000;
  const bad = [
    { body: { paths: solvePaths(s.board).slice(1) }, want: "INVALID_SOLUTION" },
    { body: { seed: "ranked:forged" }, want: "INVALID_SOLUTION" },
    { body: { challengeDate: "2026-10-19" }, want: "NOT_FOUND" },
    { body: { challengeDate: "2026-02-30" }, want: "BAD_REQUEST" },
    { body: { elapsedMs: 1 }, want: "BAD_REQUEST" },
    { body: { uid: "someone-else" }, want: "BAD_REQUEST" },
    { body: { rank: 1, coins: 500 }, want: "BAD_REQUEST" },
    { body: { paths: [[{ x: 0, y: 0 }, { x: 3, y: 1 }]] }, want: "INVALID_SOLUTION" },
  ];
  for (const { body, want } of bad) assert.equal(code(await finish(p, s, { body })), want, JSON.stringify(body));
  const big = await call("POST", `/v1/attempts/${s.attemptId}/finish`, { token: p.token, body: {}, raw: Buffer.alloc(70 * 1024) });
  assert.equal(code(big), "PAYLOAD_TOO_LARGE");
  assert.equal((await db.collection("standings/2026-10-20/entries").get()).size, 0);
  // The genuine solve still works afterwards.
  assert.equal((await finish(p, s)).statusCode, 200);
});

test("ranked starts can be switched off without stranding players mid-attempt", async () => {
  const [a, b] = [await player(), await player()];
  const sa = (await start(a)).body;
  await setFlags({ rankedStartsEnabled: false });
  assert.equal(code(await start(b)), "NOT_OPEN");
  assert.equal((await start(a)).body.attemptId, sa.attemptId);
});

test("implausibly fast finishes are stored but held out of the rankings", async () => {
  const p = await player();
  clock = T("2026-10-20T10:00:00Z");
  const s = (await start(p)).body;
  clock = T("2026-10-20T10:00:05Z");
  assert.equal((await finish(p, s)).body.accepted, true);
  const view = await call("GET", "/v1/leaderboard", { token: p.token, query: { date: "2026-10-20" } });
  assert.equal(view.body.entries.length, 0);
  assert.deepEqual(view.body.me, { rank: null, elapsedMs: 5000 });
});

// ---------------------------------------------------------------- ordering
test("exact ties order by finish time then UID, with ranks 1,2,3 (never shared)", async () => {
  const ps = [await player(), await player(), await player()];
  // ps[0], ps[1]: same start, same finish => same elapsed and finish time -> UID decides.
  await playAt(ps[0], "2026-10-20T10:00:00Z", "2026-10-20T10:02:00Z");
  await playAt(ps[1], "2026-10-20T10:00:00Z", "2026-10-20T10:02:00Z");
  // ps[2]: same elapsed, later finish time -> after both.
  await playAt(ps[2], "2026-10-20T10:00:01Z", "2026-10-20T10:02:01Z");
  const view = await call("GET", "/v1/leaderboard", { token: ps[2].token, query: { date: "2026-10-20" } });
  const [first, second] = [ps[0], ps[1]].sort((x, y) => (x.uid < y.uid ? -1 : 1));
  assert.deepEqual(view.body.entries.map((e) => e.rank), [1, 2, 3]);
  assert.deepEqual(view.body.entries.map((e) => e.elapsedMs), [120000, 120000, 120000]);
  assert.equal(view.body.entries[2].isYou, true);
  assert.deepEqual(view.body.me, { rank: 3, elapsedMs: 120000 });
  const meFirst = await call("GET", "/v1/leaderboard", { token: first.token, query: { date: "2026-10-20" } });
  assert.equal(meFirst.body.me.rank, 1);
  const meSecond = await call("GET", "/v1/leaderboard", { token: second.token, query: { date: "2026-10-20" } });
  assert.equal(meSecond.body.me.rank, 2);
});

// ---------------------------------------------------------------- settlement
async function setupEntrants(n, date = "2026-10-20") {
  const ps = [];
  for (let i = 0; i < n; i++) {
    const p = await player();
    await playAt(p, `${date}T10:00:00Z`, `${date}T10:0${i + 1}:00Z`);
    ps.push(p);
  }
  return ps;
}
const awardsFor = async (uid) => (await db.collection(`players/${uid}/awards`).get()).docs.map((d) => d.data());
const ledgerFor = async (uid) => (await db.collection(`players/${uid}/walletLedger`).get()).docs.map((d) => d.data());

for (const n of [0, 1, 2, 3, 5]) {
  test(`settlement with ${n} entrant(s) awards only occupied podium places`, async () => {
    const ps = await setupEntrants(n);
    if (n === 0) {
      clock = T("2026-10-20T10:00:00Z");
      await start(await player()); // creates the challenge but nobody finishes
    }
    clock = T("2026-10-21T00:05:00Z");
    assert.equal(await settleDate("2026-10-20"), "complete");
    const expected = [500, 300, 150];
    for (let i = 0; i < ps.length; i++) {
      const a = await awardsFor(ps[i].uid);
      if (i < 3) {
        assert.equal(a.length, 1);
        assert.equal(a[0].rank, i + 1);
        assert.equal(a[0].coins, expected[i]);
        assert.equal(a[0].awardId, `daily:2026-10-20:${ps[i].uid}`);
        assert.equal((await ledgerFor(ps[i].uid)).length, 1);
      } else assert.equal(a.length, 0);
    }
    const s = (await db.doc("settlements/2026-10-20").get()).data();
    assert.equal(s.status, "complete");
    assert.equal(s.winners.length, Math.min(3, n));
  });
}

test("settlement refuses an open day and the live day is not finalized", async () => {
  await setupEntrants(1);
  assert.equal(await settleDate("2026-10-20"), "not-closed");
});

test("a disqualification before finalization moves later players up", async () => {
  const ps = await setupEntrants(4);
  await db.doc(`standings/2026-10-20/entries/${ps[0].uid}`).update({ eligible: false, verification: "disqualified" });
  clock = T("2026-10-21T00:05:00Z");
  await settleDate("2026-10-20");
  assert.equal((await awardsFor(ps[0].uid)).length, 0);
  assert.equal((await awardsFor(ps[1].uid))[0].rank, 1);
  assert.equal((await awardsFor(ps[3].uid))[0].rank, 3);
});

test("concurrent and repeated scheduler runs pay each winner exactly once", async () => {
  const ps = await setupEntrants(3);
  clock = T("2026-10-21T00:05:00Z");
  const results = await Promise.all(Array.from({ length: 6 }, () => settleDate("2026-10-20")));
  assert.ok(results.includes("complete"));
  await settleDue();
  await settleDue();
  for (const p of ps) {
    assert.equal((await awardsFor(p.uid)).length, 1);
    assert.equal((await ledgerFor(p.uid)).length, 1);
  }
  const balances = await Promise.all(ps.map(async (p) => (await db.doc(`players/${p.uid}`).get()).get("serverWallet.balance")));
  assert.deepEqual(balances, [500, 300, 150]);
});

test("a crash after each winner resumes on the next run without paying anyone twice", async () => {
  const ps = await setupEntrants(3);
  clock = T("2026-10-21T00:05:00Z");
  for (let crashAfter = 1; crashAfter <= 3; crashAfter++) {
    let paid = 0;
    await assert.rejects(
      settleDate("2026-10-20", { afterWinnerPaid: () => { if (++paid === crashAfter) throw new Error("simulated crash"); } }),
    );
    assert.equal((await db.doc("settlements/2026-10-20").get()).get("status"), "running");
    clock += 6 * 60_000; // lease expires
  }
  assert.equal(await settleDate("2026-10-20"), "complete");
  for (const p of ps) {
    assert.equal((await awardsFor(p.uid)).length, 1);
    assert.equal((await ledgerFor(p.uid)).length, 1);
  }
});

test("a day created while prizes were disabled finalizes without paying", async () => {
  await setFlags({ prizesEnabled: false });
  const ps = await setupEntrants(2);
  await setFlags({ prizesEnabled: true }); // later switch does not retro-pay a frozen day
  clock = T("2026-10-21T00:05:00Z");
  assert.equal(await settleDate("2026-10-20"), "complete");
  for (const p of ps) assert.equal((await awardsFor(p.uid)).length, 0);
  const pub = await call("GET", "/v1/public/leaderboard", { query: { date: "2026-10-20" } });
  assert.equal(pub.body.finalized, true);
  assert.equal(pub.body.entries.length, 2);
});

// ---------------------------------------------------------------- claims
test("claim replays return the same immutable receipts that the game accepts", async () => {
  const ps = await setupEntrants(3);
  clock = T("2026-10-21T00:05:00Z");
  await settleDate("2026-10-20");
  const c1 = await call("POST", "/v1/me/awards/claim", { token: ps[1].token, body: {} });
  const c2 = await call("POST", "/v1/me/awards/claim", { token: ps[1].token, body: {} });
  assert.deepEqual(c1.body.receipts, c2.body.receipts);
  assert.deepEqual(c1.body.receipts, [{ awardId: `daily:2026-10-20:${ps[1].uid}`, playerId: ps[1].uid, date: "2026-10-20", rank: 2, coins: 300, finalized: true }]);
  assert.equal(c1.body.nextCursor, null);
  assert.ok(validPodiumReceipt(c1.body.receipts[0], ps[1].uid, clock));
  assert.equal((await ledgerFor(ps[1].uid)).length, 1, "claiming never mints");
});

test("claims paginate 100 at a time with a stable opaque cursor", async () => {
  const p = await player();
  await call("GET", "/v1/leaderboard", { token: p.token, query: { date: "2026-10-20" } }); // creates player doc
  const batch = db.batch();
  for (let i = 0; i < 101; i++) {
    const date = new Date(T("2026-01-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
    batch.set(db.doc(`players/${p.uid}/awards/${date}`), { awardId: `daily:${date}:${p.uid}`, playerId: p.uid, date, rank: 3, coins: 150, finalized: true });
  }
  await batch.commit();
  const page1 = await call("POST", "/v1/me/awards/claim", { token: p.token, body: {} });
  assert.equal(page1.body.receipts.length, 100);
  assert.equal(typeof page1.body.nextCursor, "string");
  const page2 = await call("POST", "/v1/me/awards/claim", { token: p.token, body: { cursor: page1.body.nextCursor } });
  assert.equal(page2.body.receipts.length, 1);
  assert.equal(page2.body.nextCursor, null);
  const again = await call("POST", "/v1/me/awards/claim", { token: p.token, body: { cursor: page1.body.nextCursor } });
  assert.deepEqual(again.body.receipts, page2.body.receipts);
  assert.equal(code(await call("POST", "/v1/me/awards/claim", { token: p.token, body: { cursor: "garbage!!" } })), "BAD_REQUEST");
});

// ---------------------------------------------------------------- security surface
test("missing, garbage and expired tokens are rejected", async () => {
  assert.equal(code(await call("POST", "/v1/attempts/start", { body: {} })), "UNAUTHENTICATED");
  assert.equal(code(await call("POST", "/v1/attempts/start", { token: "x".repeat(40), body: {} })), "UNAUTHENTICATED");
  const p = await player();
  const [h, payload] = p.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1000) - 3600;
  claims.iat = claims.exp - 3600;
  const stale = `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
  assert.equal(code(await call("POST", "/v1/attempts/start", { token: stale, body: {} })), "UNAUTHENTICATED");
});

test("disabled accounts and banned players are refused", async () => {
  const [a, b] = [await player(), await player()];
  await getAuth().updateUser(a.uid, { disabled: true });
  assert.equal(code(await start(a)), "UNAUTHENTICATED");
  await start(b);
  await db.doc(`players/${b.uid}`).update({ banned: true });
  assert.equal(code(await start(b)), "INELIGIBLE");
});

test("anonymous identities are refused once linked accounts are required", async () => {
  await setFlags({ requireLinkedAccount: true });
  assert.equal(code(await start(await player())), "ACCOUNT_REQUIRED");
});

test("only configured website origins get CORS access", async () => {
  const ok = await call("OPTIONS", "/v1/public/leaderboard", { origin: ORIGIN });
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
  const bad = await call("GET", "/v1/public/leaderboard", { origin: "https://evil.example", query: { date: "2026-10-20" } });
  assert.equal(code(bad), "FORBIDDEN_ORIGIN");
  assert.equal(bad.headers["access-control-allow-origin"], undefined);
});

test("request floods are rate limited", async () => {
  const p = await player();
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await start(p)).statusCode);
  assert.ok(codes.includes(429));
});

test("public API exposes only alias, rank and time — no UID, token or private fields", async () => {
  const ps = await setupEntrants(2);
  const r = await call("GET", "/v1/public/leaderboard", { origin: ORIGIN, query: { date: "2026-10-20" } });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["cache-control"], /^public, max-age=30$/);
  const text = JSON.stringify(r.body);
  for (const p of ps) {
    assert.ok(!text.includes(p.uid));
    assert.ok(!text.includes(p.token.slice(0, 20)));
  }
  for (const e of r.body.entries) assert.deepEqual(Object.keys(e).sort(), ["displayName", "elapsedMs", "rank"]);
  assert.equal(r.body.me, undefined);
  assert.equal(code(await call("GET", "/v1/public/leaderboard", { query: { date: "2026-10-22" } })), "BAD_REQUEST", "future dates");
  const priv = await call("GET", "/v1/leaderboard", { token: ps[0].token, query: { date: "2026-10-20" } });
  assert.equal(priv.headers["cache-control"], "private, no-store");
});
