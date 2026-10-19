# View-only roles: Stock viewer, Document viewer, Order viewer (v0.27.0)

Asked by the owner 2026-10-19: "Staff who only needs to view the floor stock - what role should I assign?" There was
none: Store keeper also counts and adds items. The same gap was in Document Store, and Order Capture's view (no
amounts) came only with Plant staff (= every employee).

## Decisions (owner, 2026-10-19)
- A **separate view-only role per module**, given on Manage users like any role (not Plant staff, which would show the
  stock to every employee).
- Modules: **Floor Stock** (Stock viewer), **Document Store** (Document viewer), **Order Capture** (Order viewer, the
  same view as Plant staff today: orders without amounts). Not Lab Records or Complaint Box for now; not Attendance
  (Supervisor already exists, and workers must never see each other's attendance).
- **Alerts only if the owner ticks them** ("Gets alerts" on Manage users), like any other person. Order viewers can't be
  ticked: the new-order alert carries the amount.
- **Stock viewers see only the sections the owner marks for them, per person.** Their alerts list only items in their
  sections.
- **"Can make"** is shown to a Stock viewer for a product only when every section its recipe uses is marked for them
  (the product's own section, its materials' sections, and what those are "made from").

## Design
- **One rule in `packages/types`:** `VIEW_ROLE_MODULE` (role → its one module). These roles are **not** in
  `ROLE_MODULE`, so `roleWorksIn` stays false: never staff, never responsible for a document, never counted as working
  there. `viewOnlyIn()` now also returns true for the module's view role (and still for Plant staff in Order Capture);
  `canAccessModule`, the launcher and Order Capture's `whoFor` pick it up unchanged. `getsAlertsIn()` = works there, or
  the module's view role where `VIEWER_ALERTS` allows (Floor Stock, Document Store).
- **Platform:** migration `0018_view_roles.sql` (three role rows, no grant change); role labels and hints; the
  Permissions screen shows "View only, chosen sections" / "View only" / "View only, no amounts" (🔔 when ticked);
  "Gets alerts" and the send-time check use `getsAlertsIn`; `alert-contacts` also lists a module's viewers (Floor Stock
  needs them for its owner screen); the launcher tile asks for the new `"viewer"` summary view (modules that don't know
  it treat it as `staff`).
- **Two new notification fields** (`NotificationInput`): `no_viewers` (leave out people whose only link is the view
  role) and `if_ticked` (each `also_user_ids` person must be ticked and allowed the module's alerts). The platform
  still decides; a module can't reach anyone else.
- **Floor Stock:** migration `0005_viewer_sections.sql` (`viewer_sections`: tenant, viewer, section, on / off; FORCE RLS;
  SELECT + INSERT + UPDATE of the status columns only, no DELETE). `src/server/viewers.ts`: `visibleSections()` is used
  by the day page, item history, the item list and "Can make" (all on the server). The owner picks sections on
  Sections & items → **Who sees what** (audited, in Recent changes). Viewers never open the count, Sections & items,
  Recent changes, CSV or Support access. Count alerts go out once with `no_viewers`, then one version per viewer with
  marked sections (`if_ticked`, dedupe key `count:<date>:v<n>:<viewer>`); "setup changed" leaves viewers out; "count
  not done" goes to ticked viewers as it is. Tile: only "Counted 6:40 pm" / "Today's count not done".
- **Document Store:** no schema change. A Document viewer reads documents and opens files; every write already needs
  `requireManage`, the CSV / ZIP stay owner-only, and the responsible-person list keeps `roleWorksIn`. Header "View
  only". Reminders: a responsible person counts as active only while owner / document keeper.
- **Order Capture:** no change; tests for `order_viewer`.
- **SSO token unchanged.**

## Status
Built and **live** 2026-10-19 (v0.27.0, `production` = `3d15b82`; migrations platform `0018`, Floor Stock `0005`
applied first). Record: `docs/deployments/shared.md`.

Owner's checklist after deploying (plant 001):
1. Manage users → give someone **Stock viewer** (and tick "Gets Floor Stock alerts" if they should get alerts).
2. Floor Stock → Sections & items → **Who sees what** → tick their sections.
3. Log in as them on a phone: they land straight in Floor Stock, see only those sections, no Enter count button.
4. After the next count, check their bell lists only their items.
5. Document viewer: opens a document and its file; no Add / Renew / Archive buttons.
