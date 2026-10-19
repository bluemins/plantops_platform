# Field day log (Attendance & Salary): Phase Plan and Build Prompts

**Status:** Asked by the owner on 2026-10-19; four answers given the same day (below). **Plan only.** To be built
**after F1** (weekly offs, holidays, leave; `docs/STABILITY_PLAN.md` section 10), as feature **F1b**. Release number
set when the build starts. Mock-ups to be approved before Phase 1.

**Mock-ups (2026-10-19, not yet approved):** https://claude.ai/artifact/EutRdTDJaBw7tHpHLXcUCq
A1 before start · A2 Start my day · A3 during the round · A4 Shop visited (customer search + **meeting notes**,
added by the owner 2026-10-19) · A5 weak GPS / list unavailable · A6 End my day · A7 fixing a mistake · B1 Today
board "In the field" · B2 person page → Field days · B3 day page (map links, photos, meeting notes) · C1 claims card
line (❓) · C2 bell "not ended" · C3 no new setting (uses the Field staff tick).

**What the owner asked (2026-10-19):** for staff with the **Field staff** tick, a record of what was done that day:
1. **Day start:** the person's location (saved as a Google Maps location), a place name they can type, the **start km
   reading + a photo** of the meter.
2. **Each shop visited:** location (Google Maps), the shop picked from the **customers already in Order Capture**.
3. **Day end:** location, place name, the **end km reading + a photo**.

"Just documentation of what is done today." **The claims section is not touched** (field duty / expense claims, TA /
DA and salary stay exactly as they are; nothing here is counted in pay).

**Owner's answers (2026-10-19):**
- **When:** after F1 (the 31 Oct salary month needs weekly offs first).
- **Customers:** a platform-signed **lookup ticket**, Attendance asks Order Capture (name / place search, no phone
  numbers, no amounts). A typed shop name is allowed when the shop isn't in the list or Order Capture is off. The same
  ticket is reused later for the Floor Stock → Lab Records batch check (F5).
- **Location:** store the **exact position (latitude / longitude)** at the three moments only (start, visit, end),
  when the person taps. Never tracked in between. Ordinary attendance scans stay distance-only.
- **Who sees a field day:** the **owner**, **supervisors** (read-only, all field staff) and **the person themself**
  (own days). PlantOps support read-only, logged. Office staff do not.

---

## Agreed design (proposed; confirm the points marked ❓)

### Who can use it
- A person may start a field day on a date when their **Field staff** tick (`salary_settings.field_staff`, the newest
  row from that month, as for claims) is on, **and** they hold Plant staff (`isEmployee`). Others get 404.
- New access rows in `src/server/access.ts`: `field_own` (employee, ticked), `field_view` (owner, supervisor,
  support). Support refused on every write, as everywhere.

### The worker's screen: "My field day" (`/my/field`)
```
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ Field day · Mon 20 Oct        │   │ Field day · Mon 20 Oct        │
│                               │   │ Started 9:12 · 45,210.5 km 📷 │
│  [   ▶  Start my day      ]   │   │ Plant gate · ±12 m  (map)     │
│                               │   │                               │
│                               │   │ Visits (3)                    │
│                               │   │ 10:05 Sai Stores, Bhadrak  map│
│                               │   │ 11:40 Maa Tarini Hotel     map│
│                               │   │ 13:15 "New shop near bus stand"│
│                               │   │                               │
│                               │   │  [  + Shop visited        ]   │
│                               │   │  [  ■  End my day         ]   │
└───────────────────────────────┘   └───────────────────────────────┘
 Start my day: location (waits up to 20 s, shows ±m), place name (optional), km reading (one decimal), photo of the
 meter (camera, shrunk on the phone like claim photos). Save.
 Shop visited: location, customer search (from Order Capture) or "Not in the list: type the name", **meeting notes**
 (optional, ≤ 300 characters: what was discussed with the customer; owner 2026-10-19), fixed once saved.
 End my day: location, place name, km reading (≥ start), photo. Shows "Today 84.3 km by meter".
```
- Location uses the existing `bestLocation()` (B-04). ❓ **Proposed:** a fix rougher than ±150 m is **saved with a
  warning** (shown to the owner as "rough location ±600 m"), not refused: shops in the field often have weak GPS and
  a refusal would lose the visit. No location at all (permission off) is refused with help text.
- The day belongs to the **India date of its start**; an End after midnight closes the open day (like Floor Stock's
  `countDay()`).
- ❓ **Mistakes:** append-only, as everywhere. A wrong km reading → "Correct start / end" adds a new start / end row
  with a reason; the newest counts, old ones shown crossed out. A wrong visit → "Remove" with a reason (a cancel row);
  the visit stays on record crossed out. The person can do this on the same day only; the owner any time.
- Days back: ❓ **today only** for the person (it records what happens now); the owner can't invent visits for them.

### Owner / supervisor screen
- Person page → new **Field days** section: month list (date, start–end time, km by meter, visits count, "not ended").
- Day page: timeline of start → visits → end, each with time, **Google Maps link**
  (`https://www.google.com/maps?q=<lat>,<lng>`), ±accuracy, place name, the two meter photos. No map drawn in the page
  (no Google API key, no cost).
