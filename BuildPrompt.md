Phase 1 — Platform core

Prompt to paste into Claude Code:

		Read CLAUDE.md.

		We're starting Phase 1: Platform core.

		Plan (do not write code yet):
		- super_admin service: create/manage tenants and tenant_admins
		- Auth and roles shared across all future module apps
		- Tenant registry with tenant_plan (enabled modules + limits as JSON)
		- SSO token issuance (JWT: tenant_id, user_id, role, enabled_modules)
		- Postgres row-level security so tenant A can never read tenant B

		Show me:
		1. The database schema (tables, columns, keys, RLS policy approach)
		2. The permission/role model
		3. The SSO token structure and how a module app would verify it
		4. The folder/file structure you'll create
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
		- Staff roles (lab technician, store keeper, maintenance technician) see only their one working module
		- Clicking an unlocked tile hands off to that module's URL using the SSO token from Phase 1

		Show me the screen layout, the API calls the launcher makes, and how it decides what to show per role,
		before writing any code.

		Follow-up questions:

		"What does the launcher show if a module's app is down or unreachable?"
		"How do I add a brand-new module to the system later — what exactly do I need to configure?"
		Phase 3 — Lab Records module

Prompt:

		Read CLAUDE.md. Phases 1 and 2 are complete — see the Status log.

		Plan Phase 3: Lab Records module app (new repo: plantops_lab_records).

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

