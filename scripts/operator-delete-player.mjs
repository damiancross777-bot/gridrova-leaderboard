#!/usr/bin/env node
// Emailed deletion requests: delete the online data of an anonymous player by their in-game player name.
// Dry run by default. Uses YOUR Google credentials (Application Default Credentials), never a key file.
// Easiest place to run it: Google Cloud Shell (already signed in):
//   git clone https://github.com/damiancross777-bot/gridrova-leaderboard && cd gridrova-leaderboard/functions
//   npm ci && npm run build && cd ..
//   node scripts/operator-delete-player.mjs --project gridrova-lb-staging --name "Amber Heron"          # dry run
//   node scripts/operator-delete-player.mjs --project gridrova-lb-staging --name "Amber Heron" --yes    # delete
// Refuses when no account or more than one account has that name, or the account was active in the last
// 30 days (that player can use Settings -> "Delete my online data" in the app instead).
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []),
);
if (typeof args.project !== "string" || typeof args.name !== "string") {
  console.error('Usage: node scripts/operator-delete-player.mjs --project <projectId> --name "<player name>" [--yes]');
  process.exit(2);
}
process.env.GOOGLE_CLOUD_PROJECT = args.project;
process.env.GCLOUD_PROJECT = args.project;
const { operatorDeleteByName, MIN_INACTIVE_DAYS } = await import("../functions/lib/operator.js");
const result = await operatorDeleteByName(args.name, { execute: args.yes === true });
const say = {
  "not-found": "No account has that player name. Nothing was deleted.",
  ambiguous: "More than one account has that player name. Nothing was deleted; ask for another detail (e.g. a date and finish time).",
  "recently-active": `The account was active ${result.inactiveDays} day(s) ago (less than ${MIN_INACTIVE_DAYS}). Nothing was deleted; ask the player to use Settings > Delete my online data on that phone.`,
  "would-delete": "Dry run: this account would be deleted. Re-run with --yes to delete it.",
  deleted: "Deleted: the account, its ranking/attempt/prize records, and its sign-in. Final standings now show 'Deleted player'.",
}[result.outcome];
console.log(JSON.stringify({ project: args.project, name: args.name, ...result }, null, 2));
console.log(say);
process.exit(result.outcome === "deleted" || result.outcome === "would-delete" ? 0 : 1);
