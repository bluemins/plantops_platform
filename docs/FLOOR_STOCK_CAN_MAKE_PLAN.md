# Floor Stock "Can make" — Plan and Build Prompt

**Status:** Design agreed with the owner on 2026-10-11. **Built 2026-10-11 (v0.11.0), not deployed.** Notes in
`apps/floor-stock/NOTES.md`.

Visual mock-ups (private link, owner only): https://claude.ai/artifact/TYHcm4MKJ75vhUuGXLGPrU

## Purpose
Staff count raw material (preform packets) and consumables (caps, labels) every evening in Floor Stock. On every
submitted count, the app works out by itself **how many boxes (and bottles) of each finished product can still be
made** from that stock, and which material runs out first. The owner, store keepers and plant staff see it on the
Floor Stock home page.

## Example: how the owner's plant works
Every plant enters its own figures on screen; nothing below is in code.

| Product | 1 bottle needs | Bottles per box |
|---|---|---|
| BM 1L | 1 preform 18.5 g + 1 blue cap + 1 label 1L | 12 |
| DM 1L | 1 preform 18.5 g (same preform as BM 1L) + cap + label | 12 |
| BM 500ml | 1 preform 12.5 g + cap + label | 24 |
| BM 250ml | 1 preform 9.4 g + cap + label | 35 |
| DM 2L | 1 preform 32 g + cap + label | 9 |

1 packet of preform = 25 kg (25,000 g); a damage allowance of 0.01% is always taken off.
Example: 3 packets of Preform 18.5 g = 75,000 g − 0.01% (7.5 g) = 74,992.5 g ÷ 18.5 g = 4,053 bottles.

## Agreed requirements
- **The owner sets it up in the existing Sections & items screen** (⚙ Set up sections on the tile). No new page.
  - **Raw material / consumable row → "Contents"**: what 1 counted unit holds: "1 box of Blue cap = 500 pcs",
    "1 packet of Preform 18.5 g = 25,000 g (or 25 kg)". A damage allowance %. For items counted with a second
    number (labels: bundle + count), a tick "count = loose pieces".
  - **Finished goods row → "Recipe"**: what 1 bottle needs: e.g. BM 1L = 18.5 g of Preform 18.5 g + 1 Blue cap +
    1 Label 1L.
  - **Bottles per box come from the product** linked to the item (the "1 L × 12" already shown on the row). Only an
    item without a linked product asks for it.
- Measures: pcs, g, kg, ml, L, m (kg↔g and L↔ml converted). A recipe line must use the same kind of measure as its
  material (weight with weight, pieces with pieces), otherwise refused on save.
- A material with no Contents set: its unit is taken as single pieces.
- **Owner only** sets Contents and Recipes (like limits). Store keepers, plant staff and support see them
  read-only. Every change is audited and shows in Recent changes.
- **Worked out when the screen opens, never stored**, so it follows every submit and every correction at once.
- **Shared materials** (Preform 18.5 g for BM 1L and DM 1L): the products are shown together as an **OR group**:
  "BM 1L up to 191 box OR DM 1L up to 95 box", each worked out as if all of the shared material went to it, plus the
  shared material's total for both together ("enough for 4,053 bottles in total"). The numbers are never added.
- Shown on the **Floor Stock home page** (newest count) and on the **day page**. Tile badges unchanged.
- **No existing table is changed.** Everything new lives in new tables.

## Flow
1. **Owner, once:** ⚙ Set up sections → Contents on each material, Recipe on each finished product.
2. **Store keeper / plant staff, every evening:** enter the count exactly as today (count screen unchanged).
3. **After submit:** the home page shows "Can make from today's stock". A correction updates it straight away.

## Mock-ups (example numbers)
Floor Stock home page:
```
✓ Today's count done · 11 Oct 2026                      [View]
  Counted at 7:40 pm by Atharv
─────────────────────────────────────────────────────────────
Can make from today's stock

  1L bottles: Preform 18.5 g is shared, make one OR the other
  ┌───────────────────────────────────────────────────────────┐
  │ BM 1L   up to 191 box (2,300 bottles)  runs out: Label 1L    │
  │                     ── OR ──                                 │
  │ DM 1L   up to  95 box (1,150 bottles)  runs out: Label DM 1L │
  │ Preform 18.5 g is enough for 4,053 bottles in total          │
  │ (BM 1L + DM 1L together)                                     │
  └───────────────────────────────────────────────────────────┘

  BM 500ml   166 box  (3,999 bottles)   runs out first: Preform 12.5 g
  DM 2L       86 box  (781 bottles)     runs out first: Preform 32 g
  BM 250ml   —  recipe not set
```
- **Products that share a material are shown together as one "OR" group** (owner, 2026-10-11): "how many BM 1L
  I can make **or** how many DM 1L". Each line is the most of that product if the shared material all goes to it.
  The group ends with the shared material's total ("enough for 4,053 bottles in total, BM 1L + DM 1L together"),
  so the owner can split it between the two.
