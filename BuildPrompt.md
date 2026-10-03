Phase 1 — Platform core

Prompt to paste into Claude Code:

		Read CLAUDE.md.

		We're starting Phase 1: Platform core.

		Plan (do not write code yet):
		- Monorepo setup (pnpm + Turborepo): apps/platform plus packages/auth, packages/types, packages/ui
		- super_admin service: create/manage tenants and their tenant_admin users (tenant_admin is a role,
		  no separate tenant_admins table)
		- Auth and roles shared across all future module apps; users can hold multiple roles; staff log in
		  with username + PIN set by the tenant_admin
		- Tenant registry with tenant_plan (enabled modules + platform-wide and per-module limits as JSON)
		- SSO token issuance (JWT: tenant_id, user_id, roles[], enabled_modules, exp), asymmetric signing,
		  handed to modules via a one-time code exchange
		- Postgres row-level security so tenant A can never read tenant B (rules in CLAUDE.md)

		Show me:
		1. The database schema (tables, columns, keys, RLS policy approach)
		2. The permission/role model
		3. The SSO token structure, the one-time-code handoff, and how a module app would verify it
		4. The folder/file structure you'll create in the monorepo
		5. The test plan for tenant isolation and role access

		Wait for my approval before writing any code.

My follow-up questions for you to ask it back, once it responds:

"Why row-level security instead of just filtering by tenant_id in every query?"
"Show me exactly what happens if a module app receives an expired or tampered token."
"How would I, as super_admin, create a new tenant right now — walk me through the actual steps/API calls."


Phase 2 — Launcher

