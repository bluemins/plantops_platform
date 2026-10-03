Session Handoff (2026-10-03, after Phase 2)
1. Core Objective & Scope
Product: PlantOps, a multi-tenant SaaS for RO / packaged-drinking-water plants. Owner Rocky (super_admin) sells it to plants.
Architecture: a platform shell (identity, tenants, plans, launcher, SSO) plus independent module web apps. Batch ID (owned by Lab Records) links modules.
Phases (finish and test each before the next; plan mode + approval at each start):
Platform core ✅
Launcher ✅
Lab Records (next)
Floor Stock
Preventive Mgmt
AMC
Attendance/Salary
Marketing Contacts
Website + dedicated-instance tooling
User: not a full-time developer. Plain language, small explained changes, decisions via AskUserQuestion.
Repo: /home/rocky/projects/plantops_platform, GitHub bluemins/plantops_platform, branch main (the user says "master"; use main). The user often commits themselves; ask before committing or pushing.
Environment: WSL2 Ubuntu (systemd) on Windows, VS Code extension.
Sources of truth: CLAUDE.md (rules, token definitions, contracts, dated Status log; read it first), BuildPrompt.md (per-phase prompts; CRLF line endings, keep them), README.md (user-facing how-tos).
2. Current System State & Architecture
Stack

pnpm 12.8.1 (corepack) + Turborepo 2.11.6, Node 22.23, TypeScript 5.9
Next.js 16.3 (App Router, REST via app/api/**/route.ts; route params is a Promise)
React 19, Tailwind 4 (bg-(--var) syntax), zod 4, Drizzle 0.45 + pg, jose 6 (EdDSA), @node-rs/argon2, Vitest 5, tsx
Layout

