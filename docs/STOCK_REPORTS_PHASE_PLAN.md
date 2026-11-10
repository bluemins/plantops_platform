# Reports → Stock (Floor Stock): plan

Asked by the owner 2026-11-10: "what reports can you give in the Stock section from Floor Stock"; then "write the plan
and mock-ups for the first three": **Stock Summary**, **Production**, **Material use vs recipe**.
Mock-ups (sample figures, not plant 001's real counts): https://claude.ai/artifact/PRh92rhiTHH9RZpbn91RSE (section 9).
Status: **plan only. The five decisions (section 8) approved by the owner 2026-11-10 (the recommended option each);
waiting for "build".**
The Reports section itself (Sales, Receivables): `docs/REPORTS_PHASE_PLAN.md`.

## 1. What the reports are built from (nothing new is typed in)
Floor Stock already saves, per plant:
- **one count per day** (append-only; a correction is a new version: reports always use each day's **latest version**)
  with today's **production** (finished goods, in their unit, usually box) and the **closing stock** of every item, in one
  or more lines (remarks / party names; the report adds the lines up)
- **sections and items** (finished / stock section, unit, optional second number, link to a PlantOps product, limit)
- **Contents** (1 packet = 25,000 g, damage allowance %) and **Recipes** (what 1 bottle needs), and **Made from**
  (empty bottle ← 18.5 g preform)
- the PlantOps product behind a finished item (bottles per box, bottle size in ml), read from the platform as today

Nothing is stored for the reports; every figure is worked out when the page opens, like the day page.

## 2. The one rule for a period (all three reports use it)
The day page compares a count only with **the calendar day before**. A month report can't do that: one missed day would
lose that day's movement. So the reports **chain the counts**:
- **Opening** = closing of the **last count before the period** (its date is shown: "Opening = count of 31 Oct").
- **Closing** = the **last count in the period**.
- Between each count and the next one (even with days missing in between) the difference is worked out once:
  - finished goods: `sold = previous closing + production of the later count − its closing`
    (below 0 = a **"check the count" day**: counted as a negative sold so the totals still add up)
  - materials: drop = **used**, rise = **received (calculated)**
- So for every item, always exactly: **Opening + Production (or Received) − Sold (or Used) = Closing.**
- **Days without a count** in the period are listed ("3 days not counted: 9, 16, 23 Oct"); their production is missing
  (it was never typed in), so the movement over a gap shows up as sold / used in one lump on the next count.
- **Unit changed** during the period (e.g. labels counted in bundles, then in pieces): the item is compared only from the
  change on, with a note. Quantities are never added across two different units.
- Items switched off still appear if they were counted in the period. Sections in the plant's own order.
- Dates are India dates; a count saved before 5 am belongs to the night before (as `countDay()` already does).
- Sums in hundredths (2 decimals), as `src/lib/compare.ts` does today.

## 3. Report 1: Stock Summary (mock-up 2)
**What it answers:** for a month (or any period), what came in, what went out and what is left, item by item.
Like Zoho's "Inventory Summary".
- **Filters:** period (previous month default; this month, this quarter, this financial year, custom from / to);
  section (all / one); show (all items / only items that moved / only items low at the end); search.
- **Columns (PC):** Item · Unit · Opening · In (production for finished goods, received for materials) · Out (sold /
  used) · Closing · Limit · **Days low** (closing below the limit, out of the days counted) · **Check days**
  (finished goods with "check the count").
- Grouped by section with the section's name as a heading; no money anywhere (Floor Stock has no rates).
- Second number: closing only (e.g. returnables "120 good · 4 damaged"; labels "bundles + loose").
- An item opens its existing **Item history** page (`/items/<id>`) for the day-by-day lines.
- Top line: "18 of 31 days counted · 2 corrections · 3 days not counted".
- CSV (one row per item, same columns) and Print / PDF, like the Sales reports.
- **Phone:** one card per item (Opening → In → Out → Closing, low / check tags).

## 4. Report 2: Production (mock-up 3)
**What it answers:** how much each product was made, when, and against last month / last year.
- **Rows by:** day (default for one month), week, or month (default for a quarter / year). **Columns:** each finished
  product, then **Total**.
- **Show in:** boxes (as counted) / bottles (boxes × bottles per box) / **litres** (bottles × bottle size). Litres is the
  only measure in which products of different sizes can be added up fairly; boxes total = the tile's "Made N box".
- **Compare with:** none / previous period / same period last year (a "change" row at the bottom).
- Top cards: total made, production days, average per production day, best day.
- A small bar chart (total per row in the chosen measure) above the table; a product filter.
- Days with a count but no production show "0"; days with no count show "not counted" (not 0).
- CSV + Print. **Phone:** the chart and one card per product (total, best day, change).
- Products without a PlantOps link (no bottles per box / size): boxes only, "—" for bottles / litres.

## 5. Report 3: Material use vs recipe (mock-up 4)
**What it answers:** did the materials go down as much as the production says they should? The difference is the real
waste (or a counting / recipe mistake).
- **Expected use** of a material = for each product: production × bottles per box × the recipe's amount per bottle,
  turned into the material's counted unit with its Contents (25,000 g per packet), plus its damage allowance.
- **Counted use** = the drops in its closing stock (section 2).
- **Difference** = counted − expected, and as % of expected. Colours: within ±2 % green, 2–5 % amber, over 5 % red
  (the owner can change the bands later; see decision 4).
- **The problem with deliveries:** when packets arrive, the count goes up, and that day's real use can't be seen (a +7
  could be 10 received − 3 used). So **intervals where the material went up are left out of both columns** for that
  material, and the row says so: "compared on 24 of 27 intervals; 3 left out (stock went up: 4, 12, 20 Oct)". This keeps
  the comparison honest without asking anyone to type in deliveries.
- **Made from (empty bottle ← preform):** the empty bottles and their preform are checked **together as bottle
  equivalents** (bottles counted + bottles the preform can still make): blowing preforms into bottles moves stock from
  one to the other and is not use. Expected = bottles produced. The preform's own damage allowance counts, as in
  "Can make". Shown as one row "Empty Bottle 1L + Preform 18.5 g (as bottles)".
- **Shared materials** (one cap for BM 1L and DM 1L): expected use adds up every product that uses it.
- Materials with no recipe using them, or without Contents, are listed below the table ("not checked: no recipe /
  no contents"), with a link to Sections & items.
- A row opens a **detail panel**: per product how much of the expected use came from it, and the intervals left out.
- The recipe used is **today's recipe** (recipes have no history; see decision 3). The page says so.
- CSV + Print. **Phone:** one card per material with expected / counted / difference and the colour.

## 6. Where it lives and who sees it
- **Floor Stock** gets `/reports?section=stock` and `/reports/stock/summary`, `/reports/stock/production`,
  `/reports/stock/materials` (+ `/api/reports/stock/<kind>` for CSV). The page shows the same left-hand **SECTIONS** list
  as Sales' Reports page; Sales / Receivables link to Sales through the platform (`/sso/start?module=order_capture&
  next=/reports?section=…`), and Sales' list gets a live **Stock** link the same way (only when Floor Stock is switched on
  for the plant). Each module still owns its own reports and data; nothing is read across databases.
- **Platform:** the dashboard **Reports** card also shows for owners when **only** Floor Stock is on (it then opens
  Floor Stock's Reports page). With Sales on it opens Sales' page as now. No platform migration.
- **Access:** owner only, like the Sales reports; PlantOps support read-only, page views logged as on every other
  Floor Stock page. Store keepers and Stock viewers: not now (decision 1). A new access row `reports` in Floor Stock's
  permission table.
- **No database change, no new grant, SSO token unchanged.**

## 7. Build
- **Pure rules** `apps/floor-stock/src/lib/period.ts` (the chain of section 2: opening, in, out, closing, check days,
  days low, gaps, unit changes) and `src/lib/material-check.ts` (expected vs counted, intervals left out, bottle
  equivalents), reusing `compare.ts` and `recipe.ts` (`onHand`, `TO_BASE`). One table shape for page and CSV.
- **Server** `src/server/reports.ts`: one query for the latest version of every count in the period plus the last one
  before it (lines summed per item and kind), setup + recipes as today, products from the platform (cached).
- **Tests:**
  - the chain against a hand-worked month: a gap day, a correction (only the latest version counts), a check-the-count
    day, a rise in a material, a unit change, an item switched off, an item with several lines
  - Opening + In − Out = Closing for every item; production by day / week / month and in litres
  - expected use with Contents and damage allowance; intervals with a rise left out; preform + bottles as one; a shared
    cap; materials not checked
  - owner only (store keeper, Stock viewer, plant staff refused, support read-only and logged); plant B sees nothing; CSV
  - India-date edges (a count saved at 1 am)
- **Check on real data:** plant 001's October on a local copy (read with the backup login, only with the owner's OK, as
  for Receivables; copy removed afterwards), against the day pages and the owner's own idea of October production.

**Phases:**
- **SR1:** Reports page + section list in Floor Stock, links both ways with Sales, platform card rule, **Stock Summary**.
- **SR2:** **Production** (rows by day / week / month, boxes / bottles / litres, compare with).
- **SR3:** **Material use vs recipe**.
Each a small release (v0.57.0, v0.58.0, v0.59.0), `next build` for floor-stock (and order-capture / platform in SR1)
before production.

## 8. Decisions (owner, 2026-11-10: the first option of each, as recommended)
1. **Who sees Stock reports:** **owner only for now** (recommended: same as Sales reports, one access row to add a store
   keeper later) / also store keepers.
2. **Default period:** **previous month** (recommended, same as Sales) / this month.
3. **Recipe history:** **use today's recipe and say so on the page** (recommended: no schema change; recipes rarely
   change) / keep dated recipe versions (a Floor Stock migration, to ask about separately).
4. **Difference colours** for material use: **±2 % green, 2–5 % amber, over 5 % red** (recommended) / other bands.
5. **Deliveries:** **leave intervals where stock went up out of the check** (recommended: no new typing) / later, an
   optional "received today" box on the count (more accurate, but staff type more and it is a schema change).

## 9. Mock-ups
https://claude.ai/artifact/PRh92rhiTHH9RZpbn91RSE (sample October 2026 figures, not plant 001's real counts):
1. Reports page, Stock section (Sales / Receivables link to Sales; "later" reports greyed)
2. Stock Summary, PC and phone
3. Production, PC (cards, per-day bars, weekly table with totals, litres and the change on September)
4. Material use vs recipe, PC (with the detail panel for one material) and phone

The Production table always ends with a "Total litres" column, whatever "Show in" is set to.
