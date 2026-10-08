# Floor Stock – module notes

Phase 5 module (`apps/floor-stock`, port 3002). It replaces the staff's evening WhatsApp message: **today's
production** (finished goods) and the **closing stock** of everything in the plant, counted once at the end of
the day. Sales happen during the same day, so the stock figure is the closing count. Project rules live in the
root `CLAUDE.md`. Built on the shared module kit (`packages/module-kit`), like Lab Records and Document Store.

## Status (2026-10-08)
- **Live** on the shared copy at https://stock.bluemins.life since release **v0.6.0** (Railway service
  `floor-stock`, no volume; record in `docs/deployments/shared.md`).
- All 8 build steps are done. 87 tests pass (platform 187, auth 32, Lab Records 111, Document Store 86 also pass).
- Live checks passed:
  - health with the database OK
  - redirect to the PlantOps login
  - APIs refuse without a session, the platform's ticket or the cron secret
- **Not used for real yet:** no plant has sections, and no count has been entered in a browser.

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
`pnpm --filter @plantops/floor-stock test` (real Postgres test database; the schema is rebuilt each run). 87 tests:
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
- [ ] Delete `.env.railway.shared.floor_stock.paste` (it holds the database password). Save the updated
      `.env.railway.shared` in the password manager.
- [ ] GitHub → Settings → Environments → `shared`: add the variable `STOCK_URL` = `https://stock.bluemins.life`.
      Then Actions → *Daily jobs* → Run workflow: all three steps should be green.
- [ ] super_admin → Modules: check that Floor Stock shows `https://stock.bluemins.life`.
- [ ] `floor-stock` variables: check that `BREVO_API_KEY` and `MAIL_FROM` match `document-store`.
- [ ] First real use:
  - [ ] switch Floor Stock on in a plant's plan
  - [ ] give a staff member the `store_keeper` (or `plant_staff`) role
  - [ ] owner: "⚙ Set up sections", then the starter list
  - [ ] store keeper: a count on a phone
  - [ ] owner: the day page and "Copy as WhatsApp message"
- [ ] Email test: set a limit above an item's count, submit, and check the owner receives the email.
- [ ] Turn on Railway backups for Postgres before real plant data (shared copy, all modules).

**Decisions to confirm with the owner (made while building, 2026-10-08):**
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

**Later (not v1):**
- Dispatch entries (party, item, boxes, batch) as new tables. The day page would then show "Dispatched vs Sold
  (from count) vs Gap".
- The Lab Records batch check on dispatch: a held batch is never dispatched, and dispatch is refused if Lab
  Records can't be reached. It needs module-to-module authentication (a platform-signed token with a `purpose`),
  which changes the token contents, so **ask the owner first**.
- Purchases, a party list, who holds the returnable jars, Hindi / Odia screens and emails.
- Long-term: general godown stock (several godowns, transfers, in/out ledger, suppliers, value). Keep the code
  generic (free-text units, optional product link, no RO-only rules).
