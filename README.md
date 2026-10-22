# gridrova-leaderboard

Backend and public results page for GridRova's **Daily Podium** (one shared ranked puzzle per UTC day; 500/300/150 coins + gold/silver/bronze medals).

This repository is self-contained. It does not touch any other website, repository or the game folder. Its public page publishes to its own URL:
`https://damiancross777-bot.github.io/gridrova-leaderboard/`

| Folder | What it is |
|---|---|
| `functions/` | Firebase Cloud Functions (TypeScript, Node 24): the v1 HTTP API and the 00:05 UTC settlement job |
| `functions/src/game/` | Unmodified copies of the game's own board generator/validator, vocabulary and receipt checks (hashes in `SOURCE_SHA256.txt`) |
| `firestore.rules`, `firestore.indexes.json` | Deny-all client rules, the ranking index and the rate-limit TTL policy |
| `site/` | Read-only public leaderboard page (no credentials; fetches public scores only) |
| `.github/workflows/` | `ci.yml` runs unit + emulator acceptance tests; `pages.yml` publishes `site/` |

## Status

**Not live.** Nothing has been deployed to Firebase. Ranked starts and prizes are **off by default** (a missing `config/leaderboard` document means off) and stay off until the release gates below are met.

## API (v1)

Base URL: `https://australia-southeast1-<projectId>.cloudfunctions.net/api`

| Route | Auth | Purpose |
|---|---|---|
| `GET /v1/public/leaderboard?date=YYYY-MM-DD` | none | Top 100 (alias, rank, elapsedMs). 30 s cache live, 1 h final |
| `GET /v1/leaderboard?date=` | Bearer ID token | Same plus `isYou` and `me` |
| `POST /v1/attempts/start` | Bearer | Creates or resumes today's single attempt; returns the frozen board |
| `POST /v1/attempts/{id}/finish` | Bearer | Verifies the full solve; time is measured by the server |
| `POST /v1/me/awards/claim` | Bearer | Immutable receipts, 100 per page, replay-safe |
| `GET /v1/leaderboard/nearby?date=&above=0-5&below=0-5` | Bearer | Your position: ≤5 above, you, ≤5 below (≤11 rows); `status` ranked/pending/unranked |
| `POST /v1/journey/start` | Bearer | Opens a server-timed attempt for one journey level (exact v5 board) |
| `POST /v1/journey/{id}/finish` | Bearer | Records a complete, valid, not-too-fast solve (daily cap applies) |
| `GET /v1/journey/progress` | Bearer | Levels recorded online for the caller |
| `GET /v1/champions?cursor=` | Bearer | "Recorded online" gallery, 100/page, signed cursor, no UIDs |
| `GET / POST / DELETE /v1/me/save` | Bearer (linked account) | Private cloud save, optimistic `expectedVersion`, `SAVE_CONFLICT` on races, ≤600 KB |

Every response includes `serverNow`. Errors are `{error:{code}}` using `NOT_OPEN, ALREADY_FINISHED, INELIGIBLE, INVALID_SOLUTION, SUBMISSION_CLOSED, RATE_LIMITED, ACCOUNT_REQUIRED, UNAUTHENTICATED, FORBIDDEN_ORIGIN, BAD_REQUEST, PAYLOAD_TOO_LARGE, NOT_FOUND, CONFLICT`.

## Design decisions

- **Ranked board ≠ relaxed daily board.** The seed is `ranked:<date>:<HMAC(CHALLENGE_SALT,date)>:v1`, so nobody can pre-generate a future board using the generator inside the app, and playing the relaxed daily never reveals the ranked one.
- **Challenges are immutable.** `challenges/{date}` is created once (`create`, never `set`) with its content version, seed, board, prize table and prize on/off status frozen.
- **Ranking:** server elapsed ms ↑, then finish time ↑, then UID ↑. Ranks are 1,2,3, never shared. A player's private rank uses three COUNT aggregations (~1 billed read per 1,000 entrants) instead of scanning the board.
- **Too-fast finishes** (below `minPlausibleElapsedMs`, default 20 s) are accepted and stored but held out of rankings for review.
- **Settlement:** a lease on `settlements/{date}` blocks overlapping runs; winners and final top-100 are written once and never recomputed; each winner is paid in its own transaction guarded by `players/{uid}/awards/{date}`; status becomes `complete` only once every podium place has a receipt. The job also re-checks the previous 7 days.
- **Server wallet ledger:** each prize writes one immutable `walletLedger/prize_daily_<date>` entry with a running balance. Claims only read receipts and never mint anything.
- **Identity:** `verifyIdToken(token, checkRevoked=true)` on every private route. The UID only ever comes from the token. Public aliases are generated (for example "Curious Otter 42"), so players never type names.
- **Region:** `australia-southeast1` (Sydney) for Functions. Create Firestore in the same region. Competition timing is UTC regardless of region.

