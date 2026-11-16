# HANDOVER: LIFC Loan Platform

Written 2026-11-16. This is the one document to read first. It is written so that a person, or **any AI model or coding assistant**, can pick the project up cold and keep it working. The many older `.md` files in the repo root (START_HERE, FINAL_SUMMARY, PHASE_*, and so on) are history from earlier stages and may be out of date. **Where they disagree with this file, this file wins.**

> Never put a real secret (password, key, token, connection string) in this file, in chat, or in git. Secrets live only in Railway variables and in the Integrations page of the admin portal.

---

## 1. What this is

A loan platform for the NBFC **LIFC – Laxmi India Finance Ltd.** It has four parts:

| Part | Where | What it is |
|---|---|---|
| **Backend API** | `backend/` | Node 20, Express 4, MongoDB (mongoose 7). Serves the API and also serves the web pages below. |
| **Staff admin console** | `web-portal/*.html` → copied to `backend/public/` | Plain HTML pages, no build step. Reached at `/` on the live site. |
| **LMS console** (loan management for active loans) | `web-portal/lms/` → served at `/lms/` | Separate sign-in and menu from the admin console. |
| **Customer app** | `mobile/` | Flutter 3.24.5 (Android APK, iOS unsigned IPA, and a web build). Built in GitHub Actions. |

