# Proposed Complaint Box Module — Phase Plan and Build Prompt

**Status:** Proposed product plan only. No code, schema, module registration, or roadmap change is approved or built.

## Purpose

Give plant staff a mobile-friendly way to record customer complaints, including the customer’s contact details, the
item involved, a description of the issue, and photos and/or video. The tenant owner and every user authorized for
Complaint Box can see complaints for their own plant. The tenant owner can resolve complaints.

## Requirements captured so far

- Complaint Box is a **separate PlantOps module**, not Order Capture or another existing module.
- Staff create a complaint with:
  - Customer name — **required**.
  - Customer phone number — **required**.
  - Place — included; whether it is required remains to be confirmed.
  - Item — selected from an owner-managed list; confirm whether this is the item involved or an issue category.
  - Issue description.
  - Photo and/or video attachments.
- Record the logged-in staff member as the reporter, separately from the customer.
- In v1, staff enter customer name and phone manually. No spreadsheet or other customer lookup source is required.
  Phone lookup can be considered later after a source is chosen.
- The tenant owner can add and manage the available items.
- The tenant owner and **all users who have Complaint Box access** can view complaints belonging to their plant.
- The tenant owner can mark a complaint resolved. Whether other authorized users can change other statuses is not yet
  decided.
- The module must enforce access on the server and isolate each plant's data and attachments.

## Roadmap position and prerequisite

The current roadmap names Preventive Management as Phase 6. Floor Stock is complete and live, but its owner live-use
checklist is still open in `apps/floor-stock/NOTES.md`. The owner said Complaint Box should be scheduled later.
Therefore, this plan assigns **no phase number** and does not reorder the roadmap. Before implementation, confirm
where it belongs and whether the Floor Stock checklist is complete or explicitly deferred.

## Proposed implementation stages

### Stage 0 — Confirm placement and approve the design

- Confirm the roadmap position and close or explicitly defer the Floor Stock live-use checklist.
- Resolve the open decisions below, especially who can change statuses, which complaint fields are mandatory, media
  limits/storage, and how users are granted access.
- Read current module conventions, including the module kit, platform module/role/plan integration, per-module
  database setup, deployment and tests.
- Present the detailed implementation plan and wait for approval before coding.
- Ask separately before any database schema, permission, tenant-isolation, or SSO-token change.

### Stage 1 — Module foundation and access

- Build an independent app using the existing module patterns and `packages/module-kit`.
- Add the approved module and access role(s) to the platform and plan/launcher only after the roadmap and access
  model are approved.
- Use a separate module schema and runtime database login. Tenant-owned records must include `tenant_id` and use
  FORCE RLS; runtime code must not connect as the table owner.
- Enforce the agreed roles on every server route and page. A hidden tile is not authorization.

### Stage 2 — Owner-managed item list

- Let the tenant owner add, rename, reorder, activate and deactivate items (final management rules to be agreed).
- Keep each plant's list separate. Validate that complaint submissions refer only to an active item belonging to
  that same tenant.
- Audit changes to the list where consistent with module practices.

### Stage 3 — Staff complaint entry

- Provide a mobile-first form for required customer name and phone, place, item, issue description and photo/video.
- Store the authenticated reporter's user ID and submission time on the server; never accept reporter or tenant IDs
  supplied by the browser as authoritative.
- Validate and normalize phone numbers using an agreed rule, while preserving the entered value if appropriate.
- Save attachments privately and associate them with the tenant-scoped complaint. Downloads/previews must require
  module access and re-check tenant ownership.
- Show a clear success confirmation and reference. Handle upload/save failures without leaving a misleading
  success state.

### Stage 4 — Complaint inbox and resolution

- Show complaints to the tenant owner and every user authorized for Complaint Box, scoped to their own tenant.
- Provide useful filters/search and clear status, item, customer, reporter and submitted-time details.
- Implement only the agreed status transitions. The owner must be able to mark a complaint resolved; record who
  resolved it and when, and retain status history.
- Do not expose complaint records or attachments to users without module access or to another tenant.

### Stage 5 — Security, media, tests and operations

- Add focused tests for tenant isolation, role access, required fields, item ownership/active state, upload type and
  size checks, private attachment access, status transitions, resolution audit and concurrent updates.
