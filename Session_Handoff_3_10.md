Written for: a new Claude Code session picking up this project with no prior context.

---

# PlantOps — Session Handoff (2026-10-03)

## 1. Core Objective & Scope
- **Product:** PlantOps, a multi-tenant SaaS for RO / packaged-drinking-water plants. The owner (Rocky, super_admin) sells it to plants.
- **Architecture goal:** a platform shell (identity, tenants, plans, launcher, SSO) plus independent module web apps: Lab Records, Floor Stock, Preventive Mgmt, AMC, Attendance & Salary, Marketing Contacts. Batch ID (owned by Lab Records) links modules.
- **Target end state:** phased build per `CLAUDE.md`:
  1. Platform core ✅
  2. Launcher (next)
  3. Lab Records
  4. Floor Stock
  5. Preventive Mgmt
  6. AMC
  7. Attendance/Salary
  8. Marketing Contacts
  9. Website + dedicated-instance tooling
- **The user:** not a full-time developer. Explain in plain language, keep changes small.
- **Repo:** `/home/rocky/projects/plantops_platform`, GitHub `bluemins/plantops_platform`, branch `main`. The user calls it "master"; there is no master branch, so use `main`. The user explicitly asked for commits directly on `main`.
- **Environment:** WSL2 Ubuntu on Windows, VSCode extension.
- **Source of truth:** `CLAUDE.md` (rules, decisions, Status log) and `BuildPrompt.md` (per-phase prompts and follow-up questions).

## 2. Current System State & Architecture
- **Monorepo:** pnpm 12.8.1 (via corepack) + Turborepo 2.11.6. Node 22.23, TypeScript 5.9.
- **Stack:**
  - Next.js 16.3 (App Router; REST via `app/api/**/route.ts`), React 19, Tailwind 4 (`@tailwindcss/postcss`)
  - zod 4, Drizzle ORM 0.45 + `pg`, jose 6 (EdDSA/Ed25519), `@node-rs/argon2`
  - Vitest 5, tsx
- **Layout:**
  - `apps/platform`: Next app, port 3000
    - `src/server/*`: logic — `env`, `db/{index,schema}`, `crypto`, `http`, `audit`, `auth`, `super-auth`, `users`, `tenants`, `sso`
    - `src/app/**`: pages and API routes
    - `db/migrations/0001_platform_core.sql`
    - `db/{migrate,seed,set-super-password,load-env}.ts`
    - `test/*`
    - `Dockerfile` (standalone output)
  - `apps/dev-module`: **dev-only** placeholder module server, plain Node `http` via `tsx watch`. Serves every module that has `MODULE_URL_<ID>` (localhost) + `MODULE_SECRET_<ID>` in `.env`. Lab Records on :3001, Floor Stock on :3002. Routes: `/`, `/sso/callback?code=`, `/logout`, `/health`. Never deploy it.
  - `packages/auth`: `canAccessModule`, `requireModuleAccess`, `requireRole`, `AccessDeniedError`, `verifyToken` (EdDSA only, iss/aud/exp, zod payload; `{jwksUrl}` or `{jwks}`), `InvalidTokenError`, and the module→platform client `exchangeCode` / `fetchUserStatus` / `fetchTenantPlan` (HTTP Basic `moduleId:secret`).
  - `packages/db`: `createDb`, `withTenant(db, tenantId, fn)` (transaction + `set_config('app.tenant_id', id, true)`), `migrate(ownerUrl, schema, dir)` (tracks `<schema>.schema_migrations`).
  - `packages/types`: `MODULE_IDS`, `ROLE_IDS`, `ROLE_MODULE`, `PlanLimits`, `TenantPlan`, `TokenPayload`, `UserStatus`, `TOKEN_ISSUER="plantops-platform"`.
  - `packages/ui`: `Button`, `Card`, `TextField`, `PinInput`, `ErrorText` (Tailwind; scanned via `@source` in `globals.css`).
  - `scripts/`: `setup-local-db.sh` + `.sql` (sudo, creates roles/DBs, writes `.env`), `generate-sso-key.mjs`, `sso-smoke.sh`.
- **Database:**
  - Local Postgres 18 at `localhost:5432`. Docker is not installed.
  - DBs: `plantops` (dev) and `plantops_test` (wiped and rebuilt every test run by `test/global-setup.ts`).
  - Logins:
    - `plantops_owner`: owner, BYPASSRLS; migrations and SECURITY DEFINER functions only
    - `platform_app`: all plant-user requests; RLS enforced
    - `platform_super`: BYPASSRLS; only `/api/super/*` after `requireSuperAdmin`