apps/platform (:3000)
src/server/: env, db/{index,schema}, crypto, http (handle, readJson, HttpError), audit, auth, super-auth, users, tenants, business, sso, launcher, summary, modules-admin, brand
src/lib/: api, modules (tile catalog), safe-next, launcher-tiles, business-form, user-form, plan-form
db/migrations/0001…0004, test/*
apps/dev-module: dev-only placeholder modules (Lab Records :3001, Floor Stock :3002), built on the packages/auth helpers. Never deploy.
packages/auth:
access: canAccessModule, requireRole
verify: verifyToken (rejects any token carrying purpose), verifySummaryRequest
client: exchangeCode, fetchUserStatus, fetchTenantPlan, fetchBranding, fetchLogo, PlatformRequestError
session: startModuleSession, sealSession/openSession (HS256, module's own SESSION_SECRET ≥ 32 chars), refreshModuleSession (12 h shift, 5-min re-check, 15-min grace on platform 5xx/unreachable; 4xx → logout)
packages/types: MODULE_IDS, ROLE_IDS, ROLE_MODULE, PlanLimits, TenantPlan, TokenPayload, UserStatus, SummaryRequestPayload, ModuleSummary, MODULE_SUMMARY_PATH, TenantBranding
packages/ui: Button, Card, TextField, PinInput, ErrorText, and brandPalette/brandStyle (exports . and ./brand)
packages/db: createDb, withTenant (transaction + set_config('app.tenant_id')), migrate
Database

Local Postgres 18. DBs plantops (dev) and plantops_test (rebuilt each run).
Logins:
plantops_owner: migrations
platform_app: RLS-enforced plant requests
platform_super: BYPASSRLS, /api/super/* only after requireSuperAdmin
platform schema tables: modules, roles, super_admins(+sessions), tenants, tenant_plans, users, user_roles, sessions, sso_handoff_codes, audit_log (append-only), tenant_profiles, tenant_skus.
Main routes

Plant users:
/api/auth/{login,logout,me,change-secret}
/api/launcher, /api/launcher/summary/:module
/api/admin/users[/:id[/reset-secret|/unlock]]
/api/admin/business, /api/admin/skus[/:id]
/api/business/logo
Pages: /login, /change-secret, /home (launcher), /admin/users, /admin/business, /sso/start, /sso/blocked
super_admin:
/api/super/{login,logout,me,change-password}
/api/super/tenants[/:id[/plan|/admins|/business|/logo|/skus[/:skuId]|/users/:userId[/reset-secret]|/launcher|/summary/:module]]
/api/super/modules[/:id[/secret]]
super_admin pages: /super, /super/tenants/[id], /super/modules, /super/dashboard, /super/change-password (/super/layout.tsx forces PlantOps blue)
Module ↔ platform (Basic auth moduleId:secret): /api/sso/{handoff,exchange}, /api/m/tenants/:tid/users/:uid/status, /api/m/tenants/:tid/{branding,logo}, /api/tenants/:id/plan, /.well-known/jwks.json
3. Decisions Made & Constraints
Working rules (CLAUDE.md)

Plan mode at the start of each phase.
Ask before any schema, permission, tenant-isolation or token-content change.
Tests with every feature; never commit secrets; dated Status note after each phase.
Stop and ask on a conflict with CLAUDE.md.
Hosting

Shared (tenant_id + FORCE RLS) or Dedicated (a full copy via env vars) only.
No per-tenant schema, no db_mode. tenant_id on every table. The move-tenant tool is Phase 9.
Roles and access

Roles: tenant_admin, lab_technician→lab_records, store_keeper→floor_stock, maintenance_technician→preventive_mgmt. Multiple roles per user.
Access = module in the plan AND (tenant_admin OR the module's role). Checked by the platform and again by each module.
Login and accounts

Plant code + username + secret. Staff: 6-digit PIN. Owner: password ≥ 10 characters.
Temporary secrets must be changed at first login.
Owner edits users (name, phone, email, roles, status) and resets PINs (typed or random, always temporary).
super_admin does the same for any user, plus username and plant code changes.
The owner can rename the plant but never change its code or status (column-level grant).
Tokens (exact definitions in CLAUDE.md)

SSO token: iss, aud, iat, exp 15m, jti, tenant_id, user_id, roles, enabled_modules. Unchanged; never carries limits.
Summary request token: purpose:"summary", tenant_id, view, exp 60s.
Support token: designed, not built (purpose:"support", super_admin_id, read_only); built per module from Phase 3 (read-only, owner-visible audit).
Tile contract

GET <module>/api/plantops/summary, Bearer token, 3 s timeout.
Response {badges:[{text ≤ 40, tone ok|info|warn|danger}] ≤ 3}. Any failure shows "unavailable". Never stored.
Branding

Plant brand colour → CSS vars --brand, -hover, -contrast, -soft, -ring, set by the root layout from the session.
Login and super screens stay PlantOps blue #1d4ed8.
Modules use fetchBranding + brandPalette.
Products and logo

SKUs: volume_ml = one unit, units_per_pack, never deleted (inactive instead). SKUs live in the platform; modules store sku_id as a plain reference.
Logo in DB as bytea (PNG/JPEG/WebP ≤ 300 KB, magic-byte check, never SVG).
Never

Put a JWT in a URL.
Trust tile-hiding as access control.
Make customer forks.
Deploy dev-module.
Ask the user to paste passwords.
Print .env values.
4. Progress & Completed Work
Commits (main, all pushed):

5c5fa63: Phase 1 core
477da34: Phase 2 prep
dc8476b "Phase - 1 complete": business details, SKUs, user editing, code/username changes
fa9207b "phase 2": launcher, sso/start, session helper, Modules screen, dashboard, branding, LAN dev
Migrations

0001 platform core
0002 tenant_profiles, tenant_skus, column grant tenants(name, updated_at) → platform_app
0003 units_per_pack
0004 platform_super UPDATE on modules(base_url, client_secret_hash, status)
Tests: 193 passing (platform 168, auth 25). pnpm typecheck clean (6 packages). next build passes.

Verified live (2026-10-03)

Launcher tiles, live placeholder numbers, plant colour.
Direct link: module → /sso/start → login → callback → 12 h session.
Super pages stay blue.
sso-smoke.sh passes.
Real phone: lab user 002/1111 ("Techno") logged in, set own PIN, landed straight in Lab Records.
Windows side reaches 192.168.1.2:3000–3002.
Docs: CLAUDE.md (Phase 2 status note, token types, contract, "Every module app must" checklist) and README (launcher, Modules/Dashboard, "Testing on your phone", business details, editing users, resets).

5. Open Tasks & Immediate Next Steps
Commit the CLAUDE.md phone-verification note (only uncommitted change), after asking the user.
Start Phase 3, Lab Records, in plan mode. Use the BuildPrompt.md Phase 3 prompt and the Lab Records mockups if any are in refeDocs/ (currently 4 launcher mockups).
New apps/lab-records (own schema + DB login, FORCE RLS) built on the packages/auth session helpers, replacing dev-module for lab_records.
Batch log; tests with per-plant configurable limits; auto pass/fail.
Append-only results enforced by DB grants (no UPDATE/DELETE; edits = new version with who/when/why); lock on submit.
Failed test → batch ON HOLD + corrective-action note + WhatsApp alert to owner + blocks dispatch; a retest is a new entry.
PDF report; real summary badges; support view (verifySupportToken, read-only, owner-visible audit).
Batch API for other modules; apps/lab-records/NOTES.md.
Phase 4 later: a module-facing SKU read endpoint (/api/m/tenants/:tid/skus).
User actions to remind:
Start WhatsApp Business / Meta verification (Phase 3 depends on it).
Fix plant 001 SKUs: saved as single 24 L and 12 L bottles; should be e.g. 500 ml × 24, case.
Reset the temporary PIN of user 001/1111 (lab_msahu): unknown, was set by msahu at 11:44.
MobaXterm: use a "WSL" session type, or install openssh-server on port 2222 and connect to 127.0.0.1.
6. Known Issues, Blockers, or Edge Cases
Dockerfile never built (no Docker on this machine).
No real deployment yet: the app runs only on this PC.
.env is in phone mode:
PLATFORM_URL and MODULE_URL_* point at http://192.168.1.2:300x. Module base_urls in the DB match (via pnpm db:seed).
Use 192.168.1.2 on the PC too: mixing localhost and the IP breaks module redirects and cookies.
To revert: set those three lines to localhost, then pnpm db:seed.
The PC's IP could change (DHCP); re-run pnpm lan:urls.
Windows setup: .wslconfig has [wsl2] networkingMode=mirrored and [experimental] hostAddressLoopback=true. Firewall rule "PlantOps dev" (Private, TCP 3000–3002) and Hyper-V rule PlantOpsDev exist. The Wi-Fi "Airtel_mana_0782_5G" is Private.
Dev server started by Claude (pnpm dev:lan, background, about 2 h limit) stops on WSL restart. Check with ss -ltn | grep 300.
Accounts:
Sujata (002) had 4 failed tries; one more locks her for 15 minutes. A correct login resets the count.
The super_admin password is unknown to Claude; SUPER_ADMIN_PASSWORD in .env is stale. Recovery: pnpm super:set-password (interactive; the user runs it).
Same username in two plants: 1111 exists in both 001 and 002; the plant code disambiguates.
Rate limit is in-memory per instance, keyed on the first x-forwarded-for; production needs a trusted-proxy config.
Plant code changes don't log users out. Username changes and resets do.
Module switched off → authenticateModule 401s → the module's users drop out at the next 5-minute re-check.
Drizzle errors wrap pg errors in .cause: check err.code ?? err.cause?.code in app code; tests use a dbError() helper.
RLS without a tenant errors (fails closed).
WSL flips files to mode 755. Normalise to 644 before committing; only scripts/*.sh stay executable.
pnpm 12: minimum release age applies (pick older versions; don't add excludes). Build scripts need allowBuilds. Use pnpm install --offline when possible.
Next 16: writes apps/platform/{AGENTS.md,CLAUDE.md}; read node_modules/next/dist/docs before Next-specific code. The dev server uses .next/dev, so next build can run alongside it.
The layout reads the session server-side. Client navigations don't re-run it, so login and logout use window.location, and Business details calls router.refresh() after saving.
Tooling: jq isn't installed (use node). psql works via set -a; . ./.env; set +a. To check a password without a login attempt, use @node-rs/argon2 verify(hash, guess) against DATABASE_URL_OWNER.
7. Working State & Code Snippets
.env keys (gitignored; never print values):


DATABASE_URL_OWNER / _APP / _SUPER ; TEST_DATABASE_URL_OWNER / _APP / _SUPER
PLATFORM_URL=http://192.168.1.2:3000            # phone mode
SSO_PRIVATE_JWK_B64=<Ed25519 JWK with kid> ; SUPER_ADMIN_EMAIL=admin@plantops.local ; SUPER_ADMIN_PASSWORD=<stale>
MODULE_URL_LAB_RECORDS=http://192.168.1.2:3001  MODULE_SECRET_LAB_RECORDS=<hex>
MODULE_URL_FLOOR_STOCK=http://192.168.1.2:3002  MODULE_SECRET_FLOOR_STOCK=<hex>
Test accounts (dev DB):

Who	URL	Login
super_admin	http://192.168.1.2:3000/super/login	admin@plantops.local / user's own password
Owner Sujata	http://192.168.1.2:3000/login	plant 002 (SAMPLEAQUA, brand #0e7490, lab+stock) / sujata / Sujata@Plant002
Staff Atharv	same	002 / atharv / PIN 482913 (lab + store)
Lab "Techno"	same	002 / 1111 / own PIN (unknown to Claude)
Owner Manas	same	001 (Bluemins, lab+stock) / msahu / own password
Lab "lab_msahu"	same	001 / 1111 / temporary PIN unknown → needs reset
Commands


pnpm dev | pnpm dev:lan            # :3000 platform + :3001/:3002 placeholders (dev:lan listens on 0.0.0.0)
pnpm lan:urls                      # prints Wi-Fi IP + .env lines (needs mirrored mode)
pnpm test && pnpm typecheck        # expect 193 passing, 6 packages clean
pnpm db:migrate && pnpm db:seed    # seed: super_admin if missing + module URL/secret from .env
scripts/sso-smoke.sh 002 atharv 482913 lab_records
pnpm super:set-password [-- email]
RLS pattern (every tenant table; tenants uses id):


alter table platform.X enable row level security; alter table platform.X force row level security;
create policy tenant_isolation on platform.X
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
Route pattern


type Ctx = { params: Promise<{ id: string }> };
export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  return json(await updateUser(admin, uuidParam((await ctx.params).id), await readJson(req, UpdateUserInput)));
});
Plant data goes through withTenant(tenantId, tx => …). Super routes use superDb() only after requireSuperAdmin. Shared owner/super logic takes (tx, tenantId, …, actor), e.g. applyUserUpdate / applySecretReset, writeProfile.

Module-side skeleton (what Lab Records must do; see apps/dev-module/src/server.ts):


// /sso/callback?code&next -> startModuleSession(creds, code, {jwksUrl}) -> sealSession -> cookie plantops_<module> (12h) -> redirect safeNext(next)
// every request: openSession -> refreshModuleSession(creds, s) -> null => 302 `${PLATFORM_URL}/sso/start?module=<id>&next=<path>`
// GET /api/plantops/summary: verifySummaryRequest(req.headers.authorization, {audience, keys}) -> {badges:[...]}
// branding: fetchBranding(creds, tenantId) + brandPalette(color); "Account" -> `${PLATFORM_URL}/home?launcher=1`
Tile rules (src/server/launcher.ts):

decideTiles:
owner → enabled modules = open (or off if unavailable); others locked; AMC locked as addon
staff → only accessible modules, never locked
landingFor: non-owner with exactly one tile (open) → that module, else "launcher".