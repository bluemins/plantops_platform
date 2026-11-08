# Drop (customer app): Phase Plan and Build Prompts

Status: **approved by the owner (2026-11-08), decisions D1–D6 included. Phase 1 LIVE 2026-11-09 (v0.49.0); next = Phase 2
(owner, in a new session).** Every database change below is
**proposed**: each migration is shown to the owner before it runs. Background, the owner's decisions and the reasons:
`docs/CUSTOMER_APP_PLAN.md` (read sections 18–20 first). **Phase 1 mock-ups** (Drop card, add phone, make main,
Drop shops, app login): https://claude.ai/artifact/N3Mz1ucytpBxbJqbje8ypE. Earlier mock-up canvas:
https://claude.ai/artifact/AFWktvyoB2XEyXgihJXouQ (to be updated to this plan's screens before Phase 3).

## Purpose

Drop is an Android app (Capacitor, Play Store) for **Bluemins shops**. It gives a shop reasons to open it that it does
not get today, without exposing prices or buying history to competitors (decision 18.3):
- its **current order** (products and boxes, status; no rates, no amounts)
- its **due per brand** (Bluemins now; Mr.Charge when ticked)
- its **box totals** (this month, last month, this year vs last; Bluemins bottles only, decision 18.5)
- **product information** and **quality certificates** to show its own buyers
- **support**: report an issue or make a suggestion and see the replies
- **announcements** and a **marketing kit** (posters + WhatsApp texts to share)

The staff side stays the PlantOps web app. Drop gets data only through a narrow **customer API inside Sales** (Order
Capture); never the database, the plant login or the SSO token.

## Names used in this plan

| Name | Meaning |
|---|---|
| Sales | The module `order_capture` (`apps/order-capture`, `orders.bluemins.life`), shown as "Sales" since v0.43.1 |
| Drop | The customer app, `apps/drop`, package `life.bluemins.drop` |
| Shop | A Sales customer (`order_capture.customers`) switched on for Drop |
| Main phone | The customer's mobile in Sales (`customers.phone`) |
| Extra phone | Another phone that logs in to the same shop (decision 20.4) |
| Customer API | `https://orders.bluemins.life/api/app/v1/…`, outside the staff login proxy, like the bot API |
| Share key | A narrow server-to-server key from Sales to Document Store / Complaint Box (decision D1) |
| Bluemins bottles | Products counted in box totals: Zoho "1L / 500ml / 250ml Water Bottle", PlantOps "Bluemins 1L / 500ml / 250ml Water Bottle" (plan 20) |

## Agreed design (owner, 2026-11-07 / 08)

### Who can use Drop
- Only shops the owner switches on: **"Can use Drop"** on the customer's page in Sales (owner only, audited). Pilot
  with 10–20 shops, then everyone (decision 20.2).
- **Brands shown in Drop:** Bluemins always; Mr.Charge (and Hemex, any later brand) ticked per shop by the owner
  (decision 18.4). Brands come from the Rates brand tags, never from code.
- **Extra phones** see exactly what the main phone sees. Owner and Order desk add or remove them on the customer's page;
  a phone belongs to one shop only (no clash with any customer's main phone or another extra phone). **"Make main
  phone"** is owner-only and audited: it swaps the two numbers using the existing owner Edit of the mobile (with a
  reason, v0.45.0) (decision 20.4).
- Switching a shop off, removing an extra phone or disabling the customer ends their sessions at the next request.

### Login (phone + WhatsApp code)
1. The app asks for the phone number. The server answers **the same message for every number**: "If this number can
   use Drop, a code is on its way on WhatsApp." A code is sent **only** to a main or extra phone of a switched-on,
   active shop (decision D2: nobody can find out which numbers are Bluemins customers; no WhatsApp charge for others).
   The screen also says "No code? Ask Bluemins to switch on Drop for you" with the support phone.