- Products sharing nothing are listed on their own, as before.
Set up sections, finished goods row:
```
BM 1L                                          [↑] [↓] [Edit] [Recipe]
box · Bluemins 1L (1 L × 12) · limit 10
1 bottle = 18.5 g Preform 18.5 g + 1 Blue cap + 1 Label 1L

What makes 1 bottle of BM 1L          (1 box = 12 bottles, from the product)
  [Preform 18.5 g ▾]  [18.5]  [g   ▾]   ✕
  [Blue cap       ▾]  [1]     [pcs ▾]   ✕
  [Label 1L       ▾]  [1]     [pcs ▾]   ✕
  + Add material
                                            [Cancel] [Save]
```
Set up sections, raw material rows:
```
Preform 18.5 g                                 [↑] [↓] [Edit] [Contents]
packet · 1 packet = 25,000 g · damage 0.01%

What is in 1 packet of Preform 18.5 g
  1 packet holds  [25000]  [g ▾]
  Damage allowance [0.01] %
                                            [Cancel] [Save]

Blue cap                                       [↑] [↓] [Edit] [Contents]
box · 1 box = 500 pcs

Label 1L                                       [↑] [↓] [Edit] [Contents]
bundle + count · 1 bundle = 1,000 pcs · count = loose labels
```
How "BM 1L: 191 box" is worked out:

| Material | Tonight's count | Bottles possible |
|---|---|---|
| Preform 18.5 g | 3 packets = 75,000 g − 0.01% | 4,053 |
| Blue cap | 6 boxes × 500 | 3,000 |
| Label 1L | 2 bundles × 1,000 + 300 loose | **2,300** (smallest: runs out first) |

2,300 bottles ÷ 12 per box = **191 box**.

## Design

### Database: new tables only (migration `apps/floor-stock/db/migrations/0004_recipes.sql`)
No existing table is altered: no new columns, no changed rows, no changed permissions. The new tables point at
existing items by `(tenant_id, item_id)` foreign keys, like `count_lines` does.
- `floor_stock.material_contents`: `tenant_id`, `item_id` (stock item, unique), `content_qty numeric(12,2) > 0`,
  `content_measure` ('pcs','g','kg','ml','L','m'), `second_is_pieces boolean default false`,
  `damage_pct numeric(6,4) not null default 0` (0 ≤ x < 100), updated by / name / at.
