# Session Handoff: PlantOps Phase 5 (Floor Stock), 2026-10-04

## 1. Core Objective & Scope
- **Project:** PlantOps, a multi-tenant SaaS for RO / packaged-drinking-water plants. Monorepo `~/projects/plantops_platform` (pnpm + Turborepo). Owner "Rocky" is not a full-time developer.
  - Explain every step in plain language.
  - The owner explicitly said "wait, don't just write code": show the design and mockups first, then build one step at a time and report after each step.
- **Phase 5 = Floor Stock module** (`apps/floor-stock`, port **3002**). It replaces the staff's daily WhatsApp message:
  - the message holds **today's production** (finished goods) and the **closing stock** of every item
  - sales happen during the same day, so stock = **end-of-day closing count**
- **Target end state:**
  - **Store keeper:** opens one URL on the phone → enters today's production + closing stock → submits (locked).
  - **Owner:**
    - sees a dashboard tile with live badges
    - in-module views: today vs previous, Sold / Used calculated, low stock, history, Recent changes, CSV
    - gets a low-stock email on submit
    - configures the plant's own sections and items
  - **super_admin:** read-only support view, logged.
- **Long-term idea (not now):** general godown stock management for any material (several godowns, transfers, in/out ledger, suppliers, value). Keep code generic: no RO-only rules in code.

## 2. Current System State & Architecture
- **Stack:** Next.js 16 + Tailwind 4, TypeScript, PostgreSQL (drizzle-orm + raw SQL migrations), vitest against a real Postgres test database. Railway (Singapore) deploys the `production` branch only.
- **Repo layout:**
  - **Apps:** `apps/platform` (:3000), `apps/lab-records` (:3001, reference module), `apps/document-store` (:3003, **the newest module and the pattern to copy**), `apps/dev-module` (dev placeholder; still serves floor_stock on :3002 and must stop doing so).
  - **Packages:** `packages/{auth,db,types,ui,module-kit}`.
- **Module kit:** `packages/module-kit/src/module.ts`, `createModule({moduleId, label, env})`. It provides:
  - SSO callback, sessions (12 h, 5-minute re-check), support cookie, proxy
  - standard routes (callback, support, logout, support-exit, plant logo)
  - branding / SKUs / plan / alert-contacts caches, `productLabel()`
  - `handle` / `readJson`, CSV, date formats
- **Pattern files to copy from Document Store:**
  - `src/server/{kit,env,db,schema,summary,support,session,http,pages}.ts`, `src/proxy.ts`
  - `src/app/sso/*`, `src/app/api/plantops` (summary), `src/app/api/cron`, `src/app/support-access`, `src/app/plant-logo`, `src/app/health`
  - `db/{load-env,migrate,run-daily}.ts`
  - `test/{global-setup,load-test-env,setup-env,fake-platform,helpers}.ts`, `vitest.config.ts`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `Dockerfile`
- **Data access:**
  - DB access goes only through `withTenant(tenantId, fn)` (from `@plantops/db`, which sets `app.tenant_id` transaction-locally).
  - Module DB login: never the owner, no BYPASSRLS, FORCE RLS on every table.
- **Platform already has:** module `floor_stock` and role `store_keeper` (migration `0001_platform_core.sql`); `packages/types` `ROLE_IDS` maps `store_keeper` → `floor_stock`. **No platform DB change is needed.**
- **Platform endpoints modules use:**
  - `GET /api/m/tenants/:tid/{status,plan,branding,logo,skus,alert-contacts}`
  - `AlertContact {user_id, display_name, phone, email?}`
  - `TenantSku {id, name, sku_code, volume_ml, units_per_pack, …}`
- **Summary endpoint contract:** `GET /api/plantops/summary` with `Bearer <summary token>` → `{badges:[{text ≤40, tone ok|info|warn|danger}] ≤3}`.
- **Email:** Document Store's `src/server/mail.ts` (Brevo HTTPS API wins over nodemailer SMTP; env `BREVO_API_KEY`, `MAIL_FROM`, `SMTP_*`). Plan: **move it into `packages/module-kit`** and share it.

## 3. Decisions Made & Constraints

**Counts**
- **v1 = the daily count only.** No dispatch, purchase or transfer entries.
- **Calculated on screen open, never stored:**
  - **Sold** = previous closing + today's production − today's closing, per finished item. Negative → "check the count". Previous day missing → "—, no count on <date>".
  - **Used** = previous − today for materials; a rise shows as "received (calculated)".
  - **Below limit** = qty < min_level.
  - If an item's unit changed between counts → "unit changed: not compared". When saving a unit change, warn "Old counts stay in X; new counts in Y".
