// Pure-logic tests: no emulator needed. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { rankedSeed, generateRankedBoard, parseFinishBody, checkSolution } from "../lib/game.js";
import { isValidDate, closesAt, addDays, utcDay } from "../lib/time.js";
import { generateAlias, safeDisplayName } from "../lib/alias.js";
import { validateBoard, hash } from "../lib/game/core.mjs";

const SALT = "unit-test-salt-0123456789";
const solve = (b) => b.targets.map((t) => t.path);

test("ranked seed is secret-salted, date-specific, and never the relaxed daily seed", () => {
  const a = rankedSeed("2026-10-20", SALT);
  assert.equal(a, rankedSeed("2026-10-20", SALT));
  assert.notEqual(a, rankedSeed("2026-10-21", SALT));
  assert.notEqual(a, rankedSeed("2026-10-20", SALT + "x"));
  assert.notEqual(a, "daily:2026-10-20:v1");
  assert.throws(() => rankedSeed("2026-10-20", "short"));
});

test("same date produces the identical validated 8x8 board for every caller and timezone", async () => {
  const a = await generateRankedBoard("2026-10-20", SALT);
  const b = await generateRankedBoard("2026-10-20", SALT);
  assert.deepEqual(a, b);
  assert.deepEqual(validateBoard(a), []);
  assert.equal(a.grid.length, 8);
  assert.ok(a.grid.every((r) => r.length === 8));
  assert.ok(a.targets.every((t) => t.word.length <= 8));
  // Category comes from the seed, not the device.
  assert.equal(a.category, hash(a.seed.replace(/:\d+$/, "")) % 15);
});

test("thirty consecutive days all generate valid boards", async () => {
  for (let i = 0; i < 30; i++) {
    const b = await generateRankedBoard(addDays("2026-10-20", i), SALT);
    assert.deepEqual(validateBoard(b), [], b.seed);
  }
});

test("a complete solve is accepted, in any order and either direction, with a stable hash", async () => {
  const b = await generateRankedBoard("2026-10-20", SALT);
  const h1 = checkSolution(b, solve(b));
  assert.match(h1, /^[0-9a-f]{64}$/);
  const shuffled = [...solve(b)].reverse().map((p, i) => (i % 2 ? [...p].reverse() : p));
  assert.equal(checkSolution(b, shuffled), h1);
});

test("missing, duplicated, wrong-letter, bent and out-of-bounds paths are rejected", async () => {
  const b = await generateRankedBoard("2026-10-20", SALT);
  const ok = solve(b);
  assert.equal(checkSolution(b, ok.slice(1)), null, "missing target");
  assert.equal(checkSolution(b, [...ok.slice(1), ok[1]]), null, "duplicate target");
  const shifted = ok.map((p, i) => (i === 0 ? p.map((c) => ({ x: c.x, y: (c.y + 1) % 8 })) : p));
  assert.equal(checkSolution(b, shifted), null, "wrong letters");
  const bent = ok.map((p, i) => (i === 0 ? [...p.slice(0, -1), { x: (p.at(-1).x + 3) % 8, y: (p.at(-1).y + 2) % 8 }] : p));
  assert.equal(checkSolution(b, bent), null, "non-straight path");
  const oob = ok.map((p, i) => (i === 0 ? p.map((c) => ({ x: c.x + 8, y: c.y })) : p));
  assert.equal(checkSolution(b, oob), null, "out of bounds");
});

test("finish body is strictly bounded", () => {
  const cell = { x: 1, y: 1 };
  const good = { challengeDate: "2026-10-20", seed: "s", paths: [[cell, { x: 2, y: 1 }]] };
  assert.ok(parseFinishBody(good));
  for (const bad of [
    null, [], "x",
    { ...good, elapsedMs: 1 }, // forged extra fields (elapsed, uid, prize) rejected outright
    { ...good, uid: "someone" },
    { ...good, coins: 500 },
    { ...good, paths: [] },
    { ...good, paths: Array.from({ length: 21 }, () => [cell, cell]) },
    { ...good, paths: [Array.from({ length: 11 }, () => cell)] },
    { ...good, paths: [[cell]] },
    { ...good, paths: [[{ x: 1.5, y: 1 }, cell]] },
    { ...good, paths: [[{ x: -1, y: 1 }, cell]] },
    { ...good, paths: [[{ x: 10, y: 1 }, cell]] },
    { ...good, paths: [[{ x: 1, y: 1, z: 0 }, cell]] },
    { ...good, seed: "s".repeat(201) },
  ])
    assert.equal(parseFinishBody(bad), null, JSON.stringify(bad)?.slice(0, 60));
});

test("UTC date helpers handle invalid dates, DST-irrelevance and midnight close", () => {
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026-10-20"), true);
  assert.equal(new Date(closesAt("2026-10-20")).toISOString(), "2026-10-21T00:00:00.000Z");
  // Sydney DST starts 2026-10-04; London ends 2026-10-25 — UTC days are always 24h.
  assert.equal(addDays("2026-10-24", 2), "2026-10-26");
  assert.equal(utcDay(Date.parse("2026-10-20T23:59:59.999Z")), "2026-10-20");
  assert.equal(utcDay(Date.parse("2026-10-21T10:59:00+11:00")), "2026-10-20");
});

test("aliases are safe public names within 24 characters", () => {
  for (let i = 0; i < 500; i++) {
    const a = generateAlias();
    assert.ok(a.length <= 24 && safeDisplayName(a) === a, a);
  }
  assert.equal(safeDisplayName("<script>"), "Player");
  assert.equal(safeDisplayName("x".repeat(25)), "Player");
});
