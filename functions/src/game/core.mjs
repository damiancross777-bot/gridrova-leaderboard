import {missions,recordActivity,weekKey,prefixComplete} from "./activities.mjs";
import { validPodiumReceipt, hasCompletedJourney } from "./leaderboard.mjs";
import { categories, bonusLexicon, banned } from "./vocabulary.mjs";
export const CONTENT_VERSION = 6;
export const tuning = {
  startCoins: 100,
  targetPoints: 10,
  bonusPoints: 5,
  bonusCoins: 2,
  bonusPerBoard: 5,
  practiceBonusDaily: 20,
  dailyCoins: 25,
  loginCoins: 60,
  loginStreakCoins: 150,
  timedPointMultiplier: 2,
  nudgeCost: 15,
  traceCost: 40,
  rescueCost: 100,
  completionCoins: 25,
  chapterCoins: 100,
  rewardCoins: 30,
  adInterval: 300,
  adLevels: 5,
  adLevelsLater: 4,
  adCap: 4,
  rewardCap: 3,
  sessionGap: 1800000,
};
export const directions = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];
const bonusSet = new Set(bonusLexicon);
export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}
export function rng(seed) {
  let a = hash(seed);
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(a, r) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    let j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function profile(level) {
  const phase = (level - 1) % 5,
    stretch = phase === 4,
    ease = phase === 0;
  let size,
    count,
    min = 3,
    dirs = [0],
    max;
  if (level <= 5) {
    size = 5;
    count = stretch ? 4 : 3;
    max = 5;
  } else if (level <= 15) {
    size = 6;
    count = stretch ? 5 : ease ? 3 : 4;
    dirs = [0, 1];
    max = 6;
  } else if (level <= 30) {
    size = level <= 20 ? 6 : 7;
    count = 5 + (stretch ? 2 : ease ? 0 : 1);
    dirs = [0, 1, 2];
    max = size;
  } else if (level <= 60) {
    size = level <= 40 ? 7 : 8;
    count = 6 + (stretch ? 2 : ease ? 0 : 1);
    min = 4;
    dirs =
      level <= 40
        ? [0, 1, 2, 3]
        : level <= 50
          ? [0, 1, 2, 3, 4]
          : [0, 1, 2, 3, 4, 5, 6, 7];
    max = size;
  } else if (level <= 120) {
    size = level <= 80 ? 8 : 9;
    count = 7 + (stretch ? 3 : ease ? 0 : 2);
    min = 4;
    dirs = [0, 1, 2, 3, 4, 5, 6, 7];
    max = size;
  } else if (level <= 200) {
    size = level <= 140 ? 9 : 10;
    count = 9 + (stretch ? 3 : ease ? 0 : 1);
    min = 4;
    dirs = [0, 1, 2, 3, 4, 5, 6, 7];
    max = size;
  } else {
    size = 10;
    count = 10 + (stretch ? 4 : ease ? 0 : 2);
    min = 4;
    dirs = [0, 1, 2, 3, 4, 5, 6, 7];
    max = 10;
  }
  // Teach the search through small boards, not prolonged direction restrictions.
  dirs = level === 1 ? [0,1] : level <= 3 ? [0,1,2,5] : [0,1,2,3,4,5,6,7];
  let columns = size,
    rows = size;
  if (level >= 81 && level <= 120) {
    columns = 8;
    rows = 9;
    max = 9;
  } else if (level >= 121 && level <= 160) {
    columns = 9;
    rows = 9;
    max = 9;
  } else if (level >= 161 && level <= 200) {
    columns = 9;
    rows = 10;
    max = 10;
  }
  return {
    size: Math.max(columns, rows),
    columns,
    rows,
    count,
    min,
    max,
    dirs,
    phase,
    overlap: level <= 3 ? 0.08 : level < 31 ? 0.18 : level < 121 ? 0.26 : 0.36,
    minDirections: Math.min(dirs.length, level <= 30 ? 3 : level <= 60 ? 4 : 5),
    maxPerDirection: Math.ceil(count * (dirs.length === 1 ? 1 : dirs.length === 2 ? 0.65 : 0.45)),
    minCrossings: level <= 3 ? 0 : level <= 15 ? 1 : level <= 80 ? 2 : level <= 200 ? 3 : 4,
    fillerSimilarity: level <= 60 ? 0 : level <= 200 ? 0.12 : 0.2,
    familiarity: "familiar-category-and-subtheme",
    timeMedian: level <= 5 ? 45 : level <= 30 ? 85 : level <= 120 ? 150 : 220,
    timeSource: "provisional-not-human-tested",
  };
}
export function boardDimensions(shape) {
  return typeof shape === "number"
    ? { columns: shape, rows: shape }
    : { columns: shape.columns ?? shape.size, rows: shape.rows ?? shape.size };
}
export function pathBetween(a, b, size) {
  if (!a || !b) return [];
  const { columns, rows } = boardDimensions(size);
  let dx = b.x - a.x,
    dy = b.y - a.y;
  if (dx && dy && Math.abs(dx) !== Math.abs(dy)) return [];
  let n = Math.max(Math.abs(dx), Math.abs(dy));
  if (
    a.x < 0 ||
    a.y < 0 ||
    b.x < 0 ||
    b.y < 0 ||
    a.x >= columns ||
    b.x >= columns ||
    a.y >= rows ||
    b.y >= rows
  )
    return [];
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + Math.sign(dx) * i,
    y: a.y + Math.sign(dy) * i,
  }));
}
export function snapEnd(start, end, size) {
  const { columns, rows } = boardDimensions(size);
  let dx = end.x - start.x,
    dy = end.y - start.y;
  if (!dx && !dy) return start;
  let angle = Math.atan2(dy, dx),
    step = Math.round(angle / (Math.PI / 4)),
    sx = Math.round(Math.cos((step * Math.PI) / 4)),
    sy = Math.round(Math.sin((step * Math.PI) / 4));
  let n = Math.round(Math.max(Math.abs(dx), Math.abs(dy)));
  while (
    n > 0 &&
    (start.x + sx * n < 0 ||
      start.y + sy * n < 0 ||
      start.x + sx * n >= columns ||
      start.y + sy * n >= rows)
  )
    n--;
  return { x: start.x + sx * n, y: start.y + sy * n };
}
export function pathKey(path) {
  let s = path.map((c) => `${c.x},${c.y}`).join(";"),
    rev = [...path]
      .reverse()
      .map((c) => `${c.x},${c.y}`)
      .join(";");
  return s < rev ? s : rev;
}
export function textAt(grid, path) {
  return path.map((c) => grid[c.y]?.[c.x] ?? "").join("");
}
export function occurrences(grid, word) {
  const rows = grid.length,
    columns = grid[0]?.length ?? 0,
    paths = new Map();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      for (const [dx, dy] of directions) {
        const end = {
            x: x + dx * (word.length - 1),
            y: y + dy * (word.length - 1),
          },
          p = pathBetween({ x, y }, end, { columns, rows });
        if (p.length === word.length && textAt(grid, p) === word)
          paths.set(pathKey(p), p);
      }
  return [...paths.values()];
}
export function scanBonus(grid, targets) {
  let out = new Set(),
    rows = grid.length,
    columns = grid[0]?.length ?? 0,
    t = new Set(targets);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      for (const [dx, dy] of directions) {
        let s = "";
        for (let k = 0; k < 8; k++) {
          let xx = x + dx * k,
            yy = y + dy * k;
          if (xx < 0 || yy < 0 || xx >= columns || yy >= rows) break;
          s += grid[yy][xx];
          if (s.length >= 3 && bonusSet.has(s) && !t.has(s)) out.add(s);
        }
      }
  return [...out].sort();
}
export function layoutStats(board) {
  const directionCounts = {}, cells = new Map();
  for (const t of board.targets) {
    const dx = Math.sign(t.path.at(-1).x-t.path[0].x), dy = Math.sign(t.path.at(-1).y-t.path[0].y);
    const d = directions.findIndex(v => v[0] === dx && v[1] === dy);
    directionCounts[d] = (directionCounts[d] || 0) + 1;
    for (const c of t.path) {
      const key = `${c.x},${c.y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([dx,dy]);
    }
  }
  const crossings = [...cells.values()].filter(axes => axes.some((v,i) => axes.slice(i+1).some(w => v[0]*w[1] !== v[1]*w[0]))).length;
  return {directionCounts, directions:Object.keys(directionCounts).length, crossings};
}
export function validateBoard(board) {
  let issues = [],
    { grid, targets, profile: p } = board,
    { columns, rows } = boardDimensions(p);
  if (
    grid.length !== rows ||
    grid.some(
      (row) => row.length !== columns || row.some((c) => !/^[A-Z]$/.test(c)),
    )
  )
    return ["Malformed grid"];
  if (targets.length !== p.count) issues.push("Wrong target count");
  if (new Set(targets.map((t) => t.word)).size !== targets.length)
    issues.push("Duplicate target");
  let occupied = new Set(),
    shared = 0;
  for (const t of targets) {
    let all = occurrences(grid, t.word);
    if (t.word.length < p.min || t.word.length > p.max)
      issues.push("Length: " + t.word);
    if (all.length !== 1 || pathKey(all[0] ?? []) !== pathKey(t.path))
      issues.push("Occurrence: " + t.word);
    if (textAt(grid, t.path) !== t.word) issues.push("Letters: " + t.word);
    let dx = Math.sign(t.path.at(-1).x - t.path[0].x),
      dy = Math.sign(t.path.at(-1).y - t.path[0].y),
      di = directions.findIndex((d) => d[0] === dx && d[1] === dy);
    if (!p.dirs.includes(di)) issues.push("Direction: " + t.word);
    for (const c of t.path) {
      let key = c.x + "," + c.y;
      if (occupied.has(key)) shared++;
      occupied.add(key);
    }
  }
  if (
    shared >
    Math.floor(targets.reduce((s, t) => s + t.word.length, 0) * p.overlap)
  )
    issues.push("Overlap limit");
  const layout = layoutStats(board);
  if (layout.directions < (p.minDirections || 1)) issues.push("Direction variety");
  if (Math.max(...Object.values(layout.directionCounts)) > (p.maxPerDirection || p.count)) issues.push("Direction balance");
  if (layout.crossings < (p.minCrossings || 0)) issues.push("Crossing minimum");
  for (const w of banned)
    if (occurrences(grid, w).length) issues.push("Disallowed: " + w);
  return issues;
}
const alphabet =
  "EEEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOOONNNNNNSSSSSSRRRRRRTTTTTTLLLLDDDDUUUCCCMMPPGGBBFFHHVVWWYKJXQZ";
export function tryGenerate({ id, seed, category, p, words }) {
  const { columns, rows } = boardDimensions(p);
  let r = rng(seed),
    grid = Array.from({ length: rows }, () => Array(columns).fill("")),
    placed = [],
    nodes = 0,
    shared = 0,
    budget = Math.floor(words.join("").length * p.overlap);
  const place = (index) => {
    const used = placed.map(t => directions.findIndex(d => d[0] === Math.sign(t.path.at(-1).x-t.path[0].x) && d[1] === Math.sign(t.path.at(-1).y-t.path[0].y)));
    const counts = used.reduce((out,d) => (out[d]=(out[d]||0)+1,out),{});
    const distinct = new Set(used).size;
    if (distinct + words.length-index < (p.minDirections || 1)) return false;
    if (index === words.length) return distinct >= (p.minDirections || 1) && layoutStats({targets:placed}).crossings >= (p.minCrossings || 0);
    if (++nodes > 300) return false;
    let w = words[index],
      choices = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++)
        for (let d of p.dirs) {
          if ((counts[d] || 0) >= (p.maxPerDirection || p.count)) continue;
          let [dx, dy] = directions[d],
            path = pathBetween(
              { x, y },
              { x: x + dx * (w.length - 1), y: y + dy * (w.length - 1) },
              p,
            );
          if (path.length !== w.length) continue;
          let overlap = 0,
            ok = true;
          for (let k = 0; k < path.length; k++) {
            let c = path[k],
              v = grid[c.y][c.x];
            if (v && v !== w[k]) {
              ok = false;
              break;
            }
            if (v) overlap++;
          }
          // Shared letters should form real crossings, not same-line nesting.
          if (ok && overlap && placed.some(t => {
            const ex=t.path.at(-1).x-t.path[0].x, ey=t.path.at(-1).y-t.path[0].y;
            return dx*ey === dy*ex && t.path.some(c => path.some(v => c.x===v.x && c.y===v.y));
          })) ok=false;
          if (ok && shared + overlap <= budget)
            choices.push({ path, overlap, d });
        }
    // One backward diagonal on levels two and three; later levels mix freely.
    const newDirection = id === 2 || id === 3 ? 5 : null;
    choices = shuffle(choices, r);
    if (index === 0 && newDirection !== null)
      choices = choices.filter((c) => c.d === newDirection);
    if (index > 0 && newDirection !== null)
      choices = choices.filter((c) => c.d !== newDirection);
    // Shuffle ties, then favour underused directions and useful matching-letter crossings.
    const needsCrossing = layoutStats({targets:placed}).crossings < (p.minCrossings || 0);
    choices.sort((a,b) => {
      const score = c => (!counts[c.d] && distinct < (p.minDirections || 1) ? 100 : 0) + (needsCrossing && c.overlap ? 30 : 0) - (counts[c.d] || 0)*5;
      return score(b)-score(a);
    });
    for (const { path, overlap } of choices.slice(0, 24)) {
      let changed = [];
      for (let k = 0; k < path.length; k++) {
        let c = path[k];
        if (!grid[c.y][c.x]) {
          grid[c.y][c.x] = w[k];
          changed.push(c);
        }
      }
      shared += overlap;
      placed.push({ word: w, path });
      if (place(index + 1)) return true;
      placed.pop();
      shared -= overlap;
      for (let c of changed) grid[c.y][c.x] = "";
    }
    return false;
  };
  if (!place(0)) return null;
  let targetLetters = words.join("");
  for (let row of grid)
    for (let i = 0; i < row.length; i++)
      if (!row[i])
        row[i] =
          r() < p.fillerSimilarity
            ? targetLetters[Math.floor(r() * targetLetters.length)]
            : alphabet[Math.floor(r() * alphabet.length)];
  let board = {
    id,
    seed,
    category,
    contentVersion: CONTENT_VERSION,
    profile: p,
    grid,
    targets: placed,
  };
  if (validateBoard(board).length) return null;
  board.bonus = scanBonus(grid, words);
  board.explorerEligible = board.bonus.length >= 3;
  return board;
}
export function safePool(category, p) {
  return categories[category].words.filter(
    (w) =>
      w.length >= p.min &&
      w.length <= p.max &&
      !banned.some(
        (b) => w.includes(b) || [...w].reverse().join("").includes(b),
      ),
  );
}
function pickWords(pool, p, rr, usage = {}) {
  const { columns, rows } = boardDimensions(p);
  const words = shuffle(pool, rr)
    .sort((a, b) => (usage[a] || 0) - (usage[b] || 0))
    .slice(0, p.count)
    .sort((a, b) => b.length - a.length);
  // Retain filler and a mix of lengths even with a larger dictionary.
  const ranked = shuffle(pool, rr).sort(
    (a, b) => (usage[a] || 0) - (usage[b] || 0),
  );
  while (words.reduce((n, w) => n + w.length, 0) > columns * rows * 0.75) {
    const replacement = ranked.find(
      (w) => !words.includes(w) && w.length < words[0].length,
    );
    if (!replacement) break;
    words[0] = replacement;
    words.sort((a, b) => b.length - a.length);
  }
  return words;
}
export function makeBoard({
  id,
  seed,
  category,
  p = profile(id),
  exclude = [],
  allowed = null,
  usage = {},
  maxAttempts = 200,
}) {
  let pool = safePool(category, p).filter(
    (w) => !exclude.includes(w) && (!allowed || allowed.includes(w)),
  );
  if (pool.length < p.count)
    throw Error(
      `Vocabulary shortage ${categories[category].name}: ${pool.length}/${p.count}`,
    );
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let rr = rng(seed + ":words:" + attempt),
      words = pickWords(pool, p, rr, usage);
    let b = tryGenerate({ id, seed: seed + ":" + attempt, category, p, words });
    if (b) return b;
  }
  throw Error("Generation exhausted: " + seed);
}
export async function makeRuntimeBoard({
  seed,
  category,
  p,
  fallback,
  maxAttempts = 200,
}) {
  let pool = safePool(category, p);
  for (
    let i = 0;
    i < Math.min(200, maxAttempts) && pool.length >= p.count;
    i++
  ) {
    if (i % 2 === 0) await new Promise((r) => setTimeout(r, 0));
    let rr = rng(seed + ":" + i),
      words = pickWords(pool, p, rr);
    let b = tryGenerate({ id: 0, seed: seed + ":" + i, category, p, words });
    if (b) return b;
  }
  if (
    !fallback ||
    JSON.stringify(fallback.profile) !== JSON.stringify(p) ||
    fallback.category !== category ||
    validateBoard(fallback).length
  )
    throw Error("No matching validated fallback");
  return {
    ...fallback,
    id: 0,
    seed: "fallback:" + fallback.seed,
    fallback: true,
  };
}
export function localDate(time = Date.now()) {
  let d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function initialState(now = Date.now()) {
  return {
    schema: 1,
    readabilityVersion: 2,
    revision: 0,
    coins: tuning.startCoins,
    completed: [],
    medals: {},
    podium: { receipts: {} },
    best: {},
    palettes: [0],
    ledger: {},
    dailyRewards: [],
    login: { lastDate: null, streak: 0, lastAmount: 0 },
    practiceBonus: {},
    settings: {
      sound: true,
      music: false,
      volume: 1,
      haptics: true,
      reducedMotion: false,
      contrast: false,
      dark: false,
      timer: true,
      tapSelect: false,
      grid: "light",
      palette: 0,
      tutorialDone: false,
      gentleHelp: true,
    },
    active: null,
    events: [],
    notebook: [],
    practiceCounter: 0,
    ads: {
      sessionStarted: now,
      lastSeen: now,
      firstSession: true,
      policyVersion: 1,
      sessionInterstitials: 0,
      newCompletions: 0,
      activeSinceFullscreen: 0,
      rewardDays: {},
    },
  };
}
function event(s, type, data = {}) {
  s.events.push({ type, at: Date.now(), ...data });
  if (s.events.length > 5000) s.events.splice(0, s.events.length - 5000);
}
function award(s, key, amount) {
  if (s.ledger[key]) return false;
  s.ledger[key] = true;
  s.coins += amount;
  return true;
}
function unlockChampion(s, now = Date.now()) {
  if (!hasCompletedJourney(s) || s.achievements?.grandExplorer) return false;
  s.achievements ??= {};
  s.achievements.grandExplorer = {unlockedAt: now};
  event(s, "journey_champion_unlocked");
  return true;
}
// Version once so legacy completion counters cannot trigger an immediate ad on update.
export function upgradeAdPolicy(s) {
  if (s.ads.policyVersion === 1) return s;
  return {...s, ads:{...s.ads, policyVersion:1,newCompletions:0,activeSinceFullscreen:0}};
}
export function canInterstitial(s) {
  const a=s.active;
  return !!(a?.mode === "journey" && a.completed && a.board.id > 10 && a.board.id < 300 &&
    s.ads.newCompletions >= (a.board.id > 100 ? tuning.adLevelsLater : tuning.adLevels) &&
    s.ads.activeSinceFullscreen >= tuning.adInterval &&
    s.ads.sessionInterstitials < tuning.adCap);
}
export function canReward(s, date) {
  return (s.ads.rewardDays[date] ?? 0) < tuning.rewardCap;
}
// Rescue allowance belongs to the puzzle, not to a button or a restarted attempt.
function rescueScope(a) {
  return a.mode === "journey" ? `journey:${a.board.id}` : a.mode === "daily" ? `daily:${a.date}` : `${a.mode}:${a.board.seed}`;
}
export function rescueCount(s, a = s.active) {
  if (!a) return 0;
  return Math.max(s.rescueUses?.[rescueScope(a)] || 0, (a.help || []).filter(h => h.kind === "rescue").length);
}
// Prices follow the puzzle tier, not the player's wallet or ad behaviour.
export function helpPrices(a) {
 const level = a?.mode === "journey" ? Number(a.board?.id) || 1 : 1;
 const tier = level <= 40 ? 0 : level <= 80 ? 1 : level <= 120 ? 2 : level <= 160 ? 3 : level <= 200 ? 4 : 5;
 return {nudge:15+tier*5, trace:40+tier*10, rescue:100+tier*20};
}
// One free nudge OR rescue for a puzzle, never recharged by time or restart.
export function freeHelpUsed(s, a = s.active) {
  if (!a) return false;
  return !!s.freeHelpUses?.[rescueScope(a)] || rescueCount(s,a) > 0 ||
    (a.help || []).some(h => h.kind === "nudge" || h.kind === "rescue");
}
export function reduce(state, action) {
  let s = JSON.parse(JSON.stringify(state)),
    a = s.active;
  switch (action.type) {
    case "MISSION_CLAIM": {
      const mission=missions(s,action.date).find(m=>m.id===action.id);
      if(!mission?.ready||mission.claimed)return state;
      award(s,`mission:${mission.period}:${mission.id}`,mission.coins);
      event(s,"mission_claimed",{id:mission.id,coins:mission.coins});
      break;
    }

    case "CHAMPION_UNLOCK":
      if (!unlockChampion(s)) return state;
      break;
    case "ONLINE_BIND": {
      // First online use binds this save to one online identity. A different UID is ignored here;
      // changing accounts needs the explicit ONLINE_SWITCH below.
      if (typeof action.uid !== "string" || !action.uid || action.uid.length > 128 || s.online?.uid) return state;
      s.online = { uid: action.uid, boundAt: Date.now() };
      break;
    }
    case "ONLINE_SWITCH": {
      if (typeof action.uid !== "string" || !action.uid || action.uid.length > 128 || s.online?.uid === action.uid) return state;
      // Earlier receipts stay as this device's history, but no new prize for another UID is accepted,
      // and queued journey recordings (owned by the old UID) are discarded.
      s.online = { uid: action.uid, boundAt: Date.now(), previous: [...(s.online?.previous || []), ...(s.online?.uid ? [s.online.uid] : [])].slice(-10) };
      s.journeyQueue = [];
      s.journeyRecorded = [];
      event(s, "online_account_switched");
      break;
    }
    case "JOURNEY_BIND": {
      if (!a || a.mode !== "journey" || a.completed || action.seed !== a.board.seed || a.journeyAttempt || typeof action.attemptId !== "string" || !action.attemptId || action.attemptId.length > 128) return state;
      a.journeyAttempt = action.attemptId;
      break;
    }
    case "JOURNEY_RECORDED": {
      if (!Number.isInteger(action.level) || action.level < 1 || action.level > 300) return state;
      s.journeyRecorded = [...new Set([...(s.journeyRecorded || []), action.level])].sort((x, y) => x - y);
      s.journeyQueue = (s.journeyQueue || []).filter((q) => q.level !== action.level);
      break;
    }
    case "JOURNEY_DROP": {
      if (!(s.journeyQueue || []).some((q) => q.level === action.level)) return state;
      s.journeyQueue = s.journeyQueue.filter((q) => q.level !== action.level);
      break;
    }
    case "PODIUM_AWARD": {
      const receipt = action.receipt;
      if (!validPodiumReceipt(receipt, action.playerId, action.now)) return state;
      if (s.online?.uid && action.playerId !== s.online.uid) return state;
      const key = "podium:" + receipt.date;
      if (s.ledger[key]) return state;
      s.podium ??= { receipts: {} };
      if (Object.values(s.podium.receipts).some((r) => r.date === receipt.date)) return state;
      award(s, key, receipt.coins);
      s.podium.receipts[receipt.awardId] = receipt;
      event(s, "podium_award", {date:receipt.date, rank:receipt.rank, coins:receipt.coins});
      break;
    }
    case "RANKED_BIND": {
      if (!a || a.mode !== "ranked" || a.completed || action.seed !== a.board.seed || typeof action.attemptId !== "string" || !action.attemptId) return state;
      if (a.ranked) return state;
      a.ranked = {attemptId:action.attemptId, submitted:false};
      break;
    }
    case "RANKED_SUBMITTED": {
      if (!a?.ranked || a.ranked.attemptId !== action.attemptId || !a.completed) return state;
      a.ranked.submitted = true;
      break;
    }
    case "LOGIN": {
      // Compare calendar dates, not elapsed hours, so DST does not break a streak.
      const dayNumber = (date) => {
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
          return null;
        const time = Date.parse(date + "T00:00:00Z");
        return Number.isFinite(time) &&
          new Date(time).toISOString().slice(0, 10) === date
          ? time / 86400000
          : null;
      };
      const today = dayNumber(action.date),
        previous = dayNumber(s.login?.lastDate);
      if (
        today === null ||
        (previous !== null && today <= previous) ||
        s.ledger["login:" + action.date]
      )
        return state;
      const streak =
        previous !== null && today === previous + 1
          ? (s.login.streak || 0) + 1
          : 1;
      const amount =
        streak % 7 === 0 ? tuning.loginStreakCoins : tuning.loginCoins;
      award(s, "login:" + action.date, amount);
      s.login = { lastDate: action.date, streak, lastAmount: amount };
      event(s, "login_reward", { date: action.date, streak, amount });
      break;
    }
    case "SESSION":
      if (action.now - s.ads.lastSeen >= tuning.sessionGap) {
        s.ads.firstSession = false;
        s.ads.sessionStarted = action.now;
        s.ads.sessionInterstitials = 0;
      }
      s.ads.lastSeen = action.now;
      break;
    case "START": {
      let b = action.board,
        mode = action.mode,
        date = action.date;
      if (mode === "journey" && b.id > Math.min(300, s.completed.length + 1))
        return state;
      if ((mode === "daily" || mode === "ranked") && s.completed.length < 10) return state;
      if (mode === "timed" && s.completed.length < 20) return state;
      if (
        (mode === "practice" || mode === "timed") &&
        b.category > 0 &&
        !s.completed.includes(b.category * 20)
      )
        return state;
      if (mode === "ranked" && (typeof action.ranked?.attemptId !== "string" || !action.ranked.attemptId || action.ranked.attemptId.length > 128)) return state;
      if (mode === "expedition") {
        const week=weekKey(date), progress=s.expeditions?.[week]?.completed||[];
        if(!week||!prefixComplete(s,10)||action.activity?.week!==week||action.activity?.index!==progress.length||progress.length>=5)return state;
      }
      if(mode === "beyond" && (!prefixComplete(s,300)||action.activity?.index!==(s.beyond?.completed||0)))return state;
      let duration = Math.max(
        90,
        Math.min(600, Math.round(b.profile.timeMedian * 1.6)),
      );
      // Carry legacy active-puzzle rescues into durable per-puzzle accounting.
      if (a && rescueCount(s, a)) {
        s.rescueUses ??= {};
        s.rescueUses[rescueScope(a)] = rescueCount(s, a);
      }
      if (a && freeHelpUsed(s,a)) {
        s.freeHelpUses ??= {};
        s.freeHelpUses[rescueScope(a)] = true;
      }
      s.practiceCounter++;
      s.active = {
        board: b,
        mode,
        ...(action.activity ? {activity:action.activity} : {}),
        date,
        instance: `${mode}:${b.seed}:${s.practiceCounter}`,
        found: [],
        bonuses: [],
        score: 0,
        elapsed: 0,
        lastFoundAt: 0,
        stalledShown: false,
        help: [],
        completed: false,
        timedExpired: false,
        untimed: false,
        duration,
        coinReward: 0,
        ...(mode === "ranked" ? {ranked:{attemptId:action.ranked.attemptId,submitted:false}} : {}),
        replay: mode === "journey" && s.completed.includes(b.id),
      };
      event(s, "level_start", { id: b.id, mode, seed: b.seed });
      break;
    }
    case "TICK":
      if (a && !a.completed && !a.timedExpired) {
        let dt = Math.min(5, Math.max(0, action.seconds));
        a.elapsed += dt;
        s.ads.activeSinceFullscreen += dt;
        s.ads.lastSeen = action.now;
        if (a.mode === "timed" && !a.untimed && a.elapsed >= a.duration) {
          a.timedExpired = true;
          event(s, "time_expired");
        }
        if (a.elapsed - a.lastFoundAt >= 45 && !a.stalledShown) {
          a.stalledShown = true;
          event(s, "help_offer");
        }
      }
      break;
    case "SELECT": {
      if (!a || a.completed || a.timedExpired) return state;
      let path = action.path;
      if (
        !path?.length ||
        JSON.stringify(pathBetween(path[0], path.at(-1), a.board.profile)) !==
          JSON.stringify(path)
      )
        return state;
      let text = textAt(a.board.grid, path),
        rev = [...text].reverse().join(""),
        target = a.board.targets.find(
          (t) =>
            (t.word === text || t.word === rev) &&
            pathKey(t.path) === pathKey(path),
        );
      if (target) {
        if (a.found.includes(target.word)) return state;
        if (!a.found.length) event(s, "first_word", { seconds: a.elapsed });
        a.found.push(target.word);
        a.score += tuning.targetPoints;
        a.lastFoundAt = a.elapsed;
        a.missesSinceFound = 0;
        event(s, "target_found", { word: target.word, seconds: a.elapsed });
      } else {
        if (a.mode === "ranked") return state;
        let word = bonusSet.has(text) ? text : bonusSet.has(rev) ? rev : null;
        if (
          !word ||
          word.length < 3 ||
          word.length > 8 ||
          a.board.targets.some((t) => t.word === word) ||
          a.bonuses.includes(word)
        ) {
          if(path.length<3 || a.bonuses.includes(word))return state;
          a.missesSinceFound=(a.missesSinceFound||0)+1;
          event(s,"selection_miss",{id:a.board.id,seconds:a.elapsed});
          break;
        }
        a.bonuses.push(word);
        a.score += tuning.bonusPoints;
        if (!s.notebook.includes(word)) s.notebook.push(word);
        let date = action.date,
          rewardScope =
            a.mode === "journey"
              ? `journey:${a.board.id}`
              : a.mode === "daily"
                ? `daily:${a.date}`
                : ["expedition","beyond"].includes(a.mode) ? `${a.mode}:${a.board.seed}` : a.instance,
          paidBonusCount = Object.keys(s.ledger).filter((k) =>
            k.startsWith(`bonus:${rewardScope}:`),
          ).length,
          canCoins =
            a.bonuses.length <= tuning.bonusPerBoard &&
            paidBonusCount < tuning.bonusPerBoard &&
            !a.replay &&
            (a.mode !== "daily" || a.date === date) &&
            !(a.mode === "daily" && s.dailyRewards.includes(date));
        if (
          (a.mode === "practice" || a.mode === "timed") &&
          (s.practiceBonus[date] ?? 0) >= tuning.practiceBonusDaily
        )
          canCoins = false;
        if (
          canCoins &&
          award(s, `bonus:${rewardScope}:${word}`, tuning.bonusCoins)
        ) {
          a.coinReward += tuning.bonusCoins;
          if (a.mode === "practice" || a.mode === "timed")
            s.practiceBonus[date] =
              (s.practiceBonus[date] ?? 0) + tuning.bonusCoins;
        }
        recordActivity(s, action.date, `bonus:${a.mode}:${a.board.seed}:${word}`, {bonus:1});
        event(s, "bonus_found", { word });
      }
      break;
    }
    case "HELP": {
      if (a?.mode === "ranked") return state;
      if (!a || a.completed || a.timedExpired) return state;
      if (action.id && s.ledger["help:" + action.id]) return state;
      let target = a.board.targets.find((t) => !a.found.includes(t.word));
      if (!target) return state;
      const usedFree = freeHelpUsed(s,a);
      let cost = 0;
      if (action.kind === "nudge") {
        if (usedFree) cost = helpPrices(a).nudge;
      } else if (action.kind === "trace") cost = helpPrices(a).trace;
      else if (action.kind !== "rescue") return state;
      if (action.kind === "rescue" && usedFree) {
        if (action.instance !== a.instance) return state;
        if (action.payment === "coins") {
          if (action.impression || typeof action.id !== "string" || !action.id) return state;
          cost = helpPrices(a).rescue;
        } else {
          // Only the SDK earned-reward callback may supply a fresh receipt.
          if (typeof action.impression !== "string" || !action.impression || s.ledger["ad:" + action.impression]) return state;
        }
      } else if (action.kind === "rescue" && (action.impression || action.payment)) return state;
      if (s.coins < cost) return state;
      if (action.kind === "rescue") {
        const used = rescueCount(s,a);
        if (usedFree && action.payment !== "coins") s.ledger["ad:" + action.impression] = true;
        s.rescueUses ??= {};
        s.rescueUses[rescueScope(a)] = used + 1;
      }
      if (action.kind === "nudge" || action.kind === "rescue") {
        s.freeHelpUses ??= {};
        s.freeHelpUses[rescueScope(a)] = true;
      }
      if (action.id) s.ledger["help:" + action.id] = true;
      s.coins -= cost;
      a.help.push({ kind: action.kind, word: target.word, elapsed: a.elapsed });
      if (action.kind === "rescue") {
        a.found.push(target.word);
        a.lastFoundAt = a.elapsed;
        event(s, "target_revealed", { word: target.word });
      }
      event(s, "help_used", { kind: action.kind, cost });
      break;
    }
    case "CONTINUE_UNTIMED":
      if (a && a.timedExpired) {
        a.timedExpired = false;
        a.untimed = true;
      }
      break;
    case "COMPLETE": {
      if (!a || a.completed || a.found.length !== a.board.targets.length)
        return state;
      a.completed = true;
      if (a.mode === "timed" && !a.untimed)
        a.score +=
          Math.max(0, Math.floor(a.duration - a.elapsed)) *
          tuning.timedPointMultiplier;
      let key = `${a.mode}:${a.board.seed}:${a.help.length ? "assisted" : "independent"}:${a.untimed ? "continued" : "normal"}`;
      s.best[key] = Math.max(s.best[key] ?? 0, a.score);
      if (a.mode === "journey") {
        let id = a.board.id;
        if (award(s, "level:" + id, tuning.completionCoins)) {
          a.coinReward += tuning.completionCoins;
          s.completed.push(id);
          s.completed.sort((x, y) => x - y);
          if (id > 10) s.ads.newCompletions++;
          if (id % 20 === 0 && award(s, "chapter:" + id, tuning.chapterCoins)) {
            a.coinReward += tuning.chapterCoins;
            s.palettes.push(id / 20);
          }
        }
        let medals = s.medals[id] ?? { independent: false, explorer: false };
        s.medals[id] = {
          independent: medals.independent || !a.help.length,
          explorer:
            medals.explorer ||
            (a.board.explorerEligible && a.bonuses.length >= 3),
        };
      } else if (
        a.mode === "daily" &&
        a.date === action.date &&
        award(s, "daily:" + a.date, tuning.dailyCoins)
      ) {
        s.dailyRewards.push(a.date);
        a.coinReward += tuning.dailyCoins;
      }
      if(a.mode === "expedition") {
        const {week,index}=a.activity||{};
        if(week && Number.isInteger(index)) {
          s.expeditions??={};s.expeditions[week]??={completed:[],keepsake:false};
          const progress=s.expeditions[week];
          if(!progress.completed.includes(index))progress.completed.push(index);
          if(progress.completed.length===5){progress.keepsake=true;if(award(s,`expedition:${week}`,60))a.coinReward+=60;}
        }
      }
      if(a.mode === "beyond" && a.activity?.index===(s.beyond?.completed||0)) {
        s.beyond??={completed:0};
        if(award(s,`beyond:${a.activity.index}`,10)){s.beyond.completed++;a.coinReward+=10;}
      }
      const activityScope=a.mode==="journey" ? `journey:${a.board.id}` : a.mode==="daily" ? `daily:${a.date}` : `${a.mode}:${a.board.seed}`;
      recordActivity(s,action.date,`complete:${activityScope}`,{puzzles:1,independent:a.help.length?0:1});
      if (a.mode === "journey") unlockChampion(s);
      // Queue the finished level for "Recorded online" if a server-timed attempt was opened.
      if (a.mode === "journey" && a.journeyAttempt && !(s.journeyRecorded || []).includes(a.board.id)) {
        s.journeyQueue = [
          ...(s.journeyQueue || []).filter((q) => q.level !== a.board.id),
          {
            level: a.board.id,
            attemptId: a.journeyAttempt,
            seed: a.board.seed,
            paths: a.board.targets.map((t) => t.path),
            rescues: a.help.filter((h) => h.kind === "rescue").length,
          },
        ].slice(-300);
      }
      event(s, "completion", {
        id: a.board.id,
        mode: a.mode,
        seconds: a.elapsed,
        help: a.help.length,
        score: a.score,
      });
      break;
    }
    case "LEAVE":
      if (a && !a.completed)
        event(s, "abandon_resume", { id: a.board.id, seconds: a.elapsed });
      break;
    case "RESUME":
      if (a && !a.completed) event(s, "resume", { id: a.board.id });
      break;
    case "SETTING":
      if (action.key in s.settings) {
        if (action.key === "palette") {
          if (!s.palettes.includes(action.value)) return state;
        } else if (action.key === "grid") {
          if (!["light", "heavy", "none"].includes(action.value)) return state;
        } else if (action.key === "volume") {
          if (!Number.isFinite(action.value) || action.value < 0 || action.value > 1) return state;
        } else if (typeof action.value !== "boolean") return state;
        s.settings[action.key] = action.value;
      }
      break;
    case "AD_EVENT":
      event(s, "ad_" + action.event);
      break;
    case "AD_SHOWN":
      s.ads.activeSinceFullscreen = 0;
      if (action.kind === "interstitial") {
        s.ads.sessionInterstitials++;
        s.ads.newCompletions = 0;
      }
      event(s, "ad_show", { kind: action.kind });
      break;
    case "REWARD":
      if (!canReward(s, action.date) || s.ledger["ad:" + action.impression])
        return state;
      if (award(s, "ad:" + action.impression, tuning.rewardCoins)) {
        s.ads.rewardDays[action.date] =
          (s.ads.rewardDays[action.date] ?? 0) + 1;
        event(s, "ad_reward");
      }
      break;
    case "CLEAR_EVENTS":
      s.events = [];
      break;
    default:
      return state;
  }
  if (JSON.stringify(s) === JSON.stringify(state)) return state;
  s.revision++;
  return s;
}
