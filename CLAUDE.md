# PlantOps – Project Brief

Working name: PlantOps .
A multi-tenant SaaS platform for RO / packaged-drinking-water manufacturing plants, sold to other plants.

## Repo layout
One monorepo (pnpm workspaces + Turborepo) at ~/projects/plantops_platform. Each app is still deployed
independently, with its own URL, Docker image and database schema.
- `apps/platform` — platform shell (auth, tenants, plans, launcher, SSO)
- `apps/lab-records`
- `apps/document-store`
- `apps/floor-stock`
- `apps/complaint-box` (built before Preventive Management, decided by the owner 2026-10-11)
- `apps/order-capture` (built before Preventive Management, decided by the owner 2026-10-12)
- `apps/preventive-mgmt`
- `apps/amc`
- `apps/attendance-salary` (version 1 = attendance, built before Preventive Management, decided by the owner
  2026-10-15; v0.18.0. Version 2 = salary, v0.20.0, 2026-10-17. Office staff + Supervisor roles, v0.23.0)
- `apps/job-applications` (public job page + applicants for owner / HR desk; built before Preventive Management, decided
  by the owner 2026-10-17; v0.25.0)
- `apps/marketing-contacts`
- **Not in this repo:** the Bluemins WhatsApp bot, a separate private repo (`github.com/bluemins/order_handoff`,
  local clone `~/projects/order_handoff`; moved from the old repo 2026-10-20). Goal and the PlantOps changes it needs: "WhatsApp bot integration" below.
- `packages/auth` — SSO token verification + role guards, used by every module
- `packages/ui` — shared UI components (tiles, buttons, forms)
- `packages/types` — shared TypeScript types (token payload, roles, plan JSON)
Apps import shared code only from `packages/*`, never from another app. This CLAUDE.md covers the whole repo;
module-specific notes go in `apps/<module>/NOTES.md` once that phase starts.

## Architecture: one platform, independent module apps
PlantOps is a **platform shell** (identity, tenants, plans, launcher) plus independent **module web apps** that
plug into it. Each module is its own codebase/app with its own URL, database tables, and business logic. The
platform never contains module business logic; modules never contain login/tenant logic.

Batch ID is the glue that links lab, stock and production data across modules. **Lab Records owns the batch
record.** Other modules store `batch_id` as a plain reference (no cross-database foreign key) and look batches up
through the Lab Records API.

## Users and roles
- **super_admin** (Rocky): creates/manages tenant_admin accounts; enables modules per tenant; sets plan/limits;
  sees all tenants. super_admin can also **see every module's data for every plant** (pick a plant from a
  drop-down): read-only and audited, so the plant can see when PlantOps support looked. Planned in Phase 2,
  built into each module from Phase 3.
- **tenant_admin** (plant owner): owner of one plant/tenant; manages their plant's users/roles; gets read-only
  summaries for modules they don't operate directly; can export reports.
- Module-level operational roles (examples): lab technician (Lab Records), lab lead (Lab Records: a lab
  technician who can also approve batches, release holds, verify records and set limits), store keeper (Floor
  Stock), maintenance technician (Preventive Management). Each sees only the module(s)/data it's entitled to.
- **Plant staff** (`plant_staff`): marks **"this person is an employee"** (owner, 2026-10-15). Every employee can hold
  it next to their work role (e.g. Store keeper + Plant staff). It works **only** in `PLANT_STAFF_MODULES`
  (Attendance & Salary: own attendance and overtime; their own salary slip only when the owner ticked "Can see own
  salary", only for paid months; salary is otherwise owner-only), and may **view** Order Capture
  (`PLANT_STAFF_VIEW_ONLY` + `viewOnlyIn()`, owner 2026-10-14): orders, customer, phone, products and quantities,
  never amounts, never writes, never its alerts. Work in any other module needs that module's own role (Store
  keeper, Document keeper, Complaint desk, Order desk, Lab technician / lead, Maintenance technician, Sales team).
  New modules do **not** include plant staff. The rule is `roleWorksIn()` in `packages/types`; "is an employee"
  (tracked and paid in Attendance) is `isEmployee()` = holds Plant staff.
- **Office staff** (`office_staff`) and **Supervisor** (`supervisor`), Attendance & Salary only (owner, 2026-10-17;
  v0.23.0, `docs/ATTENDANCE_ROLES_PHASE_PLAN.md`). Office staff mark IN / OUT for people without a phone ("Mark for
  someone", office phone at the plant), fix times and give advances, never for themselves, and never see a salary,
  slip or claim. A Supervisor sees the Today board read-only, gets a bell for every IN / OUT and the morning
  "not marked" alert, and marks / fixes the Office staff's IN / OUT (only them, never themselves; owner 2026-10-19,
  v0.26.1). Neither is tracked or paid unless they also hold Plant staff. Inside Attendance a person's roles
  become a set of capacities (owner, employee, office, supervisor) in one access table (`src/server/access.ts`).
- **HR desk** (`hr_desk`), Job applications only (owner, 2026-10-17; v0.25.0): sees every application, calls /
  WhatsApps, changes the status and adds notes. Openings, CSV and "Remove now" are owner-only. Plant staff never work in
  Job applications. Its public page (`jobs.bluemins.life`, `/<plant code>`) is the **only PlantOps page strangers can
  write to**, without a login; the plant comes from the address only (`GET /api/m/plants/by-code/:code`, Job
  applications' credentials only, one 404 for every refusal).
- **View-only roles** (owner, 2026-10-19; v0.27.0, `docs/VIEW_ROLES_PHASE_PLAN.md`): **Stock viewer** (Floor Stock,
  only the sections the owner ticks for that person), **Document viewer** (Document Store) and **Order viewer** (Order
  Capture, no amounts). Each opens its one module read-only (`VIEW_ROLE_MODULE` + `viewOnlyIn()`), never works there
  (`roleWorksIn` false), and gets alerts only if the owner ticks them (`getsAlertsIn`; never Order Capture). New modules
  get a view role only when the owner asks.
- A user can hold **more than one role** (e.g. lab technician AND store keeper in a small plant). tenant_admin
  is a role in `users`/`user_roles`, not a separate account type.
- Login: plant users log in with **plant code + username + secret**. Staff use a 6-digit **PIN**; anyone holding
  tenant_admin uses a **password** (min 10 chars). New users get a random temporary PIN/password (shown once to
  whoever created them) and must replace it at first login. tenant_admin creates staff, edits their details
  (name, mobile, email, roles) and resets their PINs; super_admin creates owners and can see/edit any user of any
  plant (including username) and reset anyone's PIN/password. A reset is always temporary (typed by the admin or
  random) and must be replaced at next login. super_admin logs in separately (email + password).
- Enforce all of this on the SERVER in every module, not only in the platform UI.

## Login and launcher flow
1. User logs in once, on the main PlantOps platform (shared login).
2. Platform checks: modules enabled for this tenant (set by super_admin) + this user's roles.
3. Launcher shows only the module tiles this tenant+roles are entitled to (owner sees read-only summary tiles
   for all enabled modules + locked tiles for modules not enabled; staff see only the working module(s) their
   roles give them).
4. Clicking a tile sends the user to that module's own URL with a **one-time handoff code** (never the token
   itself in the URL). The module exchanges the code server-to-server with the platform for the SSO token.
5. Each module app verifies the token and independently enforces role checks. Never trust platform tile-hiding
   as the only access control.
6. **Staff use modules directly from their phones.** A module's own URL (home-screen icon) works without the
   launcher: a module with no session sends the user to the platform (`/sso/start?module=<id>`), which returns
   them with a one-time code — straight away if already logged in, after the login screen if not.
7. **Single-module staff skip the launcher** and land directly in their module. Multi-role staff and owners see
   the tile screen.
8. Owner dashboard tiles show the same data staff enter — read live from each module's summary endpoint when the
   dashboard opens/refreshes. Never a copy.

**SSO token (the single source of truth for its contents):** JWT (EdDSA / Ed25519, header `kid`) with
`iss` ("plantops-platform"), `aud` (the one module it is for), `iat`, `exp` (15 min), `jti`, `tenant_id`,
`user_id`, `roles[]`, `enabled_modules`. Modules verify with the platform's public key
(`/.well-known/jwks.json`) only, so a module can never mint tokens. The module then keeps its own session for up
to one shift (12 h) and re-checks `GET /api/m/tenants/:tid/users/:uid/status` every 5 minutes, so a disabled user
or removed role loses access within ~5 minutes.

**Other platform-signed tokens** (same key, never accepted as a login: they carry `purpose` and no
`user_id`/`roles`; `verifyToken` rejects anything with `purpose`):
- **Summary request** (built, Phase 2): `purpose: "summary"`, `tenant_id`, `view` ("owner" | "staff" | "desk"),
  `aud` = one module, `exp` 60 s. Modules check it with `verifySummaryRequest` (`packages/auth`). `desk` (v0.23.0) is
  sent to a non-owner holding one of the module's `DESK_ROLES` (`packages/types`; Attendance: Office staff,
  Supervisor), who see the attendance numbers but never money; a module that doesn't know `desk` treats it like
  `staff`.
- **Support token** (built in Phase 3; Lab Records is the first module to accept it): super_admin opens one
  plant's module data read-only. One-time code like a user handoff → token with `purpose: "support"`, `tenant_id`,
  `super_admin_id`, `read_only: true`, `aud` = one module, `exp` 15 min. Modules accept it only through a
  `verifySupportToken`, refuse every write with it, and log each view in an audit trail the plant owner can
  see ("PlantOps support viewed Lab Records, 5 Oct 10:42").

**Launcher tiles (contract, Phase 2):** the platform calls `GET <module base_url>/api/plantops/summary` with
`Authorization: Bearer <summary request token>` (3 s timeout) whenever a launcher opens. The module answers
`{ "badges": [{ "text": "3 held today", "tone": "ok" | "info" | "warn" | "danger" }] }` (max 3 badges, 40
characters each). A timeout, error or bad answer shows "Numbers unavailable right now"; the launcher keeps
working. Nothing is stored. The request's `view` says whose tile it is (owner, staff, or `desk` for a module's
`DESK_ROLES`, v0.23.0).

**Plant look:** each plant's screens use its brand colour (Business details). `brandPalette()` in
`packages/ui` turns it into CSS variables (`--brand`, `--brand-hover`, `--brand-contrast`, `--brand-soft`,
`--brand-ring`), with dark text automatically on light colours. Modules get the colour and logo from
`GET /api/m/tenants/:tid/branding` (`fetchBranding`/`fetchLogo` in `packages/auth`). super_admin and login
screens stay PlantOps blue.

**Every module app must** (all in `packages/auth`, wired up once by `createModule()` in `packages/module-kit`;
`apps/lab-records`, `apps/document-store`, `apps/floor-stock`, `apps/complaint-box`, `apps/order-capture`,
`apps/attendance-salary` and `apps/job-applications` use it; Job applications lands logins on `homePath: "/applications"`
because its `/` is the public page):
`startModuleSession` at `/sso/callback`, keep the session with `sealSession`/`openSession` (own
`SESSION_SECRET`, ≥ 32 chars), call `refreshModuleSession` on every request (12 h shift, 5-min re-check,
15-min grace if the platform is unreachable), send users without a session to
`<PLATFORM_URL>/sso/start?module=<id>&next=<path>`, serve the summary endpoint, and link "Account" to
`<PLATFORM_URL>/home?launcher=1`. For the support view: `startSupportSession` at `/sso/support`, a separate
support cookie (`sealSupportSession`/`openSupportSession`), refuse every write with it, and log each page view
where the owner can see it. `apps/lab-records` is the reference module. Owner notifications (bell + phone) go
through `kit.notify(tenantId, input)` after the answer, never blocking the action (CLAUDE.md "Notifications").
**From day one (N5+):** a new module's phase plan lists its notification events (who receives each, text, link,
dedupe key, action or scheduled job, level, urgent or not), adds them to `NOTIFICATION_KINDS`, gives the module a
`notification_outbox` (+ `outbox_tenants()`) and `kit.retryOutbox()` in its jobs, and tests each event. The
prompt to add to a module phase is in `docs/notifications.md` ("N5+").

## Plans and limits (centralized)
- Central `tenant_plan` record per tenant: enabled modules + limits as flexible JSON. Limits are both
  platform-wide (e.g. max users across the plant) and per-module (storage, batches/month, etc.).
- SSO token stays small (see the token definition above) — it NEVER carries limits.
- Billing/renewals are handled manually (invoicing outside the app) in v1.
- Each module calls `GET /tenants/:id/plan` on the platform API, caches briefly, tracks its own usage, compares
  against the central limit.

## Multi-tenancy and deployment
- Default: all tenants share one database, isolated by `tenant_id` + Postgres row-level security.
- Row-level security rules:
  - One Postgres server; each app gets its own schema and its own database user. An app never reads another
    app's schema directly — it calls that app's API.
  - Apps never connect as the table owner (owners skip RLS); every tenant table uses
    `FORCE ROW LEVEL SECURITY`.
  - The current tenant is set with `SET LOCAL` inside each transaction, so it is safe with connection pooling.
- Two hosting options only:
  - **Shared (default, every plant):** all plants use the same tables in each app's schema (e.g. one
    Lab Records table for everyone), separated by `tenant_id` + RLS. Adding a plant adds rows, not databases.
  - **Dedicated (paid upgrade):** the plant gets its own full copy of PlantOps — its own database and app
    containers, optionally its own subdomain and branding. It runs the same code and the same release, set up
    only through environment variables (`MODE=dedicated`, its own `DATABASE_URL`, brand vars). It holds a single
    tenant, managed by a super_admin account on that copy.
- No "own schema inside the shared database" option and no per-request database-routing layer (`db_mode`).
  They add migration and maintenance work without real extra isolation.
- To keep Dedicated possible without building it now: every table keeps `tenant_id` (even in a dedicated copy),
  and nothing is hard-coded. The "move one tenant" tool (export one plant's data by `tenant_id` from Shared,
  import into a Dedicated copy) is built in Phase 10 (website + provisioning), only when a paying plant needs it.
- When a plant objects to Shared, first address the usual concerns: other plants cannot see their data (RLS),
  they can export their data if they leave, and where data is stored: Singapore (Railway) for now; India hosting
  later if a plant needs it. Offer Dedicated only
  if that's not enough.
- Containerized (Docker). Config via environment variables (DATABASE_URL, STORAGE_BUCKET, WHATSAPP_TOKEN,
  APP_DOMAIN, BRAND_NAME, BRAND_LOGO, BRAND_COLOR, MODE, ENABLED_MODULES).
- No customer-specific code/forks. Custom needs become config or feature flags.
- Backward-compatible, versioned migrations so all instances stay on one release line.

## Stack
- Next.js (React) + Tailwind, mobile-first PWA. No native app, no offline mode in v1.
- Node.js + TypeScript backend, clean REST API per app (platform + each module).
- PostgreSQL, managed hosting. Hosting: Railway, Singapore region, one project (decided 2026-10-04 for low
  cost); India hosting later if a plant needs it. Public addresses: `app.bluemins.life` (platform),
  `lab.bluemins.life` (Lab Records), `docs.bluemins.life` (Document Store), `stock.bluemins.life` (Floor Stock),
  `complaints.bluemins.life` (Complaint Box), `orders.bluemins.life` (Order Capture), `attendance.bluemins.life` (Attendance),
  `jobs.bluemins.life` (Job applications, public); `bluemins.life` itself stays a static site on GitHub Pages, DNS at
  WordPress.com. Railway deploys the git branch `production` only (`main` never deploys). Running it:
  `docs/HANDBOOK.md`; setup steps: `docs/DEPLOY.md`; per-copy records: `docs/deployments/`.
- S3-compatible storage for documents/reports. PDF reports via Puppeteer or react-pdf.
- Scheduler for daily checks; alerts via WhatsApp Cloud API.

## Data rules (compliance-critical, Lab Records)
- Lab results are APPEND-ONLY. Edits create a new version with who/when/why; never overwrite or delete.
  Enforce this in the database too: the app's database user has no UPDATE/DELETE permission on lab result
  tables, not just a rule in app code.
- Every lab entry has a user ID and timestamp; records lock on submit.
- Pass/fail computed automatically against configurable limits per parameter.
- A failed test puts the batch ON HOLD, requires a corrective-action note, alerts the tenant_admin (WhatsApp),
  and blocks dispatch. A retest is a new entry; the failed one stays on record.
- Stock-out links to a batch where possible, so a failure can be traced back to material lots.

## Core platform tables (Phase 1)
`super_admins`, `tenants`, `tenant_plans` (enabled modules + limits JSON), `users`, `roles`, `user_roles`,
`tenant_profiles` (business details), `tenant_skus` (products).
tenant_admin is a role in `user_roles` (no separate `tenant_admins` table). Each module app owns its own tables.

## UX
- Mobile-first, big buttons, fast data entry. Hindi and Odia labels planned.
- Screens follow the approved mockups (launcher, lab records, floor stock, preventive maintenance).
- Sample limits (TDS, pH, turbidity) are placeholders; each plant sets its own.