2. Code: 6 digits, **10 minutes**, single use, stored only as an HMAC (secret `DROP_CODE_SECRET`), sent with the
   approved template `drop_login_code_v1` (`HX701c5de329b39705cfa1c152c931c4b7`) through the plant's existing Twilio
   sender (`login_content_sid` in its `TWILIO_WHATSAPP_SENDERS` entry).
3. Limits: per phone 3 codes per 15 minutes and 10 per day (counted from the database, so they survive restarts);
   5 wrong tries end a code; per connection 20 starts per hour.
4. The right code gives a **session token** (random, shown once to the app, stored as SHA-256), valid **90 days**,
   kept on the phone in secure storage. Log out ends it on the server.
5. **Which plant:** the app sends its app id (`drop`, not a secret); Sales maps it to one plant with the variable
   `DROP_APPS` (`{"drop": "<tenant id of plant 001>"}`). The plant never comes from the phone's request. A broken
   `DROP_APPS` turns the customer API off, shown under `/health` warnings (config rule, STABILITY_PLAN 6.5).

### Home (what a shop sees)
```
┌──────────────────────────────┐
│ Drop            Shree Stores │
│                              │
│ Your order                   │
│  Order received · 8 Nov      │
│  1L × 20 box · 500ml × 10 box│
│  + 1 box free                │
│                              │
│ Due (Bluemins)   ₹12,450     │
│                              │
│ Boxes you bought             │
│  This month   120 (1L 80 ·   │
│               500ml 40)      │
│  Last month    95            │
│  This year  1,050  (870 last)│
│                              │
│ News: New 250ml pack …     › │
├──────────────────────────────┤
│ Home  Products  Share  Help  │
└──────────────────────────────┘
```
- **Your order:** orders that are **pending** ("Order received", date) or **delivered today** ("Delivered 10:42"),
  only lines of brands shown to this shop. Products and boxes (free boxes as "+ N free"), never rates, amounts, notes,
  history or who did what. Nothing pending or delivered today: "No order on the way. Call or WhatsApp to order."
- **Due, per brand** (decision D3, owner 2026-11-08): only for the brands shown to the shop (Bluemins now; e.g.
  "Bluemins ₹8,200 · Mr.Charge ₹4,250" once Mr.Charge is ticked). Worked out from the same unpaid bills the customer's
  account page uses (PlantOps bills + linked Zoho contacts): each unpaid bill's due is split by **the brand's share of
  that bill's line values** (a bill with only Bluemins lines is all Bluemins). Zoho lines get their brand from the plan
  20 names; a line with no brand (20 L, empties, connection) goes to "Other", never shown. An advance not yet used on
  a bill is not shown. "Nothing due" at zero. Pure rule in `src/lib/brand-due.ts`.
- **Boxes you bought:** only for a shop with a delivered Bluemins-bottle order or bill in the last 12 months (decision
  20.3). Counted when the app asks, never stored: non-cancelled bills (Zoho up to 5 Nov 2026 + PlantOps), plus
  delivered orders without a bill, each box once; Bluemins bottles only (plan 20 list); **free boxes not counted**
  (decision D4, owner 2026-11-08: only boxes the shop bought). Worked out **per brand** so Mr.Charge totals can be
  shown later the same way; only Bluemins is shown now (decision 18.5). Months and years are India dates; the year is April–March.
- **News:** the newest announcement, link to all.

### Products tab
- One card per product the shop may see (active PlantOps products of its brands that have app text): photo, name, pack
  ("1 L × 12"), the owner's text (details, storage and handling, common questions). **No price.**
- **Quality** section: certificates the owner ticked "Show in Drop" in Document Store and that have not expired (name,
  issued by, valid until, "View"). The file comes through Sales; the app never talks to Document Store.

### Share tab (marketing kit)
- Posters / photos with a ready WhatsApp text; **Share** opens the phone's share sheet (WhatsApp, status, etc.). Items
  per brand; a shop sees only its brands.

