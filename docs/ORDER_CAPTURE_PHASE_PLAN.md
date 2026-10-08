# Proposed Order Capture Module — Phase Plan and Build Prompt

**Status:** Proposed only. No module, schema, provider integration, or roadmap ordering has been approved or built.

## Purpose

Let anyone with a plant's public order link or QR code submit an order, while plant owners manage the item catalog and
staff manage fulfillment. Customer details are looked up from that plant's Google Sheet. Staff can mark a complete
order delivered. Plant staff receive an evening pending-orders digest over MSG91 RCS; failed RCS delivery is surfaced
in the authenticated app, with no SMS or email fallback.

## Agreed requirements

- This is a **separate module**, not an extension of Marketing Contacts or Floor Stock.
- A public, plant-specific URL/QR code opens order entry without a staff login.
- The person entering the order supplies a phone number. The app looks up that customer in the plant's own Google
  Sheet and shows the matching name, phone number, and place. Do not expose or download the whole customer sheet to
  the public page.
- An order line has an owner-configured item, quantity, and rate. The owner maintains items and default rates; the
  person placing the order may adjust a rate for that order.
- Example: `1ltr 100 / Rs.84` means 100 units at Rs.84 per unit.
- Authenticated plant staff see orders and can mark an order delivered only after the whole order is delivered.
  Record who marked it and when. Partial delivery is out of scope for v1.
- Send an evening digest of all pending orders through the plant's MSG91 RCS setup. If delivery fails or RCS is
  unavailable, show an in-app alert; do not fall back to SMS or email.
- The user reports already having an MSG91 RCS account. Verify RCS enablement, sender/agent approval, templates,
  and API/webhook requirements before depending on live delivery.

## Roadmap position and prerequisite

The repository's roadmap currently names Preventive Management as Phase 6. Phase 5 (Floor Stock) has a complete
status note, but its owner live-use checklist remains open in `apps/floor-stock/NOTES.md`. Complete or explicitly
defer that checklist before starting another implementation phase.

This plan does **not** silently renumber the roadmap. The owner must decide whether Order Capture should be inserted
before Preventive Management or scheduled later. Recommended decision point: confirm the Floor Stock pilot first,
then choose the next phase.

## Proposed implementation stages

### Stage 0 — Close prerequisites and approve design

- Complete or defer the Floor Stock live checklist, including the first real count and low-stock email test.
- Confirm the official phase order.
- Inspect repository conventions for module registration, module-kit setup, independent database logins, cron jobs,
  and deployment before proposing implementation details.
- Resolve the open decisions below. In particular, public order submission and customer lookup are unauthenticated
  surfaces and need explicit abuse, privacy, and revocation decisions.
- Present a detailed implementation plan and wait for approval before editing code.
- Ask separately for approval before any database schema, database permission, tenant-isolation, or SSO-token change.

### Stage 1 — Module foundation and owner setup

- Add a standalone Order Capture app using existing module patterns and `packages/module-kit`.
- Give it its own schema/database login and tenant-scoped data; use `tenant_id` and FORCE RLS for tenant data.
- Add only the platform module/role/plan integration that is approved. Keep public order entry separate from
  authenticated order management.
- Build owner-only setup for the plant's item catalog, active/inactive state, and default rates.
- Build settings for the plant-specific public link, Google Sheets connection, and notification recipients/time only
  after their decisions and secret-storage requirements are approved.

### Stage 2 — Per-plant customer lookup

- Connect each tenant to its own Google Sheet using an approved, least-privilege integration. Keep credentials on the
  server; never send Google credentials or a full sheet to the browser.
- Match the submitted phone number using an agreed normalization rule. Return only the matching customer's name,
  phone, and place.
- Handle missing, duplicate, malformed, and temporarily unavailable customer records explicitly; do not fabricate a
  successful match or silently fall back to another tenant's data.
