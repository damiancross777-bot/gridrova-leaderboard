// Copies the vendored game files verbatim into lib/ (tsc does not emit .mjs/.json sources).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
mkdirSync("lib/game", { recursive: true });
for (const f of readdirSync("src/game")) if (/\.(mjs|json)$/.test(f)) cpSync(`src/game/${f}`, `lib/game/${f}`);
