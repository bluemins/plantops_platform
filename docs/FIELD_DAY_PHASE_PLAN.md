# Field day log (Attendance & Salary): Phase Plan and Build Prompts

**Status:** Asked by the owner on 2026-10-19; four answers given the same day (below). **Plan only.** To be built
**after F1** (weekly offs, holidays, leave; `docs/STABILITY_PLAN.md` section 10), as feature **F1b**. Release number
set when the build starts. Mock-ups to be approved before Phase 1.

**Mock-ups (2026-10-19, not yet approved):** https://claude.ai/artifact/EutRdTDJaBw7tHpHLXcUCq
A1 before start · A2 Start my day · A3 during the round · A4 Shop visited (customer search + **meeting notes**,
added by the owner 2026-10-19) · A5 weak GPS / list unavailable · A6 End my day · A7 fixing a mistake · B1 Today
board "In the field" · B2 person page → Field days · B3 day page (map links, photos, meeting notes) · C1 claims card
line (❓) · C2 bell "not ended" · C3 no new setting (uses the Field staff tick).
**To add before approval:** A4 with phone search, the typed shop's phone and the "Save this location as the shop's
location" tick; an Order Capture customer row / order page with the 📍 Map link (owner's addition 2026-10-19).

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

**Added by the owner (2026-10-19):** at the shop, the field staff can **link the shop's Google location to the
customer** (found by name or phone number), so the location is kept on the customer in Order Capture for later
visits and deliveries. A shop not in the list gets its phone number typed on the visit. Design: "Shop location on the
customer" below. Its three open points were decided as proposed (owner, 2026-10-19): field staff may replace a saved
location (the old one stays on record); no saving when the fix is rougher than ±150 m; the delivery WhatsApp message
carries one map link per shop.

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
 Shop visited: location, customer search by name, place **or phone number** (from Order Capture) or "Not in the
 list: type the name" + **phone number** (optional, Indian mobile rule), **meeting notes** (optional, ≤ 300
 characters: what was discussed with the customer; owner 2026-10-19), tick box **"Save this location as the shop's
 location"** (owner 2026-10-19; see below), fixed once saved.
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
- **Phone search:** `q` of 6 or more digits (any spelling: "+91 98…", spaces) also matches the customer's phone,
  with the same phone rule as Order Capture's own search (`packages/module-kit/src/phone.ts`). The answer still has
  **no phone number**: the field staff types the number they already have, and only gets the name / place back.
- **Attendance:** server-side search route for the visit screen (the browser never sees the ticket); stores
  `customer_id` as a plain reference plus a copy of name / place, like `batch_id`. Order Capture off or not
  answering (3 s) → "Customer list unavailable, type the shop name".

### Shop location on the customer (owner, 2026-10-19)
The first time Attendance **writes** to another module, so it is its own scope with its own checks.
- **Visit screen:** when a customer is picked from the list, a tick box "Save this location as the shop's location".
  - Customer has no location yet → ticked by default.
  - Customer already has one → unticked, label "Replace the shop's location (saved 12 Oct by Ravi)". Field staff
    may replace it; the old one stays on record (owner, 2026-10-19).
  - Hidden when the fix is rougher than ±150 m ("Location too rough to save for the shop"): the visit is still
    saved with its rough location, but a wrong pin would mislead every later delivery (owner, 2026-10-19).
  - A typed shop (not in the list) can't save a location (there is no customer to save it on).
- **How it is sent:** after the visit is saved, Attendance's server asks the platform for a ticket with scope
  `customer_location` (a second pair in `LOOKUPS`: `attendance_salary → order_capture: customer_location`) and calls
  Order Capture `POST /api/plantops/customers/:id/location` `{ lat, lng, accuracy_m, set_by_user_id, set_by_name,
  visit_id }`. Order Capture checks the ticket, that the customer is its own plant's and active, and the numbers.
  The visit never waits on it: if Order Capture is off or not answering, the visit page says "Shop location not
  saved (customer list unavailable)" and a **"Try again"** button on that visit sends it again (same visit, so never
  saved twice: unique on `visit_id`). Nothing is queued silently.
- **Order Capture shows it** (everyone who already sees the customer: owner, Order desk, plant staff view, support):
  📍 **Map** link (`https://www.google.com/maps?q=<lat>,<lng>`) on the customer list, the order page and the
  Pending tab's "Copy as WhatsApp message" (one map link per shop, for the delivery driver; owner, 2026-10-19); "Shop location saved
  12 Oct by Ravi (field visit) ±18 m". Owner and Order desk can **clear** it with a reason (a wrong pin); clearing is
  a new row, never a delete. Recent changes lists every save / clear.