## Operator switches (`config/leaderboard` in Firestore)

| Field | Default | Meaning |
|---|---|---|
| `rankedStartsEnabled` | false | New ranked attempts allowed. Turning it off is the rollback lever; players mid-attempt can still finish |
| `prizesEnabled` | false | Frozen into each **newly created** day. Settlement only pays days created while this was true |
| `requireLinkedAccount` | false | Refuse anonymous-only identities (turn on after the game adds Google sign-in) |
| `enforceAppCheck` | false | Require `X-Firebase-AppCheck` (turn on only after the app sends it) |
| `minPlausibleElapsedMs` | 20000 | Below this, results are held for review |
| `championsRecordingEnabled` | false | Accept journey-level recordings for the Champions gallery |
| `journeyDailyCap` | 60 | Max new journey levels recorded per player per UTC day (1–300) |
| `cloudSaveEnabled` | false | Private cloud save routes (linked, non-anonymous accounts only) |

To disqualify before settlement, set `standings/<date>/entries/<uid>.eligible = false` and `verification = "disqualified"`. To release a held result, set `eligible = true` and `verification = "verified"`. Finalized podiums are never rewritten.

## Deploying (you run these; nothing here can spend money for you)

1. In the Firebase console, create **two projects**: `gridrova-lb-staging` and `gridrova-lb-prod`. Upgrade both to **Blaze** and set a **budget alert**. Alerts warn you but do not cap spending.
2. In each project, enable **Firestore (Native, australia-southeast1)** and **Authentication → Anonymous**. In Google Cloud → APIs & credentials, restrict the browser API key to Identity Toolkit and Token Service.
3. Locally: `npm i -g firebase-tools`, `firebase login`, then copy `.firebaserc.example` to `.firebaserc`.
4. Copy `functions/.env.example` to `functions/.env.gridrova-lb-staging` (and `…-prod`). Set `ALLOWED_ORIGINS=https://damiancross777-bot.github.io` (staging can add `http://localhost:8000`).
5. Set the secret, using a different long random value per project: `firebase use staging && firebase functions:secrets:set CHALLENGE_SALT`
6. Deploy: `cd functions && npm ci && cd .. && firebase use staging && firebase deploy --only functions,firestore`
7. In the Firestore console, create `config/leaderboard` with `rankedStartsEnabled: true` and `prizesEnabled: true` **on staging only**.
8. Game build (staging): in the game's `.env.local`, set `EXPO_PUBLIC_LEADERBOARD_API_URL` to the staging base URL above and `EXPO_PUBLIC_FIREBASE_API_KEY` to the staging Web API key. Rebuild.
9. Site: set `site/config.json` → `{"apiBaseUrl":"<production base URL>"}` when production is approved. Until then the page shows "being prepared".

Tests: `cd functions && npm test` (unit) and `npm run test:emulators` (needs Java 21+).

## Release gates (prizes stay off in production until all are true)

- [ ] CI green: unit tests + emulator acceptance suite
- [ ] Staging: two or more real devices complete a challenge, a close/settlement issues the correct prizes, repeated claims don't double-pay
- [ ] **Game:** Google sign-in linking and account recovery, then `requireLinkedAccount: true`
- [ ] **Game:** server-authoritative wallet reconciliation (see "Known limitations"), or a release explicitly limited to one installation with no cloud recovery
- [ ] **Game:** App Check (Play Integrity) sending tokens, then `enforceAppCheck: true`
- [ ] **Game:** map the error codes above to friendly messages, and show "official time = server time" in ranked results
- [ ] Production configuration separately approved and deployed

## Champions: what "Recorded online" means