- `floor_stock.recipes`: `tenant_id`, `product_item_id` (finished item, unique), `case_size int` (null = linked
  product's pack size), `status` active / off, created / updated by + at.
- `floor_stock.recipe_lines`: `tenant_id`, `recipe_id`, `material_item_id`, `qty numeric(12,2) > 0`, `measure`,
  `status` active / off, created / updated by + at; unique (recipe, material).
- All three: ENABLE + FORCE RLS with the usual `tenant_isolation` policy. `stock_app`: SELECT, INSERT and column
  UPDATE on the editable columns; **no DELETE** (a removed line is switched off, like items and sections).
- Platform, SSO token and other modules: unchanged.

### Calculation (pure function, `src/lib/recipe.ts`, next to `src/lib/compare.ts`)
- Material on hand (base measure g / ml / pcs / m) = `closing × content` (+ loose pieces when `second_is_pieces`),
  then `× (1 − damage_pct / 100)`. Hundredths arithmetic as in `compare.ts`.
- Per product: `bottles = min over recipe lines of floor(on hand ÷ needed per bottle)`;
  `boxes = floor(bottles ÷ bottles per box)` (linked product's `units_per_pack` via `kit.products`, else
  `case_size`, else 1).
- "Runs out first" = the material(s) giving the smallest number. A material missing from the count → "can't work
  out: <material> not counted". No recipe → "recipe not set".
- **OR groups:** products that share any material (directly or through another product) form one group. For each
  shared material the group also gives its total in bottles = `floor(on hand ÷ needed per bottle)` (when every
  product in the group needs the same amount of it; otherwise "enough for N <product> or M <product>").

### Server (`apps/floor-stock/src/server`)
- `recipes.ts` (new): `setContent(user, itemId, …)` (audit `material.content`) and `setRecipe(user, productId, …)`
  (audit `recipe.set`), both `requireOwner`; checks: product = active finished item, materials = active stock items
  of the same plant, no duplicates, measure kinds match.
- `setup.ts`: `listSetup` also returns each item's contents / recipe; existing rules and saves unchanged.
- `views.ts`: `dayView` and `homeStatus` add `can_make[]`, using the lines they already load.
- Routes `PUT /api/materials/[id]` and `PUT /api/recipes/[id]`; support refused by the existing guards.
- `schema.ts`: the three tables. `src/lib/changes.ts`: Recent changes text for the two new audit actions.

### Screens
- `/setup` (`src/app/setup/editor.tsx`): Contents button + panel on stock items, Recipe button + panel on finished
  items, a summary line on each row; read-only for non-owners. The existing Edit form stays as it is.
- Home (`src/app/page.tsx`): "Can make" card under the Today / Yesterday card, above "Below the limit".
- Day page (`src/app/day/[date]/page.tsx`): same card for that day's shown version.

## Tests (`pnpm --filter @plantops/floor-stock test`)
- Arithmetic: the example above (4,053 bottles with 0.01%, 4,054 with 0%), boxes of 12 / 24 / 35 / 9, kg↔g, bundles
  + loose count, smallest wins, ties, OR groups (BM 1L / DM 1L share Preform 18.5 g: one group, total 4,053 bottles; a product sharing nothing stands alone), missing material, no recipe.
- Permissions: only the owner sets Contents / Recipes; store keeper, plant staff and support refused; audited.
- Validation: product must be finished goods, material must be stock, plant B's item refused, no duplicates,
  weight vs pieces refused.
- FORCE RLS guard and plant A / plant B isolation for the three new tables; DELETE refused by the database.
- Day view and home follow a correction (v2 changes the number).
- All existing Floor Stock tests (111) pass unchanged.

## Verification
1. Migrate dev + test databases; Floor Stock tests, typecheck, build.
2. `pnpm dev`, plant 002 as the owner: enter Contents and Recipes from the example, submit a count, check the home
   page numbers and "runs out first"; correct the count and see the numbers change; a store keeper sees it
   read-only.
3. NOTES.md, CLAUDE.md dated status note, CHANGELOG; release v0.11.0. Deploy only when the owner says so.

## Build prompt (used 2026-10-11; kept for reference)
```
Build the Floor Stock "Can make" feature described in docs/FLOOR_STOCK_CAN_MAKE_PLAN.md. The owner agreed the
design on 2026-10-11 (Contents + Recipe set by the owner in Sections & items; products sharing a material shown
as one "OR" group; result on the Floor Stock home page and day page; new tables only, no existing table changed).

Start in plan mode: read apps/floor-stock (NOTES.md, db/migrations, src/server/setup.ts, views.ts, counts.ts,
src/lib/compare.ts, src/app/setup/editor.tsx, src/app/page.tsx) and confirm the plan fits the code.

Then build:
1. Migration apps/floor-stock/db/migrations/0004_recipes.sql: material_contents, recipes, recipe_lines with
   tenant_id, FORCE RLS, tenant_isolation, stock_app SELECT / INSERT / column UPDATE, no DELETE. Show me the SQL and
   wait for my OK before running it.
2. src/lib/recipe.ts (pure calculation) with its tests first, using the example numbers in the doc.
3. src/server/recipes.ts + routes PUT /api/materials/[id] and PUT /api/recipes/[id] (owner only, audited), listSetup
   additions, can_make in dayView and homeStatus, Recent changes texts.
4. Screens: Contents and Recipe panels on /setup (read-only for non-owners), "Can make" card on the home page and
   the day page, matching the mock-ups.
5. Every test listed in the doc; then pnpm test, typecheck and build. All existing Floor Stock tests must pass
   unchanged.
6. Migrate the dev and test databases; check on pnpm dev with plant 002.
7. Update apps/floor-stock/NOTES.md, a dated status note in CLAUDE.md and the CHANGELOG. Prepare v0.11.0 but ask me
   before pushing to production.

Keep changes small and explain each in plain language. Ask before any other schema, permission or token change.
```