- **Customer CSV** (owner): Latitude, Longitude, "Location saved on".
- **No notification** for a saved location (bell noise); it appears in Order Capture's Recent changes.

### Notifications (N5+)
| Kind | Who | Text | Link | Dedupe | When | Level |
|---|---|---|---|---|---|---|
| `attendance_salary.field_not_ended` ❓ | owners | "Ravi's field day was not ended (started 9:12)" | `/staff/<id>/field/<date>` | `field_not_ended:<user>:<date>` | daily job 07:00 next morning | bell |

Nothing is sent on start / visit / end (a supervisor bell per visit would be noise; can be added later). Outbox and
`kit.retryOutbox` already exist in Attendance.

### Not in this version
Route drawing / live tracking, a map inside the page, adding new customers to Order Capture from the field (a typed
shop's name + phone stay on the visit; the owner can add it in Order Capture by hand), changing a customer's name,
place or phone from the field, linking a visit to an order, any change to claims, TA / DA or salary.

---

## Database (shown to the owner before it runs)

### Platform: none
`LOOKUPS` is code in `packages/types`; the ticket is signed with the existing key. No platform migration.

### Module `0005_customer_locations.sql` (Order Capture, owner 2026-10-19)
- `customer_locations`: `tenant_id`, `customer_id` (FK to `customers`), `kind` (`set` / `clear`), `lat` / `lng`
  numeric(9,6) (set only), `accuracy_m`, `source` (`field_visit` / `desk`), `visit_id` (uuid, plain reference to
  Attendance's visit; unique per plant when present, so a retry never saves twice), `reason` (required on clear,
  ≥ 3), `set_by`, `set_by_name`, `created_at`. The newest row counts; a `clear` hides the location.
- `tenant_id` + FORCE RLS + `tenant_isolation`; **`order_app` SELECT + INSERT only**. `customers` unchanged (a
  customer's phone stays fixed).

### Module `0008_field_day.sql` (Attendance)
- `field_events`: `tenant_id`, `user_id`, `user_name`, `on_date` (India date of the day's start), `kind`
  (`start` / `visit` / `end`), `lat` / `lng` numeric(9,6), `accuracy_m`, `place_text` (≤ 100), `km_tenths` (start /
  end only, 0–9,999,999.9), `customer_id` (uuid, plain reference), `customer_name` / `customer_place` (copies),
  `customer_phone` (typed shop only, optional, normalised Indian mobile), `save_location` (boolean, visit only: the
  tick; whether Order Capture took it is read from Order Capture, never stored twice),
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
`LOOKUPS` (both scopes), the platform endpoint, `fetchLookupTicket` / `verifyLookupRequest`, Order Capture's customers
endpoint (name / place / phone search), Order Capture migration `0005` (shown first), the location endpoint, the 📍 Map
link, clear with a reason, Recent changes and CSV columns.
Tests: refused without credentials, for a pair not in `LOOKUPS`, when either module is off, for another plant's
customers; a lookup ticket refused as a login and as a summary request; expired ticket; no phone in the answer (also
for a phone search); a `customers` ticket refused by the location endpoint and the other way round; location for an
inactive or other plant's customer refused; the same `visit_id` twice saves once; `order_app` UPDATE / DELETE on
`customer_locations` refused; clear needs a reason; plant staff see the Map link but can't clear.

### Phase 2: Database + access (Attendance)
Migration `0008` (shown first), access rows, server functions for start / visit / end / correct / cancel.
Tests: isolation + FORCE RLS guard (table count), append-only refusals, the checks, not-ticked → 404, today only,
end < start refused, end after midnight closes the open day.

### Phase 3: Worker screens
`/my/field` with start / visit / end, photo, customer search (name / place / phone) with the typed fallback + phone,
"Save this location as the shop's location" with "Try again", corrections. Headless Chromium at 390 px.

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
helpers, Order Capture `/api/plantops/customers`), then show me Order Capture migration `0005_customer_locations.sql`
before the location endpoint and the Map link, with the tests listed. Also add a dated note to
`apps/order-capture/NOTES.md`."

### Phase 2 prompt
"Shared header. Phase 2: show me migration `0008_field_day.sql` first, then the access rows and server functions, with
the tests listed."

### Phase 3 prompt
"Shared header. Phase 3: the worker's `/my/field` screen as in the approved mock-up; check it at 390 px."

### Phase 4 prompt
"Shared header. Phase 4: owner and supervisor screens, CSV, support logging; check at 390 and 1280 px."

### Phase 5 prompt
"Shared header. Phase 5: the `field_not_ended` notification, backup of the new photos, docs and the release."
