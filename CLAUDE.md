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
  sees all tenants.
- **tenant_admin** (plant owner): owner of one plant/tenant; manages their plant's users/roles; gets read-only
  summaries for modules they don't operate directly; can export reports.
- Module-level operational roles (examples): lab technician (Lab Records), store keeper (Floor Stock),
  maintenance technician (Preventive Management). Each sees only the module(s)/data it's entitled to.
- A user can hold **more than one role** (e.g. lab technician AND store keeper in a small plant). tenant_admin
  is a role in `users`/`user_roles`, not a separate account type.
- Login: plant users log in with **plant code + username + secret**. Staff use a 6-digit **PIN**; anyone holding
  tenant_admin uses a **password** (min 10 chars). New users get a random temporary PIN/password (shown once to
  whoever created them) and must replace it at first login. tenant_admin creates staff and resets their PINs;
  super_admin creates owners and resets owner passwords. super_admin logs in separately (email + password).
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

**Launcher tiles:** each module exposes a small summary endpoint (e.g. "3 held today", "2 overdue") that the
launcher calls. If a module is down, its tile shows an "unavailable" state instead of breaking the launcher.
Exact contract is designed in Phase 2.

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
`super_admins`, `tenants`, `tenant_plans` (enabled modules + limits JSON), `users`, `roles`, `user_roles`.
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

**Next — Phase 2 (Launcher):** tile dashboard per the mockups; module summary-endpoint contract with an
"unavailable" tile state; direct-link flow (`/sso/start`) for staff opening a module from their phone;
single-module staff skip the launcher; module-side session helper in `packages/auth` (generalising what
`apps/dev-module` does); a way to reach the dev setup from a phone for testing.