- **One count per plant per day**, for today or yesterday only:
  - Production starts empty; closing stock is pre-filled from the latest version of the last count.
  - Several lines per item, each with a free-text remark (usually a party name); decimals allowed; no negatives.
  - Submit = locked. A correction is a new version with a reason (≥ 3 chars) and holds the full sheet again; old versions stay viewable.
  - Append-only, enforced by DB grants.

**Sections and items**
- **Per plant (tenant):** each plant configures its own list, nothing is shared. Configured inside Floor Stock ("Sections & items" screen); the owner's dashboard tile gets a **"⚙ Set up sections"** link. That is a small platform launcher change: a per-module setup path in `apps/platform/src/lib/modules.ts`, no DB change.
- **Section kind:**
  - `finished`: its items appear in BOTH Today production and closing stock. Rule: every produced product is also in closing stock.
  - `stock`: closing stock only.
- **"Hotel room" is a section.** There is no location setting.
- **Item fields:** name, unit (free text), optional second unit (labels bundle + count; returnables good + damaged), optional `sku_id` (platform product, plain reference), optional `min_level` (limit).
- **Generic template** offered to a new plant (edit or skip):
  - Today production / Finished goods closing stock, filled from **that plant's own SKUs**
  - Raw material: empty bottle packets per product
  - Consumable: caps, 20 L sticker, screw caps blue / yellow / sky blue, labels per product, filters 210" / 220", roll, dosing chemical Ca / Mg / Ka, inkjet solution / ink, dosing liquid, ring, tap
  - Returnable items: 20 L jar, jerry can, chiller jar, battery dispenser, pump dispenser; counted in plant only, good + damaged
  - Plant 002's specific list (sku1–sku6, "1 L box / 500 ml box / 250 ml box" as separate products) is entered via screens, **not code**.