- **Root scripts:** `pnpm dev | build | test | typecheck | db:migrate | db:seed | sso:keygen | super:set-password`.

## 3. Decisions Made & Constraints
- **Working rules (CLAUDE.md, must follow):**
  - Plan mode at the start of each phase; wait for approval.
  - Ask before any change to schema, permissions, tenant isolation or SSO token contents.
  - Tests with every feature; never commit secrets.
  - After each phase, write a dated Status note.
  - If a request conflicts with CLAUDE.md, stop and ask.
- **Repo and hosting:** monorepo (not repo-per-app). Hosting is **Shared** (tenant_id + RLS) or **Dedicated** (full separate copy, same code, env config) only. No per-tenant schema, no `db_mode` routing layer. Keep `tenant_id` on every table. The "move one tenant" export/import tool is Phase 9.
- **Roles:**
  - Roles: `tenant_admin`, `lab_technician`→lab_records, `store_keeper`→floor_stock, `maintenance_technician`→preventive_mgmt.
  - Multiple roles per user. `tenant_admin` is a role (no `tenant_admins` table).
  - Module access = module enabled in the plan AND (tenant_admin OR the module's staff role). The platform checks at handoff and the module re-checks.
- **Login:**
  - Plant users: **plant code + username + secret**. Staff use a 6-digit PIN; anyone with tenant_admin uses a password of 10+ characters.
  - New users get a random temporary secret, shown once, with forced change at first login.
  - Promoting a user to or from tenant_admin switches PIN↔password and forces a change.
  - super_admin logs in separately at `/super/login` with email + password.
  - Lockout: 5 failures → 15 minutes. Per-IP login rate limit is in-memory.
- **SSO token:**
  - EdDSA JWT with header `kid`.
  - Claims: `iss, aud (single module), iat, exp (15 min), jti, tenant_id, user_id, roles[], enabled_modules`. Never limits.
  - Handoff: one-time code (32 bytes, hash stored, 60 s, single use, bound to one module) → module server exchanges it server-to-server with Basic auth.
  - JWKS at `/.well-known/jwks.json`, with optional previous key `SSO_PREVIOUS_PUBLIC_JWK_B64`.
  - Module session up to 12 h, re-checking `/api/m/tenants/:tid/users/:uid/status` every 5 min.
- **Batch:** Lab Records owns the batch record; other modules store `batch_id` as a plain reference and use its API.
- **Lab results:** append-only, enforced in the DB (no UPDATE/DELETE grants), later in Phase 3.
- **Billing:** manual in v1. Plan JSON: `{platform:{max_users}, modules:{<id>:{...}}}`; a missing limit means unlimited.
- **Phase 2 decisions (already in `BuildPrompt.md` and the CLAUDE.md flow steps 6–8):**
  - Direct-link flow: module without a session → platform `/sso/start?module=<id>` → back with a code, logging in first if needed.
  - Single-module staff skip the launcher.
  - Owner tiles read live module summary endpoints (no copied data, no live push).
  - super_admin **Modules** screen: list status, set URL, generate secret (shown once), switch a module off globally, audit every change. New module ids still start as code + migration.
- **Never:** put the JWT in a URL; trust tile-hiding as access control; customer-specific forks; deploy `apps/dev-module`; bypass a denied tool action.

## 4. Progress & Completed Work
- **Phase 1 COMPLETE**, committed to `main` as **`5c5fa63`** ("Phase 1: platform core (auth, tenants, plans, RLS, SSO)"). **Not pushed.**
- **Schema** (`platform` schema):
  - `modules` (registry: base_url, client_secret_hash sha256, status)
  - `roles`
  - `super_admins` (+ `super_admin_sessions`)
  - `tenants` (code `^[A-Z0-9_-]{3,32}$`, status active/suspended, hosting shared/dedicated)
  - `tenant_plans`
  - `users` (username lowercase, `UNIQUE(tenant_id, username)`, `UNIQUE(tenant_id, id)`, secret_kind pin/password, failed_attempts, locked_until, must_change_secret, status)
  - `user_roles` (composite FK to users(tenant_id, id))
  - `sessions`
  - `sso_handoff_codes`
  - `audit_log` (append-only)
  - FORCE RLS + `tenant_isolation` policy on all tenant tables
  - SECURITY DEFINER `platform.resolve_tenant(code)` and `platform.consume_handoff_code(hash, module)`
- **API routes:**
  - Plant users: `/api/auth/{login,logout,me,change-secret}` (`me` returns `modules` the user may open)
  - super_admin: `/api/super/{login,logout,me,change-password}`, `/api/super/tenants` [GET, POST], `/api/super/tenants/[id]` [GET, PATCH name/status], `.../[id]/plan` [PUT], `.../[id]/admins` [POST], `.../[id]/admins/[userId]/reset-password` [POST]
  - tenant_admin: `/api/admin/users` [GET, POST], `/api/admin/users/[id]` [GET, PATCH roles/status/name/phone], `.../reset-secret`, `.../unlock`
  - SSO and modules: `/api/sso/handoff` [POST {module}], `/api/sso/exchange` [POST, module auth], `/api/m/tenants/[tid]/users/[uid]/status` [GET, module auth], `/api/tenants/[id]/plan` [GET, module auth], `/.well-known/jwks.json`
  - All mutations require `content-type: application/json` (CSRF guard in `handle()`).
- **Screens:** `/login`, `/change-secret`, `/home` (placeholder with "Open <module>" buttons → handoff), `/admin/users`, `/super/login`, `/super` (plants list + New plant), `/super/tenants/[id]` (plan, owners, suspend), `/super/change-password`.
- **Tests:** 86 passing (platform 77, auth 9) against a real Postgres test DB:
  - tenant isolation at DB level (including a guard test that every `tenant_id` table has FORCE RLS + policy) and at API level
  - roles and guards
  - login, lockout, sessions
  - SSO handoff/exchange and token rejection (expired, tampered, wrong aud, alg none, HS256, foreign key, bad shape)
  - remote JWKS over HTTP
- **Verified end to end over HTTP** against `pnpm dev`, 26/26 checks: super_admin created plant `002` → owner Sujata activated → added Atharv (lab+store) → Atharv opened Lab Records and Floor Stock via handoff. Refusals verified: reused code, module not in plan, wrong-module token, tampered token, unauthenticated direct link. Owner sees read-only. `scripts/sso-smoke.sh` passes for both modules. Links :3000/:3001/:3002 return 200 from WSL and from Windows.
- **Docs:** README rewritten (who is who, creating users as super/owner, reset table, links, commands). CLAUDE.md has the decisions + dated Phase 1 Status note. BuildPrompt Phase 1/2/3 prompts updated.

## 5. Open Tasks & Immediate Next Steps
1. **Commit pending changes** (user was asked, no answer yet): `BuildPrompt.md` (Modules screen in Phase 2), `CLAUDE.md` (Phase 2 next-steps line), `.gitignore` (`.claude/settings.local.json`). Suggested message: "Phase 2 prep: Modules screen + local settings ignore". End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before committing, `chmod 644` any files flipped to 755 by WSL.
2. **Push `main`** (`5c5fa63` + the step 1 commit). Claude's push was blocked by the auto-mode classifier. The user added `.claude/settings.local.json` allowing `Bash(git push)` / `Bash(git push *)`, which needs a Claude Code restart or `/permissions` to load. Push only if the user asks again; otherwise they run `git push origin main`.
3. **Start Phase 2 (Launcher) in plan mode** using the `BuildPrompt.md` Phase 2 prompt:
   - launcher tiles per the mockups (`refeDocs/*.jpeg`: owner view with summary and locked tiles, plan summary card; staff views)
   - module summary-endpoint contract with an "unavailable" state
   - `/sso/start` direct-link flow
   - single-module skip
   - module-side session helper in `packages/auth`, generalising `apps/dev-module`
   - super_admin Modules screen
   - phone reachability for dev testing
   - Answer the follow-ups: module down; how to add a new module.
4. Phase 2 also needs to cover: the AMC tile's "Add-on service" locked variant from the mockup, and the plan summary card (plan, modules X of 6, users N/max, renews).

## 6. Known Issues, Blockers, or Edge Cases
- **Not verified:**
  - Dockerfile (no Docker on this machine)
  - phone access (`localhost` only)
  - real module apps (only the placeholder exists)
- **Product gaps:**
  - The plant code can't be changed after creation (`updateTenant` only edits name/status). The user's plants use codes `001` (Bluemins, owner `msahu`, still on his temporary password) and `002` (name SAMPLEAQUA).
  - The rate limiter is in-memory per instance and keys on the first `x-forwarded-for` value. A trusted-proxy config is needed in production.
  - The dev-module stores the raw 15-min token as its session cookie, with no refresh. Phase 2's real session helper must do 12 h + 5-min status re-check.
- **Stale secret:** `SUPER_ADMIN_PASSWORD` in `.env` no longer matches. The user reset it via `pnpm super:set-password`, and the password is unknown to Claude. Never ask the user to paste it; for super_admin actions, have the user click in the UI.
- **WSL quirk:** files get the executable bit (755). Normalise to 644 before committing; only `scripts/*.sh` stay executable.
- **pnpm 12:** enforces a minimum release age (don't add `minimumReleaseAgeExclude`; pick older versions). Build scripts must be approved (`allowBuilds: {esbuild: true}` in `pnpm-workspace.yaml`).
- **Auto-generated files:** Next 16 writes `apps/platform/{AGENTS.md,CLAUDE.md}` and Turbo writes root `AGENTS.md` (agent notes; committed). Next 16: route `params` is a Promise; middleware is renamed proxy (none used).
- **Drizzle errors:** wrapped as `DrizzleQueryError`; the real pg error is in `.cause`. Tests use the `dbError()` helper; app code checks `err.code ?? err.cause?.code` (e.g. `23505`).
- **RLS without a tenant:** errors as `unrecognized configuration parameter "app.tenant_id"` on a fresh connection, or `invalid input syntax for type uuid: ""` on a reused one. Both fail closed.
- **Env loading:** `process.loadEnvFile` doesn't override variables already set. `next.config.ts` and the scripts load the root `../../.env`. Tests map `TEST_DATABASE_URL_*` → `DATABASE_URL_*` and generate a throwaway SSO key.
- **Dev server:** started by Claude as a background task (2 h limit); may have stopped. Restart with `pnpm dev` from the repo root.
- **Tooling:** `jq` is not installed (use node for JSON checks). `psql` works with URLs from `.env` (`set -a; . ./.env; set +a`).

## 7. Working State & Code Snippets
**`.env` keys** (generated, gitignored; never print values):
```
DATABASE_URL_OWNER / DATABASE_URL_APP / DATABASE_URL_SUPER      (db plantops)
TEST_DATABASE_URL_OWNER / _APP / _SUPER                          (db plantops_test)
PLATFORM_URL=http://localhost:3000
SSO_PRIVATE_JWK_B64=<base64 Ed25519 JWK with kid>
SUPER_ADMIN_EMAIL=admin@plantops.local
SUPER_ADMIN_PASSWORD=<stale>
MODULE_URL_LAB_RECORDS=http://localhost:3001   MODULE_SECRET_LAB_RECORDS=<hex>
MODULE_URL_FLOOR_STOCK=http://localhost:3002   MODULE_SECRET_FLOOR_STOCK=<hex>
```

**Dev test accounts** (dev DB only, plant code `002`):
- Owner: `sujata` / `Sujata@Plant002`
- Staff: `atharv` / PIN `482913` (lab_technician + store_keeper)

**RLS policy pattern** (every tenant table; `tenants` uses `id`):
```sql
alter table platform.X enable row level security;
alter table platform.X force row level security;
create policy tenant_isolation on platform.X
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Access rule** (`packages/auth/src/access.ts`):
```ts
canAccessModule(roles, enabledModules, moduleId) =
  enabledModules.includes(moduleId) &&
  (roles.includes("tenant_admin") || roles.some(r => r !== "tenant_admin" && ROLE_MODULE[r] === moduleId))
```

**Session cookie:** `plantops_session=<tenantId>.<random>` (HttpOnly, SameSite=Lax, 12 h; DB stores sha256). super_admin uses `plantops_super=<random>` (8 h). Module placeholder cookies are `plantops_<moduleId>`.

**Route handler pattern:**
```ts
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  return json(await updateUser(admin, uuidParam((await ctx.params).id), await readJson(req, UpdateUserInput)));
});
```
Plant data always goes through `withTenant(tenantId, tx => …)` (platform_app). Super routes use `superDb()` only after `requireSuperAdmin(req)`.

**Commands:**
```bash
pnpm dev                                   # :3000 platform + :3001/:3002 placeholder modules
pnpm test && pnpm typecheck                # expect 86 passing, 6 packages clean
pnpm db:migrate && pnpm db:seed            # seed: super_admin if missing + module URL/secret from .env
scripts/sso-smoke.sh 002 atharv 482913 lab_records
pnpm super:set-password [-- email]         # interactive, TTY required
```

**Adding a module (current process):**
1. Add the id to `MODULE_IDS` and its role to `ROLE_IDS`/`ROLE_MODULE` (`packages/types`).
2. New migration inserting into `platform.modules` / `platform.roles`.
3. Build the app.
4. Put `MODULE_URL_*` / `MODULE_SECRET_*` in `.env`, then run `pnpm db:seed`. Phase 2's Modules screen will replace this step.
5. super_admin enables it per plant in the plan.