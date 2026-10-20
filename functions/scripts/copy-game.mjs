// Copies the vendored game files verbatim into lib/ (tsc does not emit .mjs/.json sources).
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("lib/game", { recursive: true });
for (const f of ["core.mjs", "vocabulary.mjs", "vocabulary-expansion.mjs", "leaderboard.mjs", "fallbacks.json"])
  cpSync(`src/game/${f}`, `lib/game/${f}`);