## Prioritized build order (phases; finish and test each before the next)

**Why this order:** Lab Records is the compliance wedge plants will pay for first. Document Store comes next
(decided 2026-10-04 by the owner): expired licences and certificates (FSSAI, BIS, pollution board, lab
accreditations) are a compliance risk plants feel directly, and it needs no batch link. Floor Stock and Preventive
Management are the next-closest operational needs and both link to the batch record. AMC is a revenue add-on
that pairs naturally with Preventive Management. Attendance/Salary and Marketing Contacts are generic
small-business tools (not RO-specific) — deprioritized until the RO-specific modules are proven with paying
pilots.

1. **Platform core** — super_admin service, auth/roles, tenant registry with `tenant_plan`, SSO token issuance.
2. **Launcher** — role-and-plan-filtered dashboard, handoff to module URLs.
3. **Lab Records module** — batch log, tests, pass/fail, PDF report, failed-test flow, WhatsApp alert.
4. **Document Store module** — plant documents/certificates with name, certificate, expiry, authority, support
   contact, responsible person (a plant user); file upload stored on the server; renewal history kept;
   expiry reminders by email to the owner and the responsible person.
5. **Floor Stock module** — the plant's daily end-of-day count (today's production + closing stock of every
   item) replacing the staff's WhatsApp message; plant-defined sections and items; owner-set limits with
   low-stock email; sold / used worked out from the counts. Dispatch entries with the batch check come later.
