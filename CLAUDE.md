# PlantOps – Project Brief

Working name: PlantOps .
A multi-tenant SaaS platform for RO / packaged-drinking-water manufacturing plants, sold to other plants.

## Repo layout
One monorepo (pnpm workspaces + Turborepo) at ~/projects/plantops_platform. Each app is still deployed
independently, with its own URL, Docker image and database schema.
- `apps/platform` — platform shell (auth, tenants, plans, launcher, SSO)
- `apps/lab-records`
- `apps/floor-stock`
- `apps/preventive-mgmt`
- `apps/amc`
- `apps/attendance-salary`
- `apps/marketing-contacts`
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
- Module-level operational roles (examples): lab technician (Lab Records), store keeper (Floor Stock),
  maintenance technician (Preventive Management). Each sees only the module(s)/data it's entitled to.
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
- **Summary request** (built, Phase 2): `purpose: "summary"`, `tenant_id`, `view` ("owner" | "staff"), `aud`
  = one module, `exp` 60 s. Modules check it with `verifySummaryRequest` (`packages/auth`).
- **Support token** (decided, built per module from Phase 3): super_admin opens one plant's module data
  read-only. One-time code like a user handoff → token with `purpose: "support"`, `tenant_id`,
  `super_admin_id`, `read_only: true`, `aud` = one module, `exp` 15 min. Modules accept it only through a
  `verifySupportToken`, refuse every write with it, and log each view in an audit trail the plant owner can
  see ("PlantOps support viewed Lab Records, 5 Oct 10:42").

**Launcher tiles (contract, Phase 2):** the platform calls `GET <module base_url>/api/plantops/summary` with
`Authorization: Bearer <summary request token>` (3 s timeout) whenever a launcher opens. The module answers
`{ "badges": [{ "text": "3 held today", "tone": "ok" | "info" | "warn" | "danger" }] }` (max 3 badges, 40
characters each). A timeout, error or bad answer shows "Numbers unavailable right now"; the launcher keeps
working. Nothing is stored.

**Plant look:** each plant's screens use its brand colour (Business details). `brandPalette()` in
`packages/ui` turns it into CSS variables (`--brand`, `--brand-hover`, `--brand-contrast`, `--brand-soft`,
`--brand-ring`), with dark text automatically on light colours. Modules get the colour and logo from
`GET /api/m/tenants/:tid/branding` (`fetchBranding`/`fetchLogo` in `packages/auth`). super_admin and login
screens stay PlantOps blue.

**Every module app must** (all in `packages/auth`; `apps/dev-module` is a working example):
`startModuleSession` at `/sso/callback`, keep the session with `sealSession`/`openSession` (own
`SESSION_SECRET`, ≥ 32 chars), call `refreshModuleSession` on every request (12 h shift, 5-min re-check,
15-min grace if the platform is unreachable), send users without a session to
`<PLATFORM_URL>/sso/start?module=<id>&next=<path>`, serve the summary endpoint, and link "Account" to
`<PLATFORM_URL>/home?launcher=1`.

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
  import into a Dedicated copy) is built in Phase 9, only when a paying plant needs it.
- When a plant objects to Shared, first address the usual concerns: other plants cannot see their data (RLS),
  they can export their data if they leave, and data is stored in India (Mumbai region). Offer Dedicated only
  if that's not enough.
- Containerized (Docker). Config via environment variables (DATABASE_URL, STORAGE_BUCKET, WHATSAPP_TOKEN,
  APP_DOMAIN, BRAND_NAME, BRAND_LOGO, BRAND_COLOR, MODE, ENABLED_MODULES).
- No customer-specific code/forks. Custom needs become config or feature flags.
- Backward-compatible, versioned migrations so all instances stay on one release line.

## Stack
- Next.js (React) + Tailwind, mobile-first PWA. No native app, no offline mode in v1.
- Node.js + TypeScript backend, clean REST API per app (platform + each module).
- PostgreSQL, managed hosting, Mumbai region preferred.
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

**Why this order:** Lab Records is the compliance wedge plants will pay for first. Floor Stock and Preventive
Management are the next-closest operational needs and both link to the batch record. AMC is a revenue add-on
that pairs naturally with Preventive Management. Attendance/Salary and Marketing Contacts are generic
small-business tools (not RO-specific) — deprioritized until the RO-specific modules are proven with paying
pilots.

1. **Platform core** — super_admin service, auth/roles, tenant registry with `tenant_plan`, SSO token issuance.
2. **Launcher** — role-and-plan-filtered dashboard, handoff to module URLs.
3. **Lab Records module** — batch log, tests, pass/fail, PDF report, failed-test flow, WhatsApp alert.
4. **Floor Stock module** — items, stock in/out, reorder alerts, linked to batches.
5. **Preventive Management module** — assets, PM schedules, task completion, history.
6. **AMC module** — contracts, visit logs, renewals, invoicing (pairs with Preventive Management).
7. **Attendance & Salary module.**
8. **Digital Marketing Contact Management module.**
9. **Website + dedicated-instance/tenant provisioning tooling.**

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

**Not yet verified:** on a real phone (waits for the Windows mirrored-networking step); Dockerfile.
`next build` passes.

**Next — Phase 3 (Lab Records):** real module app in `apps/lab-records` built on the helpers above; its own
schema with append-only lab results; batch log, tests, pass/fail, failed-test flow, PDF, WhatsApp alert
(start Meta verification now if not done); summary badges ("3 held today"); support view (support token);
module SKU read endpoint for Floor Stock later (Phase 4).