- Add privacy-preserving logs and rate limits. Do not expose whether unrelated phone numbers exist beyond the
  intended order-entry flow.

### Stage 3 — Public order submission

- Build a mobile-first public form reachable through the plant-specific link/QR.
- Resolve the plant from the approved public-link mechanism on the server. Never trust a caller-supplied `tenant_id`
  to choose the tenant.
- Allow customer lookup, multiple item lines, quantities, and per-order rate adjustments; show the calculated total
  before submission.
- Persist the customer and item details needed to understand the submitted order, subject to approved retention and
  privacy rules. Keep an order's submitted item/rate snapshot stable if the owner later edits the catalog.
- Protect submission against spam, duplicate taps/retries, invalid quantities/rates, and cross-tenant access.
- Show a clear confirmation and order reference after a successful save.

### Stage 4 — Authenticated order management and delivery

- Provide authenticated staff views for pending and delivered orders, scoped to their tenant and approved role.
- Show order/customer details and item lines needed for fulfillment.
- Permit a complete-order transition from pending to delivered; record actor and timestamp and audit the transition.
- Prevent public users and unauthorized roles from viewing other orders or changing delivery status.
- Define and test behavior for mistaken submissions, cancellation, corrections, and repeated delivery actions before
  implementation; do not invent an alternate state machine.

### Stage 5 — MSG91 RCS evening digest

- Verify MSG91 RCS account readiness and documented API, sender/agent approval, templates, callback/webhook, delivery
  status, and consent requirements.
- Send a scheduled digest of pending orders only to owner-approved staff recipients.
- Use an idempotent outbox/retry approach so retries do not create duplicate messages. Validate provider callbacks
  and protect provider credentials.
- On a failed/unavailable RCS send, create an authenticated in-app alert and retain a visible failure status. Do not
  send SMS or email.
- Make schedule, timezone, recipients, digest content, retry policy, and in-app alert behavior follow the owner's
  decisions below. Do not include unnecessary customer personal data in the RCS message.

### Stage 6 — Verification, pilot, and deployment

- Add automated tests for tenant isolation, roles, public-link tenant binding, phone lookup, order calculations,
  duplicate submissions, immutable order snapshots, delivery audit, and RCS success/failure/retries.
- Test Google Sheets and MSG91 integrations against fakes; do not require live provider credentials in unit tests.
- Document owner setup, Google permissions, public QR/link rotation, MSG91 configuration, operational failures,
  retention, backups, and deployment.
- Run the focused tests, typecheck, and production build; deploy only after owner approval and a safe pilot.

## Decisions to settle before implementation

1. **Roadmap:** Insert Order Capture before Preventive Management, or build it later? The current roadmap's Phase 6 is
   Preventive Management.
2. **Google Sheets connection:** How should each owner grant access (for example, share a sheet with a service
   account or connect an account)? Confirm exact tab/column mapping, whether phone numbers are unique, and what the
   form should do when Sheets is unavailable.
3. **Public link:** Is a permanent opaque, revocable plant-specific link acceptable? Decide whether it can be
   rotated, whether there is an expiry, and which anti-abuse controls (rate limit, CAPTCHA, or other) are acceptable.
4. **Customer lookup:** Is exact full-phone matching required? Decide country-code handling and whether lookup should
   happen only after a customer is identified or as a separate step before the order form.
5. **Order lifecycle:** Confirm which states are needed beyond pending and delivered (for example, cancellation or
   rejection), who may correct an order, and whether an order may be edited after submission.
6. **Order details:** Confirm quantity units, allowed decimal precision, currency/rounding, and whether tax, discount,
   payment status, delivery date, or notes are in v1. These were not agreed; default recommendation is to exclude
   them until requested.
7. **Rate override:** The order-entry person may adjust the owner's default rate. Decide whether the form should show
   both default and entered rate, and whether overrides need a reason or owner review.