### Help tab
- Call / WhatsApp buttons with the support phone and hours (Business details).
- **Report an issue** (what's wrong: product / delivery / other, text, up to 3 photos) or **Send a suggestion** (text).
  Each becomes a Complaint Box complaint (source "Drop", the shop's name, phone and place).
- **My issues:** the shop's complaints from Drop and from staff for its phone numbers: reference, date, status (Open /
  In progress / Resolved), and the **replies to the customer** (a new staff text). Staff notes, photos added by staff,
  names of staff and history never leave Complaint Box.

### Announcements
- Owner writes title + text (+ optional photo), chooses brands (or all), publishes. Shown in News; a push goes to every
  switched-on shop of those brands, in batches of 200 a minute (plan 16.1 rule 1). Owner can hide one later.

### Owner screens in Sales
- **Customer page → "Drop" card** (owner; Order desk sees it read-only, can add / remove extra phones): Can use Drop
  switch, brands shown, main phone, extra phones (+ Add / Remove / Make main phone), last login, "Ended sessions".
- **Customers → "Drop shops"** list: switched-on shops, last login, phones; filter by brand. Owner only.
- **"Drop content"** page (owner): Products text, Announcements, Share kit; each with preview "as the shop sees it".
- **Document Store:** "Show in Drop" tick on a document (owner).
- **Complaint Box:** "Reply to customer" box on a complaint (owner + Complaint desk); the reply is shown in Drop and
  can't be changed (a new reply corrects it).

### Notifications
**To shops (push via Firebase, new):**

| Event | Text | When | Dedupe |
|---|---|---|---|
| Order received | "Order received: 1L × 20 box, 500ml × 10 box" | a pending order is saved for the shop (any source) | order id |
| Order delivered | "Delivered: 1L × 20 box …" | Mark delivered | order id |
| Reply to your issue | "Reply on C-0123: …" (first 80 characters) | a reply to customer is saved | reply id |
| Announcement | title | owner publishes | announcement id |

Never: amounts, bills, payments, staff names. A shop with no phone token gets nothing; push failures are retried
through an outbox and dropped after 3 days.

**To staff (existing bell / push, N5+ rule):**

| Kind | Who | Level | When |
|---|---|---|---|
| `complaint_box.new` (existing) | as today | push | an issue from Drop (title says "from Drop") |
| `complaint_box.suggestion` (new) | owners + ticked Complaint desk | bell | a suggestion from Drop |
| `order_capture.drop_push_failed` (new) | owners | bell | Firebase refuses every send for an hour (wrong key, project off) |

### Audit and Recent changes
Switch on / off, brands, extra phones, make main phone, content published / hidden, "Show in Drop" tick: audit rows,
shown in Recent changes. Logins and code requests: audit rows `drop.*` kept out of Recent changes (like `bot.*`).

### Support view (PlantOps support)
The Drop card, Drop shops and Drop content are visible read-only in the support view, page views logged.

### Not in the first version
Ordering, payments, loyalty points, rewards, shop profile, public directory, 20 L customers, Odia / Hindi screens
(every text kept in one file so Odia follows), iPhone.

## Decided before building

From `docs/CUSTOMER_APP_PLAN.md` (owner): 18.3 current order only; 18.4 Bluemins first, other brands per shop; 18.5
box totals; 20.1 full first set; 20.2 owner switches shops on; 20.3 box totals = bought in the last 12 months; 20.4
extra phones; Hemex separate brand (2026-11-08).

**New in this plan, all approved by the owner (2026-11-08):**
- ✅ **D1. How Sales reads certificates and creates complaints:** a narrow **share key** per plant from Sales to Document
  Store (`DOC_SHARE_KEYS`) and Complaint Box (`COMPLAINT_SHARE_KEYS`), checked by SHA-256 like the bot key, plant
  bound to the key, only the endpoints listed below. *Recommended:* the pattern already used for the WhatsApp bot; no
  platform or SSO change. (Alternative: the platform signs module-to-module tokens: more general, but touches the
  platform's token family and is more work.)
- ✅ **D2. Same login answer for every number** (no "not a customer" message). *Recommended:* nobody can test which
  numbers are customers; costs nothing.
- ✅ **D3. Due per brand** (owner, 2026-11-08): "track it brand-wise; for now Bluemins; later the shop may take
  Mr.Charge". Rule in "Home" (split of each unpaid bill by brand line value; unused advance not shown). Split rule for bills with two brands **approved** (owner, 2026-11-08).
- ✅ **D4. Free boxes not counted** in box totals (owner, 2026-11-08). The current order still shows "+ N free".
- ✅ **D5. Files for Drop content** (product photos, posters): a **volume at `/data` on `order-capture`** with the nightly
  encrypted file backup, like Attendance and Job applications. *Recommended:* no new service; a few hundred MB at most.
- ✅ **D6. The app lives in the repo as `apps/drop`** (built into an Android app on this computer, never deployed to
  Railway); starts from the demo `~/projects/book-it-demo`. *Recommended:* shares `packages/types` and the same tests
  and review.

## Database (proposed; each migration shown to the owner before it runs)

All new tables: `tenant_id`, the `tenant_isolation` policy, FORCE RLS; `order_app` SELECT + INSERT, UPDATE only where
listed; no DELETE anywhere. No existing table changes except where listed.

**Sales `0012_drop_access.sql` (Phase 1):**
- `app_access_changes` (history, newest row wins): `customer_id`, `enabled` bool, `brands` text[] (besides Bluemins),
  `changed_by`, `changed_by_name`, `created_at`.
- `app_phone_changes` (history): `customer_id`, `phone` (normalised mobile), `action` (`add` / `remove`), `changed_by`,
  `changed_by_name`, `created_at`. An extra phone is active when its newest row is `add`.
- `app_login_codes`: `phone`, `customer_id`, `code_hmac`, `expires_at`, `attempts`, `used_at`, `created_at`, `ip_hash`.
  UPDATE on (`attempts`, `used_at`) only.
- `app_sessions`: `customer_id`, `phone`, `token_sha256` (unique), `created_at`, `expires_at`, `last_seen_at`,
  `ended_at`, `end_reason`. UPDATE on (`last_seen_at`, `ended_at`, `end_reason`) only.

**Sales `0013_drop_content.sql` (Phase 4):**
- `app_content`: `kind` (`product` / `announcement` / `kit`), `sku_id` (product only), `brands` text[], `title`,
  `body` (≤ 2,000), `share_text` (kit, ≤ 1,000), `published_at`, `hidden_at`, `created_by`, `updated_by`,
  `updated_at`. UPDATE on the text columns, `brands`, `hidden_at`, `updated_*` (audited; it is content, not a ledger).
- `app_files`: `content_id`, `storage_key` (unique), `mime`, `bytes`, `sha256`, `width`, `height`, `created_at`.

**Sales `0014_drop_push.sql` (Phase 6):**
- `app_devices`: `session_id`, `fcm_token`, `created_at`, `removed_at`, `remove_reason`. UPDATE on (`removed_at`,
  `remove_reason`).
- `app_push_outbox`: `device_id`, `kind`, `dedupe_key`, `title`, `body`, `link`, `tries`, `next_try_at`, `sent_at`,
  `gave_up_at`; unique (`device_id`, `dedupe_key`). UPDATE on the retry columns. `app_push_tenants()` (plant ids only).

**Document Store `0003_show_in_app.sql` (Phase 4):** `documents.show_in_app` boolean default false + UPDATE on that
column.

**Complaint Box `0002_drop.sql` (Phase 5):** `complaints.source` (`staff` default / `drop`), `complaints.kind`
(`issue` default / `suggestion`); `complaint_events.kind` also allows `customer_reply` (text required, append-only).

Platform: **no migration, no SSO change.** `packages/types`: the two new notification kinds
(`complaint_box.suggestion`, `order_capture.drop_push_failed`).

## Phases

| Phase | What | Release |
|---|---|---|
| 0 | Accounts, template, Firebase, decisions | done 2026-11-08 (D-U-N-S pending) |
| 1 | Sales: Drop switch, phones, login | Sales v0.49.0, **live 2026-11-09** (`2e21f24`) |
| 2 | Sales: customer API for Home | v0.49.0 |
| 3 | Drop app: login, Home, Help (call / WhatsApp) | Drop 0.1 (test app on the owner's phone) |
| 4 | Content: products, certificates, announcements, share kit | Sales v0.50.0, Document Store, Drop 0.2 |
| 5 | Support: issues, suggestions, replies | Sales + Complaint Box v0.51.0, Drop 0.3 |
| 6 | Push notifications | Sales v0.52.0, Drop 0.4 |
| 7 | Privacy policy, Play Store, load test, pilot | Drop 1.0 |

Each phase ends with tests passing, typecheck and `next build` of every touched app, a dated note in the module's
NOTES.md, and the owner's OK. Phases 1–2 can go live before the app exists (nothing calls the API yet; the Drop card
lets the owner prepare the pilot shops).

### Phase 0: Accounts, template, Firebase, decisions (done 2026-11-08)
D-U-N-S requested (ref DR110820263662512338; Play Console sign-up when it arrives, organisation "PureVibe
Enterprises"); `drop_login_code_v1` approved; Firebase `drop-purevibe` with `life.bluemins.drop`; decisions 20.1–20.4
and the Bluemins bottle list. **Owner's content to gather before Phase 4:** product texts and photos, which
certificates to show, 3–5 posters with WhatsApp texts, the first announcement, 10–20 pilot shops.

### Phase 1: Sales: Drop switch, phones, login
**Done 2026-11-09:** built as planned (notes: `apps/order-capture/NOTES.md` v0.49.0), live as v0.49.0. Changes from
the plan: the Drop card also has its own page `/customers/[id]/drop` for Order desk (the customer page shows money);
the plant's main brand is in `DROP_APPS` (`{"drop": {"tenant_id", "brand"}}`), not in code; the Zoho match needed no
change. Live settings on `order-capture`: `DROP_APPS` (`drop` → plant 001, Bluemins), `DROP_CODE_SECRET` (owner's password
manager), `login_content_sid` in `TWILIO_WHATSAPP_SENDERS`. Plant 001's brands set on Rates by the owner (2026-11-09):
Bluemins (1L / 500ml / 250ml bottles), Mr.Charge, Hemex, **Bluemins 20L** (20 L jar + connection; kept apart from
"Bluemins" so the thank-you stays bottles only), empties no brand. No shop switched on yet (app in Phase 3).
- Migration `0012_drop_access.sql` (show first; dev + test).
- `src/server/drop/access.ts`: the shop's current switch, brands and phones; "phone belongs to one shop" check across
  main and extra phones (the bot, Calls and login find the shop by either).
- Customer page **Drop card** + `POST /api/customers/:id/drop` (switch, brands; owner), `…/drop/phones` (add / remove;
  owner + Order desk), "Make main phone" (owner; one transaction with the existing mobile Edit and its reason).
  `access.ts` rows `drop_manage`, `drop_phones`.
- Customers → **Drop shops** list (owner).
- Login API: `POST /api/app/v1/login/start` `{ app, phone }` and `/login/verify` `{ app, phone, code }`, `/logout`;
  `DROP_APPS`, `DROP_CODE_SECRET`, `login_content_sid` parsing with `/health` warnings; sending through the existing
  Twilio code (`thanks.ts`), never blocking the answer longer than the Twilio call.
- `appSession(req)` helper: token → session → shop still switched on, active and the phone still one of its phones;
  else 401 `session_ended`. `last_seen_at` written at most once an hour.
- Bot and Calls: an extra phone finds its shop like the main phone (one helper, `customerByPhone`).
- Tests: tenant isolation (plant A's token never reads plant B; FORCE RLS guard counts the new tables); same answer for
  known / unknown / switched-off numbers and no code sent for the last two; code expiry, single use, 5 wrong tries,
  limits per phone (from the database) and per connection; switched off / phone removed / customer disabled → 401;
  logout; 90-day expiry; extra phone clash with another shop's main or extra phone refused; Make main phone keeps the
  audit trail; Order desk can add phones but not switch on; support read-only; append-only refusals for `order_app`.

### Phase 2: Sales: customer API for Home
- `GET /api/app/v1/home` → `{ shop: { name }, order: [...] | null, dues: [{ brand, paise }], boxes: { brand: {...} } | null,
  support: { phone, hours }, news: {...} | null }`, built in `src/server/drop/home.ts`; box totals rules in a pure
  `src/lib/box-totals.ts` (Bluemins-bottle match by brand tag or the Zoho names in plan 20).
- Every answer built from an allow-list of fields (never a staff object passed through); `Cache-Control: no-store`.
- Limits per session and per connection; errors in the bot's shape `{ error: { code, message } }`.
- Tests: the worked example in "Home" (pending + delivered today, free box, other brand's lines hidden, cancelled
  hidden); no rates / amounts (other than the brand dues) / notes anywhere in the JSON (checked by searching the
  answer); brand dues add up to the account page's due when every brand is shown (mixed Zoho + PlantOps customer, a
  two-brand bill part-paid, a 20 L line in "Other"); only ticked brands' dues sent; box totals against a hand-worked
  month incl. a Zoho bill, a PlantOps bill, a delivered unbilled order, a cancelled bill, a free line (not counted), a
  Mr.Charge and a Hemex line, a 20 L line; the 12-month rule; India
  month / year boundaries; plant 001's real total checked by hand once against the owner's 8 Nov list.

### Phase 3: Drop app: login, Home, Help
- `apps/drop` from the demo: Capacitor 8 + React 19 + Tailwind 4 + Vite; package `life.bluemins.drop`, name "Drop";
  all texts in `src/text/en.ts`; brand colour and logo from the API (no Bluemins look hard-coded).
- Screens: phone → code (with Copy-code paste and a resend after 60 s) → Home; Help with call / WhatsApp; Products and
  Share tabs show "Coming soon" until Phase 4. Pull to refresh; "No internet" screen; session in Capacitor secure
  storage; 401 `session_ended` → back to login.
- API address from the build (`DROP_API_URL`); a test build against the live copy for the owner's phone; debug-signed
  APK installed directly (Play comes in Phase 7).
- Tests: unit tests for formatting (₹, boxes, India dates) and the screens' states (Vitest + Testing Library); the
  phase's check is the owner's phone.
- Mock-up canvas updated to these screens before building (owner's OK on the look).

### Phase 4: Content: products, certificates, announcements, share kit
- **To design properly before building (owner, 2026-11-09: "a proper infra to push the content to the Drop app, brand
  wise").** The brand filter above is only the base. Plan this phase in plan mode with mock-ups, covering: (1) draft →
  preview → publish, with optional start / end dates (offers that end by themselves); (2) targeting beyond brand:
  customer type, area, or hand-picked shops; (3) a per-brand look on the app's cards (logo, colour); (4) who writes
  content: owner only, or a content role (e.g. Marketing staff) with the owner publishing; (5) simple numbers per item:
  opened, shared, tapped. Choices in (2) and (3) may shape Phase 2's Home answer: check them when building Phase 2.
- Migrations Sales `0013_drop_content.sql` and Document Store `0003_show_in_app.sql` (show first).
- Volume `/data` on `order-capture` (D5), `ORDER_STORAGE_DIR`, files through `packages/module-kit` storage; photos
  shrunk on the owner's phone (`photo.ts`); nightly backup route `POST /api/cron/backup` + `backup.yml` step.
- Sales **Drop content** page (owner) with preview; announcements published to News.
- Document Store: "Show in Drop" tick (owner, audited); share-key endpoints `GET /api/share/v1/certificates` (unexpired,
  ticked, latest version: name, authority, expiry, file id) and `GET /api/share/v1/certificates/:id/file`. Sales caches
  the list 10 minutes and streams the file to the app.
- Customer API: `GET /api/app/v1/products`, `/news`, `/kit`, `/files/:id` (only files of content the shop may see).
- Drop 0.2: Products (+ Quality), Share (share sheet via `@capacitor/share`), News.
- Tests: brand filtering of every list; hidden content gone; expired or unticked certificate never listed or served;
  a file id of another plant / brand / hidden item refused; share key wrong / other plant (401 / 404); storage limits.

### Phase 5: Support: issues, suggestions, replies
- Migration Complaint Box `0002_drop.sql` (show first).
- Complaint Box share-key endpoints: `POST /api/share/v1/complaints` (issue or suggestion from a shop: name, phone,
  place, kind, item group, text, ≤ 3 photos) and `GET /api/share/v1/complaints?phones=…` (reference, date, status,
  customer replies only). "Reply to customer" box on the complaint page (owner + Complaint desk); "from Drop" tag in the
  inbox.
- Sales: `POST /api/app/v1/issues`, `GET /api/app/v1/issues` (passes through with the shop's phones). An issue raises
  Complaint Box's existing new-complaint alert; a suggestion raises the new bell-only `complaint_box.suggestion`.
- Drop 0.3: Help → Report an issue / Send a suggestion / My issues.
- Tests: a shop sees only complaints of its own phones; staff notes, staff photos, staff names never in the answer; reply
  is append-only; limits (5 issues a day per shop); photos checked by content; share key isolation.

### Phase 6: Push notifications
- Migration Sales `0014_drop_push.sql` (show first).
- Firebase service-account key made by the owner (allow key creation for project `drop-purevibe` only, if the
  organisation blocks it), pasted straight into `FCM_SERVICE_ACCOUNT` on `order-capture`; FCM HTTP v1 sender in
  `src/server/drop/push.ts` (OAuth token signed with Node's crypto, no SDK); 404 / UNREGISTERED removes the device.
- Events in "Notifications" (orders from `orders.ts` / `handling.ts` after the answer, replies found by Sales asking Complaint Box
  for new customer replies every 5 minutes through the share key, so no key is needed in the other direction); announcements in batches of 200 a minute
  from the outbox job; `drop_push_failed` alert.
- Drop 0.4: `@capacitor/push-notifications`, `google-services.json`, permission asked after the first login, tap opens
  the right tab.
- Tests: each event to the right shop's devices only, other brands' orders don't push, dedupe, batching, outbox retry
  and give-up, removed devices, logout removes the device.

### Phase 7: Privacy policy, Play Store, load test, pilot
- **Privacy policy** page on `bluemins.life` (what Drop stores: phone, shop, sessions, device token; no location, no
  contacts; how to delete: ask Bluemins) and the Play **Data safety** form; a "Delete my Drop login" request path.
- Play Console (organisation account after the D-U-N-S number): app listing (name Drop, screenshots, short text),
  **Play App Signing**; the upload key kept in the password manager and an encrypted copy off this computer (losing it
  blocks updates); internal test → closed test with the pilot shops → production.
- One-tap code template `drop_login_code_v2` once the signing key's hash is known (Copy code stays as fallback).
- Load test on the local copy: 2,000 shops opening Home within 2 minutes while staff save orders (plan 16.1); uptime
  monitor on `orders.bluemins.life/health`; deploys after 21:00 IST from now on.
- Docs: `docs/HANDBOOK.md` "Drop: switching on a shop" and "Drop: content"; CLAUDE.md status note.
- **Pilot:** the owner switches on 10–20 shops, staff help them install and log in; after 2–4 weeks look at logins, repeat
  use, issues sent, calls about order status; then switch on everyone (or change course).

## Build prompts

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are building Drop, the customer app for Bluemins shops, with a narrow customer API inside Sales (Order Capture).
The agreed design is docs/CUSTOMER_APP_PHASE_PLAN.md; background and the owner's decisions are in
docs/CUSTOMER_APP_PLAN.md sections 18-20. Read both, CLAUDE.md and apps/order-capture/NOTES.md before anything else.
Reuse what exists: the bot API's key handling, limits and error shape (apps/order-capture/src/server/bot.ts), the one
access table (src/server/access.ts), the customer account's due (src/server/ledger.ts), Twilio sending
(src/server/thanks.ts), normalisePhone (packages/module-kit/src/phone.ts), module-kit storage and photo.ts. Apps
import shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change to
schema, permissions, tenant isolation, credentials, Twilio or the SSO token that is not already in the plan; the plant
comes from DROP_APPS / the share key / the session, never from the request; the customer API sends an allow-list of
fields only and never rates, amounts (except the brand dues), notes, history or staff names; enforce access on the
server; no secrets in code, docs or tests; give me any variable as its complete value and check the older features
that read it. Write tests with the feature (real Postgres test database). Explain each change in plain language; I am
not a full-time developer. At the end of the phase run the tests of every touched app, typecheck and next build, and
add a dated note to the module's NOTES.md. Don't commit until I say so.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 1 (Sales: Drop switch, phones, login) of docs/CUSTOMER_APP_PHASE_PLAN.md:
- Sales migration 0012_drop_access.sql exactly as in the plan's Database section (show it first; dev + test)
- the Drop card on the customer page, Drop shops list, extra phones and Make main phone, access rows
- the login API (start / verify / logout) with DROP_APPS, DROP_CODE_SECRET and login_content_sid, the same answer for
  every number, limits, 90-day sessions, appSession() and customerByPhone() for login, bot and Calls
Tests: as listed under Phase 1 in the plan. Then verify on pnpm dev with plant 002 (temporary customer and phones,
Twilio sending faked; all removed after).
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Build Phase 2 (Sales: customer API for Home) of docs/CUSTOMER_APP_PHASE_PLAN.md: GET /api/app/v1/home with the current
order, due per brand (pure src/lib/brand-due.ts), box totals (pure src/lib/box-totals.ts), support and news, from an allow-list of fields.
Tests: as listed under Phase 2, incl. the worked month and the "no amounts in the JSON" check. Then verify on pnpm dev
with curl and a test session; read-only check of plant 001's box totals for two shops against the owner's 8 Nov list.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Build Phase 3 (Drop app: login, Home, Help) of docs/CUSTOMER_APP_PHASE_PLAN.md in apps/drop, starting from
~/projects/book-it-demo (copy, don't move), Capacitor + React + Tailwind + Vite, package life.bluemins.drop, texts in
src/text/en.ts. First update the mock-up canvas to the plan's screens and wait for my OK on the look. Build a debug APK
against the live copy for my phone and give me install steps.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Build Phase 4 (Content) of docs/CUSTOMER_APP_PHASE_PLAN.md: migrations Sales 0013 and Document Store 0003 (show first),
storage on order-capture with backup, the Drop content page, Document Store's Show in Drop tick and share-key
endpoints, the customer API lists and files, Drop 0.2 screens. Tests: as listed under Phase 4.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Build Phase 5 (Support) of docs/CUSTOMER_APP_PHASE_PLAN.md: Complaint Box migration 0002 (show first), its share-key
endpoints and Reply to customer, Sales' issues API, Drop 0.3 Help screens. Tests: as listed under Phase 5.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Build Phase 6 (Push notifications) of docs/CUSTOMER_APP_PHASE_PLAN.md: Sales migration 0014 (show first), the FCM v1
sender without an SDK, the four shop events through the outbox, batches of 200 a minute, drop_push_failed, Drop 0.4
with push. Walk me through making the Firebase key and putting it straight into Railway. Tests: as listed under Phase 6.
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/CUSTOMER_APP_PHASE_PLAN.md and follow it for this session.

Do Phase 7 (Privacy policy, Play Store, load test, pilot) of docs/CUSTOMER_APP_PHASE_PLAN.md: draft the privacy policy
and Data safety answers for my OK, then give me the Play Console steps one at a time and wait for each; run the load
test; set up the uptime monitor; HANDBOOK sections; the pilot checklist.
```