Prompt:

		Read CLAUDE.md. Phase 1 (platform core) is complete — see the Status log for what was built.

		Plan Phase 2: Launcher.

		- A dashboard shown after login, filtered by the user's role and the tenant's enabled modules
		- Owner (tenant_admin) sees read-only summary tiles for every enabled module, plus locked tiles for
		  modules not enabled
		- Staff roles (lab technician, store keeper, maintenance technician) see only their working module(s)
		- Single-module staff skip the launcher: after login they go straight into their one module.
		  Multi-role staff and owners see the tile screen.
		- Clicking an unlocked tile hands off to that module's URL using the SSO token from Phase 1
		- Direct-link flow: staff open a module's own URL (home-screen icon on their phone) without going through
		  the launcher. Module with no session -> platform /sso/start?module=<id> -> if logged in, straight back
		  with a one-time code; if not, platform login first, then back into the module. Module session lasts
		  one shift (12 h) with the 5-minute status re-check from Phase 1.
		- Owner's tiles read live numbers from each module's summary endpoint each time the dashboard is
		  opened or refreshed (no copied data, no live push in v1)
		- super_admin "Modules" screen (replaces editing .env + pnpm db:seed for module setup):
		  - list every module with its status: set up (URL + secret) or not, active or switched off
		  - set or change a module's URL (e.g. when it moves to a real domain)
		  - generate a new client secret for a module, shown once (for setup or if the old one leaks)
		  - switch a module off for ALL plants (e.g. it is broken) - blocks new handoffs to it; plant plans
		    keep their settings, so switching it back on restores access
		  - every change written to the audit log
		  - a brand-new module still starts as code (module id + role in packages/types, a migration, the
		    module app); the screen covers everything after that

		- super_admin plant dashboard: choose a plant from a drop-down -> that plant's module tiles with live
		  summaries (same summary endpoints as the owner's tiles), read-only
		- Design (build per module from Phase 3): super_admin opens any plant's module data read-only
		  ("support view"). Decide how the platform proves to a module that the caller is super_admin acting on
		  one chosen plant (SSO token change - ask first), how modules enforce read-only, and how each view is
		  written to an audit log the plant owner can see

		Show me the screen layout (launcher, Modules screen and super_admin plant dashboard), the API calls the launcher makes, and how it
		decides what to show per role, before writing any code.

		Follow-up questions:

		"What does the launcher show if a module's app is down or unreachable?"
		"How do I add a brand-new module to the system later — what exactly do I need to configure?"

Phase 3 — Lab Records module

Prompt:

		Read CLAUDE.md. Phases 1 and 2 are complete — see the Status log.
		Also read refeDocs/sheets/FSSAI STI Forms.xlsx — the four FSSAI record forms this module replaces.

		Plan Phase 3: Lab Records module app (apps/lab-records in the monorepo). It owns the batch record.

		- Built on the packages/auth module helpers ("Every module app must" in CLAUDE.md), replacing
		  apps/dev-module for lab_records: SSO callback, 12 h session with 5-min re-check, own schema + own
		  DB login + FORCE RLS, plant colour/logo, "Account" link, summary endpoint
		- The four FSSAI forms, entered by the lab technician in the app:
		  - Form 1 — Report for Monthly Testing: per batch (production date, batch no.) the parameter results
		    (Barium, Copper, Iron, Manganese, Nitrate, Nitrite, Aluminium, Calcium, Sulphide, Magnesium,
		    Antimony, Borate, Phenolic Compound, Mineral Oil, Zinc, Anionic Surface-Active Agent), remark
		  - Form 2 — Testing at an FSSAI-notified NABL lab (ISO/IEC 17025): batch no., manufacturing date,
		    type of packing, date sample sent, lab name, test report no. and date, remark
		  - Form 3 — Source Water Testing: source of water, lab name, sample sent on, test report no. and date,
		    results, remark
		  - Form 4 — Plastic Containers Used for Packaging Water: type of packaging, supplier, quantity
		    received, lab name, date samples sent, overall migration result, remaining parameters as per FSS
		    Packaging Regulation 2018, remark
		  Each row records who entered it ("Sign") and who verified it ("Verified By"), with date/time.
		- Daily in-house test log (besides the four forms): routine checks per batch / per day (e.g. TDS, pH,
		  turbidity), parameters chosen by each plant. This is where most failed tests come from.
		- Parameters and limits are configurable per plant (sample limits are placeholders); pass/fail is
		  computed automatically wherever a result has a limit
		- Append-only: lab technicians add and "update" entries, but an update creates a new version with
		  who/when/why; the old version stays on record. Enforced by DB grants (no UPDATE/DELETE on result
		  tables). Entries lock on submit.
		- Batch approval for production: a batch stays pending until approved. It can be approved by the
		  tenant_admin or by a new "lab lead" role (a lab technician who can also approve batches), which the
		  owner ticks per user like the other roles. Adding the role touches roles/permissions — show me the
		  exact change and ask first.
		- Failed test: batch goes on hold, cannot be approved or dispatched, requires a corrective-action note,
		  WhatsApp alert to tenant_admin; a retest is a new entry and the failed one stays on record
		- Owner (tenant_admin) views all forms and batches, approves/verifies; otherwise read-only
		- Search screen inside Lab Records: owner opens the Lab Records tile and finds data by date range,
		  batch no., form, status (pending / approved / on hold), pass/fail. super_admin sees the same screen
		  read-only through the support view. The platform dashboard tile shows only the summary numbers.
		- History by plan: nothing is ever deleted. The tenant_plan limits JSON sets how many months back the
		  app shows, searches and prints (e.g. basic 12 months, premium longer or unlimited); older data stays
		  stored and comes back on upgrade; the owner can always export everything. New plan limit key — ask
		  first.
		- Printing: each form prints in the same layout as its sheet (FORM n title, plant name, same columns in
		  the same order, landscape, Sign / Verified By filled in, room for handwritten signatures) for a chosen
		  date range. The paper copy is submitted to the government office; the soft copy stays in the app.
		  Also a PDF report per batch.
		- Owner tile badges from the summary endpoint (e.g. "2 awaiting approval", "1 on hold")
		- Support view: super_admin reads one plant's lab data read-only via the support token
		  (verifySupportToken), every view written to an audit trail the owner can see
		- Batch lookup API for other modules (Floor Stock will reference batch_id)
		- apps/lab-records/NOTES.md with module-specific notes

		Show me the schema, the screens (technician entry, owner approval, print layout), the permission checks,
		the versioning and failed-test flow, and the test plan before writing code.

		Follow-up questions:

		"Walk me through exactly what's stored when a retest happens — show me the actual rows."
		"How does this module know which parameter limits apply to which product, and who sets them?"
		"What happens to a batch that's on hold if nobody logs a retest for a week?"
		"Show me a printed Form 1 next to the Excel sheet — what differs?"
		"Which Form 1 parameters are tested in-house every batch, and which only monthly or by the NABL lab?"
