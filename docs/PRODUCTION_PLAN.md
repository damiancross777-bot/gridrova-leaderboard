# GridRova leaderboard: production deployment and configuration plan

Status: **plan only.** Production (`gridrova-lb-prod`) is not deployed or activated. Nothing here runs
until every gate in section 1 is met and the owner says go.

## 1. Gates before any production deploy

| Gate | Evidence required | Status (22 Oct 2026) |
|---|---|---|
| Staging acceptance on the deployed commit | `scripts/staging-acceptance.mjs` 17/17 | Done on `a1a9e15` (v6). Rerun after PR #6 + #20 deploy. |
| v6 ranked board live | Acceptance after 00:00 UTC 23 Oct: C5 `contentVersion 6`, `ranked:2026-10-23` | Scheduled for Fri 23 Oct 11:05 Sydney |
| Real prize payout | Genuine phone result settles; exactly one award receipt and one ledger delta; duplicate claims don't re-pay | Pending owner's ranked phone game |
| Least-privilege identity | PR #6 merged; acceptance + forced scheduler runs pass under `gridrova-api` | Done on staging (PR #22/#23, 17/17, both jobs 200 as gridrova-api) |
| Privacy/retention | Pages corrected; tombstone TTL deployed; log retention verified | In progress |
| Game build | Signed release AAB with production config, consent/age tests on real phones | Codex / owner |
| Owner decision | Explicit go for production | Not given |

## 2. One-time project setup (`gridrova-lb-prod`)

1. Blaze billing on; budget alert (e.g. A$10/month).
2. Firestore Native in **australia-southeast1**; Authentication → **Anonymous** provider enabled.
   Email/password stays **off** in 1.0.
3. Secret `CHALLENGE_SALT`: a **new** random value of at least 32 characters, different from staging, entered with
   `firebase functions:secrets:set CHALLENGE_SALT -P gridrova-lb-prod`. It is never shown, logged or committed.
4. `functions/.env.gridrova-lb-prod`: `ALLOWED_ORIGINS=https://phoneporium.au`.
5. Least-privilege runtime identity, the same as staging (README → "Server identity"):
   - custom role `gridrovaAuthRuntime` (`firebaseauth.users.get`, `firebaseauth.users.delete`);
   - service account `gridrova-api` with Cloud Datastore User + GridRova auth runtime (project);
   - Cloud Run Invoker on `settledaily` and `purgedeletedaccountsaves` only, granted after the first deploy
     creates them.
   - **After every deploy**, point both Cloud Scheduler jobs at this identity. `firebase deploy` leaves existing jobs on
     the default compute account (seen on staging, 22 Oct):
     `gcloud scheduler jobs update http firebase-schedule-<settleDaily|purgeDeletedAccountSaves>-australia-southeast1 --location=australia-southeast1 --oidc-service-account-email=gridrova-api@gridrova-lb-prod.iam.gserviceaccount.com`
     Then force-run both jobs and expect HTTP 200 with no ERROR logs.
   - Custom role note: in the console's Add permissions dialog, filter by role "Firebase Authentication Admin"; the two
     `firebaseauth.users.*` permissions are on page 2.
6. Web API key: **API restrictions** to Identity Toolkit API + Token Service API only (as on staging). No
   Android-app restriction: the app calls these by plain HTTPS without the Android package/certificate
   headers, so that restriction would block sign-in.
7. `config/leaderboard` created **with every switch off** before the first deploy (see section 4).

## 3. Deploy

```powershell
cd E:\GAMES\gridrova-leaderboard
git pull
firebase deploy --only functions,firestore -P gridrova-lb-prod
```

Indexes deployed from `firestore.indexes.json`. Wait until all show **Enabled**.
- **Composite (5):**
  - `entries`: eligible↑ elapsedMs↑
  - `entries`: eligible↑ elapsedMs↑ finishedAtMs↑
  - `entries`: eligible↑ elapsedMs↑ finishedAtMs↑ uid↑
  - `entries`: eligible↑ elapsedMs↓ finishedAtMs↓ uid↓
  - `champions`: published↑ completedAtMs↑ galleryId↑
- **Field overrides (3):**
  - `rateLimits.expireAt`: TTL
  - `deletedPlayers.expireAt`: TTL, 30 days
  - `entries.uid`: ascending, collection and collection-group (used by deletion)

The emulator never enforces indexes. A missing index shows up only live, as a 500 error. That's why the
rank-count indexes were added after the 22 Oct staging run.

## 4. Final switches (`config/leaderboard`)

| Field | 1.0 value | Note |
|---|---|---|
| `rankedStartsEnabled` | `false` at deploy → `true` at launch | The launch switch; rollback = false (players mid-attempt keep their attempt) |
| `prizesEnabled` | **owner decision** (planned `true`) | Frozen into each day's challenge when that day's first start creates it |
| `requireLinkedAccount` | `false` | 1.0 is anonymous-only |
| `enforceAppCheck` | `false` | App Check isn't integrated in the 1.0 app |
| `championsRecordingEnabled` | `false` | Champions is out of 1.0 scope |
| `cloudSaveEnabled` | `false` | Out of 1.0 scope |
| `minPlausibleElapsedMs` | `20000` | Finishes under 20 s are held off the board |
| `journeyDailyCap` | `60` | Inactive while Champions is off |

## 5. Smoke checks on production (read-only first)

`scripts/staging-acceptance.mjs` refuses non-staging URLs on purpose, so production gets:
1. Read-only checks: `GET /v1/public/leaderboard?date=<today>` returns JSON; an unknown route returns API
   JSON; `https://phoneporium.au` is allowed by CORS and another origin is refused.
2. With `rankedStartsEnabled=true`: one owner ranked game on the **signed production build**, which appears
   on the public board; then force-run `settleDaily` the next day and collect.
3. Deletion from the production build's Settings for a **separate test install**, never a real player.

## 6. Switching on the public site and the app

- `site/config.json` → `{"apiBaseUrl":"https://australia-southeast1-gridrova-lb-prod.cloudfunctions.net/api"}`
  (push to `main`; the page goes live in about 1 minute).
- Game production env: `EXPO_PUBLIC_ONLINE_ENABLED=true`, `EXPO_PUBLIC_CHAMPIONS_ENABLED=false`,
  `EXPO_PUBLIC_CLOUD_SAVE_ENABLED=false`, `EXPO_PUBLIC_LEADERBOARD_API_URL=<prod URL>`,
  `EXPO_PUBLIC_FIREBASE_API_KEY=<prod web key>`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID=gridrova-lb-prod`.
  `scripts/check-production.mjs` must pass.

## 7. Rollback

1. `rankedStartsEnabled=false`: stops new attempts. Reads, history and claims keep working.
2. `prizesEnabled=false`: affects only days whose challenge isn't created yet.
3. Site: blank `apiBaseUrl` → the page shows "being prepared".
4. Code: `git revert` and redeploy. Firestore data and indexes are untouched by a functions rollback.
