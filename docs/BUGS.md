# PlantOps — Bugs and issues

The one list of problems in what is already built: PlantOps apps, the WhatsApp bot, hosting and jobs. The owner keeps
it; Claude adds to it when asked ("add this to the bugs") or when something is found. New features and ideas go in
`docs/TODO.md`, not here. Full history of B-01 … B-17 (evidence, fixes, checks): `docs/STABILITY_PLAN.md` section 4.

**Priority:**
- **P1:** wrong data, data leak, money wrong, or an alert / order never arrives. Fix at once.
- **P2:** a feature broken or unreliable. Fix this week.
- **P3:** confusing, slow or cosmetic. A later patch.

**Status words:** open · investigating · fix built (version, not live) · waiting check (who) · closed (date) · accepted
(won't fix).

## Open

| ID | Pri | Where | Issue | Status / next step |
|---|---|---|---|---|
| B-19 | P1 | Bot (Railway) | 2026-10-24: container stopped at 20:11 IST (`SIGTERM`), next start 21:59. If nobody restarted it, WhatsApp customers got no answer for ~1 h 48 min | **investigating.** Owner: Twilio Monitor → Errors, any 11200 in that window; call those customers back. Then decide whether a stop alert is needed |
| B-03 | P1 | Platform | People log in many times a day | **waiting check.** Login records live since v0.25.2. Claude: read them (read-only) and name the cause. Owner: ask Dillip and Gaja which phone and how they open PlantOps |
| B-04 | P1 | Attendance | Location check effectively off: plant 001's circle is still 2,000 m (should be 300 m) | Code fixed (v0.25.3, ±150 m). **Owner deferred (2026-10-19):** set plant 001's circle to 300 m standing outside. Claude then reads the next marks and closes it |
| B-01 | P1 | Timed jobs | Jobs started hours late on GitHub; moved to cron-job.org 2026-10-18 | **waiting check.** Claude: start times of the timed alerts are within 5 min of their hour over a week, then close |
| B-02 | P2 | Document Store | Email dropped; expiry alerts go by app only, so people must have phone notifications on | Code live (v0.25.1). **Owner:** everyone who must hear about expiries turns on phone notifications; one document expired since 31 Mar 2026 (renew or archive) |
| B-17 | P2 | Order Capture, Complaint Box, Attendance, Floor Stock | An alert that couldn't reach the platform waits until the module's next timed job (next morning for Order Capture / Complaint Box) | **Owner to answer:** hourly resend route called by cron-job.org (no new service, no schema) |
| B-09 | P2 | All | No uptime check | Error log live (v0.25.5). **Owner:** make the UptimeRobot account (once a day per address) |
| B-07 | P2 | Notifications | Too many alerts, most never read | **Owner:** switch Lab Records off for 001 (or set "no tests today" to Off); resolve the open complaints. A daily-summary option is in TODO |
| B-06 | P2 | All | Trials done on the real plant | Demo plant 999 exists. **Claude, when the owner says:** finish the demo trials (list in STABILITY_PLAN B-06) |
| B-11 | P3 | Job applications | Hourly send limit in memory; may count Railway's proxy address, not the phone | open: check, then fix |
| B-13 | P3 | Floor Stock | History pages stop at 120 counts / 60 days | open: later |
| B-14 | P3 | Lab Records | Form 3 "Record of Test Report" prints empty | open: ask a plant what it should show |
| B-18 | P3 | Bot | "Redis error:" log lines are empty (the bot prints only the error text, which is blank for connection failures), so the cause can't be read | open: one-line fix to print the error code (bot `src/server.js`), with the next bot release |

## Closed / accepted

| ID | Where | Issue | Closed |
|---|---|---|---|
| B-20 | Bot (Railway) | `BOT_ORDERS=on` saved in Railway but never deployed: bot stayed in pilot mode 19:34–22:21 IST on 2026-10-24, other customers' orders went to the Sheet as leads | 2026-10-24: deployed (`605e3992`). Rule: after a variable change click Deploy / Redeploy, never Restart, and read the startup line |
| B-05 | Floor Stock | Count saved after midnight took the next day | v0.25.3 live; owner checked 16 / 17 Oct (2026-10-19) |
| B-08 | All | Tests not run automatically | 2026-10-19 (GitHub `ci.yml`) |
| B-10 | Floor Stock | Platform down during a save → wrong alert title | v0.25.4 live |
| B-15 | Order Capture | 2 thank-yous failed on 14 Oct (Twilio token, fixed) | closed |
| B-16 | Database | Feared running out of connections | closed (`max_connections` 500) |
| B-12 | Platform | Login rate limit in memory, resets on deploy | accepted for v1 |

## How to add one

Next free ID: **B-21**. Add a row under Open with the date in the issue text, where it happens, what goes wrong and
what is known so far. Claude sets the priority with a reason; the owner can change it.