**Permissions** (server-enforced; DB can't tell roles apart; every setup change audited)

| Action | Owner (tenant_admin) | store_keeper | Other staff | Support (super_admin) |
|---|---|---|---|---|
| Open module | ✓ | ✓ | refused | read-only |
| Submit / correct count | ✓ | ✓ | – | refused |
| Add item to any section (choose section at creation), edit name/unit/second unit/sku | ✓ | ✓ | – | refused |
| **Sections: add / rename / re-order / switch off** | ✓ | – | – | refused |
| **Move item to another section** | ✓ | – | – | refused |
| **Set / change limit** | ✓ | – | – | refused |
| **Switch off an item that has a limit** | ✓ | – | – | refused |
| Switch off an item without a limit | ✓ | ✓ | – | refused |
| View today / history / low stock | ✓ | ✓ | – | ✓ logged |
| CSV export, Support-access log, Recent changes | ✓ | – | – | – (Recent changes read-only) |

- A store keeper's save that touches a forbidden field → the **whole save is refused** with a plain message.

**Alerts and tile**
- **Low-stock email:** goes to **owners only** on submit or correction, once per item per day per owner (DB unique key). Newly low items in a correction are emailed. No email address → `skipped`. Failures are retried by the daily job. No WhatsApp yet (Meta approval pending).
- **Tile badges:**
  - "Today's count not done" (warn) / "Counted 6:40 pm" (ok)
  - "N items low" (danger)
  - "Made N box" (info)
- **Other features:** "Copy as WhatsApp message" button; owner CSV with formulas neutralised; support view read-only, logging every page.

**Later (not v1)**
- **Dispatch entries** (party, item, boxes, batch) as **new tables** with no change to counts; the owner view adds a "Dispatched vs Sold (from count) vs Gap" column.
- **Batch check:**
  - Floor Stock asks Lab Records whether the batch is approved; if Lab Records can't be reached, the dispatch is **refused**.
  - Dispatch lines store `batch_id` for recall tracing.
  - It needs a module-to-module auth design: likely a platform-signed short-lived token with `purpose`. **That changes the token contents, so ask the owner first.**
- Purchases, party list, Hindi / Odia screens.

**Project rules (CLAUDE.md)**
- Start phases in plan mode.
- Ask before any schema, permission, tenant-isolation or SSO-token change.
- Write tests with each feature.
- Never commit secrets.
- Keep changes small and explain them plainly.
- Commit or push only when asked; currently on `main` (Railway deploys `production` only).

## 4. Progress & Completed Work
- **Design approved** and documented:
  - `CLAUDE.md` Status log: "2026-10-04 — Phase 5: Floor Stock — design approved, build starting", with decisions, the 8 build steps (step 1 ✅) and the Later list; build-order item 5 rewritten
  - `BuildPrompt.md`: new "Phase 5 — Floor Stock module" prompt + follow-up questions
  - `CHANGELOG.md` "Unreleased": Floor Stock started + the migration
  - full plain-language design + ASCII mockups in `~/.claude/plans/hidden-marinating-pelican.md` (outside the repo; CLAUDE.md is canonical)
  - memory `~/.claude/projects/-home-rocky-projects-plantops-platform/memory/floor-stock-brief.md` (+ MEMORY.md index line)
- **Step 1 ✅:**
  - The owner ran `./scripts/setup-module-db.sh floor_stock stock_app STOCK 3002`. `.env` now has `STOCK_DATABASE_URL_APP`, `TEST_STOCK_DATABASE_URL_APP`, `STOCK_SESSION_SECRET`; `MODULE_URL_FLOOR_STOCK=http://192.168.1.2:3002` and `MODULE_SECRET_FLOOR_STOCK` already existed.
  - Created:
    - `apps/floor-stock/db/migrations/0001_floor_stock.sql`
    - `apps/floor-stock/db/migrate.ts`
    - `apps/floor-stock/db/load-env.ts` (copied from Document Store)
    - `apps/floor-stock/package.json` (`@plantops/floor-stock`, scripts dev / dev:lan / build / start / typecheck / test / db:migrate / daily; nodemailer not included; `db/run-daily.ts` not yet created)
  - Root `package.json` `db:migrate` now includes floor-stock; `pnpm install` was run.
  - The migration is applied to the **dev** (`plantops`) and **test** (`plantops_test`) databases.
  - Manual SQL checks ran as `stock_app` on the test DB and **all passed**:
    - no tenant → error
    - B sees 0 of A's rows and can't insert A's
    - 8 UPDATE / DELETE attempts refused
    - duplicate day, correction without reason and negative qty refused
    - rename, limit and correction with reason allowed
- **Nothing is committed.** Changed / new files: `CLAUDE.md`, `BuildPrompt.md`, `CHANGELOG.md`, root `package.json`, `pnpm-lock.yaml` (maybe), `apps/floor-stock/**`, this file.

## 5. Open Tasks & Immediate Next Steps
1. **Step 2, the app skeleton** `apps/floor-stock` on the module kit, copying Document Store's structure:
   - `src/server/{env,kit,db,schema,summary,support,session,http}.ts`: env prefix `STOCK_`, `MODULE_SECRET_FLOOR_STOCK`, `MODULE_URL_FLOOR_STOCK`, moduleId `floor_stock`, label "Floor Stock"
   - `src/proxy.ts`, sso routes, `api/plantops/summary`, `support-access`, `plant-logo`, `health`, layout / header with plant colour + Account link
   - config files (`next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `vitest.config.ts`), test scaffolding (`global-setup` must `drop schema if exists floor_stock cascade` then migrate)
   - remove floor_stock from `apps/dev-module` (`src/server.ts`, around line 192 `REAL_APPS`, and its :3002 server)
   - access: `tenant_admin` or `store_keeper`
   - verify `pnpm dev` → `http://192.168.1.2:3002` → platform login → empty module
   - report to the owner and wait before step 3
2. **Step 3:** Sections & items screens (owner-only rules above), generic template, "Set up sections" tile link (platform `modules.ts` + launcher tile; also change floor_stock staff text from "Manage stock in/out" to a daily-count wording).
3. **Step 4:** daily count screen (pre-fill, multi-line, submit / lock, correction with reason, today / yesterday, WhatsApp text).
4. **Step 5:** owner views (today vs previous, Sold / Used, low stock, history by date and by item, Recent changes from audit_log, CSV, unit-change handling).
5. **Step 6:** summary badges + low-stock email (move `mail.ts` into module-kit; keep Document Store's tests green); `POST /api/cron/daily` + `CRON_SECRET` retries pending alerts (`stock_tenants()`); add Floor Stock to the GitHub daily workflow.
6. **Step 7:** tests covering isolation + FORCE RLS guard, append-only refusals, role matrix, count rules, arithmetic, email once-only, tile, setup / audit, CSV / WhatsApp text, support read-only.
7. **Step 8:**
   - `apps/floor-stock/NOTES.md`, CLAUDE.md status note, `CHANGELOG.md`, Dockerfile
   - `docs/DEPLOY.md` / `docs/deployments/shared.md` for `stock.bluemins.life` (Railway service, `stock_app` login on the hosted DB, `./scripts/railway-migrate.sh`)
   - super_admin Modules screen URL / secret for the hosted copy

## 6. Known Issues, Blockers, or Edge Cases
- **Port conflict:** `apps/dev-module` still listens on :3002 for floor_stock. Stop or remove it before running the real app.
- **Platform module registry:** confirm `platform.modules` row `floor_stock` has `base_url` = `MODULE_URL_FLOOR_STOCK` and a secret hash matching `MODULE_SECRET_FLOOR_STOCK` (seeded earlier for dev-module; `pnpm db:seed` or the super_admin Modules screen). Plant 002 must have floor_stock enabled and a store_keeper user to test.
- **Alert contacts:** check which roles `GET /api/m/tenants/:tid/alert-contacts` returns (it was built for lab leads / document keepers + owners). Floor Stock must email **owners only**: filter by role, or extend the endpoint (a platform API change; tell the owner).
- **Test DB leftovers:** the manual checks left rows in `plantops_test.floor_stock`. The test global-setup must drop and recreate the schema.
- **Limit checks are app-level only:** one DB login per module, so owner-only rules (limits, moves, sections, switch-off of limited items) must be enforced server-side and covered by tests.
- **Unit change** makes cross-day comparison invalid; show "not compared".
- **Corrections:** compute "newly low" against alerts already sent that day.
- **Unverified for the whole project:** Docker images never built locally (no Docker); real WhatsApp waiting on Meta.
- `BuildPrompt.md` has no Phase 4 prompt (left as is).

## 7. Working State & Code Snippets

**Schema (`apps/floor-stock/db/migrations/0001_floor_stock.sql`, applied):**
```
floor_stock.sections(id, tenant_id, name 1–60, kind 'finished'|'stock', sort_order, status 'active'|'off',
  created_by, created_by_name, created_at, updated_at; unique(tenant_id,id); unique idx (tenant_id, lower(trim(name))))
floor_stock.items(id, tenant_id, section_id → sections(tenant_id,id), name 1–80, unit 1–20, second_unit?,
  sku_id?, min_level numeric(12,2)? ≥0, sort_order, status, created_by(_name), created_at, updated_at;
  unique idx (section_id, lower(trim(name))))
floor_stock.counts(id, tenant_id, count_date, created_at; unique(tenant_id,count_date))
floor_stock.count_versions(id, tenant_id, count_id, version ≥1, reason, entered_by(_name), entered_at;
  check(version=1 or len(trim(reason))≥3); unique(count_id,version))
floor_stock.count_lines(id, tenant_id, version_id, item_id, kind 'production'|'stock', line_no 1–20,
  item_name, unit, second_unit (copied), qty numeric(12,2) ≥0, second_qty? ≥0, remark ≤120;
  check(kind='stock' or second_qty is null); unique(version_id,item_id,kind,line_no))
floor_stock.low_stock_alerts(id, tenant_id, count_date, item_id, item_name, qty, min_level,
  recipient_user_id, recipient_name, email, status pending|sent|failed|skipped, error, created_at, sent_at;
  unique(tenant_id,count_date,item_id,recipient_user_id))
floor_stock.support_views(id identity, tenant_id, super_admin_id, super_admin_name, path, at)
floor_stock.audit_log(id identity, tenant_id, actor, action, target, details jsonb, at)
RLS: enable+force + policy tenant_isolation (tenant_id = current_setting('app.tenant_id')::uuid) on all 8.
function floor_stock.stock_tenants() security definer → distinct tenant_id with pending alerts (daily job).
Grants to stock_app: SELECT+INSERT on all tables; UPDATE only:
  sections(name, sort_order, status, updated_at)
  items(section_id, name, unit, second_unit, sku_id, min_level, sort_order, status, updated_at)
  low_stock_alerts(status, error, sent_at)
  No DELETE anywhere.
```

**Env (repo-root `.env`, never print values):**
`PLATFORM_URL`, `DATABASE_URL_OWNER`, `TEST_DATABASE_URL_OWNER`, `STOCK_DATABASE_URL_APP`, `TEST_STOCK_DATABASE_URL_APP`, `STOCK_SESSION_SECRET`, `MODULE_URL_FLOOR_STOCK`, `MODULE_SECRET_FLOOR_STOCK`, `CRON_SECRET`; later `BREVO_API_KEY` / `MAIL_FROM` / `SMTP_*`.

**Module wiring to replicate:**
```ts
// apps/floor-stock/src/server/kit.ts
import { createModule } from "@plantops/module-kit";
import { env } from "./env";
export const kit = createModule({
  moduleId: "floor_stock", label: "Floor Stock",
  env: { platformUrl: () => env.platformUrl, clientSecret: () => env.clientSecret,
         sessionSecret: () => env.sessionSecret, secureCookies: () => env.secureCookies },
});
// env: clientSecret=MODULE_SECRET_FLOOR_STOCK, sessionSecret=STOCK_SESSION_SECRET,
// databaseUrl=STOCK_DATABASE_URL_APP, secureCookies = MODULE_URL_FLOOR_STOCK startsWith https
```

**Commands:**
- `pnpm --filter @plantops/floor-stock db:migrate`
- `pnpm db:migrate` (all apps)
- `pnpm dev` / `pnpm dev:lan`
- `pnpm test` (runs per app, concurrency 1)
- local URLs: platform `http://192.168.1.2:3000`, Floor Stock `http://192.168.1.2:3002`
- test plant **002** (SAMPLEAQUA): owner Sujata, staff Atharv and Techno