8. **Evening digest:** Set send time/timezone, days, recipients and opt-in, message content/detail level, what counts
   as pending at send time, retry window, and who sees the in-app failure alert.
9. **RCS readiness:** Confirm MSG91's RCS sender/agent and template are approved and the provider account supports
   the required delivery callbacks. Decide how to proceed if approval is pending.
10. **Retention/privacy:** Decide how long orders and customer contact snapshots are retained and whether owners need
    export or deletion tools.

## Copy-ready build prompt

```text
We are planning a new standalone Order Capture module for the PlantOps monorepo at
~/projects/plantops_platform. Do not start implementation immediately.

First read the current repository instructions and relevant module examples, especially:
- CLAUDE.md and its current roadmap/status
- apps/floor-stock/NOTES.md (Phase 5 pilot checklist)
- apps/lab-records and apps/document-store for module conventions
- packages/module-kit, packages/auth, platform module/role/plan integration,
  daily-job workflow, deployment docs, and existing tests

The Order Capture requirements agreed with the owner are:
- A separate module, not Marketing Contacts or Floor Stock.
- Public plant-specific order URL/QR; anyone with the link can place an order without
  signing in. Public callers must not choose a tenant by posting tenant_id.
- Customer is looked up by phone number from that plant's own Google Sheet. Show only
  that match's name, phone, and place; never expose the whole sheet or Google credentials.
- The owner manages the plant's item catalog and default rates. The person placing an
  order can adjust a default rate for that order.
- A line such as "1ltr 100 / Rs.84" means quantity 100 at Rs.84 per unit.
- Authenticated plant staff manage orders. An order is marked delivered only when the
  complete order is delivered; record who did it and when. Partial delivery is out of
  v1 scope.
- Send an evening pending-orders digest through the plant's MSG91 RCS setup. If RCS
  cannot deliver, show an in-app alert only; no SMS or email fallback. Owner reports
  already having an MSG91 RCS account, but readiness must be verified.

Important project constraints:
- This is a multi-tenant platform; server-side authorization and tenant isolation are
  mandatory. Follow existing module patterns and packages/module-kit.
- Each app has its own URL, schema, and DB login. Plant data uses tenant_id + FORCE RLS;
  never connect as the table owner at runtime.
- Apps share code through packages/*, not by importing another app's code.
- Do not put secrets in source, docs, logs, browser code, or test fixtures.
- Ask before changing schema, database permissions, tenant isolation, or SSO token
  contents. No token change is presumed necessary.
- Write tests for tenant isolation, role access, data validation, calculations, and
  provider failure paths.
- The existing roadmap names Preventive Management as Phase 6. Do not silently
  renumber it or assume Order Capture's place. Phase 5 has a status note but its live
  owner checklist is open; identify that prerequisite and ask whether it is complete
  or explicitly deferred.
- Do not use or repeat credentials from pasted environment files. Verify and rotate
  exposed secrets through the owner's normal secret-management process before using
  affected environments.

Your first response must be plan-mode only:
1. Summarize relevant current repo state and prerequisites, without editing files.
2. Propose a staged implementation plan covering owner setup, per-tenant Sheets
   connection/lookup, public order submission, authenticated order management/delivery,
   MSG91 RCS digest/in-app failure alert, tests, docs, and deployment.
3. Identify the decisions that block implementation: roadmap order, Google access and
   sheet mapping, public-link revocation/anti-abuse, phone normalization, lifecycle and
   correction rules, quantity/currency precision, rate override policy, RCS recipients/
   schedule/timezone/content/consent/retries, and retention.
4. Ask the owner the necessary focused questions and wait for answers/approval.

Do not create migrations, edit code, configure providers, deploy, or commit until the
owner approves the detailed plan and any required schema/permission/isolation changes.
After approval, implement in small coherent steps; add focused tests and relevant docs;
run the narrowest relevant test suite, typecheck, and production build; report any
provider setup that still requires owner credentials or approval.
```