- Test upload and storage behavior using fakes/local test services; do not require production credentials in tests.
- Document setup, item administration, complaint handling, media storage/limits, retention and deployment.
- Run focused tests, typecheck and production build; deploy only after an approved pilot.

## Decisions to settle before implementation

1. **Roadmap placement:** which later phase should contain Complaint Box? It will not silently replace or renumber
   Preventive Management or another planned module.
2. **Floor Stock prerequisite:** complete its owner live-use checklist first, or explicitly defer it?
3. **Field requirements:** Name and phone are confirmed required. Is Place required? Is an item required? Is the issue
   description required, and what is the minimum useful detail?
4. **Item meaning:** Is the owner-managed “item” the product/equipment being complained about, or a complaint
   category/type? Should staff also enter a free-text issue description?
5. **Access:** Which users/roles should receive Complaint Box access? The owner needs access to manage items and
   resolve complaints. Should `plant_staff` access it automatically when the module is enabled, or only users with
   an explicitly assigned Complaint Box role?
6. **Status permissions and workflow:** The owner can resolve. Can other authorized users set statuses such as Open
   and In progress? Should resolved complaints be reopenable, and by whom?
7. **Media:** Which image/video formats and maximum file size, count and total storage per complaint? Use the
   existing private local/S3-compatible module storage pattern, subject to the approved limits.
8. **Corrections and retention:** Can a reporter edit or withdraw a complaint after submission? How long should
   complaints and attachments be retained, and is an owner export needed?
9. **Future customer lookup:** No lookup source is needed for v1. If added later, choose the source and define
   per-plant configuration and phone matching rules at that time.

## Copy-ready build prompt

```text
Plan the future Complaint Box module for the PlantOps monorepo at
~/projects/plantops_platform. Do not start implementation immediately.

First read current repository instructions and relevant examples, especially:
- CLAUDE.md and the current roadmap/status
- apps/floor-stock/NOTES.md and its open owner live-use checklist
- apps/lab-records, apps/document-store and apps/floor-stock module conventions
- packages/module-kit, packages/auth, packages/types, platform module/role/plan integration,
  per-module database setup, deployment docs and tests

Product requirements captured with the owner:
- Complaint Box is a separate module, not Order Capture or an existing module extension.
- Staff manually enter customer name and phone number; both are mandatory. No Google Sheet or other lookup
  source is required in v1; customer lookup may be considered later.
- The complaint includes place, the item involved (managed by the tenant owner), an issue description, and
  photo and/or video attachments.
- Record the logged-in staff member separately as the reporter.
- The tenant owner can manage the item list and can mark complaints resolved.
- The tenant owner and every user authorized for Complaint Box can see complaints for their own plant.
- No behavior concerning other status changes, editing/submitting users, or reopening is confirmed yet; identify
  these as decisions rather than inventing policy.

Project constraints:
- PlantOps is multi-tenant. Enforce access on every server route and isolate each plant's records and attachments.
- Follow existing independent-app patterns: own app URL, schema and runtime DB login; use tenant_id and FORCE RLS.
- Apps share code through packages/*, not by importing another app's code.
- Never trust tenant or reporter IDs from browser input. Never serve private media without authorization and
  tenant checks.
- No secrets in source, docs, logs or test fixtures.
- Ask before changing schema, database permissions, tenant isolation or SSO token contents.
- Do not silently renumber or reorder the roadmap. It currently names Preventive Management as Phase 6;
  Complaint Box was requested to be scheduled later, with its exact phase still undecided.
- Floor Stock is live but its owner live-use checklist in apps/floor-stock/NOTES.md remains open; ask whether it
  is complete or explicitly deferred before beginning another implementation phase.

First response must be plan-only:
1. Summarize the current repository state and prerequisites.
2. Propose staged work for the module foundation/access, owner-managed items, staff complaint form, private
   photo/video uploads, tenant-wide authorized inbox, owner resolution/status history, tests, documentation and
   deployment.
3. Ask focused questions about phase placement, Floor Stock prerequisite, required fields, item/category
   meaning, module roles, status permissions/transitions, media limits/storage, corrections and retention.
4. Wait for the owner's approval of the detailed plan and any required schema/permission/isolation changes.

Do not create migrations, edit code, configure providers, deploy or commit before approval. After approval,
implement in small coherent steps, write tests for tenant isolation and role access, validate media handling and
resolution audit, run focused tests/typecheck/production build, and report any remaining owner setup.
```
