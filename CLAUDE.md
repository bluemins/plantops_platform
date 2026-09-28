# PlantOps – Project Brief

Working name: PlantOps .
A multi-tenant SaaS platform for RO / packaged-drinking-water manufacturing plants, sold to other plants.

## Repo layout
Separate repo per app, under ~/projects/plantops/:
- `plantops_platform` — platform shell (auth, tenants, plans, launcher, SSO)
- `plantops_lab_records`
- `plantops_floor_stock`
- `plantops_preventive_mgmt`
- `plantops_amc`
- `plantops_attendance_salary`
- `plantops_marketing_contacts`
Each module repo gets its own copy of this CLAUDE.md (or a short one that links back here) plus its own
module-specific notes once that phase starts.

## Architecture: one platform, independent module apps
PlantOps is a **platform shell** (identity, tenants, plans, launcher) plus independent **module web apps** that
plug into it. Each module is its own codebase/app with its own URL, database tables, and business logic. The
platform never contains module business logic; modules never contain login/tenant logic.

Batch ID is the glue that links lab, stock and production data across modules.

## Users and roles
- **super_admin** (Rocky): creates/manages tenant_admin accounts; enables modules per tenant; sets plan/limits;
  sees all tenants.
- **tenant_admin** (plant owner): owner of one plant/tenant; manages their plant's users/roles; gets read-only
  summaries for modules they don't operate directly; can export reports.
- Module-level operational roles (examples): lab technician (Lab Records), store keeper (Floor Stock),
  maintenance technician (Preventive Management). Each sees only the module(s)/data it's entitled to.
- Enforce all of this on the SERVER in every module, not only in the platform UI.

## Login and launcher flow
1. User logs in once, on the main PlantOps platform (shared login).
2. Platform checks: modules enabled for this tenant (set by super_admin) + this user's role.
3. Launcher shows only the module tiles this tenant+role is entitled to (owner sees read-only summary tiles for
   all enabled modules + locked tiles for modules not enabled; staff roles see only their one working module).
4. Clicking a tile navigates to that module's own URL, carrying a signed SSO token (JWT: tenant_id, user_id,
   role, enabled_modules).
5. Each module app verifies the token and independently enforces role checks. Never trust platform tile-hiding
   as the only access control.

## Plans and limits (centralized)
- Central `tenant_plan` record per tenant: enabled modules + per-module limits (max users, storage,
  batches/month, etc.) as flexible JSON.
- SSO token stays small: tenant_id, role, enabled_modules only — NOT full limits.
- Each module calls `GET /tenants/:id/plan` on the platform API, caches briefly, tracks its own usage, compares
  against the central limit.

## Multi-tenancy and deployment
- Default: all tenants share one database, isolated by `tenant_id` + Postgres row-level security.
- A tenant needing separation can be moved to their own tables/schema (or dedicated instance later); a
  connection-routing layer picks the right database per request based on `tenant_id`/`db_mode`.
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
- Every lab entry has a user ID and timestamp; records lock on submit.
- Pass/fail computed automatically against configurable limits per parameter.
- A failed test puts the batch ON HOLD, requires a corrective-action note, alerts the tenant_admin (WhatsApp),
  and blocks dispatch. A retest is a new entry; the failed one stays on record.
- Stock-out links to a batch where possible, so a failure can be traced back to material lots.

## Core platform tables (Phase 1)
`super_admins`, `tenants`, `tenant_plans` (enabled modules + limits JSON), `tenant_admins`, `users`, `roles`,
`user_roles`. Each module app owns its own tables.

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
- Keep changes small and explain each in plain language; the owner is not a full-time developer.
- If a requirement here conflicts with a request, stop and ask.
- After completing a phase, add a dated "Status" note to this file: what was built, key decisions, what's next.

## Status log
(empty — updated by Claude Code after each phase)
