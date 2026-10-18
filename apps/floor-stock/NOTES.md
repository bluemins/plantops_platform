# Floor Stock – module notes

Phase 5 module (`apps/floor-stock`, port 3002). It replaces the staff's evening WhatsApp message: **today's
production** (finished goods) and the **closing stock** of everything in the plant, counted once at the end of
the day. Sales happen during the same day, so the stock figure is the closing count. Project rules live in the
root `CLAUDE.md`. Built on the shared module kit (`packages/module-kit`), like Lab Records and Document Store.

## Status (2026-10-11)
- **Live** on the shared copy at https://stock.bluemins.life since release **v0.6.0** (Railway service
  `floor-stock`, no volume; record in `docs/deployments/shared.md`). Runs **v0.11.0** ("Can make", 2026-10-11).
- **In real use** since 2026-10-11 (plant 001 Bluemins: daily counts, low-stock and corrected notifications).
- **"Can make" live since 2026-10-11** (migration `0004_recipes.sql` applied); plant 001 has Contents and Recipes set
  and the owner checked the result against a count.
- **Low-stock email not used** (owner, 2026-10-11): app notifications instead (see the Pending list).
- 146 tests pass (all apps' tests pass too).

## What it does
- **Sections & items** (`/setup`): each plant's own list; nothing is shared between plants.
  - A section is **finished goods** (its items are entered as today's production AND counted as closing stock) or
    **stock** (closing stock only). The kind can't be changed later.
  - An item has a name, a unit (free text: box, packet, bundle…), an optional **second number** (labels:
    bundle + count; returnables: good + damaged), an optional link to a platform product (`sku_id`), and an
    optional **limit**.
  - **Starter list** for a plant with no sections: Finished goods / Raw material / Consumable / Returnable items,
    with finished goods, empty bottles and labels made from that plant's own products (`src/lib/template.ts`).
  - Sections and items are switched off, never deleted.
- **Daily count** (`/count`): one per plant per day, for **today or yesterday** (India date).
  - Closing stock is pre-filled from the latest version of the last count; production starts empty.
  - Several lines per item, each with a remark (usually a party name); decimals allowed, no negatives.
  - Every active item needs a closing stock. Production may be left blank.
  - **Submit locks it.** A correction is a new version with a reason (≥ 3 characters), also only for today or
    yesterday. It holds the full sheet again; old versions stay viewable.
- **Views:**
  - Home: today's / yesterday's status and the items below their limit in the newest count.
  - Day page (`/day/<date>`): each item compared with **the day before only**. Finished goods show
    Sold = previous + production − closing ("check the count" when negative). Everything else shows
    Used = previous − closing, or "received (calculated)" when it rose. Also: "—, no count on <date>",
    "unit changed: not compared", old versions, and "Copy as WhatsApp message".
  - History by date (`/history`) and by item (`/items/<id>`, last 60 counts).
  - Recent changes (`/changes`): owner and support. Owner CSV (`/api/export`): every version, audited.
- **Low-stock email** (`src/server/alerts.ts`): queued in the count's transaction for every item below its limit
  (`closing < limit`), for every **owner**. Store keepers and plant staff are never emailed.
  - Once per item per day per owner (unique key in `low_stock_alerts`). A correction adds only newly low items.
  - An owner without an email address is recorded as `skipped`.
  - Sent right after the save (`after()`), one email per owner. The daily job (`POST /api/cron/daily`) sends
    anything still waiting.
  - Email not set up: stays `pending`. A failed send stays `pending` with the error, is retried daily, and is
    marked `failed` after 7 days.
- **Tile badges:** "Today's count not done" / "Counted 6:40 pm", "N items low" (from the newest count, against
  today's limits), "Made 120 box" (today's production by unit).
- **Support view:** read-only (proxy + server guards); every page view is logged on the owner's
  `/support-access` page.

## Owner notifications (v0.7.0, docs/notifications.md N1)
App notifications through the platform (launcher bell + phone), sent with `kit.notify` after the answer, so a slow
or unreachable platform never holds up or breaks a count. Texts in `src/server/notify.ts`.
- **One per saved count or correction** (`count:<date>:v<version>`): title by the most serious case: "Low stock:
  N items" (only items **newly** below their limit, the same once-per-item-per-day rule as the email) > "Check
  the count: N items" (Sold negative against the day before) > "Count corrected (vN)" > "Stock count saved".
- **Setup changed** by a store keeper / plant staff (add, edit, re-order items): **bell only**, one per action.
- **8 pm "Today's stock count is not done yet"** (`POST /api/cron/evening`, `.github/workflows/evening.yml`):
  plants from `floor_stock.counting_tenants()` (migration `0002`; plants with active items), skipped quietly
  when Floor Stock is switched off for the plant; `missing:<date>` so a second run adds nothing.
- Owners + people ticked for Floor Stock (N2), never for their own action.
- **Reminder hour** (N4): the owner picks 5 pm–11 pm or Off on Sections & items (`plant_settings`, migration `0003`;
  no row = 8 pm; audited as `setup.reminder`). `runEvening` runs hourly 5–11 pm and only reminds plants whose hour
  has come.
- **Outbox** (N4): a notification that can't reach the platform waits in `notification_outbox` and is resent by the
  daily and evening jobs (`kit.retryOutbox`).

## "Can make" (v0.11.0, docs/FLOOR_STOCK_CAN_MAKE_PLAN.md)
How many boxes of each finished product a count's stock is enough for, on the home page (newest count) and the day
page (the version shown). Worked out when the page opens (`src/lib/recipe.ts`), never stored.
- **Set by the owner only** on Sections & items (`src/server/recipes.ts`, `PUT /api/materials/<id>`,
  `PUT /api/recipes/<id>`), audited as `material.content` / `recipe.set` in Recent changes:
  - **Contents** (stock items): what 1 counted unit holds (pcs, g, kg, ml, L, m), a damage allowance %, and for an
    item with a second number "count = loose pieces" (only with pcs). No contents = the unit is single pieces.
  - **Recipe** (finished items): what 1 bottle needs of each material. Bottles per box = the linked product's
    `units_per_pack`; an item without a product uses `case_size` (blank = 1). If PlantOps products can't be loaded,
    bottles are shown and boxes are not.
- **Arithmetic:** on hand = closing × contents (+ loose pieces) × (1 − damage %); bottles = the smallest
  floor(on hand ÷ need) over the recipe; boxes = floor(bottles ÷ per box). Ties name every limiting material.
- **OR groups:** products sharing a material (directly or through another product) are shown together; each line is
  "up to" as if all of it went to that product, plus the shared material's total when every product needs the same
  amount. Numbers are never added up.
- **Rules:** recipe amounts must be the same kind of measure as the material's contents (weight with weight); a
  contents change that would break a recipe is refused ("change that recipe first"). Amounts have at most 2
  decimals (use g, not kg, for small amounts). A material switched off and not counted → "Can't work out: … not
  counted". Nothing shows until the plant has at least one recipe.
- **Database** (migration `0004_recipes.sql`): new tables `material_contents`, `recipes`, `recipe_lines`, all with
  `tenant_id` + FORCE RLS; `stock_app` SELECT / INSERT / column UPDATE, no DELETE (a recipe line taken out is
  switched off). No existing table was changed.
- **Made from** (v0.19.0, asked by the owner 2026-10-16: empty bottles are blown from preform): the owner gives a
  stock item counted in pieces a "Made from" on Sections & items (1 BM 1L Empty Bottle = 18.5 g Preform 18.5). It
  is stored as a recipe on that stock item (no database change) and audited as `recipe.set` with `made_from: true`
  ("BM 1L Empty Bottle made from (1 pcs): …").
  - Its stock in "Can make" = pieces counted + pieces its materials can still make; only those materials' damage
    allowance counts (owner, 2026-10-16). The product line shows "799 ready + 16,214 from Preform 18.5".
  - One step only: a material something is made from can't itself be made from something, and nothing is made from
    itself. The item stays counted in pieces (its Contents can't become g / ml while it has a Made from).
  - Products sharing a material through what it is made from join the same OR group (plant 001: all five bottled
    products are one group, through the shared preform and caps). Example with plant 001's count of 16 Oct in
    `test/recipe-math.test.ts`: BM 1L 66 box before → up to 1,333 box, the D Blue cap runs out first.

## Rules that are easy to get wrong
- **Who may do what** is checked in `src/server/setup.ts` / `counts.ts`, because the database login can't tell
  an owner from a store keeper:
  - Owner only: sections (add, rename, re-order, switch off), setting or changing a limit, moving an item to
    another section, switching off an item that **has** a limit.
  - Owner, store keeper or **plant staff** (same rights as a store keeper; `canCount` in
    `src/server/session.ts`): add an item (choosing its section), edit name / units / product, re-order items
    within a section, switch off an item without a limit, switch an item back on, count and correct.
  - A store keeper's (or plant staff's) save that **changes** an owner-only field is refused as a whole. Sending a field back
    unchanged is fine, so forms can send everything.
- **Append-only:** `stock_app` has SELECT + INSERT on counts, versions and lines, and no UPDATE / DELETE. Its only
  UPDATEs are setup columns (`sections`, `items`) and the alert status columns. Nothing is ever deleted.
- **Names and units are copied into each count line**, so old counts read the same after a rename or unit change.
  Sections and limits in the views are today's.
- **The counting day (B-05, v0.25.3):** until **5 am India time** the screens treat last night as the day to count
  (`countDay()` in `src/lib/days.ts`): the home page's main card ("Last night's count · 16 Oct"), `/count` with no
  date (the 8 pm reminder's link) and the launcher tile. After midnight the calendar day is offered as a small switch
  ("Count for 17 Oct"), with an amber note on its count page. Saving is still allowed for the calendar today and
  yesterday only (`allowedDates()`), unchanged.
- **"Previous" means the calendar day before.** With a gap, nothing is compared rather than guessing over two days.
- **Two people counting at once:** the screen sends the version it showed (`expected_version`). A mismatch, or the
  unique keys on `counts` / `count_versions`, gives a 409 "reload" instead of overwriting.
- **Owners for emails** come from the platform's `alert-contacts` (owners + store keepers + plant staff), filtered to
  `tenant_admin`. If the platform can't be reached when a count is saved, the count is saved but **no email is
  queued for it** (logged). The next save or correction that day queues it.
- Sums are done in hundredths (`src/lib/compare.ts`), so 0.1 + 0.2 = 0.3.

## Settings (environment)
| Variable | What |
|---|---|
| `PLATFORM_URL` | the platform's address |
| `MODULE_URL_FLOOR_STOCK` | this module's address (https → Secure cookies; link in emails) |
| `MODULE_SECRET_FLOOR_STOCK` | client secret registered with the platform (super_admin → Modules) |
| `STOCK_DATABASE_URL_APP` | the `stock_app` login (never the owner) |
| `STOCK_SESSION_SECRET` | signs this module's cookies (≥ 32 characters) |
| `CRON_SECRET` | the daily job's `x-cron-secret` header |
| `BREVO_API_KEY` + `MAIL_FROM` (or `SMTP_*`) | email; shared sender in `packages/module-kit/src/mail.ts` |

Local setup: `./scripts/setup-module-db.sh floor_stock stock_app STOCK 3002`, then `pnpm db:migrate`.
Hosted copy set up before Floor Stock: `./scripts/add-railway-module.sh` (docs/DEPLOY.md).

## Tests
`pnpm --filter @plantops/floor-stock test` (real Postgres test database; the schema is rebuilt each run). 146 tests
(v0.11.0), including "Can make": the arithmetic with the owner's example (`recipe-math.test.ts`) and owner-only
setup, recipe checks, corrections, Recent changes and the database guards (`recipes.test.ts`). Earlier list:
- login / session / support read-only, and each support page view logged
- FORCE RLS guard on every table, and plant A vs plant B
- the full permission table, with the audit trail
- the starter list
- count rules: dates, lock, corrections, concurrency, pre-fill, lines, copied names
- append-only refusals by the database
- Sold / Used / received arithmetic and India dates
- day / item history, Recent changes, the CSV, the WhatsApp text
- low-stock email: once per item per day, owners only, skipped / pending / retry / give up
- tile badges and the daily-job endpoint

## Pending

**To do now (owner, on the live copy):**
- [x] Delete `.env.railway.shared.floor_stock.paste` (it holds the database password). Save the updated
      `.env.railway.shared` in the password manager.
- [x] GitHub → Settings → Environments → `shared`: add the variable `STOCK_URL` = `https://stock.bluemins.life`.
  - [x] Then Actions → *Daily jobs* → Run workflow: green on 2026-10-11 (`docs/deployments/shared.md`).
- [x] super_admin → Modules: Floor Stock's address works (2026-10-11: the live launcher tile shows its numbers, which
      the platform fetches from the registered address).
- [—] `floor-stock` variables `BREVO_API_KEY` / `MAIL_FROM`: not needed (no Brevo email for Floor Stock, owner
      2026-10-11).
- [x] First real use (plant 001 Bluemins, 2026-10-11):
  - [x] switch Floor Stock on in a plant's plan
  - [x] give a staff member the `store_keeper` (or `plant_staff`) role
  - [x] owner: "⚙ Set up sections"
  - [x] store keeper: a count (Bindu, 14:15) and a correction
  - [ ] owner: the day page and "Copy as WhatsApp message" (deferred for later, owner 2026-10-13)
- [—] Email test: **not needed** (owner, 2026-10-11): Brevo will not be set up for Floor Stock; owners rely on app
      notifications (bell + browser / phone push), which already carry "Low stock". Without email, low-stock rows are
      `skipped` (owner without email) or wait as `pending` and are marked `failed` after 7 days; nothing breaks.
- [x] Backups before real plant data: nightly encrypted backups since v0.6.2 (HANDBOOK.md section 11).

**Decisions to confirm with the owner (made while building, 2026-10-08; deferred for later, owner 2026-10-13 —
they stay as built until then):**
- Store keepers may re-order items within a section.
- Corrections only for today / yesterday, like new counts. Should the owner be able to correct older days?
- Sold / Used only against the calendar day before (a gap shows "—").
- Store keepers see Sold / Used and low stock; CSV and Recent changes are owner-only.
- An item switched off after a count is left out when that count is corrected.

**Known limitations:**
- If the platform can't be reached at the moment a count is saved, no low-stock email is queued for that count.
  The next save or correction that day queues it. A full fix needs a small migration: `stock_tenants()` would also
  list plants with an unqueued low count. Ask before changing the schema.
- Low-stock emails are in English only.
- History pages show the last 120 counts / 60 days per item (no paging yet). There is no plan-based history
  window like Lab Records'.
- On a phone over plain `http://` (local testing), "Copy as WhatsApp message" can't use the clipboard. It shows
  the text to select instead. Over https it copies directly.

**After deploying v0.11.0 ("Can make"):**
- [x] Owner: Contents and Recipes entered (plant 001, 2026-10-11: 9 materials, 8 products, 22 recipe lines).
- [x] Home page checked after a count against the owner's own calculation (2026-10-11).

**Later (not v1):**
- Dispatch entries (party, item, boxes, batch) as new tables. The day page would then show "Dispatched vs Sold
  (from count) vs Gap".
- The Lab Records batch check on dispatch: a held batch is never dispatched, and dispatch is refused if Lab
  Records can't be reached. It needs module-to-module authentication (a platform-signed token with a `purpose`),
  which changes the token contents, so **ask the owner first**.
- Purchases, a party list, who holds the returnable jars, Hindi / Odia screens and emails.
- Long-term: general godown stock (several godowns, transfers, in/out ledger, suppliers, value). Keep the code
  generic (free-text units, optional product link, no RO-only rules).

## 2026-10-18: count after midnight (B-05, v0.25.3)
At 01:07 IST on 17 Oct plant 001's 16 Oct closing was saved as 17 Oct, because after midnight every screen offered the
new calendar day as "today". Now until 5 am the home page, `/count` and the tile follow `countDay()` (last night), and
the calendar day is a one-tap switch. No schema change. Tests: `test/count-day.test.ts` (13). The owner checks plant
001's 16 / 17 Oct on the day pages and corrects if needed.
**Made while building:** the "Can make" title says "from the stock of 16 Oct" after midnight; the tile still reads the
newest count, so in the rare case where both last night and the calendar day are counted before 5 am it says "not done".
