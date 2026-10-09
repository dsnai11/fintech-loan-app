# Scaling, monitoring and security

## What was measured (load test, 50,000 customers)

`npm run loadtest` (in `backend/`) seeds a throw-away database (`fintech-loadtest`) with 50,000 customers, 50,000 loans and about 125,000 EMIs,
starts the server on a free port and sends 100 customers and staff at once for 30 seconds (app start, home, EMI schedule, notifications,
payday status, login, and the heavy staff pages). `--jobs` also times the background jobs; `--skip-seed` reuses the data.
The test machine also runs the database and the load generator, so real hosting should do at least as well.

| | Before | After |
|---|---|---|
| Requests per second | 29 | about 200 to 250 (6 server processes) |
| Failed requests | 62 of 1,310 | 0 |
| Collections queue | 38 s, always failing | about 0.3 s (cached 20 s) |
| Staff dashboard | 39 s | about 0.3 s (cached 60 s) |
| Daily reminder job (22,000 notices, no network) | 54 s, one customer at a time | 32 s, 20 at a time |

What changed: indexes on loans, EMIs and customers (there were none on loans); the collections queue starts from overdue EMIs
instead of reading every running loan; staff search uses indexes; the overdue list is capped; the overdue check writes in batches;
reminders go out 20 at a time. It also fixed a real bug: an EMI that fell due earlier the same day crashed the collections queue.

Rough size: 50,000 customers, all active in one day, is about 1 million requests, an average of 12 per second. Peak hours might be ten times that.
The measured capacity is above that, but measure again on the real hosting plan before launch.

## Running more than one copy

- `WEB_CONCURRENCY=N` starts N server processes in one container (use up to the number of CPUs the plan gives).
- Background jobs take a lock in the database (`joblocks`) before running, so they run once however many copies there are.
  A long run keeps its lock alive. A lock left by a crashed server expires by itself.
- With more than one process the request limits are kept in the database (`RATE_LIMIT_STORE=shared`, automatic when `WEB_CONCURRENCY` > 1;
  `RATE_LIMIT_STORE=memory` forces the old behaviour). If the database cannot be reached the request is let through.
- Settings changed in the portal reach the other copies within 30 seconds (`CONFIG_REFRESH_SECONDS`).
- The host health check is `/api/health/ready` (503 when the database cannot be reached). A deploy waits for it.
- A deploy sends SIGTERM: the server finishes running requests, then closes the database.

## Monitoring and alerts (portal: System health)

- Every response has `X-Request-Id`; failed and very slow requests are logged as one JSON line with that id (never the query string).
- Per-minute traffic from every process is stored for two days: requests, errors, time bands (19 in 20 requests finish within X ms).
- A check runs every minute (on one server) and opens or clears alerts for: database down or slow, many server errors, slow responses,
  a background job that failed or stopped, failed automatic payouts, a critical security setting.
- Alerts reach people by email (`ALERT_EMAILS`) and an optional chat web address (`ALERT_WEBHOOK_URL`, Slack style), at most once an hour per problem.
  Both are set on the System health page, with a "Send a test alert" button. Until one is set, alerts only show on the page.

## Security work done

- Operator injection (`$`/dotted keys in JSON, query and params) is stripped before any route runs.
- API answers are `Cache-Control: no-store`.
- Unexpected (500) errors never show raw text (database errors, field names). The person gets a reference; the detail is in the log under that reference.
- Broken JSON gets a plain 400; oversize bodies 413.
- The server refuses to start in production without `JWT_SECRET`.
- A settings self-check on the System health page, and a critical alert on a real deployment: weak `JWT_SECRET`, open `ALLOWED_ORIGINS`, staff 2FA switched off,
  `ADMIN_RESET_PASSWORD` left set, missing payment webhook secret, database without credentials, and similar.
- Tests: every `/api/admin/*` area refuses a read-only auditor for writes, refuses customers and unsigned requests, and an unknown admin path is super-admin only by default.
- `npm audit` (production dependencies): 0 vulnerabilities at the time of writing.

## Not done: needs outside people or a decision

- **Outside penetration test** by a specialist firm (web, API, both apps). Nothing here replaces it. Fix what it finds, then retest.
- **SOC 2 / ISO 27001**: needs policies, evidence collection over months and an auditor.
- **Personal data at rest**: PAN, Aadhaar reference, bank account numbers and the selfie are stored as normal fields. Field-level encryption with a key kept outside the database is the next step, and it affects search and exports.
- **Database**: use a paid MongoDB plan with automatic backups, point-in-time restore and a tested restore. Keep it on a private network.
- **Web firewall / DDoS protection** in front of the API (Cloudflare or the host's).
- **Secrets**: rotate every key that has ever been pasted in a chat or a file; keep them only in Railway variables.
- **Mobile**: certificate pinning, jailbreak and root detection, and obfuscation of release builds.
- **Disaster recovery plan** and a named person who gets the alerts.
- **Load test on the real plan** with the real number of CPUs, and again after adding the 10 external APIs (each is a new slow dependency).
