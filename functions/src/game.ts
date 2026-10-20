// Pure game logic: board generation and solution checking. No database access here,
// so this file is unit-tested without emulators.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
// Vendored, unmodified copies of the game's own generator/validator (see game/SOURCE_SHA256.txt).
import {
  CONTENT_VERSION,
  hash,
  makeRuntimeBoard,
  validateBoard,
  pathBetween,
  pathKey,
  textAt,
  boardDimensions,
} from "./game/core.mjs";
import { RULES, LIMITS } from "./config.js";

export type Cell = { x: number; y: number };
export type Board = {
  id: number;
  seed: string;
  category: number;
  contentVersion: number;
  profile: any;
  grid: string[][];
  targets: { word: string; path: Cell[] }[];
  bonus?: string[];
  explorerEligible?: boolean;
  fallback?: boolean;
};

const fallbacks: any[] = JSON.parse(
  readFileSync(new URL("./game/fallbacks.json", import.meta.url), "utf8"),
);

/**
 * The ranked seed includes a server-secret HMAC so nobody can pre-generate a future day's
 * board with the generator shipped inside the app. It is deliberately different from the
 * relaxed daily seed (`daily:<date>:v1`), so practising the relaxed daily never reveals the
 * ranked board.
 */
export function rankedSeed(date: string, salt: string): string {
  if (!salt || salt.length < 16) throw new Error("CHALLENGE_SALT missing or too short");
  const mac = createHmac("sha256", salt).update("gridrova-ranked:" + date).digest("hex").slice(0, 20);
  return `ranked:${date}:${mac}:${RULES.boardSeedVersion}`;
}

export async function generateRankedBoard(date: string, salt: string): Promise<Board> {
  const seed = rankedSeed(date, salt);
  const category = hash(seed) % 15;
  const fallback = fallbacks.find(
    (b) => b.category === category && b.difficulty === RULES.contentDifficulty,
  );
  if (!fallback) throw new Error("No Balanced profile for category " + category);
  const board = (await makeRuntimeBoard({ seed, category, p: fallback.profile, fallback })) as Board;
  const issues = validateBoard(board);
  if (issues.length) throw new Error("Generated board failed validation: " + issues.join(", "));
  return board;
}

export const gameContentVersion = CONTENT_VERSION as number;

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Strict structural check of the untrusted finish body. Returns null if malformed. */
export function parseFinishBody(body: unknown): { challengeDate: string; seed: string; paths: Cell[][] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.some((k) => !["challengeDate", "seed", "paths"].includes(k))) return null;
  if (typeof b.challengeDate !== "string" || typeof b.seed !== "string" || b.seed.length > 200) return null;
  if (!Array.isArray(b.paths) || b.paths.length < 1 || b.paths.length > LIMITS.maxPaths) return null;
  const out: Cell[][] = [];
  for (const p of b.paths) {
    if (!Array.isArray(p) || p.length < 2 || p.length > LIMITS.maxCellsPerPath) return null;
    const cells: Cell[] = [];
    for (const c of p) {
      if (!c || typeof c !== "object" || Array.isArray(c)) return null;
      const { x, y } = c as Record<string, unknown>;
      if (Object.keys(c).some((k) => k !== "x" && k !== "y")) return null;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
      if ((x as number) < 0 || (y as number) < 0) return null;
      if ((x as number) >= LIMITS.maxGridDimension || (y as number) >= LIMITS.maxGridDimension) return null;
      cells.push({ x: x as number, y: y as number });
    }
    out.push(cells);
  }
  return { challengeDate: b.challengeDate, seed: b.seed, paths: out };
}

/**
 * Checks that the submitted paths are exactly the board's full target set:
 * every path is a straight in-bounds line in one of the 8 directions, spells a target
 * (either way round) along that target's unique placement, no target twice, none missing.
 * Returns a canonical hash of the solve, or null if it is not a complete valid solve.
 */
export function checkSolution(board: Board, submitted: Cell[][]): string | null {
  const dims = boardDimensions(board.profile);
  if (submitted.length !== board.targets.length) return null;
  const found = new Set<string>();
  const keys: string[] = [];
  for (const path of submitted) {
    for (const c of path) if (c.x >= dims.columns || c.y >= dims.rows) return null;
    const line = pathBetween(path[0], path[path.length - 1], board.profile);
    if (JSON.stringify(line) !== JSON.stringify(path)) return null;
    const text = textAt(board.grid, path);
    const reversed = [...text].reverse().join("");
    const key = pathKey(path);
    const target = board.targets.find(
      (t) => (t.word === text || t.word === reversed) && pathKey(t.path) === key,
    );
    if (!target || found.has(target.word)) return null;
    found.add(target.word);
    keys.push(key);
  }
  if (found.size !== board.targets.length) return null;
  return sha256(keys.sort().join("|"));
}