Live site: `https://fintech-loan-app-production.up.railway.app` (Railway project `bountiful-cooperation`, service `fintech-loan-app`, MongoDB service on Railway's private network).
Repository: `https://github.com/dsnai11/fintech-loan-app` (branch `main`).

---

## 2. Repository map

```
backend/
  src/app.js            App setup: security headers, CORS, rate limits, route mounting, startup safety checks
  src/index.js          Starts the server and the background jobs
  src/routes/           One file per area (admin*.js = staff only; the rest are customer or public)
  src/services/         Business logic (decision engine, KYC, payments, EMI, LMS, face match, etc.)
  src/models/           54 Mongoose models
  src/middleware/       auth.js (sign-in + staff + permission checks), hardening.js (input cleaning)
  public/               GENERATED copy of web-portal + the Flutter web build. Do not edit by hand.
  scripts/              sync-portal.mjs, encrypt-media.mjs, loadtest.mjs
  test/run.mjs          Test runner; test/suites/*.test.mjs (77 suites); test/lib.mjs helpers
  railway.toml          Deploy settings (health check at /api/health/ready)
web-portal/             Source of the staff console (and lms/ source)
mobile/                 Flutter app (lib/screens, lib/services/api_service.dart, ...)
.github/workflows/      backend-tests.yml, build-apk.yml
HANDOVER.md             This file
```

**Important rule:** edit `web-portal/`, then run `npm run sync-portal` in `backend/` and commit both. CI fails if `backend/public` is out of date.

---

## 3. Run it locally

Needs Node 20+, and MongoDB (local or any URL).

```bash
cd backend
npm ci
cp .env.example .env        # fill MONGODB_URI and a JWT_SECRET (see section 6). .env is git-ignored.
npm run dev                 # http://localhost:5000
```

- Staff console: `http://localhost:5000/`; LMS: `http://localhost:5000/lms/`.
- To create or reset the first super admin locally, set `ADMIN_EMAIL` and `ADMIN_RESET_PASSWORD` in `.env` for one start, then remove `ADMIN_RESET_PASSWORD`. (Do the same on Railway only for emergencies, and remove it straight after.)
- Flutter app: install Flutter **3.24.5** exactly, then `cd mobile && flutter pub get && flutter run`. The API address is the `API_BASE` build define (default is the live Railway address).

---

## 4. Tests

```bash
cd backend
node test/run.mjs                 # all 77 suites (about 8–10 minutes)
node test/run.mjs pricing         # one suite, by name
```

- Needs MongoDB at `TEST_MONGO_URL` (default `mongodb://localhost:27017`). If nothing is on 27017, start any throwaway mongod on another port and set `TEST_MONGO_URL=mongodb://127.0.0.1:<port>`.
- Each suite uses its own database name. `test/lib.mjs` gives `startServer`, `makeAdmin`, `tokenFor`, `client`, `check`, `section`.
- Tests set `BCRYPT_COST=10` and `FACE_MATCH_ENGINE=aws` for speed. The real default (12) is checked in `security-audit.test.mjs`.
- **Two suites guard security and should never be weakened:**
  - `access-control.test.mjs` reads every route from the code and checks that staff routes refuse no-login (401) and customers (403), customer routes refuse no-login, and bad tokens are refused. A new route that is open to the public must be added to its `PUBLIC_OK` list on purpose.
  - `security-audit.test.mjs` checks headers, password rules, token rules, secrets scanning of the source, and so on.
- Convention: every feature ships with a test. Fix a failing test only if the test is wrong; if the code is wrong, fix the code. (Example: the cooling-off double-tap test had to accept either refusal, 409 "busy" or 400 "already closed", because the order depends on timing.)

---

## 5. Ship workflow (do exactly this)

1. Make the change. Run the relevant suite, then the full suite.
2. If you touched `web-portal/`, run `npm run sync-portal` (in `backend/`).
3. `git add -A && git commit` (clear plain-language message) → `git pull --rebase` → `git push`.
4. GitHub Actions then runs:
   - **Backend tests** (Node 20 + Mongo 7): `npm ci`, `npm audit --omit=dev --audit-level=high`, portal-sync check, all tests.
   - **Build APK & IPA & Web** (only when Flutter code changes): builds Android, iOS (unsigned) and Web, and a bot commits `Web app build [skip ci]` containing the new web build.
5. **Pull the bot commit** (`git pull --rebase`) after it appears. The web app is not published until that commit is deployed.
6. Deploy from the **repository root** (not `backend/`):
   ```bash
   railway up --ci --detach --service fintech-loan-app
   ```
   Then wait for the deployment to show SUCCESS (`railway deployment list --service fintech-loan-app`) and check the live site (section 9, "Smoke test").
7. Railway variable changes: `railway variable set KEY --stdin --skip-deploys` does **not** redeploy; run `railway redeploy --service fintech-loan-app -y` afterwards. `railway variable delete KEY` has no `--skip-deploys` flag and may trigger a deploy.

If `railway` says the login is invalid, the owner runs `railway login` in a terminal (it opens a browser). If deploys say "paused temporarily", check Railway billing and usage limits first.

Do not rewrite git history, force-push, or skip hooks without the owner's explicit say-so.

---

## 6. Configuration and secrets

Set these as **Railway service variables**. Names only; values are never written down here.

| Variable | Needed | Notes |
|---|---|---|
| `MONGODB_URI` (or Railway's Mongo variables) | Yes | Database address. Keep the database off the public internet. |
| `JWT_SECRET` | Yes | Random 64 hex characters. The server **refuses to start** in production if it is missing or under 16 characters, and warns under 32. Changing it signs everyone out. |
| `TWO_FACTOR_KEY` | **Yes, do not change** | Holds the *old* JWT secret on purpose. Staff 2FA secrets are encrypted with it. Changing or deleting it locks out every 2FA user. |
| `IDENTITY_KEY` | **Yes, do not change** | Same idea: keeps the duplicate-Aadhaar fingerprints matching. |
| `ALLOWED_ORIGINS` | Yes | The site's own address. Other websites cannot call the API. Native mobile apps send no origin and are not affected. |
| `NODE_ENV` | Yes | `production`. (The app also treats any Railway environment as production.) |
| `DATA_ENCRYPTION_KEY` | Recommended | 64 hex characters. Seals selfies and Aadhaar photos in the database (AES-256-GCM). **Store a copy outside the database; without it the files are unreadable.** To seal old files, back up the database, then run `node scripts/encrypt-media.mjs --apply` once. |
| `ADMIN_ALLOWED_IPS` | Optional | Comma list; the staff API answers only to these addresses. |
| `BCRYPT_COST` | Optional | 10–14, default 12. |
| `API_RATE_LIMIT` / `AUTH_RATE_LIMIT` / `SIGNUP_RATE_LIMIT` | Optional | Defaults 200 / 20 per 15 min, and 30 sign-ups per hour per address. |
| `STAFF_REQUIRE_2FA` | Optional | Two-step sign-in required for every staff role except super admin. |
| `PAYMENT_MODE` | **Launch blocker** | Leave unset until real SMS, email and payment providers are configured. Set `PRODUCTION` only then (it turns every test mode off). Today, sandbox flows (test OTP, sandbox DigiLocker/e-sign/payments) are reachable on the public site. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | When payments go live | Webhook secret is required once live. |
| `EMAIL_SERVICE`, `EMAIL_USER`, `EMAIL_PASSWORD` | Optional | App password, never a normal password. |
| `ADMIN_EMAIL` | Optional | Super admin address (currently `admin@lifc.in`). |
| `ADMIN_RESET_PASSWORD` | **Emergency only** | Resets the super admin password on the next start. Remove it immediately afterwards. |

Provider keys (SMS, KYC, bureau, e-sign, bank verification, etc.) are set on the portal's **Integrations** page (stored in the database through `configService`), not as environment variables.

**Provider honesty rule (keep it):** real provider configured → use it; none configured and not production → clearly marked *test mode*; none configured and production → say "unavailable". Never invent data or silently fake a verification.

---

## 7. Security model (what exists, and rules for changing it)

- **Sign-in tokens:** JWT, algorithm pinned to HS256 on sign and verify. One-purpose tokens (statement link, e-sign) carry `purpose` and are **not** sessions. The database decides the role, not the token. `passwordChangedAt` invalidates older tokens.
- **Staff access:** `adminMiddleware` plus a permissions table in `services/permissions.js` (route pattern → read/write permission). **An admin route that matches no rule is super-admin only.** When adding an admin route, add its rule.
- **Passwords:** bcrypt (cost 12), 8–72 bytes, common-password and simple-pattern blocklist, not the person's own email, phone or name (`services/passwordPolicy.js`). Old hashes are upgraded at next sign-in.
- **Input:** `middleware/hardening.js` cleans request bodies (including `__proto__` / `constructor` keys). Body-size limits are set in `app.js`.
- **Headers:** helmet with a Content-Security-Policy (the portal pages still allow inline scripts: known residual risk), HSTS, frame protection, Permissions-Policy (camera and location only for the site itself), http→https redirect in production.
- **Rate limits:** general API, a stricter one on sign-in, and one on new sign-ups.
- **CORS:** only `ALLOWED_ORIGINS` when set (set in production).
- **Startup guard:** production refuses to start with a missing or weak `JWT_SECRET`.
- **Files:** `.env` and keys are git-ignored. Git history was scanned: only placeholders found.
- **Dependencies:** `npm audit --omit=dev` is 0 vulnerabilities and CI runs it with `--audit-level=high`. When a new advisory breaks CI, run `npm audit fix` in `backend/`, run the full tests, push. Major-version jumps (express 5, mongoose 9, bcryptjs 3, dotenv 18) were deliberately skipped; do them only as their own tested change.
- **Android:** cleartext traffic and backups are off in the manifest. Flutter pins (geolocator_android 4.6.1, play-services-location 21.0.1, file_picker 8.1.6, screen_protector 1.4.2+1) exist because of the pinned toolchain (AGP 7.4.2): do not bump them casually.
- **GitHub Actions** are pinned to full commit SHAs with version comments. Keep them pinned.

---

## 8. What is built (high level)

Customer app and web: sign-up and sign-in (phone/email), PIN on the phone, KYC (PAN, Aadhaar via DigiLocker flow, Aadhaar card photo check, selfie face match and passive blink liveness, bank account with IFSC lookup, e-sign), loan offers, EMI, repayments, cooling-off exit, foreclosure, notifications, referrals/rewards, languages.

Automatic checks that need no paid account: built-in face match and passive liveness (`@vladmandic/human`, wasm), Aadhaar card detection and Verhoeff check digit, OCR (tesseract.js), PAN format (holder-type letter), spelling-tolerant name match, Aadhaar masking, cached IFSC and pincode lookups (`services/freeChecks.js`; endpoints `GET /api/kyc/ifsc/:code` and `/api/kyc/pincode/:pin`). An AWS Rekognition engine is used if AWS keys are configured.

Staff console: customers, decisions/BRE rules, pricing and charges, approvals, collections, partners, leads, employers, offers, mandates, online payments, compliance/AML, regulatory, accounting, SLA, support, roles and permissions, integrations, app home layout, website pages, 2FA for staff, analytics.

LMS console (`/lms/`): active loans, EMI, payments, auto-debit, collections buckets, reconciliation, reminders, reports, bulk assign, call outcomes.

---

## 9. Runbooks

**Smoke test after any deploy**
```bash
U=https://fintech-loan-app-production.up.railway.app
curl -s -o /dev/null -w "%{http_code}\n" $U/api/health          # 200
curl -s -o /dev/null -w "%{http_code}\n" $U/                      # 200 (web app)
curl -s -o /dev/null -w "%{http_code}\n" $U/api/app-config        # 401 (needs sign-in)
curl -sI -H "Origin: https://evil.example" $U/api/pricing | grep -i access-control-allow-origin   # nothing printed
railway logs --service fintech-loan-app | tail -20                 # "MongoDB connected", no errors
```
Then sign in once to the staff console and to `/lms/`.

**Rotate `JWT_SECRET`:** generate 64 random hex, set it, redeploy. Everyone signs in again. Do **not** touch `TWO_FACTOR_KEY` or `IDENTITY_KEY` (see section 6). Pipe the value from a generator straight into `railway variable set JWT_SECRET --stdin`; never print it.

**Locked-out super admin:** set `ADMIN_RESET_PASSWORD` for one deploy, sign in, change the password, then delete the variable. A staff member who lost their authenticator: a super admin can clear their 2FA in the staff screen; they enrol again.

**CI is red:** open the failing job. (a) `npm audit` → see section 7. (b) A single flaky test → check whether it depends on timing; make the test accept every legitimate outcome rather than retrying blindly. (c) "backend/public is out of date" → run `npm run sync-portal` and commit. (d) Flutter build → check the pinned versions in section 7.

**Web app not updating after a Flutter change:** pull the `Web app build [skip ci]` commit, then deploy.

**Database safety:** take a backup before any bulk script (`encrypt-media.mjs`, migrations). Confirm scheduled backups exist in Railway (the owner must confirm; not verified from code).

**Local test database:** start a throwaway mongod on a spare port, set `TEST_MONGO_URL`, and stop only that process afterwards. Never kill all node/mongod processes: the owner's own local backend (port 5000) and database may be running.

---

## 10. Working rules for whoever (or whatever model) continues this

1. **Plain language.** The owner is not a developer. Explain what changed and what they must do, step by step. Use they/them for anyone whose pronouns are not stated.
2. **The owner enters their own secrets.** Never type passwords, keys or tokens into forms for them. Test values on a local dev app are fine. Never print a secret. The git remote must not contain a token (the old one was rotated; pushes now use the Windows credential sign-in).
3. **Compliance, legal, tax and regulatory items** (CKYC upload, Aadhaar storage and masking, bureau reporting, data localisation, charges, RBI/DPDP rules, court/crime checks) must be marked "compliance/finance must confirm" and kept editable, never hard-coded as final.
4. **Confirm before hard-to-reverse or outward-facing actions** (production variable changes, deletes, history rewrites, sending messages, money movement). Report outcomes faithfully, including failures.
5. **Do not touch the owner's local backend/database** or kill processes you did not start.
6. **Never invent data or fake a verification** (provider honesty rule, section 6).
7. **Edit pitfalls on this Windows machine:** shell heredocs and Python strings corrupt backslashes (`\b` becomes a control character). Edit code with the editor tool, not inline scripts, especially for regexes. The repo mixes line endings (git warns LF→CRLF); that is harmless.
8. **Downloads need the owner's permission.** Do not register SSH keys.

---

## 11. Open work, in priority order

**Launch blockers (owner and compliance)**
- Real providers: SMS and email OTP, DigiLocker, PAN, penny drop, credit bureau, e-sign (the chosen vendor is **SprintVerify / PaySprint**; its API documentation and sandbox keys are still needed). Until then, production sign-up codes and KYC rely on test modes. Then set `PAYMENT_MODE=PRODUCTION`.
- Razorpay (payments, webhook secret) live keys.
- Change the super admin password (an earlier startup reset it from the env variable) and turn on 2FA for the super admin, saving the recovery codes.
- Android release keystore (the release APK is currently signed with the debug key), stored outside the repo and added as GitHub secrets; then wire `build-apk.yml` to it. Restrict the Firebase API key in Google Cloud.
- Rotate any token ever pasted in chat or stored in a git remote.
- Spending limits and alerts (Railway, AWS, Anthropic), and confirmed database backups.
- Optional: generate `DATA_ENCRYPTION_KEY`, keep a copy offline, then run `encrypt-media.mjs --apply` after a backup.
- Hosting decision: Railway (paid plan now active) vs AWS Mumbai + MongoDB Atlas for data-in-India. Moving needs a database export, new variables and a rebuilt app pointing at the new address.

**Build next**
- SprintVerify adapter layer covering the applicable APIs, in phases: (1) identity: DigiLocker, PAN, name match, OCR; (2) bank: penny drop, UPI/VPA, IFSC; (3) credit and income: CIBIL/Equifax, CKYC, bank statement analyser, EPFO/ITR; (4) fraud: mobile-to-PAN, telecom, VPN/proxy check, reverse geo, court/crime (compliance decides); (5) business loans only if added. Each with an on/off switch, cost log, caching, saved masked results and a fake-response test. Call expensive APIs late in the journey.
- Remaining free checks: pincode-to-state check at sign-up, bank statement analysis from uploaded PDFs, free IP/VPN check, a "free checks" summary on each customer file.
- Dedupe suite: face-vs-other-accounts search, fuzzy possible-duplicate review with link/block, "do not lend" list, write-off approval.
- Admin portal usability: a "My work today" home, global search, tabbed customer page, a "What's live" page.
- Super admin mandatory 2FA; move Flutter token storage from SharedPreferences to `flutter_secure_storage`; tighten the portal CSP (remove inline scripts).
- Real-device tuning of face-match thresholds (currently 80 and 45); enable BRE rules; build and install fresh app builds on phones.
- Compliance sign-offs listed in section 10, rule 3.

---

## 12. Starter prompt for a different AI model

Paste this at the start of a new session with any coding assistant:

> You are continuing a production fintech loan platform. Read `HANDOVER.md` in the repository root fully before doing anything, then follow section 5 (ship workflow), section 10 (working rules) and section 4 (tests). Do not change production variables, delete data, rewrite git history or send anything outward without asking me first. Never ask me to paste secrets into chat. Explain results in plain language. Start by running the backend tests and telling me the state of the project and the open items in section 11.

---

*Keep this file current: when you change the workflow, variables or open items, update the relevant section in the same commit.*
