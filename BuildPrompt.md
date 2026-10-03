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

		Plan Phase 3: Lab Records module app (apps/lab-records in the monorepo). It owns the batch record.

		- Verifies the SSO token from the platform; enforces lab-technician-only test entry, tenant_admin
		  read-only
		- Batch log, test entry with configurable parameters and limits, automatic pass/fail
		- Failed test: batch goes on hold, requires a corrective-action note, WhatsApp alert to tenant_admin,
		  retest logged as a new entry
		- Append-only lab results (edits create a new version, never overwrite)
		- PDF report per batch and an audit-pack export for a date range

		Show me the schema, the permission checks, the failed-test flow, and the test plan before writing code.

		Follow-up questions:

		"Walk me through exactly what's stored when a retest happens — show me the actual rows."
		"How does this module know which parameter limits apply to which product, and who sets them?"
		"What happens to a batch that's on hold if nobody logs a retest for a week?"