A level counts once it's completed against a server-timed attempt on the exact published board (content version 5, fingerprint 1462119492), with every target found, no faster than `max(8 s, 1.5 s × words)`, and within the daily cap. The gallery entry is created exactly once, when the server holds all 300 distinct level IDs. Offline completions, and version-4 boards embedded in older saves, aren't recorded; replaying those levels online records them. Rescues are stored as reported. They aren't verified purchases, because the wallet is local in this release. Since all journey answers ship in the app, this records completion; it doesn't prove a human played. It's labelled accordingly.

## Nearby ranks: cost and freshness

A player's rank is three COUNT aggregations: Firestore bills about 1 read per 1,000 index entries ahead of the player, cached per player for 60 s (live) or 1 h (closed days). The window around the player uses two keyset queries anchored on the player's own sort key, so it reads ≤10 documents whatever the board size. At 10,000 daily entrants and a refresh a minute that's about 30 reads per refresh. Past ~100k daily entrants, switch to a periodic materialized rank snapshot (scheduled job writing rank into each entry). No offsets or full scans are used anywhere.

## Known limitations

- **The board sent to the app includes the answer paths.** The game's `validateBoard` and local word matching need them. A modified client can read them. Server checks (one attempt, server-measured time, plausibility hold, rate limits) reduce this but cannot prevent it. A stronger design would have the server confirm each word as it's found, which requires game changes. This is not a cheat-proof system and must not be described as one.
- **The coin wallet is still local.** The server keeps an authoritative prize ledger, but the game's spending and earning happen on the device. Cross-device reconciliation, idempotent spend IDs and a one-time migration of the existing balance are game-side work still to do.
- **Anonymous identities** can be recreated freely until Google linking is required.
- **Level 10 eligibility** is checked only by the app. It is a UX gate, not an anti-abuse control.

## Server identity (least privilege)

All three functions (`api`, `settleDaily`, `purgeDeletedAccountSaves`) run as
`gridrova-api@<projectId>.iam.gserviceaccount.com`, not the default compute account (Editor on the whole
project). Create it once per project **before** deploying this code. Grants, derived from the code's
actual Google API calls (reviewed 22 Oct 2026):

| Grant | Scope | Code that needs it |
|---|---|---|
| Cloud Datastore User (`roles/datastore.user`) | Project | All Firestore reads/writes, transactions, COUNT queries, `recursiveDelete` (deletion.ts, settlement.ts, saves.ts, …) |
| Custom role **GridRova auth runtime** = `firebaseauth.users.get` + `firebaseauth.users.delete` | Project | `verifyIdToken(…, checkRevoked)` and `getUsers` (users.get); `DELETE /v1/me` → `deleteUser` (users.delete). The predefined *Authentication Viewer* lacks delete; *Authentication Admin* is broader than needed. |
| Secret Manager Secret Accessor | Secret `CHALLENGE_SALT` only | `defineSecret("CHALLENGE_SALT")`. `firebase deploy` adds this binding on the secret itself. |
| Cloud Run Invoker | Cloud Run services `settledaily` and `purgedeletedaccountsaves` only | Cloud Scheduler calls the scheduled functions with an OIDC token for this identity. |

Not granted: Owner/Editor, Logs Writer (Cloud Run captures stdout/stderr without it), Storage, Pub/Sub,
IAM. The person deploying needs *Service Account User* on `gridrova-api` (project Owners have it).

Acceptance under this identity: deploy, run `scripts/staging-acceptance.mjs` (includes `DELETE /v1/me`,
C16), then **Force run** both Cloud Scheduler jobs and confirm each logs a run with no permission errors.
Both jobs are idempotent (settlement skips closed/complete days; the purge only removes saves of deleted
accounts).

## Rollback

1. Set `config/leaderboard.rankedStartsEnabled = false`. This stops new attempts. Reads, finalized history and prize claims keep working.
2. Set `prizesEnabled = false` so new days won't pay out.
3. Code: `git revert` the change and redeploy. Rules and indexes come back from version control.
4. Site: revert `site/config.json` to `{"apiBaseUrl":""}`.
5. **Never delete data as a rollback.** Receipts, ledgers and settlements are the audit trail.

## Cost assumptions (rough)

Each player-day costs about 10–15 document reads and 6–8 writes, plus one transaction per settlement winner. At 1,000 daily players that's about 15k reads and 8k writes per day, well inside Firestore's free daily quota. Functions invocations at that scale are also within the free tier. Blaze is still required to deploy Functions and Cloud Scheduler (about 3 free jobs per billing account). Check current pricing at https://firebase.google.com/pricing.