6. **Preventive Management module** — assets, PM schedules, task completion, history.
7. **AMC module** — contracts, visit logs, renewals, invoicing (pairs with Preventive Management).
8. **Attendance & Salary module.** Version 1 (attendance only: QR scan + location check, own calendar, owner view
   and fixes) built **before Phase 6** (owner, 2026-10-15) and released as v0.18.0; plan and build prompts in
   `docs/ATTENDANCE_PHASE_PLAN.md`. Version 2 (**salary**: monthly salary ÷ 30, paid leave, overtime per person,
   advances, Salary tab with checking panel, mark paid, worker's own slip with permission) built and released as
   v0.20.0 (2026-10-17); plan `docs/SALARY_PHASE_PLAN.md`. Version 3 (salary extras, plan
   `docs/SALARY_EXTRAS_PHASE_PLAN.md`): Part A **per-day pay** v0.21.0 (2026-10-17); Part B **field-duty TA / DA and
   expense claims** with bill photos and owner approval v0.22.0 (2026-10-17). Weekly offs, holidays and leave requests
   come later.
9. **Digital Marketing Contact Management module.**

Also built ahead of Phase 6 (owner, 2026-10-17): **Job applications** (public job page + applicants), v0.25.0; plan and
build prompts in `docs/JOB_APPLICATIONS_PHASE_PLAN.md`.
10. **Website + dedicated-instance/tenant provisioning tooling.**

Plan each phase in detail only when you reach it — later phases will be shaped by what earlier ones actually
produce. Do not start a phase's detailed design until the prior phase's status note (below) is written.

## Working rules for Claude Code
- Start each phase in plan mode: read the code, propose a plan, wait for approval before editing.
- Ask before any change to the schema, permissions, tenant isolation, or the SSO token contents.
- Write tests with each feature: role access, tenant isolation (tenant A can never read tenant B), pass/fail
  logic, append-only behaviour, plan/limit enforcement.
- Never commit secrets. Use environment variables.
- Start WhatsApp Business verification and message-template approval early (during Phase 1–2); Meta's approval
  can take weeks and Phase 3 depends on it.
- Keep changes small and explain each in plain language; the owner is not a full-time developer.
- If a requirement here conflicts with a request, stop and ask.
- After completing a phase, add a dated "Status" note to this file: what was built, key decisions, what's next.

## Notifications (app bell + phone push): roadmap, approved by the owner 2026-10-11
**Why:** owners (and later staff) must hear about important plant events without paying for email, SMS or
WhatsApp, or setting them up. Existing email alerts stay as they are; notifications are added alongside.

**How it works (every phase):**
- **The platform owns one inbox** (`platform.notifications`, one row per recipient with its own read mark).
- **Modules only send events:** `POST /api/m/tenants/:tid/notifications` with module credentials and
  `{ kind, title (≤ 80), body (≤ 300), link (path inside the module), dedupe_key, exclude_user_id? }`.
  - **The platform decides who receives it** (N2): the plant's active owners (always) + the people the owner
    ticked for that module on Manage users ("Gets alerts") + `also_user_ids` (the people an event is about, e.g.
    the technicians of an approved batch), each re-checked at send time (active, this plant, works in the module
    via `roleWorksIn`), minus `exclude_user_id`. A module can never pick arbitrary people or reach another plant.
  - A module not enabled for the plant gets 403.
  - The same `dedupe_key` is stored once per person.
- **Where it shows:**
  1. a bell 🔔 with the unread count on the launcher after login (the login page itself can't know who is
     looking)
  2. a phone notification through **Web Push** when PlantOps (`app.bluemins.life`) is installed on the home
     screen. Web Push is free (the phone's browser push service delivers it). It needs `VAPID_PUBLIC_KEY`,
     `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on the platform only (`pnpm push:keys` makes a pair). Without them
     the bell still works.
- Tapping a notification opens `/sso/start?module=<id>&next=<link>`, which goes through the normal login and
  handoff.
- Subscriptions live in `platform.push_subscriptions`; a phone is removed on logout or when the push service
  answers 404/410.
- **iPhone:** iOS 16.4+ and PlantOps added to the Home Screen first. Android works from Chrome. Push needs
  HTTPS, so phones are tested on the live copy, not the LAN address.
- **Modules call `kit.notify(tenantId, input)`** (`packages/module-kit`). It never throws; a failure is logged.
  Sending happens after the module's answer; if the platform can't be reached (or answers 5xx) the event waits
  in the module's own `notification_outbox` and the daily / evening jobs send it again (`kit.retryOutbox`, N4).
- **Each person chooses per kind** (N4): phone + bell / bell only / off on `/notifications` (`notification_prefs`;
  catalogue `NOTIFICATION_KINDS` in `packages/types`). Urgent kinds (ON HOLD, Form 3/4 FAIL, document expiry,
  locked out) are always on. Notifications older than 90 days are removed by `platform.purge_old_notifications()`
  in the platform's daily job (the app login has no DELETE on notifications).
- **Database:** migration `apps/platform/db/migrations/0009_notifications.sql`; both tables have `tenant_id` and
  FORCE RLS.
  - `platform_app` may SELECT / INSERT notifications and UPDATE `read_at` only.
  - `platform_app` may SELECT / INSERT / DELETE push subscriptions.
  - SSO token unchanged.

**Phases (finish and test each, add a status note, then start the next):**

**Full design, review findings and the build prompt for each phase: `docs/notifications.md`.**

**N1 (v1): the system + every Floor Stock event, to owners.**
- Platform:
  - inbox, module endpoint, bell + list on the launcher (mark read, mark all read, refresh every 60 s)
  - installable app (`manifest.ts`, `public/sw.js`, icons)
  - "Turn on phone notifications" card (with the iPhone hint); logout unsubscribes the phone
- Floor Stock (owners only; nothing is sent for the owner's own actions):
  1. **count saved**
  2. **count corrected** (with the reason)
  3. **low stock** (newly low items only, once per item per day, the same rule as the email)
  4. **check the count** (negative sold compared with the day before)
  
  Events 1–4 are **one notification per save**, titled by the most serious case.
  5. **count not done** at 8 pm IST: new `POST /api/cron/evening` + `.github/workflows/evening.yml` at 14:30 UTC,
     once per plant per day, only plants with items set up
  6. **setup changed by a store keeper / plant staff:** one per save action
- Release v0.7.0.

**N2: chosen people get alerts + Lab Records** (decided by the owner 2026-10-11).
- **Not all staff, only people the owner picks** (e.g. a manager): on Manage users → edit user, a tick box per
  module, "Gets <module> alerts". The owner can tick or untick anyone at any time; every change is audited.
  Needs a small platform table (alert recipients: tenant, user, module) with RLS (schema change, approved in
  principle; confirm the migration first).
- **Recipients** = the plant's owners (always; they can't be unticked, a per-event mute comes in N4) + the
  ticked people. The platform checks each ticked person: active, of that plant, and works in that module
  (`roleWorksIn`). Whoever did the action is still left out.
- A ticked person gets **the same events as the owner** for that module (Floor Stock: saved / corrected, low
  stock, check the count, not done at 8 pm, setup changes at bell level).
- A `/notifications` page on the platform for every user, plus a 🔔 link in each module's header (module-kit), so
  ticked staff who skip the launcher can turn push on.
- Lab Records (who gets which event is planned with the tick box: e.g. ON HOLD to owners + ticked lab leads):
  - **test failed → batch ON HOLD** (owner + lab leads; urgent; the main alert until WhatsApp is approved)
  - hold older than 24 h
  - batch waiting for approval
  - batch approved / rejected (to the technician who entered it)
  - result corrected (owner)
  - Form 1 due
  - no tests entered today

**N3: Document Store + platform events.**
- Document Store:
  - **expiry** at 30 / 7 / 1 days before, on expiry, then weekly (owner + responsible person; same schedule as
    the email)
  - "you are now responsible for …"
  - renewed / uploaded (owner)
  - storage near the plan limit
- Platform (sent by the platform itself, not through the module endpoint):
  - a staff member locked out after 5 wrong PINs (owner, with an unlock link)
  - PlantOps support viewed your data
  - module switched on / plan changed
  - plan renewal coming up

**N4: settings and reliability.**
- On / off per event type per user (e.g. keep "low stock", mute "count saved").
- The evening reminder time chosen per plant.
- A **retry outbox** in modules (in module-kit), so a notification isn't lost when the platform is briefly down.
- Notifications older than 90 days removed. This needs a DELETE grant, a permission change: ask first.

**N5+: inside each new module phase.** Every new module sends its own events with `kit.notify` from day one:
- Preventive Management: task due / overdue, done, breakdown reported
- AMC: contract expiring, visit due / done, invoice due
- Attendance & Salary: version 1 done in its own phase plan (v0.18.0): corrected, outside, no exit (owners only);
  version 2 (v0.20.0): salary review (owners, last day of the month), salary paid (the worker, only with "Can see own
  salary"); version 3 (v0.22.0): new claim (owners), claim decided (the worker only), storage (owners); v0.23.0:
  advance given (owners, phone), office fix (owners, bell), every IN / OUT (supervisors only, bell), not marked by the
  plant's hour (owners + supervisors, phone); leave request comes with that feature
- Marketing Contacts: follow-up due
- Job applications: done in its own phase plan (v0.25.0): new application (owners + ticked HR desk, bell), storage
  80 % / 95 % / full (owners only)
- Complaint Box: done in its own phase plan (v0.12.0): new, resolved, reopened, still open, updated, storage
- Order Capture: done in its own phase plan (v0.13.0): new order, delivered, cancelled

## WhatsApp bot integration (planned, owner 2026-10-20)
**Goal (shared with the bot repo `~/projects/order_handoff`):** a rules-first WhatsApp ordering and reorder flow for
Bluemins packaged water where **Order Capture is the order ledger** and the separate bot is only the conversation.
Steps R, 0–5, status, one prompt per step and the Insights list: **`docs/WHATSAPP_BUILD_PLAN.md`** (work from it).
Design and rules: `docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md`. The bot side of the same goal (its Sheet / Redis
changes): the bot's `CLAUDE.md`.

**Rules for this work:**
- Built **generic, never Bluemins-only** ("no customer-specific code"): any plant could get a bot credential; the plant
  comes from server-side config bound to the credential, never from the WhatsApp message.
- The bot never touches PlantOps databases, sessions, module secrets or the SSO token. It gets **one narrow,
  rotatable credential** for an Order Capture bot API (server-to-server, rate-limited, audited).
- Staff-entered orders, amounts rules (plant staff / viewers see no amounts), notifications, CSV and the thank-you keep
  working unchanged. Order Capture keeps sending the delivery thank-you; the bot never sends a second one.

**Changes PlantOps needs, by step** (plan first; **ask** before any schema, grant, credential or Twilio change):
- **Step 0:** decide where the **area list** (served villages) and **consent** records live (Order Capture vs the bot),
  how a bot customer matches an Order Capture customer (`packages/module-kit/src/phone.ts`), and the bot credential
  design. Written to `docs/WHATSAPP_CONTRACT.md`. No code.
- **Step 2 (Order Capture, read-only):** bot credential (likely a new table or module-credential variant: **ask**);
  endpoints for customer context by phone (match, place, active products, the rate this customer gets, last delivered
  basket) and the product list. Tests: auth, tenant isolation, minimal fields, unknown phone.
- **Step 3 (Order Capture, write):** create-order endpoint reusing `src/server/orders.ts` (no second rule set):
  idempotency key, server revalidation, reference only after commit; orders marked as from WhatsApp (likely
  `source` + idempotency storage: **schema change, ask**); visible in the list, notifications, CSV and tile like any
  order.
- **Step 4 (Order Capture):** delivered event to the bot through an outbox (like `notification_outbox`), signed,
  retried, deduped by event id (**schema change, ask**); consent storage if Step 0 puts it here (**ask**).
- **Insights** (`docs/WHATSAPP_BUILD_PLAN.md` section 11): an owner-only "Customer insights" page in Order Capture
  after Step 3 (delivery time by area, cancellations, new vs repeat, reorder interval, pack mix, orders per village,
  lapsed list); group-level only, no individual scores. A **customer type** field (shop / household / office /
  institution) only after approval (**schema change**). Bot demand vs Floor Stock "Can make" only through module APIs.

## Status log

### 2026-10-03 — Phase 1: Platform core — complete
**Built** (`apps/platform` + `packages/{auth,db,types,ui}` + `apps/dev-module`, pnpm + Turborepo monorepo):
- Database (`platform` schema, migration `0001_platform_core.sql`): super_admins (+ sessions), tenants,
  tenant_plans, users, roles, user_roles, modules (registry: URL + client-secret hash), sessions,
  sso_handoff_codes, audit_log (append-only).
- Row-level security: FORCE RLS + `tenant_isolation` policy on every plant-data table; three DB logins
  (`plantops_owner` migrations, `platform_app` plant requests with RLS, `platform_super` super_admin only);
  `withTenant()` in `packages/db`; queries without a tenant fail instead of returning all rows.
- Login (plant code + username + PIN/password), 5-try lockout for 15 min, forced change of temporary secrets,
  12 h sessions, per-IP login rate limit (in-memory, per instance), JSON-only mutations (CSRF protection).
- super_admin: create plant + plan + first owner in one step, edit plan, suspend/reactivate (logs everyone out),
  add owners, reset owner passwords, change own password; `pnpm super:set-password` for recovery.
- tenant_admin: add users (temporary PIN/password shown once), multi-role assignment, reset PIN, unlock,
  disable/enable; guards for `max_users` and "at least one active owner".
- SSO: one-time handoff code (60 s, single use, bound to one module) → server-to-server exchange with module
  credentials → EdDSA token; JWKS endpoint; module endpoints for user status and plan.
  `packages/auth` gives modules `verifyToken`, `canAccessModule`, `requireRole`, `exchangeCode`,
  `fetchUserStatus`, `fetchTenantPlan`.
- Screens: plant login, change PIN/password, user management, super_admin plants list / plant detail / change
  password, home page with simple "Open <module>" buttons for the modules the user may open (replaced by the
  Phase 2 launcher tiles).
- `apps/dev-module`: **development-only placeholder modules** (Lab Records on :3001, Floor Stock on :3002) that do
  the real module-side SSO steps — exchange code, verify token via JWKS, check access, own session cookie, live
  status re-check. Replaced by the real modules from Phase 3; never deployed.
- Tests: 86 passing (`pnpm test`, real Postgres test database) — tenant isolation at DB and API level,
  role access, login/lockout/sessions, SSO handoff/exchange, token rejection (expired, tampered, wrong module,
  unsigned, HS256, foreign key), remote JWKS, modules listed per user.

**Verified end to end (2026-10-03, real HTTP against `pnpm dev`):** plant `002` (SAMPLEAQUA, Lab Records +
Floor Stock) created by super_admin in the UI → owner Sujata replaced her temporary password → added Atharv
(lab technician + store keeper) → Atharv set his PIN → opened Lab Records and Floor Stock through the one-time-code
handoff (26/26 checks: no token in URL, reused code refused, Preventive Mgmt refused because it isn't in the plan,
direct module link without login shows the login prompt, a Lab Records token is refused by Floor Stock, a
tampered token is refused, owner gets read-only access). `scripts/sso-smoke.sh` passes for both modules. All
links (:3000 login, /super/login, :3001, :3002) answer 200 from both WSL and the Windows side.

**Key decisions:** monorepo; plant code identifies the plant at login; Lab Records owns batches; Shared or
Dedicated hosting only (no per-tenant schema, no `db_mode` routing); standard JWT claims added to the token;
local dev uses the machine's Postgres (`scripts/setup-local-db.sh`) because Docker isn't installed.

**Not yet verified:** Dockerfile (no Docker on the dev machine); access from a phone (needs a deployed address or
LAN setup — `localhost` links only work on this computer); real module apps (only the placeholder exists).

### 2026-10-03 — Phase 1 additions: business details, products, user editing — complete
**Built** (migrations `0002_business_details.sql`, `0003_sku_units_per_pack.sql`; `src/server/business.ts`):
- **Business details** (`tenant_profiles`, one row per plant): logo stored in the database (PNG/JPEG/WebP
  ≤ 300 KB, type checked by its first bytes, never SVG), brand color `#rrggbb`, description,
  address/city/state/PIN code, phone. The owner edits them at `/admin/business`. super_admin can fill them in
  when creating a plant and edit them on the plant page. Any plant user can load the logo
  (`/api/business/logo`).
- **Products (SKUs)** (`tenant_skus`): name, optional SKU code (unique per plant), `volume_ml` = size of ONE
  bottle/jar, `units_per_pack` (1 = single; e.g. 24 for a case of 24 × 500 ml), pack type, active/inactive.
  No DELETE grant, so products are made inactive, never deleted. SKUs live in the platform. Modules (Floor
  Stock) will store `sku_id` as a plain reference, like `batch_id`. A module read endpoint for SKUs is still
  to add (Phase 4).
- **Plant code and usernames: super_admin only.** `PATCH /api/super/tenants/:id {code}` (open sessions stay)
  and `PATCH /api/super/tenants/:id/users/:userId {username}` (that user is logged out). The database enforces
  this: `platform_app` has column-level UPDATE on `tenants (name, updated_at)` only, so the owner can rename the
  plant but not change its code or status.
- **User details after creation:** the owner edits name, mobile, email, roles and status, and resets a
  PIN/password with a typed or random **temporary** value (`POST .../reset-secret {secret?}`; must be replaced
  at next login). super_admin does the same for any user of any plant, plus the username. Both use the same
  `applyUserUpdate` / `applySecretReset`, so the rules are identical: max users, keep one active owner, and
  PIN↔password when the owner role is added or removed. This replaced the owner-only
  `admins/:userId/reset-password` route. Secrets are never written to the audit log.
- **Branding for modules:** `GET /api/m/tenants/:tid/branding` (name, brand_color, logo_url) +
  `/api/m/tenants/:tid/logo`, module credentials required. The SSO token is unchanged.
- Both new tables have `tenant_id` + FORCE RLS (covered by the guard test). Every change is audited.
- Tests: 137 passing (platform 128, auth 9). Verified over HTTP on `pnpm dev` (plant `002`: business details,
  logo, SKUs, user edit/reset, module branding with Lab Records' credentials).

### 2026-10-03 — Phase 2: Launcher — complete
**Built:**
- **Launcher** `/home` per the mockups: greeting, plant name/logo, tiles in 2 columns, plan summary card
  (owner only). `GET /api/launcher` (tiles from `decideTiles`/`landingFor` in `src/server/launcher.ts`);
  each tile loads its own numbers from `GET /api/launcher/summary/:module`. Tile states: open, off
  (module switched off or not set up), locked ("Not enabled" / AMC "Add-on service", owner only).
- **Single-module staff skip the launcher** (straight into their module); `?launcher=1` shows it anyway (the
  module's "Account" link).
- **Direct links for phones:** `GET /sso/start?module=<id>&next=<path>` → module with a one-time code, or
  login first (`/login?next=`, also through first-login PIN change), or `/sso/blocked` with a plain reason.
  `safeNext()` only allows same-site paths (no open redirects).
- **Module session helper** in `packages/auth/src/session.ts` (+ `verifySummaryRequest`, `fetchBranding`,
  `fetchLogo`, `PlatformRequestError`); `apps/dev-module` rewritten on it (12 h session, 5-min re-check,
  summary endpoint, plant colour + logo, Account link).
- **super_admin Modules** `/super/modules`: URL (http(s) origin only), new client secret shown once (old one
  stops at once), switch off/on for all plants; audited. Migration `0004_modules_admin.sql` grants
  `platform_super` UPDATE on `modules (base_url, client_secret_hash, status)` only.
- **super_admin Plant dashboard** `/super/dashboard`: plant drop-down → that plant's owner tiles with live
  numbers + plan card, in the plant's colour, read-only.
- **Plant brand colour** on all plant screens (root layout reads the session server-side; `/super` layout
  resets to PlantOps blue).
- **Phone testing:** `pnpm dev:lan` (listens on all addresses), `pnpm lan:urls` (prints the Wi-Fi addresses
  to use), `allowedDevOrigins` from `PLATFORM_URL`. Needs WSL mirrored networking (README).
- Tests: 193 passing (platform 168, auth 25): tile rules per role, live numbers incl. module error/junk/slow,
  token separation, `/sso/start`, `safeNext`, Modules screen (URL rules, secret rotation, switch off),
  dashboard, session helper with fake clock, brand palette.

**Verified end to end (2026-10-03, `pnpm dev`):** owner Sujata (002) sees 2 open + 4 locked tiles (AMC
add-on), plan card and live placeholder numbers in plant colour #0e7490; Atharv sees 2 tiles, no plan;
opening `http://localhost:3001/` without a session → platform login → back into Lab Records with a 12 h
session, plant name and colour; reused code refused; super pages stay blue (20/20 checks).

**Verified on a real phone (2026-10-03):** WSL mirrored networking + `hostAddressLoopback`, app on
`http://192.168.1.2` (`pnpm dev:lan`); new lab user `002`/`1111` logged in from the phone, set own PIN and went
straight into Lab Records (single-module skip). Windows side reaches all three ports.

**Not yet verified:** Dockerfile. `next build` passes.

**Next — Phase 3 (Lab Records):** real module app in `apps/lab-records` built on the helpers above; its own
schema with append-only lab results; batch log, tests, pass/fail, failed-test flow, PDF, WhatsApp alert
(start Meta verification now if not done); summary badges ("3 held today"); support view (support token);
module SKU read endpoint for Floor Stock later (Phase 4).

### 2026-10-04 — Phase 3: Lab Records — complete
**Built** (`apps/lab-records` on :3001, Next.js 16; module notes in `apps/lab-records/NOTES.md`):
- **Own database section and login:** schema `lab_records`, login `lab_app` (`scripts/setup-lab-db.sh`), 11
  tables, all with `tenant_id` + FORCE RLS. Migrations `0001`–`0003`; `0003` adds `lab_tenants()`, which gives
  the daily job plant ids only.
- **Batches:** status pending → on_hold → approved / rejected, with a full event history. Products come from the
  platform.
- **Daily tests:** each plant chooses its checks and limits. Automatic pass/fail; the limit is copied into every
  result.
- **FSSAI Forms 1–4** from `refeDocs/sheets/FSSAI STI Forms.xlsx`, defined once in `src/lib/forms.ts`:
  - Form 1 has 16 fixed parameters and "tested at" (in-house or outside lab).
  - Forms 2–4 hold the sheet's columns.
  - "Verified By" by the owner or a lab lead.
- **Append-only, enforced by the database:**
  - Saving creates version 1, locked; there are no drafts.
  - A correction is a new version with a required reason (also a database check).
  - A retest is a new entry.
  - `lab_app` has no UPDATE/DELETE on result tables.
- **Failed test:** the batch goes ON HOLD in the same transaction, even if it was already approved. Release
  needs a corrective note and a passing retest; failures are judged per parameter by the most recent result.
  Approve and Reject (final, with a reason) by the owner or a lab lead.
- **WhatsApp outbox:** owners + lab leads, through the WhatsApp Cloud API template when `WHATSAPP_*` is set.
  Until then alerts are recorded as "not set up yet".
- **Daily reminder job:** `POST /api/cron/daily` + `CRON_SECRET`. It covers holds older than 24 h and, from the
  25th, a missing Form 1. At most once per plant per day.
- **Tile badges:** on hold, awaiting approval, Form 1 due, tests today.
- **Search;** the plan **history window** `limits.modules.lab_records.history_months` (hidden, never deleted);
  the **owner's full CSV export**, with formulas neutralised.
- **Print-ready registers** in the sheet layout (A4 landscape) for any date range, plus a **batch report**
  (portrait). The browser prints or saves as PDF; there is no Puppeteer.
- **Support view:**
  - Platform: migration `0005_lab_lead.sql` and `0006_support_handoff.sql` (one-time code →
    `purpose:"support"` token, exactly as defined above).
  - `packages/auth`: `verifySupportToken` and `startSupportSession`.
  - Module: read-only in both the proxy and the server guards; every page view is logged; the owner's
    "Support access" page lists them.
- **Platform additions:**
  - role `lab_lead`
  - `display_name` in the status re-check
  - `GET /api/m/tenants/:tid/alert-contacts` and `/skus` (SKUs moved up from Phase 4)
  - "Lab Records history" field on the plan screen
  - "Open … (read-only)" on the super_admin dashboard
  - `apps/dev-module` no longer serves lab_records
- **Tests: 327 passing** (platform 184, auth 32, Lab Records 111), covering:
  - append-only refusals (13 statements refused for `lab_app`)
  - isolation and the FORCE RLS guard on every table
  - pass/fail boundaries and the role matrix
  - the full hold → release → approve story
  - WhatsApp against a fake server
  - the daily job, Forms 1–4, verification, search, history window, export and printing
  - support read-only and logging

**Key decisions (with the owner, 2026-10-03):**
- **Lab lead** role: a technician who can also approve.
- **Print-ready pages, no server PDF.**
- **Owner + lab lead set limits.**
- **Saving submits and locks.**
- **Search lives inside the module.**
- **History limited by plan, never deleted.**
- **Rejected status.**
- **Hold age + daily reminder.**
- **Form 1 "tested at" + "Form 1 due".**
- The support token carries no name; the owner's log says "PlantOps support".

**Verified on `pnpm dev` (2026-10-04, plant 002):**
- Login through PlantOps from PC and phone. The login callback now redirects with a relative URL: it had been
  sending phones to `0.0.0.0`.
- Batches, daily tests and corrections; technician refused owner actions.
- Forms 2/4 saved.
- Tile numbers.
- Daily job run.
- Form 1 and Form 2 rendered to PDF through headless Chrome and compared with the sheet: same columns, same order.
- Support view through the real platform exchange: read-only, logged, Exit back to the dashboard.

**Not yet verified:**
- Owner and lab lead clicks on the live app. I don't have the owner and super_admin passwords; tests cover them.
- Real WhatsApp sending: waiting for Meta approval.
- Docker images: `apps/lab-records/Dockerfile` added, not built (no Docker on this machine).
- Any real deployment.

**Next — Phase 4 (Document Store)**, inserted by the owner on 2026-10-04; Floor Stock moves to Phase 5.
**Then Phase 5 (Floor Stock):** a real module in `apps/floor-stock` built like `apps/lab-records`:
- items, stock in/out, reorder alerts
- stock-out linked to a batch
- design the module-to-module batch lookup (Floor Stock asks Lab Records whether a batch is approved; how a
  module proves who it is to another module)
- its support view

### 2026-10-04 — Phase 4: Document Store — complete
**Built** (`apps/document-store` on :3003; module notes in `apps/document-store/NOTES.md`):
- **Platform:**
  - module `document_store` + role `document_keeper` (migration `0007_document_store.sql`)
  - `AlertContact.email` in `alert-contacts`
  - plan limit `limits.modules.document_store.storage_mb`; the plan screen's module limits are now one list
    (`MODULE_LIMIT_FIELDS`)
  - support button on the dashboard
- **`packages/module-kit`** (new): `createModule({ moduleId, label, env })` gives:
  - credentials / keys and the branding / products / plan / contacts caches
  - user and support cookies, `currentSession()`, the proxy
  - the standard routes: callback, support, logout, support-exit, plant logo
  - `handle` / `handleUpload` / `readJson`, `orNotFound` / `orHidden`, CSV, date formats
  
  **Lab Records moved onto it** with its 111 tests unchanged. `scripts/setup-module-db.sh` sets up any
  module's database login and `.env` lines.
- **Document Store:**
  - schema `document_store`, login `doc_app`; 6 tables with `tenant_id` + FORCE RLS; append-only (no DELETE;
    UPDATE only on documents' status / responsible and reminders' status)
  - documents with versions (initial / renewal / correction, reason required) and files that are never replaced
  - upload checks: PDF / JPEG / PNG / WebP by content, ≤ 10 MB, raw body (CSRF-safe), plan storage limit
  - storage: local disk, or S3-compatible (SigV4, no SDK) when `STORAGE_BUCKET` is set
  - downloads checked per plant
  - responsible person = an owner or document keeper from the platform
  - documents table with expiry status, filters, search and the last reminder per row; cards on phones
  - document page: renew, correct, change responsible, archive / restore, version history, reminder log
  - owner CSV export and ZIP bundle of the manifest plus all version files; support view read-only, with page
    **and file** views logged
  - English / Hindi / Odia interface language selector, saved as an HTTP-only browser preference (no schema change)
- **Email reminders:**
  - stages: 30 / 7 / 1 days before, on expiry (or the first run up to 6 days after), then weekly
  - each sent once per version, stage and person; a renewal restarts the schedule
  - to the owners + the responsible person, one email per person per run
  - SMTP via nodemailer; pending reminders retry after setup, including old rows marked "Email is not set up yet"
  - daily job `POST /api/cron/daily` + `CRON_SECRET`
- **Tile:** expired / expiring soon / total.
- **Tests: 411 passing** (platform 187, auth 32, Lab Records 111, Document Store 81), covering:
  - append-only refusals (10 statements) and isolation, plus the FORCE RLS guard
  - file type / size / storage-limit checks
  - reminder stage boundaries, once-only, grouping, failures
  - the fake-S3 round trip, the support view, upload route, SMTP transport, language preference and ZIP export

**Key decisions (with the owner, 2026-10-04):**
- Document Store inserted as **Phase 4** (Floor Stock → 5).
- **Email** reminders.
- Responsible = **plant user**.
- **Keep renewal history.**
- **Document keeper** role.
- **30 / 7 / 1 / 0 + weekly.**
- **PDF / photos ≤ 10 MB + plan storage limit.**
- **Extract the module kit before building it.**

**Verified on `pnpm dev` (2026-10-04):**
- Document Store runs on :3003 and reaches its database.
- Without a session → PlantOps login; an upload without a session → 401.
- The owner switched it on for plant 002 and made Techno a document keeper. Atharv (no role) is sent to "no
  access" and has no tile.
- Lab Records still works on the kit (live login, pages, logout).

**Not yet verified:**
- **Adding / renewing a document with a real file in the browser**, as Techno or Sujata. The server side is fully
  tested; nobody has done it on screen.
- Live email: no SMTP settings are configured; an account and recipient email addresses are still required.
- Real S3 bucket and a safe copy of existing volume files (setting `STORAGE_BUCKET` does not migrate them).
- The GitHub Actions daily workflow never ran until 2026-10-04: `daily.yml` was invalid YAML (an unquoted `run:`
  line containing `: `), fixed with `run: |`. The first successful run still needs to be checked in GitHub.
- Docker images (Dockerfile added, not built).
- Any real deployment.

### 2026-10-04 — Phase 4 follow-ups
- Added owner-only ZIP export with a CSV manifest and all version files; export is audited.
- Added English / Hindi / Odia interface selection. Reminder email language remains English until per-recipient
  preferences are supported.
- SMTP transport is tested against a local SMTP server. Reminders now stay pending when SMTP is unconfigured and
  retry when it becomes available.
- Real SMTP delivery and real-bucket verification remain deployment tasks requiring provider accounts. Do not
  switch the shared service to S3 until its existing volume files have been copied and verified.
- Tests: 81 Document Store tests pass; `typecheck` and production `build` pass.


### 2026-10-04 — Phase 5: Floor Stock — design approved, build starting
Full design: `/home/rocky/.claude/plans/hidden-marinating-pelican.md`; the module notes go into
`apps/floor-stock/NOTES.md` when it is built.

**What it replaces:** staff send a WhatsApp message every evening with today's production and the closing stock of
everything in the plant. Sales happen during the same day, so the stock figure is the **closing count at the end of
the day**.

**Decided with the owner (2026-10-04):**
- **Version 1 has the daily count only.** There are no stock in/out or dispatch entries yet. The app works out:
  - **Sold** = previous closing + today's production − today's closing, per finished product. A negative result
    is flagged "check the count".
  - **Used** = previous − today, per material. A rise is shown as "received (calculated)".
  - Nothing calculated is stored.
- **One count per plant per day**, for today or yesterday only:
  - It is pre-filled from the last count.
  - It locks on submit.
  - A correction is a new version with a reason.
  - It is append-only, enforced by the database (no UPDATE / DELETE on counts).
- **Sections and items are the plant's own:** each plant (tenant) configures its own list; nothing is shared
  between plants.
  - Configured in Floor Stock's **Sections & items** screen (the module owns the data). The owner reaches it
    from the dashboard through a "Set up sections" link on the Floor Stock tile. This is a small platform
    launcher change (a per-module setup path in `apps/platform/src/lib/modules.ts`), with no database change.
  - The owner can add a new section at any time. Owner and store keeper can add a new item to any section, and
    edit items.
  - Sections and items are switched off, never deleted.
  - "Hotel room" is a section; there is no separate location setting.
- **Finished-goods sections:** every finished product appears in both *Today production* and closing stock.
  Items link to platform products (`sku_id`).
- **Each item has:**
  - a main unit and an optional second number: labels as bundle + count, returnables as good + damaged
  - several lines per item, each with a free-text remark (usually a party name)
  - decimals allowed
- **Limits:**
  - Only the owner sets an item's limit; a blank limit never alerts. The server checks this; the database cannot
    tell owner from store keeper.
  - **Only the owner may switch off an item that has a limit**, so a shortage can't be hidden by switching the
    item off. Renaming or moving an item keeps its limit.
  - **Sections are owner-only:** add, rename, re-order, switch off.
  - **Only the owner may move an item to another section.** A store keeper picks the section when adding an
    item, but can't move it afterwards.
  - Every setup change (item, section, limit, on/off) is audited and shown to the owner in a **"Recent changes"**
    list on the Floor Stock screen.
  - Below the limit → an **email to the owners on submit**, once per item per day (same email service as
    Document Store), plus a **red tile badge**.
  - Store keepers are not emailed.
- **Returnable items** (20 L jar, jerry can, chiller jar, dispensers) are counted in the plant only. Who holds
  them comes later.
- **First start:** a new plant is offered a **generic template**: the 5 sections below with common RO-plant
  items, with finished goods filled from that plant's own products. The owner can edit it or skip it. Nothing
  is plant-specific in code.
- **Plant 002's own list** (entered through the screens, not code):
  1. Today production
  2. Finished goods closing stock (9 products)
  3. Raw material (empty bottle packets per product)
  4. Consumable (caps, stickers, labels per product, filters, roll, dosing chemicals, inkjet, ring, tap)
  5. Returnable items
- **Tile:** "Today's count not done" / "Counted 6:40 pm", "N items low", "Made N box".
- **"Copy as WhatsApp message"** during the switch-over.
- **Owner CSV export.**
- **Support view** read-only and logged.
- **No platform database change:** module `floor_stock` and role `store_keeper` already exist.

**Build steps:**
1. ✅ (2026-10-04) Schema `floor_stock` + login `stock_app` (`./scripts/setup-module-db.sh floor_stock stock_app
   STOCK 3002`). Migration `apps/floor-stock/db/migrations/0001_floor_stock.sql` is applied to dev + test. The
   checks were run by hand as `stock_app`: no plant → refused; plant B sees 0 of A's rows and cannot write A's;
   8 edits / deletes of counts and setup rows refused; second count per day, correction without reason and a
   negative qty refused; rename, limit and correction with reason allowed. The checks become automated tests in
   step 7.
2. ✅ (2026-10-08) App `apps/floor-stock` (:3002) on the module kit; `apps/dev-module` no longer serves
   floor_stock (or document_store). Checked over HTTP: health, platform login redirect, 401 for APIs.
3. ✅ (2026-10-08) Sections & items screen (`/setup`) with the owner-only rules, generic starter list (sizes not
   repeated when the product name has them), owner tile link "⚙ Set up sections" (`setup` in
   `apps/platform/src/lib/modules.ts`), staff tile text "Daily stock count". Store keepers may also re-order
   items within a section. 34 Floor Stock tests. Not yet clicked through on screen by the owner.
4. ✅ (2026-10-08) Daily count screen (`/count`): today or yesterday (India date), closing stock pre-filled from
   the latest version of the last count, production empty, several lines per item with remarks, submit locks,
   correction = next version with a reason (≥ 3 chars), a correction based on an old version is refused (409),
   "Copy as WhatsApp message" on the day page. Corrections are also limited to today / yesterday.
5. ✅ (2026-10-08) Views: home (today / yesterday status, low stock of the newest count), day page `/day/<date>`
   (compared with the day before only: Sold / Used / received, "check the count", "no count on <date>",
   "unit changed: not compared", old versions), History by date and by item, Recent changes (owner + support),
   owner CSV (every version, audited). Owner and store keeper (and support) see the day views; CSV owner only.
   70 Floor Stock tests. Not yet clicked through on screen with real counts (plant 002 has no sections yet).
6. ✅ (2026-10-08) Tile badges + low-stock email (owners only, once per item per day; mail sender moved into
   `packages/module-kit`, Document Store's 86 tests unchanged); daily job `POST /api/cron/daily`; GitHub step.
7. ✅ (2026-10-08) 87 Floor Stock tests (see the status note below).
8. ✅ (2026-10-08) NOTES, Dockerfile, deploy docs and `scripts/add-railway-module.sh`; v0.6.0 live at
   `stock.bluemins.life`.

**Later:**
- dispatch entries with the Lab Records batch check (a held batch must never be dispatched)
- the module-to-module batch lookup
- purchases
- a party list
- Hindi / Odia screens
- **Long-term idea (owner, 2026-10-04):** general godown stock management for any material. It would add several
  godowns with transfers, a stock in/out ledger, suppliers, and optionally rates and value. Keep the v1 design
  generic (free-text units, optional product link, no RO-only rules in code) so that this stays an addition and
  not a rewrite.

### 2026-10-08 — Phase 5: Floor Stock — complete, live (v0.6.0)
**Built** (`apps/floor-stock` on :3002; module notes in `apps/floor-stock/NOTES.md`):
- **Own database section and login:** schema `floor_stock`, login `stock_app`, 8 tables with `tenant_id` + FORCE
  RLS. Append-only counts: no UPDATE / DELETE on counts, versions and lines; nothing is ever deleted.
- **Sections & items** (`/setup`): each plant's own list, finished-goods vs stock sections, optional second number
  and product link, a starter list from the plant's products, and the owner-only rules (sections, limits, moving
  items, switching off an item with a limit), every change audited.
- **Daily count** (`/count`): today or yesterday, pre-filled closing stock, several lines with remarks, locked on
  submit, corrections as new versions with a reason; two people can't overwrite each other.
- **Views:**
  - home status
  - day page compared with the day before (Sold / Used / received, check the count, unit changed)
  - history by date and item
  - Recent changes
  - owner CSV
  - Copy as WhatsApp message
- **Low-stock email** to owners on submit, once per item per day; daily job retries; tile badges "Counted 6:40 pm"
  / "N items low" / "Made N box"; support view read-only and logged.
- **Platform:** "⚙ Set up sections" link on the owner's tile (`setup` in `apps/platform/src/lib/modules.ts`), staff
  tile text "Daily stock count". No platform database change; the SSO token is unchanged.
- **Shared:** mail sender in `packages/module-kit/src/mail.ts`. `apps/dev-module` serves only modules without an app.
- **Deploy:** Dockerfile, `scripts/add-railway-module.sh`, Floor Stock in `setup-railway-db.sh`, docs/DEPLOY.md
  "Adding a module to a running copy", daily workflow step (skipped until `STOCK_URL`).
- **Tests: 87 Floor Stock** (platform 187 and Document Store 86 still pass): isolation + FORCE RLS guard, the
  permission table, append-only refusals, count rules and concurrency, the arithmetic, views, CSV, WhatsApp text,
  email once-only / retries, tile badges, support logging.

**Decisions (2026-10-08, made while building; owner may change them):**
- Store keepers may re-order items within a section.
- Corrections are limited to today / yesterday, like new counts.
- Sold / Used compare with the calendar day before only.
- The store keeper sees Sold / Used and low stock too; CSV and Recent changes are owner-only (support read-only).
- If the platform can't be reached when a count is saved, the count is saved but no email is queued for it.

**Verified on `pnpm dev` (2026-10-08, plant 002):** health, platform-login redirect, 401 for APIs without a
session. Every screen rendered for Sujata (owner) and Atharv (store keeper) through a session signed with the
module's key and re-checked live against the platform. Store keeper refused `/changes` and the CSV.

**Live on the shared copy (2026-10-08, v0.6.0, `production` = `d248f3a`):**
- `./scripts/add-railway-module.sh shared floor_stock stock_app STOCK 3002 stock.bluemins.life` created the
  `stock_app` login, ran the migration and registered only Floor Stock with the platform.
- New Railway service `floor-stock` (Dockerfile built by Railway, so the image works), no volume (no files).
- DNS: `stock` CNAME + `_railway-verify` TXT at WordPress.com; HTTPS issued about 20 minutes after DNS.
- Checks passed:
  - `/health` with the database OK on all four apps
  - Floor Stock without a session goes to the PlantOps login
  - APIs refuse without a session, the tile without the platform's ticket, the daily job with a wrong secret
  - platform, Lab Records and Document Store redeployed without problems
- Record: `docs/deployments/shared.md`.

**Not yet verified:**
- A real count on screen, locally or live: no plant has sections yet, and nobody has entered a count in the browser.
- Live low-stock email: `BREVO_API_KEY` / `MAIL_FROM` on `floor-stock` are to be checked with a test limit.
- The daily job's Floor Stock step: GitHub variable `STOCK_URL` to add, then "Run workflow".
- super_admin → Modules shows `https://stock.bluemins.life` (it was registered by the script).

**Update 2026-10-11:** real counts on the live copy (plant 001: Bindu's count + correction, notifications to the
owner); the Daily jobs Floor Stock step is green; the launcher tile shows live numbers (so the module address is
right). **Low-stock email:** not set up, by the owner's choice (2026-10-11): Floor Stock alerts go through app
notifications (bell + browser / phone push); the email code stays and does nothing without Brevo.

**Next:**
1. The owner tries it live: switch Floor Stock on for a plant, give a store keeper the role, set up sections from
   the starter list, enter a count on a phone, and test a low-stock email.
2. Then Phase 6 (Preventive Management), planned in plan mode, or dispatch entries with the batch check if the
   owner wants Floor Stock finished first. Pending items for Floor Stock are listed in `apps/floor-stock/NOTES.md`.

### 2026-10-08 — Plant staff role — live (v0.6.1)
**Built** (commit `5f8450d`):
- Role `plant_staff`, label "Plant staff" (platform migration `0008_plant_staff.sql`, `module_id` null like
  tenant_admin). Decided with the owner: works in any enabled module **except Lab Records**.
- One rule for every app: `roleWorksIn()` + `PLANT_STAFF_EXCLUDED` in `packages/types`, used by `canAccessModule`
  and the platform's `alert-contacts`.
- Floor Stock: same rights as a store keeper. Document Store: same rights as a document keeper, and can be the
  responsible person. Lab Records refuses plant staff on its own server.
- Launcher: plant staff see a tile for each module they may open; with only one, they land straight in it.
- The SSO token is unchanged. Tests: platform 188, auth 36, Lab Records 111, Document Store 87, Floor Stock 88.

**Live (checked 2026-10-11):** v0.6.1 on the shared copy (`production` = `2b01230`), migration `0008` applied.
**Not yet done:** saving a user with the Plant staff role and using a module as that user, on screen.
**Update 2026-10-11:** plant 001's Kedar was saved with Plant staff + store keeper on the live copy and gets Floor
Stock alerts. A user with Plant staff **only** has still not been tried.

### 2026-10-11 — Nightly backups — live (v0.6.2), first run and practice restore OK
Decided with the owner: stay on Railway Hobby (no built-in backups) and run our own. `.github/workflows/backup.yml`
dumps the database with a new read-only login `plantops_backup` (SELECT only + BYPASSRLS; approved by the owner
2026-10-11) and each file-storing app copies its new files (`backupNewFiles` in `packages/module-kit/src/backup.ts`,
`POST /api/cron/backup`), all `age`-encrypted to one private Cloudflare R2 bucket. Dumps kept 30 days, files
forever. Only the public key is on servers / in GitHub. **New modules that store files** (Complaint Box, and Attendance's bill photos since v0.22.0; e.g. Complaint Box
photos) add the backup route and the five `BACKUP_*` variables. Setup checklist and restore: HANDBOOK.md
section 11. Tests: module-kit 12, Document Store 90.

### 2026-10-11 — Notifications N1: app bell + phone push, Floor Stock — live (v0.7.0, deployed 2026-10-11)
**Built** (design and later phases: `docs/notifications.md`):
- **Platform:**
  - migration `0009_notifications.sql`: `notifications` (one row per person, `level` push / bell, unique per
    module + `dedupe_key`; `platform_app` may only mark read) and `push_subscriptions` (unique per plant, so the
    same phone can be used in two plants)
  - module endpoint `POST /api/m/tenants/:tid/notifications` (recipients: active owners, minus whoever did it;
    403 if the module is off for the plant)
  - `GET /api/notifications`, `POST /api/notifications/read`, `/api/push` (key, turn on, turn off), `/n/<id>`
    (mark read → `/sso/start`)
  - `web-push` sender (24 h TTL; removes phones on 404/410; off without `VAPID_*`), `pnpm push:keys`
  - installable app: `manifest.ts`, `public/sw.js`, icons (Dockerfile now copies `public/`)
  - launcher: bell + list for owners, "Get alerts on this phone" card (iPhone install steps, blocked help,
    "Not now" for 7 days); logout turns the phone off first
- **Shared:** `NotificationInput` (`packages/types`), `sendNotification` (`packages/auth`), `kit.notify`
  (`packages/module-kit`, never throws).
- **Floor Stock:** one notification per save (low stock > check the count > corrected > saved), setup changed by
  staff (bell only), 8 pm "count not done" (`POST /api/cron/evening`, `.github/workflows/evening.yml`, migration
  `0002_counting_tenants.sql`: plant ids only, like `lab_tenants()`).
- **Tests:** platform 210, auth 36, module-kit 15, Floor Stock 103, Lab Records 111, Document Store 90; typecheck
  and production builds pass.

**Decisions (owner, 2026-10-11):** free app notifications instead of email / SMS / WhatsApp, alongside the
existing emails; shown on the launcher after login (not on the login page); owners only in N1; review fixes 1-3
(phones per plant, module in the dedupe key, bell-only level for setup changes).
**Made while building:** Floor Stock needed `counting_tenants()` because `stock_tenants()` lists only plants with
emails waiting.

**Verified on `pnpm dev` (2026-10-11, plant 002):**
- manifest, `sw.js` (no-cache) and icons served
- Floor Stock's real credentials → Sujata got the notification
- evening job reminded plant 002 once; a second run added nothing; wrong secret → 401
- launcher bell "2" and the list rendered in headless Chrome (alignment bug found and fixed)

**Not yet verified:** a real phone notification (needs HTTPS: test on the live copy, Android and iPhone),
including whether opening a notification on an iPhone asks for the login again (docs/notifications.md finding 4).

**Next:** deploy v0.7.0 (VAPID variables on `platform`, both migrations, `evening.yml`), test on phones, then
N2 (chosen people get alerts via a per-module tick box, + Lab Records) in plan mode.

### 2026-10-11 — Notifications N2: chosen people get alerts + Lab Records — live (v0.8.0, deployed 2026-10-11)
**Built** (release v0.8.0; v0.7.0 = N1 is committed `878e8aa` and tagged, neither deployed):
- **Platform:**
  - migration `0010_alert_recipients.sql` (`alert_recipients`: tenant, user, module, who ticked; FORCE RLS;
    `platform_app` / `platform_super` SELECT / INSERT / DELETE)
  - recipients = owners + ticked people + `also_user_ids`, each re-checked at send time (`notifyPlant` in
    `src/server/notifications.ts`)
  - "Gets alerts" tick boxes in `src/lib/user-form.tsx` (owner and super_admin; also on add user via the API):
    only enabled modules the person works in, 400 otherwise, ignored for owners, dropped on a role change,
    audited
  - `/notifications` page for everyone; launcher bell for everyone; turn-on card for owners and ticked people
    (`gets_alerts` in `/api/launcher`)
  - `GET /api/m/tenants/:tid/users/:uid/notifications/unread` for module headers
- **Shared:**
  - `NotificationInput.also_user_ids`
  - `fetchUnread` (auth); `sendNotification` now has a 5 s timeout
  - `kit.unread` (30 s cache) and `kit.notificationsUrl` (module-kit)
  - `NotificationsLink` (ui)
  - 🔔 in the Lab Records, Document Store and Floor Stock headers (not in support views)
- **Lab Records:** `src/server/notify.ts` (texts + 20:00 `runEvening`), wired into `entries.ts`, `approval.ts`
  and `reminders.ts` next to the WhatsApp outbox; `POST /api/cron/evening`; Lab Records step in `evening.yml`.
- **Tests:** platform 227 (+17 recipients / tick boxes / unread), Lab Records 125 (+14), module-kit 17,
  Floor Stock 103, Document Store 90, auth 36; typecheck and all four builds pass.

**Decisions (owner, 2026-10-11):**
- chosen people instead of all staff (not the older "module_staff" prompt)
- owners always receive
- ticked people get the same events as owners
- the technicians of a batch get approved / rejected even if not ticked
- lab leads only if ticked (WhatsApp unchanged)
- result corrected is bell only

**Made while building:**
- "ready for approval" fires when a pending batch has tests and nothing failing, once per round (again after
  each released hold)
- the hold notification leaves out whoever entered the failing test
- the tick boxes are sent only when the module list is known and the ticks changed, so a failed load never
  unticks anyone

**Verified on `pnpm dev` (2026-10-11, plant 002):**
- migration `0010` applied
- Sujata ticked Atharv (lab technician + store keeper) for Floor Stock; the edit form offered only Lab Records
  and Floor Stock
- a Floor Stock event reached Sujata + Atharv (2 recipients); the unread endpoint said 1
- Atharv's `/notifications` page rendered in headless Chrome
- test data, tick and sessions removed afterwards

**Not yet verified:**
- the module header bell in a real browser session
- Lab Records events end to end on `pnpm dev` (covered by tests)
- phones (needs the deploy)

**Next:** deploy v0.7.0 + v0.8.0 together (VAPID variables, migrations platform `0009` + `0010`, Floor Stock
`0002`, all four services), test on phones, then N3 (Document Store + platform events) in plan mode.

### 2026-10-11 — Notifications N3: Document Store + PlantOps events — live (v0.9.0, deployed 2026-10-11)
**Built** (release v0.9.0; v0.8.0 = N2 committed `fe2157e` and tagged; v0.7.0–v0.9.0 not deployed at the time, live since
2026-10-11):
- **Platform:**
  - migration `0011_platform_notifications.sql`: `notifications.module_id` nullable (null = a PlantOps event,
    link = platform page), unique `nulls not distinct` (Postgres 15+), `renewal_tenants()` (security definer:
    plant id + renewal date only)
  - `notifyOwnersDirect` (owners only, as `platform_app`, phones via `later()`, never throws)
  - `src/server/platform-events.ts`: lockout (`loginUser`), support opened (`createSupportHandoff`), module on /
    off and plan changes (`updatePlan`), renewal (`runPlatformDaily`)
  - `POST /api/cron/daily` on the platform (`CRON_SECRET`, new on the platform service); Platform step in
    `daily.yml` (`APP_URL`)
  - `NotificationInput.only_listed`
- **Document Store:** `src/server/notify.ts`; expiry notifications from `queueReminders` (newly inserted reminder
  rows only), responsible (`createDocument` / `setResponsible`), added / renewed (bell), storage 80% / 95%
  (`uploadFile`).
- **Tests:** platform 239 (+12), Document Store 102 (+12), Lab Records 125, Floor Stock 103, module-kit 17,
  auth 36; typecheck and builds pass.

**Decisions (owner, 2026-10-11):**
- expiry: one notification per document
- new / renewed: bell only
- plan renewal: 30 / 7 / 1 days before and on the day

**Made while building:**
- PlantOps events go to owners only (never ticked people)
- support opened is bell level
- a module switched on is a phone notification; off and other plan changes are bell
- storage warnings are keyed to the plan's MB, so a bigger plan re-arms them

**Verified on `pnpm dev` (2026-10-11):** migration `0011` applied; the platform daily job answers (wrong secret
401; no plant has a renewal date locally). Lockout, support and plan events: by tests only.

**Not yet verified:**
- the new events on screen
- phones (needs the deploy)
- Railway's Postgres version (must be ≥ 15)

**Next:**
- deploy v0.7.0 → v0.9.0 together: VAPID + `CRON_SECRET` on `platform`, `APP_URL` in GitHub; migrations platform
  `0009`–`0011` and Floor Stock `0002`; all four services
- test on phones
- then N4 (settings and reliability) in plan mode

### 2026-10-11 — Notifications N4: settings and reliability — live (v0.10.0, deployed 2026-10-11)
**Built** (release v0.10.0; v0.9.0 = N3 committed `cc68157` and tagged; v0.7.0–v0.10.0 not deployed at the time, live
since 2026-10-11):
- **Settings:**
  - `NOTIFICATION_KINDS` catalogue in `packages/types` (label, module, `urgent`, `bellOnly`)
  - platform migration `0012`: `notification_prefs` ('bell' / 'off'; no row = normal), applied in `withPrefs`
    for both `notifyPlant` and `notifyOwnersDirect`; urgent kinds ignore it; a choice never raises the level
  - `GET` / `PUT /api/notifications/settings` (own rows only; urgent, unknown or never-received kinds → 400)
  - settings section on `/notifications`; a Settings link in the bell list
- **Cleanup:** `platform.purge_old_notifications()` (security definer; the app login still has no DELETE on
  notifications), called by `runPlatformDaily`.
- **Floor Stock reminder hour:**
  - migration `0003`: `plant_settings.count_reminder`, 17:00–23:00 or off, no row = 20:00
  - owner-only `PUT /api/settings`; "Evening reminder" on `/setup`; audited `setup.reminder`
  - `runEvening` checks each plant's hour
  - `evening.yml` hourly at `30 11-17 * * *` UTC; Lab Records' `runEvening` waits for 20:00 (`NO_TESTS_HOUR`)
- **Outbox:**
  - `OutboxStore` + `kit.retryOutbox` in module-kit: kept only when unreachable / 5xx; given up after 10 tries or
    3 days
  - `notification_outbox` + `outbox_tenants()` in Lab Records `0004`, Document Store `0002`, Floor Stock `0003`;
    `src/server/outbox.ts` in each
  - retried at the start of the daily and evening jobs
- **Tests:** platform 250 (+11), Floor Stock 111 (+8), Lab Records 126 (+1, evening at 8 pm), Document Store 102
  (outbox check; the table-count guard is now 7), module-kit 19 (+2), auth 36; typecheck and all four builds
  pass.

**Decisions (owner, 2026-10-11):**
- three choices per kind
- always on: ON HOLD, Form 3/4 FAIL, document expiry, locked out
- reminder at whole hours 5–11 pm or Off
- cleanup through a database function (no DELETE grant)

**Made while building:**
- bell-only kinds (setup changed, result corrected, added / renewed, support viewed, module off, plan changed)
  offer just Bell / Off
- 4xx refusals and invalid input are not kept in the outbox

**Verified on `pnpm dev` (2026-10-11):**
- all four migrations applied
- Sujata set "Stock count saved" to Bell only; turning off ON HOLD was refused ("urgent and always on")
- the platform daily job ran the cleanup (0 old rows)
- the settings screen rendered in headless Chrome
- test setting and session removed afterwards

**Not yet verified:**
- a live platform outage and catch-up across real services (covered by tests)
- phones
- Railway

**Next:** deploy v0.7.0 → v0.10.0 together, test on phones. N5+ notifications come with each new module phase.

**Live (2026-10-11):** v0.7.0–v0.10.0 deployed together on the shared copy (record: `docs/deployments/shared.md`);
first real notifications for plant 001 the same day (desktop Chrome / Firefox). Android confirmed with the test push
(v0.11.1, 2026-10-11); iPhone not yet tested.

### 2026-10-11 — Floor Stock "Can make" — live (v0.11.0)
**Built** (release v0.11.0; design, mock-ups and build prompt: `docs/FLOOR_STOCK_CAN_MAKE_PLAN.md`; notes in
`apps/floor-stock/NOTES.md`):
- After every count (and correction), the Floor Stock **home page** and **day page** show how many boxes / bottles
  of each finished product the stock is enough for, and which material runs out first. Worked out when the page
  opens, never stored.
- **Owner-only setup on Sections & items:** "Contents" on raw material / consumables (1 packet = 25,000 g, damage
  %, labels' loose count) and "Recipe" on finished goods (what 1 bottle needs). Bottles per box from the PlantOps
  product. Store keepers see it read-only; audited in Recent changes.
- **Shared materials** (one preform for BM 1L and DM 1L) shown as one "make one OR the other" group with the
  shared total.
- **Database:** Floor Stock migration `0004_recipes.sql`, three **new** tables (`material_contents`, `recipes`,
  `recipe_lines`) with `tenant_id` + FORCE RLS, no DELETE. **No existing table changed.** Platform and SSO token
  unchanged.
- **Tests:** Floor Stock 146 (+35: 19 arithmetic with the owner's example, 16 database); the 111 earlier ones
  unchanged. Typecheck and build pass.

**Decisions (owner, 2026-10-11):** pieces / weight per counted unit; labels' second number = loose pieces; damage
allowance per material (preform 0.01%); owner sets it in Sections & items; OR group for shared materials; new tables
only.
**Made while building:** amounts at most 2 decimals (use g for small amounts); recipe measure must match the
material's contents and a contents change that would break a recipe is refused; nothing shows until a recipe exists;
the Recipe panel puts each material on its own row (names were cut off on phones).

**Verified on `pnpm dev` (2026-10-11, plant 002):** owner set Contents and Recipes through the real API (store
keeper refused, no session 401); a count by Atharv showed SampleAqua1L up to 116 box / SampleAqua 500ml up to 104 box
sharing Screw cap blue (2,500 bottles), as worked out by hand; a correction changed it and the old version kept its
numbers; Recent changes listed every change; setup and home screens checked in headless Chrome at phone width.
Test data removed afterwards.

**Not yet verified:** real phones.
**Update 2026-10-11:** plant 001's owner entered Contents (9 materials) and Recipes (8 products) on the live copy
and checked the home page against a count.

**Live (2026-10-11):** migration `0004` applied on the shared copy, `v0.11.0:production` deployed; health checks OK
(`docs/deployments/shared.md`).

**Next:** none for "Can make"; open Floor Stock items are in `apps/floor-stock/NOTES.md`.

### 2026-10-11 — Android phone notifications: diagnosis + "Send a test" — live (v0.11.1)
**Reported:** phone notifications on Android (installed app) don't work.
**Found (live database, read-only):** all four Android phones of plant 001 (bluemins, anmol, kedar ×2) are
correctly signed up with Google's push service (FCM), but they were turned on at 16:09–16:40 IST, after the day's
last notification (14:20). Nothing had been sent to them yet; nobody gets a notification for their own action, and
there was no way to test. Desktop delivery already works.
**Built** (release v0.11.1, platform only, no migration): "Send a test to this phone" on `/notifications`
(`POST /api/push/test`, `sendTestPush` in `src/server/notifications.ts`): one push to the asking device only, no
bell row, 5 per minute; an expired phone (404 / 410) is removed. Platform tests 254 (+4); typecheck and build pass.
**Live (2026-10-11):** `v0.11.1:production` deployed; `/api/push/test` answers (401 without login).
**Verified (2026-10-11):** the owner confirmed the test push arrives on Android (installed app). Android phone
notifications work.
**Not yet verified:** iPhone (iOS 16.4+, added to the Home Screen first).

### 2026-10-11 — Where things stand (end of day)
**Live on the shared copy: v0.11.1** (`docs/deployments/shared.md`).

**Completed today:**
- App notifications N1–N4 live (v0.7.0–v0.10.0); working on desktop (Chrome, Firefox) and **Android** (installed
  app, confirmed with the test push).
- Floor Stock in real use by plant 001 (counts, corrections, low-stock / corrected notifications).
- Floor Stock "Can make" live (v0.11.0); plant 001's owner entered Contents (9 materials) and Recipes (8 products)
  and checked the result against a count.
- "Send a test to this phone" on `/notifications` live (v0.11.1).
- Decided by the owner: **no Brevo email for Floor Stock**; low-stock alerts go by app notifications only.

**Open:**
1. **iPhone notifications:** not tested (iOS 16.4+, PlantOps added to the Home Screen first, then the test button).
2. **Floor Stock day page and "Copy as WhatsApp message"** not yet tried by the owner on the live copy
   (`apps/floor-stock/NOTES.md`, Pending). Deferred for later (owner, 2026-10-13).
3. **A user with only the Plant staff role** not yet tried (Kedar also holds store keeper).
4. **Five Floor Stock decisions made while building** await the owner's OK (`apps/floor-stock/NOTES.md`,
   "Decisions to confirm with the owner"). Deferred for later (owner, 2026-10-13).
5. **Document Store reminder emails:** Brevo set up 2026-10-04, live sending never confirmed (the owner's no-Brevo
   decision covers Floor Stock only so far).

**Next phase:** Phase 6 (Preventive Management) in plan mode when the owner is ready. Complaint Box was built next
instead (owner, 2026-10-11; status note below). **Order Capture:** design, phase plan
and mock-ups approved by the owner 2026-10-12 (`docs/ORDER_CAPTURE_PHASE_PLAN.md`, build prompts per phase); to be
built after Complaint Box is deployed and tried, before Phase 6.

### 2026-10-11 — Complaint Box — live (v0.12.0, deployed 2026-10-12)
Built ahead of Phase 6, decided by the owner 2026-10-11. Design, phases and build prompts:
`docs/COMPLAINT_BOX_PHASE_PLAN.md`; module notes: `apps/complaint-box/NOTES.md`.

**Built** (`apps/complaint-box` on :3004, on `packages/module-kit`):
- **Platform:**
  - migration `0013_complaint_box.sql` (module + role **Complaint desk**; plant staff work in it too)
  - plan limit "Complaint Box storage (MB)"
  - tile 📢 with the owner's "⚙ Item list" link
  - six `NOTIFICATION_KINDS`
  - super_admin "Open … (read-only)" for Complaint Box **and Floor Stock** (it was missing)
- **Module schema** `complaint_box`, login `complaint_app` (migration `0001`):
  - 7 tables with `tenant_id` + FORCE RLS, **no DELETE anywhere**
  - complaint details locked after saving (only the status moves); history, files and audit append-only
  - database checks (Indian mobile, lengths, resolve / reopen need text, file type / size, reference unique per plant)
- **Item list** (owner): starter list from the plant's products + Dispenser / Delivery / Other with tick boxes;
  switch off, never delete; complaint count per item; Recent changes.
- **Logging (phone):**
  - customer, mobile (Indian-mobile rule), place, item, optional batch, description
  - up to 5 photos shrunk on the phone (≤ 1600 px JPEG) + one video ≤ 30 MB
  - reference C-0001… per plant, safe when phones save together
  - files: type by content, size / count / plan storage limit; added by whoever logged it (or the owner) within
    24 h; private storage with byte ranges (iPhone video)
- **Inbox:**
  - list with status / item / date filters and search (ref, name, mobile digits, place)
  - "Open N days", amber after 3; tap-to-call `tel:+91…`
  - complaint page with photos / video and history
  - notes (+ photos), In progress (staff), Resolve with quick picks / Reopen (owner)
  - 409 "just changed by …"
  - owner CSV
- **Notifications (N5+ from day one):**
  - new (push), resolved (to whoever logged it only), reopened, updated (bell), storage 80 / 95 %
  - still open (daily job: day 3, 10, 17… from logging / reopening)
  - outbox + retry
- **Standard pieces:** tile "N open / N open over 3 days / N new today"; support view read-only with page + file
  views on the owner's Support access page; nightly encrypted file backup (`files/complaint_box/…`).
- **Shared code:** file storage moved from Document Store into `packages/module-kit/src/storage.ts` (+ `sniffVideo`).
  Document Store's 102 tests passed unchanged.
- **Deploy pieces:**
  - Dockerfile
  - `add-railway-module.sh` now refuses when the platform doesn't know the module yet (its registration used to
    change 0 rows silently), and writes only the variables a module needs
  - `setup-railway-db.sh` includes Complaint Box for new copies
  - `daily.yml` / `backup.yml` steps skipped until `COMPLAINT_URL`
- **Tests:** Complaint Box 190; platform 264, auth 41, module-kit 33, Lab Records 126, Document Store 102,
  Floor Stock 146.

**Decisions (owner, 2026-10-11):**
- design "all as suggested"
- files added by whoever logged it (or the owner) within 24 h
- note text required; note photos by their author within 24 h
- days open from logging / last reopening, amber after 3
- CSV one row per complaint

**Made while building:**
- audit table named `audit_log` (like the other modules)
- reference stored as a number, shown as C-0001
- the still-open reminder sends the latest step reached, so a missed day catches up
- no customer phone numbers in notifications

**Bugs found by the checks and fixed:**
- `crypto.randomUUID()` crashed the form on plain-`http` phone testing
- a reopened complaint kept its old day count
- the reminder title showed the step instead of the real days

**Verified on `pnpm dev` (plant 002, headless Chrome at phone width; all test data removed after each check):**
- real platform logins for a temporary owner, complaint desk user and support handoff
- complaint with two 4032×3024 photos (stored 1600×1200) + an MP4; byte-range video
- failed upload + Try again
- note, In progress, Resolve ("Replaced"), Reopen, a stale change (409)
- CSV; support read-only
- Sujata's real inbox got the new / note / still-open notifications
- tile numbers through the platform
- the Support access page

**Live (2026-10-12):** `v0.12.0:production` (`a375c8f`); `complaints.bluemins.life/health` answers with the
database OK; the live database has the `complaint_box` schema, so `backup.yml` now also checks it is in each nightly
dump (`91f32c3`). The owner has tried it on a phone (confirmed 2026-10-13).

**Not yet confirmed (not recorded at deploy time):** GitHub variable `COMPLAINT_URL` with a green Daily jobs /
Nightly backup run, the first real R2 copy of complaint files, the volume at `/data`; iPhone HEIC photos and Safari
video in particular. `.env.railway.shared.complaint_box.paste` (holds the database password) is still on Rocky's
computer: delete it once its values are in Railway and the password manager.

### 2026-10-13 — Order Capture Phase 0 (readiness) — done
- Complaint Box live and tried on a phone (above).
- Floor Stock's open items **deferred for later** by the owner (2026-10-13): the day page / "Copy as WhatsApp
  message" check and the five "Decisions to confirm" (`apps/floor-stock/NOTES.md`).
- `docs/ORDER_CAPTURE_PHASE_PLAN.md` re-checked against the code; it still matches. Wording fixes made: active
  products only, the reference lock, `ORDER_URL` in `daily.yml`'s comment, Order Capture in `setup-railway-db.sh`,
  and **Order Capture reads PlantOps products (Business details → Products), not Floor Stock**, so what matters is
  that every product sold exists there with the right units per pack / pack type.
- **Next:** Order Capture Phase 1 (platform registration) when the owner says "start".

### 2026-10-13 — Order Capture — live (v0.13.0, deployed 2026-10-13)
Built ahead of Phase 6, decided by the owner 2026-10-12. Design, phases and build prompts:
`docs/ORDER_CAPTURE_PHASE_PLAN.md`; module notes (one dated note per phase): `apps/order-capture/NOTES.md`.

**Built** (`apps/order-capture` on :3005, on `packages/module-kit`):
- **Platform:**
  - migration `0014_order_capture.sql`: module + role **Order desk**; **plant staff do NOT work in it**
    (`PLANT_STAFF_EXCLUDED` = Lab Records + Order Capture)
  - three `NOTIFICATION_KINDS`
  - tile 🧾 "Take an order" with the owner's "⚙ Rates" link
  - super_admin "Open Order Capture (read-only)"
- **Module schema** `order_capture`, login `order_app` (migration `0001`):
  - 8 tables with `tenant_id` + FORCE RLS, **no DELETE anywhere**
  - an order's reference, customer copy and saved lines never change: a change is a new version of the lines
  - history, audit and support views append-only; a customer's phone is fixed
- **Rates** (owner): unit ("box" for a pack of several, else the pack type) and default rate per **active PlantOps
  product**; Recent changes.
- **Customers** (owner + Order desk): name, phone, place; one customer per phone per plant (any spelling of the
  number); switched off, never deleted; owner's **CSV upload** with a preview that follows the plan's duplicates
  table (nothing saved until confirmed; rejected rows downloadable).
- **New order** (phone):
  - customer by phone (found / new with the order), lines with whole quantity and a rate pre-filled from the
    customer's last non-cancelled order, else the default
  - live total; references O-0001… per plant, safe when phones save together
  - a repeated save never makes a second order
  - totals in whole paise
- **Order list and handling:**
  - Pending (oldest first, **amber from 2 days**) / Delivered / Cancelled; search and dates
  - order page with history and every version
  - Change (new version), Mark delivered (note, Zoho invoice no.), Cancel (reason, final), Undo delivered (owner,
    reason)
  - 409 "just changed by …" when two people act at once
  - owner CSV
- **Notifications (N5+ from day one):** new order (push), delivered (to whoever entered it, bell), cancelled (bell),
  outbox + daily job.
- **Standard pieces:** tile "N pending · N pending over 2 days · N new today"; support view read-only with the owner's
  Support access page; no files (no volume, nothing extra to back up).
- **Shared code:** the Indian-mobile phone rule moved into `packages/module-kit/src/phone.ts`, used by Complaint Box
  too (its 190 tests unchanged).
- **Deploy pieces:** Dockerfile (no volume); `setup-railway-db.sh` includes Order Capture for new copies; `daily.yml`
  step skipped until `ORDER_URL`.
- **Tests:** Order Capture 224; platform 272, auth 49, module-kit 52, Lab Records 126, Document Store 102,
  Floor Stock 146, Complaint Box 190.

**Decisions (owner, 2026-10-12):** the plan as written, incl. Order desk only (no plant staff), cancelled is final,
whole quantities, each product once per order, CSV upload with the duplicates table, bell-only delivered /
cancelled.

**Made while building (in NOTES.md per phase):**
- `order_lines.line_no` and `order_events.invoice_no` (approved with the migration)
- letter case counts in the upload
- full phone numbers in the upload preview
- a product switched off since can stay in a changed order
- Change / Undo send no notification
- "The owner has been notified." on the saved screen for non-owners

**Bugs found by the checks and fixed:**
- a search for "+91 …" found nothing
- the customer list's buttons jumped beside / below the name

**Verified on `pnpm dev` (plant 002, headless Chrome at 390 px, real platform logins; all test data removed):** the
owner's sample order (₹510), change / deliver / undo / cancel, the upload of every duplicates case, Sujata's bell
"New order O-0001: ₹510", the tile numbers, a real support handoff.

**Live (2026-10-13):** `v0.13.0:production` (`77a39ce`) at `orders.bluemins.life`, service `order-capture` (no volume).
Checks passed: `/health` OK, platform login redirect, APIs and tile 401 without a session / ticket, cron 401 with a
wrong secret, the other services healthy (`docs/deployments/shared.md`). `backup.yml` now checks the dump has
`order_capture` data.

**Not yet verified:** the Daily jobs run with the Order Capture step; the first nightly backup with the schema; the
owner's phone checklist for plant 001 (switch on, rates, customer upload, Order desk user, sample order, notification,
deliver, cancel, CSV); iPhone.

### 2026-10-13 — Order Capture: order note + owner's pending summary (v0.13.1)
- **Order note:** optional free text on a new order, fixed once saved. Order Capture migration `0002_order_note.sql`
  (one column, no UPDATE grant, approved by the owner). It is shown on the order page, the list and the CSV, and in the
  "New order" notification.
- **Pending summary:** owner-only card on the Pending tab with the total value and quantity / rate / amount per
  product. No schema change.
- Details: `apps/order-capture/NOTES.md`; tests 232 Order Capture.

### 2026-10-13 — Installed app in the plant's own look (v0.13.3)
- The installed app shows the plant's logo (on a white square) and name, in its brand colour, for a logged-in plant
  user. PlantOps "P" before login, for super_admin, and for plants without a PNG / JPG logo.
- Code: `apps/platform/src/server/app-icon.ts`; routes `/manifest.webmanifest` (replaces `manifest.ts`) and
  `/plant-app/<token>/manifest.webmanifest` + `/icon/<180|192|512|512m>`.
- **Access decision (owner, 2026-10-13):** phones fetch icons without the login cookie, so these routes need no login.
  They use a signed link instead (HMAC with a key derived from the SSO private key; no new setting) and show only
  the name, colour and logo.
- Already-installed phones must remove the app and add it again.
- Tests: platform 281 (+9).

### 2026-10-14 — Plant staff view Order Capture, WhatsApp copy, Permissions screen (v0.14.0)
Asked by the owner 2026-10-14; mock-ups approved the same day. No database change; the SSO token is unchanged.
- **Order amounts only for the owner and Order desk** (and PlantOps support, read-only). Plant staff get the orders
  with no rates or totals: removed on the server, not just hidden.
- **Plant staff view Order Capture:** `PLANT_STAFF_VIEW_ONLY` + `viewOnlyIn()` in `packages/types`, used by
  `canAccessModule`. They see the order list and each order (customer, phone, place, products, quantities, note,
  history) and can't enter, change, deliver or cancel; no customer list, Rates or CSV. They stay out of
  `roleWorksIn` for Order Capture, so they are never ticked for its alerts (the new-order alert carries the amount).
  A plant-staff-only user who also works in Floor Stock now sees the tile screen.
- **"Copy as WhatsApp message"** on the Pending tab: tick orders (Select all / Clear apply to the orders shown),
  then one message for the day's delivery; the rate per product line and each order's amount only for people who
  see amounts (no grand total since 2026-10-17, owner).
- **Owner's Permissions screen** (`/admin/permissions`, "Permissions" on the dashboard): read-only grid of users ×
  switched-on modules with each person's role there, "View only, no amounts", 🔔 for alerts, disabled users greyed,
  and a key. Worked out with the same rules the servers use (`src/lib/permissions.ts`); changes stay on Manage users.
- Details: `apps/order-capture/NOTES.md` (v0.14.0 note and the updated permission table).
- **Tests:** Order Capture 243 (+11), platform 294 (+13), auth 50 (+1).

**Not yet verified:** on screen with real logins (pending); not deployed.

### 2026-10-14 — Order Capture: WhatsApp thank-you on "Delivered" via Twilio (v0.15.0)
Asked by the owner 2026-10-14; plan `/home/rocky/.claude/plans/cozy-snuggling-pearl.md`, details
`apps/order-capture/NOTES.md`.
- "Mark delivered" panel: tick box (ticked by default) "Send a WhatsApp thank-you to <customer>". PlantOps sends the
  plant's approved Twilio template (`{{1}}` = customer name) after the answer; replies go to the Twilio number.
  Once per order ever; status in the order's History; daily job retries (3 tries / 24 h).
- Config on `order-capture` only: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_SENDERS` (per plant
  id: sender + template SID). Plants not listed have no tick box.
- **Schema (approved by the owner):** Order Capture migration `0003_customer_messages.sql`, one new table with
  FORCE RLS, no DELETE. Platform and SSO token unchanged.
- **Tests:** Order Capture 258 (+15). Typecheck and build pass.

**Not yet verified:** on screen; a real Twilio message (set the three variables, deliver an order to your own number).
Not deployed (v0.14.0 isn't either).

### 2026-10-14 — Order Capture: notes after an order is saved — live (v0.16.0)
- **"+ Add a note"** on the order page: owner and Order desk, any status (pending, delivered, cancelled), ≤ 300
  characters, never changed afterwards. The note typed with the order stays fixed; the Note box lists it with every
  added note (who / when); History shows "Note by …". Plant staff and support read only.
- Order Capture migration `0004_order_notes.sql` (approved by the owner): `order_events.kind` also allows `note`, text
  required; still append-only. New kind `order_capture.note` (bell only; owners + ticked people, not the author).
- Tests: Order Capture 262 (+4), platform 294. Details: `apps/order-capture/NOTES.md`.
- **Live (2026-10-14):** migration applied, `v0.16.0:production` (`4a0a749`), health checks OK. v0.15.0 (WhatsApp
  thank-you) was already live. **Not yet verified:** a note on screen and its notification.

### 2026-10-15 — Roles: what Plant staff means (decided) + clearer role buttons (v0.16.1)
**Decided by the owner (2026-10-15):**
- One role per module: Lab Records = Lab technician / Lab lead; **Document Store = Document keeper** (not Store
  keeper); Floor Stock = Store keeper; Complaint Box = Complaint desk; Order Capture = Order desk; Preventive Mgmt =
  Maintenance technician; Marketing Contacts = a new **Sales team** role (Phase 9).
- **Plant staff = "this person is an employee".** Every employee can hold it next to their work role (e.g. Store
  keeper + Plant staff). With Attendance & Salary (Phase 8) it gives:
  - **own attendance and overtime only**; **salary is visible to the owner only**
  - the Order Capture view (orders without amounts) stays
  - **no work in Floor Stock, Document Store or Complaint Box** any more; **not Marketing Contacts** either
- **When:** first planned together with Attendance & Salary; **brought forward by the owner the same day** (v0.17.0,
  below) after seeing a Plant-staff-only user open Floor Stock, Document Store and Complaint Box.
- To settle in the Phase 8 plan: who marks attendance (the person, the owner, or a supervisor), and whether an owner
  appears in attendance.

**Built (platform only, no database or permission change):** Add / Edit user role buttons now show the module each
role opens; roles for modules the plant hasn't switched on are hidden (a role someone already holds stays, greyed,
"not switched on", so it can be removed); Plant staff lists what it opens in this plant, worked out from
`roleWorksIn` / `viewOnlyIn` (`roleChoices` in `apps/platform/src/lib/permissions.ts`). Mobile is "optional, for
Lab Records WhatsApp alerts" only for owners / lab leads. Tests: platform 298 (+4).
**Live (2026-10-15):** `v0.16.1:production` (`8a9c749`), checks OK. **Not yet verified:** on screen.

### 2026-10-15 — Plant staff = employee, applied now (v0.17.0)
**Asked by the owner 2026-10-15** (reeta, Plant staff only, could open Floor Stock, Document Store and Complaint Box).
No database change; the SSO token is unchanged.
- `packages/types`: `PLANT_STAFF_EXCLUDED` replaced by the allow-list `PLANT_STAFF_MODULES = ["attendance_salary"]`;
  `roleWorksIn("plant_staff", m)` is true only there. The Order Capture view (`viewOnlyIn`) is unchanged.
- Floor Stock (`canCount`) and Document Store (`canManage`, responsible-person choices) now use `roleWorksIn`
  instead of naming `plant_staff`; Complaint Box already did. Each module's own server refuses a Plant-staff-only
  login (403).
- Launcher: a Plant-staff-only user of a plant with Order Capture lands straight in Order Capture (view only).
- Role buttons: Plant staff reads "Employee · <what it opens here>".
- "Gets alerts" ticks for modules a person no longer works in are kept in the table but skipped at send time (the
  existing re-check); they disappear from the form when the person's roles are next saved.
- **Who it affects on the live copy (plant 001, read-only check 2026-10-15):** reeta (only Order Capture view
  left); bindu and Gaja lose Document Store + Complaint Box; Dillip loses Floor Stock + Document Store (and his
  Floor Stock alerts); Ramu loses Document Store. Anmol and Kedar keep everything. No document has a Plant staff
  person as responsible.
- Tests: platform 299, auth 52, Complaint Box 190 (Kedar in the test plant is now Complaint desk + Plant staff; a
  Plant-staff-only person is refused everywhere), Floor Stock 146, Document Store 102.
- **Live (2026-10-15):** `v0.17.0:production` (`232f02c`), checks OK. The owner had already moved everyone off Plant staff
  except Gaja (Store keeper), so only she lost Document Store + Complaint Box. **Not yet verified:** a Plant-staff-only
  login being refused by Floor Stock on the live copy.

### 2026-10-15 — Attendance (Attendance & Salary version 1) — built (v0.18.0)
Built ahead of Phase 6, decided by the owner 2026-10-15. Design, phases and build prompts:
`docs/ATTENDANCE_PHASE_PLAN.md`; module notes: `apps/attendance-salary/NOTES.md`.

**Built** (`apps/attendance-salary` on :3006, on `packages/module-kit`):
- **Platform** (no migration; module row since `0001`):
  - `OWNER_ONLY_ALERTS = ["attendance_salary"]` in `packages/types`: no "Gets alerts" tick box (form and API refuse
    it); `notifyPlant` ignores ticks there; `also_user_ids` + `only_listed` still reach the worker
  - three `NOTIFICATION_KINDS` (+ flag `aboutYou`: in an owner-only module a non-owner sees only those in settings)
  - tile "Mark attendance", owner link "⚙ Location & QR"; no 🔔 on the Permissions screen for staff
  - `attendance_salary` in `SUPPORT_READY`; `alertChoices` moved to `src/lib/permissions.ts`
- **Module schema** `attendance_salary`, login `attendance_app` (migration `0001`): 6 tables with `tenant_id` + FORCE
  RLS, no DELETE; UPDATE only on the plant settings and the outbox retry columns. A scan stores distance and
  accuracy, **never coordinates**. One access table (`src/server/access.ts`).
- **Marking:** QR on the wall (`/scan?k=`), one big Mark IN / OUT, browser location; the server decides time and IN /
  OUT and checks key, circle (200 m), accuracy (≤ 500 m), double tap (2 min), with a per-person lock. **The QR key
  is never stored** (HMAC of `ATTEND_SESSION_SECRET` + plant + QR date; hash in the database): reprint any time;
  "Make a new QR" stops old prints; changing the secret does too.
- **Worker:** own month calendar and day view (24-hour bar, "added by owner: …", cancelled crossed out).
- **Owner:** Today board, Staff (people who left keep their history), person pages with **Fix** (add a time /
  cancel a mark, reason required, never in the future, cancel once, 409 if the day changed), month CSV, Recent
  changes, Location & QR settings + A4 print.
- **Pairing rules** in one pure function (`src/lib/sessions.ts`): blocks on the India date they start, "no exit"
  after 16 h, "no entry", "changed"; nothing stored.
- **Notifications (N5+):** corrected (worker only, phone + bell), outside (owners, bell, once per person per day),
  no exit (owners, bell, daily job 07:00); outbox + `kit.retryOutbox`; Attendance step in `daily.yml`.
- **Tile:** owner "N in now / N not marked today (from 11:00) / N no exit", "Set location & QR" until set up; workers
  no badge. Support view read-only and logged.
- **Tests:** Attendance 151, platform 312 (+13).

**Decisions (owner, 2026-10-15):** printed QR + location check; one QR, the app decides IN / OUT; only the owner
fixes, with a reason; everyone with Plant staff is tracked; 500 m accuracy, 2-minute double tap, 16-hour rule,
200 m circle; owner-only alerts; Plant staff keeps the Order Capture view; "no exit" only after 16 h; a "Get alerts
on this phone" link for workers; the QR drawn by the server and reprintable; workers' tiles without a badge.

**Made while building:** the double-tap check before the "changed" 409; future dates 404; a fix may be on the page's
day or the next morning (night shifts); the day stamp for stale fixes; "Set location & QR" tile badge; no
notification when an owner fixes their own marks.

**Verified on `pnpm dev`** (plant 002, temporary users, all removed afterwards): login through the platform (worker
lands in Attendance, store keeper refused); scan screen in Chrome at 390 px with a faked location (1.4 km refused,
40 m saved); settings and print; worker month and day; owner Today, Staff, a fix through the screen, Recent changes,
CSV; Sujata's real bells ("outside", "no exit") and the worker's "corrected"; the tile numbers.

**Not yet verified:** real phones (location needs https: Android, iPhone, Google Lens); the live deployment.

**Next:** go live on the shared copy (`add-railway-module.sh`, service `attendance-salary`, DNS, `ATTENDANCE_URL`,
deploy), then the owner's checklist at plant 001 (docs/HANDBOOK.md "Attendance: QR and location").

### 2026-10-16 — Floor Stock "Made from" (preform → empty bottle) — built (v0.19.0)
**Reported by the owner:** "Can make" ignored the preforms: BM 1L showed 66 box from 2 pkt of empty bottles while
12 pkt of Preform 18.5 were in stock. Plant 001's setup was also checked (read-only): caps without Contents (fixed by
the owner the same day: D Blue = 8,000 pcs per box) and labels counted in pieces under the unit "bundle" since 12 Oct
(the count is pre-filled from the day before; the owner to correct the count).
- **Built:** a stock item counted in pieces can be "made from" other materials, one step deep (owner only, Sections
  & items, audited). "Can make" adds what the preform can still make to the bottles counted; only the preform's
  damage allowance counts (owner, 2026-10-16). Details: `apps/floor-stock/NOTES.md`.
- **No database change** (a recipe on a stock item); platform and SSO token unchanged.
- Tests: Floor Stock 158 (+12, incl. plant 001's 16 Oct numbers). Typecheck and build pass.
**Not yet verified:** on screen; not deployed. After deploying, the owner sets "Made from" on the five Empty Bottle
items.

### 2026-10-17 — Salary (Attendance & Salary version 2) — built (v0.20.0)
Decided by the owner 2026-10-16. Design, rules, phases and build prompts: `docs/SALARY_PHASE_PLAN.md`; module notes
(rules, tables, access table, phase notes): `apps/attendance-salary/NOTES.md`; how to use it: `docs/HANDBOOK.md`
"Attendance: salary at month end".

**Built** (in `apps/attendance-salary`; no new app):
- **Database:** migration `0002_salary.sql`, five new tables (`salary_settings`, `salary_advances`,
  `salary_visibility`, `salary_payments`, `salary_payment_undos`) with `tenant_id` + FORCE RLS, `attendance_app` SELECT
  + INSERT only (nothing is ever changed or deleted); `salary_tenants()`. No existing table changed; SSO token
  unchanged.
- **The rules** in one pure file, `src/lib/salary.ts`, used by the server, the CSV and the browser's checking panel:
  every day counts, present / half / absent by shift hours, ÷ 30, paid leave (default 2, lapses), overtime per person
  in exact minutes, advances and negative carry, full vs part month, paid months frozen with "changed after payment"
  flowing to the next month once. Money in whole paise.
- **Owner:** Salary box + history, "Can see own salary", advances with corrections on Staff → person; **Salary tab**
  (totals, table / phone list, "No salary set", checking panel, CSV); **Mark paid** / Undo. Audit + Recent changes.
- **Worker:** present / half / absent and overtime (only with Gets overtime) on their calendar, never money; with the
  owner's tick, their own slips for paid months (`/my/salary`); 404 in every other case.
- **Access:** five rows in the one access table (`salary_view`, `salary_edit`, `salary_pay`, `salary_export`,
  `see_own_salary`); PlantOps support read-only, page views logged.
- **Notifications (N5+):** `attendance_salary.salary_review` (owners, last day 07:00 IST, daily job) and
  `attendance_salary.salary_paid` (the worker only, only with the tick); outbox.
- **Tests:** Attendance 258 (+107 since v0.18.0), platform 312.

**Decisions (owner, 2026-10-16):** the plan as written (÷ 30, overtime per person, advances carry, checking panel,
paid tick, staff permission); Joined on / Last day optional; overtime in exact minutes; support sees salary read-only;
a past from month needs a reason; review on the last day at 07:00.

**Made while building (in NOTES.md per phase):** a correction lowers the month of the entry it corrects; a month not
over shows the salary minus absences so far; money as plain whole-paise numbers (not BigInt); the PC checking panel is
a right-hand drawer and the table widens past the page column; each advance has its own Correct button; "Paying now"
shows the exact amount; the mark-paid dialog is drawn over the whole page.

**Verified on `pnpm dev`** (plant 002 with Attendance switched on only for each check, temporary users, all removed
afterwards): every screen at 390 and 1280 px; the worked example (₹9,040) on screen; the panel's "+₹120"; mark paid
for a worker with and without permission and what each sees; undo and pay again; the review notification with a faked
31 Oct.

**Not yet verified:** real phones; the live deployment; the owner's checklist at plant 001 (in
`docs/deployments/shared.md` once live).

### 2026-10-17 — Salary extras Part A: per-day pay — built (v0.21.0)
Asked by the owner 2026-10-17. Design, phases and build prompts: `docs/SALARY_EXTRAS_PHASE_PLAN.md`; module notes
(A1 and A2): `apps/attendance-salary/NOTES.md`.

**Built** (in `apps/attendance-salary`; no platform change, SSO token unchanged):
- **Database:** Attendance migration `0003_per_day_pay.sql` (approved by the owner), the first change to an existing
  salary table: `salary_settings.pay_basis` ('monthly' default / 'per_day'), `day_rate_paise` (≤ ₹1 lakh),
  `monthly_paise` may be empty; one check (monthly = salary, no day rate; per day = day rate, no salary, 0 paid leave).
  Existing rows read as monthly; grants unchanged (SELECT + INSERT).
- **Rule 15** in `src/lib/salary.ts`: earned = day rate × (present + ½ half days), rounded once; no paid leave; no
  full / part month difference; overtime, advances, carry and paid months unchanged. `RULES_VERSION` 2; `readFrozen`
  reads months frozen with `rules: 1` as monthly.
- **Screens:** Salary box **Pay: Monthly / Per day** with the day rate (the server saves 0 leave whatever is sent);
  Salary tab "per day" tag, "₹450 / day", leave "—"; checking panel "Day rate" box; CSV "Pay basis" / "Day rate";
  slip "24 present + 2 half days (25 days) × ₹450"; history / Recent changes "per day ₹450 · 8 h · …".
- **Tests:** Attendance 288 (+30 since v0.20.0): worked example A (₹9,850), the database checks, a per-day month from
  real marks, an old `rules: 1` slip, the API rules, the tab / CSV / panel / slip.

**Decisions (owner, 2026-10-17):** the plan as written (two releases, per day = day rate × present days, half = half,
no paid leave, overtime unchanged). **Made while building:** CSV headers in the file's existing wording ("Pay basis",
"Day rate"); the total row's Salary shows "—" when everyone is per day; `PayInput.monthlyPaise` is 0 for per-day
people.

**Verified on `pnpm dev`** (plant 002 with Attendance switched on only for the check, a temporary owner + per-day
worker with worked example A's September marks, headless Chromium at 1280 and 390 px; all removed afterwards): Per day
saved through the Salary box, the Salary tab and panel, the CSV, marked paid at exactly ₹9,850, the worker's slip.

**Not yet verified:** the live deployment; the owner setting one per-day person at plant 001.

### 2026-10-17 — Salary extras Part B: field duty and expense claims — built (v0.22.0)
Asked by the owner 2026-10-17. Design, phases and build prompts: `docs/SALARY_EXTRAS_PHASE_PLAN.md`; module notes
(B1-B5): `apps/attendance-salary/NOTES.md`.

**Built** (in `apps/attendance-salary`; SSO token unchanged):
- **Database:** Attendance migration `0004_claims.sql` (approved by the owner): `salary_settings.km_rate_paise` (TA per
  km) / `da_day_paise` (DA per day); `salary_claims`, `salary_claim_decisions` (decided once, cancelled once, reason for
  not approved / cancelled), `salary_claim_files` (bill photos, + sha256 and unique storage key, approved with the
  migration); FORCE RLS, `attendance_app` SELECT + INSERT only. 14 tables.
- **Rules 16-19** in `src/lib/salary.ts` (`claimTotals`): only approved claims; TA = km × rate (rounded once), DA = days
  × rate, expenses added up; remaining adds them; `RULES_VERSION` 3; paid months freeze the counted claims.
- **Worker (My claims):** field duty and expenses with up to 3 photos (shrunk on the phone), 31 days back, one field
  duty a day, withdraw while waiting; km and own amounts only, never TA / DA rupees.
- **Owner:** TA / DA rates in the Salary box; Claims tab with the waiting count (approve / not approve with reason /
  cancel, 409 on a stale claim); claims on the person page and entries for someone (approved at once); Salary tab
  columns, banner, panel boxes, CSV, mark-paid warning; slip lines; review count; tile badge; support read-only.
- **Files:** `packages/module-kit` storage in Attendance's own folder (`ATTEND_STORAGE_DIR`) or bucket; nightly backup
  `POST /api/cron/backup` + `backup.yml` step (on with the GitHub variable `ATTENDANCE_BACKUP_FILES`).
- **Platform:** three `NOTIFICATION_KINDS` (claim_new, claim_decided `aboutYou`, storage), "Attendance & Salary storage
  (MB)" on the plan screen. No platform migration.
- **Tests:** Attendance 364 (+59 since v0.21.0), platform 313.

**Decisions (owner, 2026-10-17):** the plan as written (two releases, 31 days back, what a worker sees, an owner's own
claims approved at once, 3 photos per expense, TA / DA for monthly people too). **Made while building:** owners may add
photos to an entry they made (it is approved at once); the worker's link is `/my/claims?m=`; CSV headers in the file's
wording; the backup step waits for `ATTENDANCE_BACKUP_FILES`; `age-encryption` as a test dependency.

**Verified on `pnpm dev`** (plant 002 with Attendance switched on only for each check, temporary owner + worker, headless
Chromium at 390 and 1280 px; all rows, photo files and notifications removed afterwards): a worker's field duty and
expense with a real photo (stored 1600 × 1067), the same day twice refused, the owners' "new claim" bells, approve and
not approve through the Claims tab with the worker's "your claim" bells, the Salary box rates, the Salary tab / panel /
CSV with TA / DA / expenses, the mark-paid warning, paying, and the worker's slip.

**Not yet verified:** the live deployment; real phones (a photo from Android / iPhone); the owner's checklist at plant 001.

### 2026-10-17 — Attendance: claims only for field staff — live (v0.22.1)
Owner's "Field staff" tick in the Salary box (from a month): only ticked people send their own field duty / expense
claims and see My claims (also anyone with a claim on record); a TA / DA rate needs the tick; the owner's entries for
someone are not limited. Attendance migration `0005_field_staff.sql` (rows with a rate ticked once; on the live copy
nobody had one, so nobody is ticked yet). Live 2026-10-17 (`024b57e`). Plan `docs/ATTENDANCE_ROLES_PHASE_PLAN.md`
Phase C; notes in `apps/attendance-salary/NOTES.md`.

### 2026-10-17 — Attendance: Office staff and Supervisor — live (v0.23.0)
Asked by the owner 2026-10-17. Design, mock-ups, phases and prompts: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md`; one dated
note per phase (R1-R5) in `apps/attendance-salary/NOTES.md`; how to use it: `docs/HANDBOOK.md` "Attendance: office
desk and supervisor".

**Built:**
- **Platform:** migration `0015_attendance_roles.sql` (roles `office_staff`, `supervisor`, both Attendance). Role
  buttons say what each does; both on the Permissions screen (🔔 for supervisors); launcher tiles "Attendance desk" /
  "Today board" with the summary request's new **`desk` view** (attendance numbers, never claims or money);
  `NOTIFICATION_KINDS` gain `roles` / `noOwners`, so a Supervisor's settings list the scan and not-marked alerts, owners
  never get every scan, and Attendance's "about you" kinds are for Plant staff only.
- **Attendance:** migration `0006_desk_and_staff_type.sql` (`punches.source` 'desk' + its check,
  `salary_settings.staff_type`, `plant_settings.not_marked_hour` + a column UPDATE grant, approved by the owner).
  - Access as a set of capacities; only Plant staff (`isEmployee`) are tracked.
  - **Office staff:** `/desk` "Mark for someone" (scan rules, office phone's location, never yourself), Fix (never
    their own), their person page with advances and "still to recover" but no salary, advances (7 days back, ≤ ₹1
    lakh, correct own entry the same day). Owners get `advance_given` (phone) and `desk_fix` (bell).
  - **Supervisor:** read-only Today board; `scan` bell after every saved mark (supervisors only, never owners);
    `POST /api/cron/morning` sends `not_marked` (owners + supervisors) at the plant's hour (Settings: 08:00-11:00 or
    Off); `evening.yml` has a morning line for it.
  - **Permanent / Temporary** in the Salary box; Salary tab "TEMP" tag and a "Manpower cost" card split by type; CSV
    "Staff type". The salary rules don't change.
- **SSO token unchanged.**
- **Tests:** Attendance 414, platform 320, auth 53 (others unchanged); typecheck and all builds pass.

**Decisions (owner, 2026-10-17):** the plan as written (mock-ups approved; scan alert bell only; desk view for tiles;
not-marked counts the board's list); the `not_marked_hour` column grant.
**Made while building (in NOTES.md):** an owner opening "Mark for someone" is told to use Fix; Settings is "not found"
for Office staff / Supervisors; the day view names who added a time; the desk tile says "Not set up yet" before the
location and QR exist.

**Verified on `pnpm dev`** (plant 002, temporary users and sessions, all removed): `/desk` with a real tap and a faked
location, the Office person page and advances, `/salary` 404 for Office staff, the owner's day "by … (office)", the
Supervisor's board and bell, Settings with the alert hour, the Salary box and tab with the split, Manage users,
Permissions, the Office staff launcher tile and the Supervisor's notification settings.

**Live (2026-10-17):** migrations platform `0015` and Attendance `0006` applied, `v0.23.0:production` (`0f28102`), live
checks OK (`docs/deployments/shared.md`). **Not yet verified:** real phones; the first morning run; the owner's
checklist at plant 001 (in the deploy record).

### 2026-10-17 — Attendance: "Ask for DA" on a field duty — live (v0.24.0)
Asked by the owner 2026-10-17 (a field-duty person sometimes eats at home). The Field duty form has a tick box "Ask for
DA (food allowance) for this day", ticked by default; unticked = TA for the km only, no DA that day. Attendance
migration `0007_claim_wants_da.sql` (approved by the owner): `salary_claims.wants_da`, existing field duties = yes, so
nothing counted or paid changes; still SELECT + INSERT only. DA = approved field-duty days that asked for DA × rate
(`RULES_VERSION` 4). Shown on claim cards, the owner's card, the slip, panel, CSV ("DA days") and the "new claim"
alert. Platform and SSO token unchanged. Notes: `apps/attendance-salary/NOTES.md`. Tests: Attendance 418 (+4).
**Live (2026-10-17):** migration `0007` applied, `v0.24.0:production` (`cea5736`), checks OK
(`docs/deployments/shared.md`). **Not yet verified:** on screen.

### 2026-10-17 — Job applications — live (v0.25.0, deployed 2026-10-17)
Asked by the owner 2026-10-17. Design, mock-ups, phases and build prompts: `docs/JOB_APPLICATIONS_PHASE_PLAN.md`; one
dated note per phase in `apps/job-applications/NOTES.md`; how to use it: `docs/HANDBOOK.md` "Job applications".

**Built** (`apps/job-applications` on :3007, on `packages/module-kit` with `homePath: "/applications"`):
- **Platform:** migration `0016_job_applications.sql` (module + role **HR desk**); tile 📋 "Applications" with the
  owner's "⚙ Openings"; plan limit "Job applications storage (MB)"; two `NOTIFICATION_KINDS`; `GET
  /api/m/plants/by-code/:code` (Job applications only, `{ tenant_id, name }`, one 404 for every refusal); `code` in the
  branding answer; `SUPPORT_READY`.
- **Module schema** `job_applications`, login `jobs_app` (migration `0001`): 9 tables with FORCE RLS, SELECT + INSERT
  and listed column UPDATEs, **no DELETE**. The first deletes in any module are security-definer functions only:
  `purge_applications` (12 months, the applicant's consent) and `remove_application` (owner's Remove now, with a
  reason); their files are queued in `file_removals` and deleted from storage **and the backup bucket** by the daily job.
- **Public page:** openings by group, one page per position, apply form (one PDF ≤ 5 MB or 1–3 photos shrunk on the
  phone, consent `v1`), reference J-0001… Spam rules: trap field, 20 sends per connection per hour (owner, 2026-10-17),
  one per phone per position per 30 days, files checked by their bytes, Turnstile when its keys are set (refused when
  Cloudflare can't be reached). Figtree font served by the app itself.
- **Owner / HR desk:** list with status chips, search and position filter; application page with Call / WhatsApp,
  resume, status (409 "Just changed by …"), notes, history, "Applied before"; owner Openings (switch, order, page
  message, Copy link, QR poster), Recent changes, CSV, Remove now, Support access.
- **Shared code:** `packages/module-kit` gains `photo.ts` (moved from Complaint Box), `rateLimit` / `clientIp` /
  `readBody`, `plantByCode`, `homePath`, and deletes used only here (`FileStorage.remove`, `S3Client.delete`,
  `removeBackupCopy`); `packages/auth` `fetchPlantByCode`.
- **Tests:** Job applications 122, platform 331, module-kit 69, auth 57, Complaint Box 190 (unchanged).

**Decisions (owner, 2026-10-17):** the plan as written (bare address = plant 001, HR desk, the owner's four columns +
group + short tag, "just send your resume", 12 months); Phases 4–6 built together; 20 sends an hour; Turnstile down =
refused.
**Made while building (in NOTES.md):** the plant code added to the branding answer; files written inside the save's
transaction; Recent changes in the form's order; photos (not PDFs) locked down when served.

**Verified on `pnpm dev`** (plant 002, temporary users, all removed): every screen at 390 px against the mock-ups; a
real photo send and a PDF send; Sujata's bells; tile numbers; status, 409, note, CSV, Remove now; the daily job
deleting the removed file.

**Live (2026-10-17):** `v0.25.0:production` (`1ea1c09`) at `https://jobs.bluemins.life`, new service
`job-applications` (volume at `/data`, `JOBS_DEFAULT_PLANT=001`); migrations platform `0016` and Job applications
`0001`; GitHub `JOBS_URL` / `JOBS_BACKUP_FILES`; Daily jobs and Backup green; every live check passed; plant 001 has
switched it on (5 positions). Record: `docs/deployments/shared.md`.

**Pending** (`docs/deployments/shared.md`, "Pending: Job applications"):
- Turnstile keys added but not active on the form yet
- delete the `.paste` file and update the password manager copy of `.env.railway.shared`
- a Daily jobs run with a (!) icon
- the owner's plant 001 checklist (openings, QR poster, HR desk, test sends from Android and iPhone, status / note /
  CSV, Remove now)
- not yet seen live: the volume across a redeploy, the daily job deleting a file and its R2 copy, Railway's address
  header for the 20-per-hour limit

### 2026-10-17 — Stability plan started (no new features)
Decided by the owner 2026-10-17: with v0.25.0 live, the next stretch is stability and bug fixing, not new modules.
Plan, issue list, live checklist, how to analyse each module, performance / uptime targets and build prompts:
`docs/STABILITY_PLAN.md` (phases S0–S6). Bug fixes ship as small patch releases (v0.25.x).
**No email anywhere (owner, 2026-10-17):** Brevo is dropped. Every alert, including Document Store expiry reminders,
goes by app notifications only (bell + phone push via the installed PWA). The mail code stays in
`packages/module-kit` unused; no module queues email when no mailer is set (patch B-02 in the stability plan).

### 2026-10-18 — Stability S1: B-01 on cron-job.org; B-02 (v0.25.1) and B-03 (v0.25.2) built, not deployed
Current status, open items and next steps: **`docs/STABILITY_PLAN.md` section 0** (read it first).
- **B-01, timed jobs:** GitHub's scheduler started the daily jobs 4–7 h late, ran the hourly evening jobs about twice a
  day (some after midnight, doing nothing) and never the morning ones. Since 2026-10-18 **cron-job.org** (free) calls
  the 11 `/api/cron/*` addresses at the exact minute, India time, with `x-cron-secret` (job list: HANDBOOK section 10).
  `daily.yml` keeps a schedule as a safety net (jobs are dedupe-safe); `evening.yml` becomes manual-only once the
  cron-job.org evening runs are confirmed. A new module with a timed job adds a cron-job.org job.
- **B-02, no email (v0.25.1):** without email settings, Document Store reminder rows and Floor Stock low-stock rows are
  recorded as "App notification only (email is off)" (`EMAIL_OFF`, `emailIsOn()` in `packages/module-kit/src/mail.ts`);
  the rows stay because they are the once-per-stage / once-per-day record the notifications rely on. Document pages say
  "sent in the app (bell + phone)". Brevo removed from the setup script and docs.
- **B-03, repeated logins (v0.25.2):** each successful plant login writes `user.login` to `platform.audit_log` (device,
  browser, installed app or tab, module link or login page, what happened to the previous session cookie; no IP); the
  login button no longer allows a second login while the next page loads. Cause to be read from the live records.
- **Railway cost** (owner, 2026-10-18): about $6.43 estimated for 29 Sep – 29 Oct, nearly all memory; it grows with the
  number of services. Rule: no new Railway service for fixes, jobs or safety nets; raise the $10 compute limit (Railway
  stops services at it). Details: `docs/STABILITY_PLAN.md` section 9.
- **B-05 + B-04 (v0.25.3, built 2026-10-18, not deployed):** Floor Stock treats a count before 5 am IST as last night's
  (`countDay()`); Attendance waits up to 20 s for good GPS (`bestLocation()`) and refuses rougher than ±150 m (was 500 m;
  owner), printed QRs unchanged. Plus a dead-code clean-up (knip). No migrations.
- Tests: platform 347, Document Store 107, Floor Stock 172, Attendance 423, module-kit 69; typecheck and builds pass.

### 2026-10-19 — View-only roles: Stock viewer, Document viewer, Order viewer — live (v0.27.0)
Asked by the owner 2026-10-19 (no role could only look at Floor Stock). Design and decisions:
`docs/VIEW_ROLES_PHASE_PLAN.md`; notes in each module's NOTES.md.
- **Shared rule** (`packages/types`): `VIEW_ROLE_MODULE`, `viewOnlyIn()` widened, `getsAlertsIn()`, `VIEWER_ALERTS`
  (Floor Stock, Document Store), summary view `"viewer"`, notification fields `no_viewers` / `if_ticked`.
- **Platform:** migration `0018_view_roles.sql`; labels, role buttons, Permissions screen; "Gets alerts" and the
  send-time check use `getsAlertsIn`; `alert-contacts` lists a module's viewers.
- **Floor Stock:** migration `0005_viewer_sections.sql` (FORCE RLS, no DELETE); "Who sees what" on Sections & items
  (owner, audited); every read filtered on the server; each ticked viewer's own count alert with only their items;
  viewer tile shows the count status only.
- **Document Store:** read-only for Document viewers (no schema change); never responsible.
- **Order Capture:** Order viewer = the existing view without amounts (tests only).
- **SSO token unchanged.** Tests: platform 366, auth 67, Floor Stock 187, Document Store 109, Order Capture 284.

**Decisions (owner, 2026-10-19):** one view role per module (Floor Stock, Document Store, Order Capture); alerts only
if ticked; Stock viewer sees only the sections ticked for them; "Can make" only when every section of the recipe is
theirs. **Made while building:** Order viewers can never be ticked (the new-order alert has the amount); Stock viewers
don't open Sections & items; "setup changed" never goes to viewers; "count not done" goes to ticked viewers unchanged.

**Live (2026-10-19):** migrations platform `0018` and Floor Stock `0005` applied, `v0.27.0:production` (`3d15b82`), live
checks OK (`docs/deployments/shared.md`). **Not yet verified:** on screen with real logins (the owner's checklist).

### 2026-10-20 — Attendance: "Mark days" (several days ON / OFF at once) — v0.28.0
Asked by the owner 2026-10-20 (some people don't mark IN / OUT). On Staff → person, the owner taps **Mark days**, picks
days on the calendar (today or earlier, up to 31) and marks them all ON / OFF / Clear in one save (all or none; one
row and one Recent changes line per day). Mock-up approved; notes in `apps/attendance-salary/NOTES.md`. No migration;
SSO token unchanged. Tests: Attendance 443 (+2).

### 2026-10-21 — Business details: customer support phone and hours (v0.28.1)
Asked by the owner 2026-10-21 for the WhatsApp bot's "talk to a person" reply. Business details gains **Customer
support phone** and **Support hours** (free text ≤ 60, days included as the owner types them), owner and super_admin,
audited. Platform migration `0019_support_contact.sql` (approved by the owner): two columns on `tenant_profiles`, no
grant change. Order Capture passes them to the bot from Step 2 (`support` in `docs/WHATSAPP_CONTRACT.md` 3.2); Step 1
uses the bot's own `SUPPORT_PHONE` / `SUPPORT_HOURS`. SSO token unchanged. Tests: platform 369. **Live (2026-10-23):**
migration `0019` (applied 2026-10-21), `v0.28.1:production` (`3fd9a0c`); the build waited for the Railway outage of
2026-10-21 to end. Checks OK (`docs/deployments/shared.md`). Plant 001's support phone and hours saved by the owner the same day.

### 2026-10-23 — WhatsApp Step 2: the bot reads from Order Capture (v0.29.0)
Plan approved by the owner 2026-10-21 (`docs/WHATSAPP_BUILD_PLAN.md` section 7); notes in `apps/order-capture/NOTES.md`.
- **Order Capture bot API** (`src/server/bot.ts`): `POST /api/bot/v1/context` and `/alerts`, outside the session proxy.
  Key `ocb_…` checked by SHA-256 against `ORDER_BOT_KEYS` (plant from the entry only; `pnpm --filter order-capture
  bot:key`); plan must have Order Capture; limits per key / phone / address; audit rows `bot.*` kept out of Recent
  changes; errors `{ error: { code, message } }`.
- **Platform:** branding answer carries `support_phone` / `support_hours`; kinds `order_capture.handoff` and
  `order_capture.feedback_low`. No migration; SSO token unchanged.
- **Bot** (`order_handoff` 3.2.0): last delivered order + REPEAT, Order Capture labels / units, support contact for
  known customers, staff alerts; today's flow when Order Capture can't answer. Orders still go to the Sheet.
- **Tests:** Order Capture 306 (+22), platform 369, bot 49 (+16).


### 2026-10-23 — Attendance: lunch break and short days (v0.29.1)
Asked by the owner 2026-10-23 after checking Reeta's and Damayanti's October ("8 h + 1 h lunch; under 8 h must not be a
half day; add the short hours ÷ 8"); "build as recommended". **Rule 21** in `apps/attendance-salary/src/lib/salary.ts`:
work = time at plant − lunch (full break from 5 h at the plant; an OUT / IN break counts towards it); ≥ work hours =
full day + overtime; less = short day, the month's short-day work ÷ work hours = days paid (exact); no half days; same
for monthly staff (paid leave covers short time first). Named **salary band `PV_SALARY_DAY_STAFF`** (owner; a name
only, everyone on it; Salary box, tab, slip, CSV, saved with a paid month). Attendance migration `0009_lunch_break.sql` (approved:
`salary_settings.lunch_minutes`, default 0). Screens: Salary box lunch field, calendar work hours / "short", day page
"Work for salary", Salary tab / panel / slip / CSV. Notes: `apps/attendance-salary/NOTES.md`. Tests: Attendance 453
(+9 `short-days.test.ts`, half-day tests updated). **Verified locally** (plant 002, Reeta's real October marks copied
to a temporary person, headless Chromium at 390 / 1280 px, all removed): ₹5,157 remaining, 19.74 days, 8h 50m OT.
**Live 2026-10-23** (`production` = `3f45acc`, v0.29.2 with the band name; migration 0009 applied). Owner to do: set 8 h work + 1 h lunch from October for Reeta, Damayanti and the
others (Reeta's setting says 9 h since 20 Oct), and decides Damayanti's 9 paid OFF days (1-5 Oct before joining?).

### 2026-10-23 — Attendance: three salary types; OFF days are not paid (v0.29.3)
Salary types (owner): picked first in the Attendance Salary box (not on the platform's Add user: salary stays in the
module) — **PV_SALARY_DAY_STAFF** (per day; Reeta, Damayanti, Joshobanti), **PV_SALARY_MONTHLY_STAFF** (monthly, leave
per person; Ramu 0, Bindu / Gaja / Anmol 2), **PV_SALARY_FIXED_MONTHLY** (full salary whatever the attendance, no
overtime; Kedar, Dillip, Prakash). Attendance migration `0010_fixed_monthly.sql` (pay basis 'fixed'). **Live 2026-10-23** (`production` = `5f0501b`).
The owner: "days off means no payment"; for monthly staff "unpaid, leave covers it". Rule 22 in
`apps/attendance-salary/src/lib/salary.ts`: an OFF day mark is a day off without pay (per day: ₹0; monthly: like an
absent day, paid leave first, then salary ÷ 30). Was a paid day off since v0.28.0. No migration; texts say "not paid".
Notes: `apps/attendance-salary/NOTES.md`.

### 2026-10-24 — WhatsApp Step 3: bot orders into Order Capture — built (v0.30.0, bot 3.3.0)
Design `docs/WHATSAPP_BUILD_PLAN.md` section 8; owner "build" 2026-10-24 (after both bot alerts were confirmed live).
- **Order Capture:** `POST /api/bot/v1/orders` through the staff form's own save (`saveOrder` in
  `src/server/orders.ts`): existing switched-on customers only, the key's products, 1–200 boxes, Rates default rate
  (else ₹0), note "WhatsApp order. Price to agree by phone. Deliver to: …", entered by "WhatsApp"; the idempotency key is
  the order's request key (same key = same order); `GET /api/bot/v1/orders/by-key/<key>`; `ORDER_BOT_ORDERS=off`. The
  order shows in the list, alerts, CSV, tile and Recent changes like any other. **No schema, grant or SSO change.**
- **Bot 3.3.0:** landmark once (SKIP) → summary → exact YES → Order Capture; reference only after its answer; unknown
  answers finished by key in the background; others and the off switch → Sheet `lead`. `BOT_ORDERS` off (default) /
  pilot (staff numbers) / on.
- **Tests:** Order Capture 320 (+14), bot 68 (+19). Not deployed; release and pilot steps in the build plan section 8.
**Live (2026-10-24):** Order Capture v0.30.0 (`production` = `a7bf54c`, no migration), checks OK
(`docs/deployments/shared.md`). Bot 3.3.0 waits for its Railway variables (`BOT_ORDERS=pilot`, pilot phones).

### 2026-10-24 — WhatsApp Step 4: reorder reminders — live, off until set (v0.31.0, bot 3.4.0)
Design `docs/WHATSAPP_BUILD_PLAN.md` section 9 (owner, 2026-10-24: Order Capture sends the reminder itself; 10:30 IST;
area list deferred until the bot takes new customers).
- **Order Capture v0.31.0:** migration `0005_reminders.sql` (approved): append-only `customer_consents` (every
  Yes / No / Stop, kept forever) and `reminder_groups` (30 % holdout drawn once); `customer_messages` holds reminders
  and skip reasons. Staff tick "Agreed to WhatsApp reminders"; bot `POST /api/bot/v1/consent`; daily reminder job
  `POST /api/cron/reminders` (15 days after delivery, consent, no newer order, caps 100 customers / ₹500 / 8 weeks, a
  Twilio refusal stops it and alerts owners); owner page "Reminder pilot". New kind `order_capture.reminder_failed`.
- **Bot 3.4.0:** asks once after an order (again only 90 days after a no), records STOP / START, handles the reminder's
  three buttons.
- **Tests:** Order Capture 343 (+23), bot 82 (+14), platform 369.
- **Live 2026-10-24:** migration applied, `production` = `e15c585`, bot `7e308ae`; checks OK. **Not sending yet:** the
  owner sets `REMINDER_COST_PAISE`, the template SID in `TWILIO_WHATSAPP_SENDERS`, the cron-job.org job,
  `REMINDER_PILOT_START`, then `ORDER_REMINDERS=on` (build plan section 0).

### 2026-10-24 — Attendance: "See as worker" slip preview (v0.31.1)
Asked by the owner 2026-10-24 (see what staff will see before ticking "Can see own salary"). Staff → person → "See as
worker: <month> slip" opens the person's slip exactly as My salary draws it (shared `slipCard()`), with a note on the
tick and paid state; an unpaid month shows what Mark paid would save now. Owner + support only (`salary_view`). No
migration; SSO token unchanged. Notes: `apps/attendance-salary/NOTES.md`. Tests: Attendance 464 (+3). Tagged on `main`,
not deployed.