- Today board (owner + supervisor): small "In the field: N" line with each person's last visit time.
- ❓ **Proposed:** a month CSV of visits for the owner (date, person, time, shop, place, lat, lng, km).
- The km by meter is **shown next to** that day's field-duty claim km on the owner's Claims card ("claimed 90 km ·
  meter 84.3 km"), **read-only, no change to claims or pay.** ❓ Owner to confirm this one line; without it nothing
  in the claims screens changes at all.

### Customers from Order Capture: the lookup ticket
- **Platform:** `POST /api/m/tenants/:tid/lookup-ticket` `{ to: "order_capture", scope: "customers" }`, module
  credentials. Allowed only if the pair is in a new allow-list `LOOKUPS` in `packages/types`
  (`attendance_salary → order_capture: customers`) **and** both modules are enabled for the plant. Answers a token
  signed with the platform key: `purpose: "lookup"`, `tenant_id`, `from` (module), `scope`, `aud` = the target
  module, `exp` 60 s. Never a login (`verifyToken` already refuses anything with `purpose`). **The SSO token is
  unchanged.**
- **`packages/auth`:** `fetchLookupTicket` and `verifyLookupRequest` (like `verifySummaryRequest`).
- **Order Capture:** `GET /api/plantops/customers?q=` with the ticket: up to 20 **active** customers matching name /
  place: `{ id, name, place }` only. No phone, no orders, no amounts.
- **Attendance:** server-side search route for the visit screen (the browser never sees the ticket); stores
  `customer_id` as a plain reference plus a copy of name / place, like `batch_id`. Order Capture off or not
  answering (3 s) → "Customer list unavailable, type the shop name".

### Notifications (N5+)
| Kind | Who | Text | Link | Dedupe | When | Level |
|---|---|---|---|---|---|---|
| `attendance_salary.field_not_ended` ❓ | owners | "Ravi's field day was not ended (started 9:12)" | `/staff/<id>/field/<date>` | `field_not_ended:<user>:<date>` | daily job 07:00 next morning | bell |

Nothing is sent on start / visit / end (a supervisor bell per visit would be noise; can be added later). Outbox and
`kit.retryOutbox` already exist in Attendance.

### Not in this version
Route drawing / live tracking, a map inside the page, adding new customers to Order Capture from the field, linking a
visit to an order, any change to claims, TA / DA or salary.

---

## Database (shown to the owner before it runs)

### Platform: none
`LOOKUPS` is code in `packages/types`; the ticket is signed with the existing key. No platform migration.

### Module `0008_field_day.sql` (Attendance)
- `field_events`: `tenant_id`, `user_id`, `user_name`, `on_date` (India date of the day's start), `kind`
  (`start` / `visit` / `end`), `lat` / `lng` numeric(9,6), `accuracy_m`, `place_text` (≤ 100), `km_tenths` (start /
  end only, 0–9,999,999.9), `customer_id` (uuid, plain reference), `customer_name` / `customer_place` (copies),
  `note` (meeting notes on a visit, ≤ 300), `reason` (required on a second start / end of the same day), `created_by`, `created_by_name`,
  `created_at`. Checks: start / end have km + a photo row; a visit has a customer name; lat and lng both or neither.
- `field_event_files`: the meter photo (same columns as `salary_claim_files`: storage key unique, sha256, size).
- `field_event_cancels`: a visit removed, with reason (≥ 3), who, when; once per visit.
- All three: `tenant_id` + FORCE RLS + `tenant_isolation`; **`attendance_app` SELECT + INSERT only**; no UPDATE, no
  DELETE. Existing tables unchanged. `backupNewFiles` gets the new file table.

---

## Phases

### Phase 0: Readiness (when F1 is live)
Re-check this plan against the code (F1 may have changed the person page / Today board); approve the mock-ups;
answer the ❓ points.

### Phase 1: Lookup ticket (platform, auth, Order Capture)
`LOOKUPS`, the platform endpoint, `fetchLookupTicket` / `verifyLookupRequest`, Order Capture's customers endpoint.
Tests: refused without credentials, for a pair not in `LOOKUPS`, when either module is off, for another plant's
customers; a lookup ticket refused as a login and as a summary request; expired ticket; no phone in the answer.

### Phase 2: Database + access (Attendance)
Migration `0008` (shown first), access rows, server functions for start / visit / end / correct / cancel.
Tests: isolation + FORCE RLS guard (table count), append-only refusals, the checks, not-ticked → 404, today only,
end < start refused, end after midnight closes the open day.

### Phase 3: Worker screens
`/my/field` with start / visit / end, photo, customer search with the typed fallback, corrections. Headless Chromium at
390 px.

### Phase 4: Owner / supervisor screens
Person page section, day page with map links and photos, Today board line, CSV, the claims card line (if confirmed),
support logging. Supervisor refused CSV and every write.

### Phase 5: Notification + release
`field_not_ended` in `NOTIFICATION_KINDS` and the daily job; backup route; NOTES.md, HANDBOOK "Attendance: field day",
CLAUDE.md status note; tag the release.

---

## Build prompts

### Shared header
Read CLAUDE.md, `docs/FIELD_DAY_PHASE_PLAN.md` and `apps/attendance-salary/NOTES.md`. Build only the phase named. Ask
before any schema, permission or token change not written in this plan. Tests with each change; typecheck and build
must pass. Add a dated note to `apps/attendance-salary/NOTES.md` at the end of the phase. Commit on `main` and push;
never push `production`.

### Phase 1 prompt
"Shared header. Phase 1 of FIELD_DAY_PHASE_PLAN: the lookup ticket (platform endpoint + `LOOKUPS`, `packages/auth`
helpers, Order Capture `/api/plantops/customers`), with the tests listed."

### Phase 2 prompt
"Shared header. Phase 2: show me migration `0008_field_day.sql` first, then the access rows and server functions, with
the tests listed."

### Phase 3 prompt
"Shared header. Phase 3: the worker's `/my/field` screen as in the approved mock-up; check it at 390 px."

### Phase 4 prompt
"Shared header. Phase 4: owner and supervisor screens, CSV, support logging; check at 390 and 1280 px."

### Phase 5 prompt
"Shared header. Phase 5: the `field_not_ended` notification, backup of the new photos, docs and the release."
