# Order flow and raw material stock: lean analysis (plant 001)

Asked by the owner 2026-11-01. One-off report, no code or schema change. Data: the live database, read-only
(`plantops_backup`), plant 001 only; aggregates only, no customer names or phone numbers copied out.

- **Orders:** Order Capture, 110 orders entered 13 Oct – 1 Nov 2026 (20 days).
- **Stock:** Floor Stock, 21 daily counts 8 Oct – 1 Nov 2026, with the owner's Contents and Recipes.
- **Caution:** three weeks of data. 13–14 Oct includes the first days of entering orders (a backlog, incl. one
  350-box order), and Hemex is one bulk customer (two orders of 250 boxes). Treat the numbers as a first reading;
  repeat at the end of November.

---

## 1. Summary

1. **Stock is in the wrong place.** The fast products are nearly out (BM 1L 18 boxes, BM 500ml 0 boxes on 1 Nov,
   with 64 and 31 boxes waiting in pending orders), while slow, cheap materials hold months: D Blue caps ~105 days,
   BM labels 160–210 days, roll ~20 weeks, 5 L jars ~75 days. Hemex is blocked: 250 boxes pending, 217 in stock, and
   **0 Hemex labels and 0 DM 1L empty bottles** to make the rest.
2. **Orders wait for delivery, not for stock.** Median order-to-delivered time is 31 h, but 1 in 3 orders takes more
   than 2 days and 12 took more than 4 days. 9 of today's 18 pending orders are 6–12 days old, and for most of them
   the product is on the shelf (DM 1L 74 boxes, DM 5L 56, BM 250ml 33). Routes, not production, are the bottleneck.
3. **One in three orders is changed after it is saved** (35 of 110), mostly 1–6 days later, cutting the quantity or
   changing the rate. That is the order being made to match what was actually loaded and charged: the order taken
   is not the order delivered.
4. **The owner is in the middle of the flow.** The owner's login entered 52 of 110 orders and marked 42 of 73
   deliveries. Every hold-up waits for one person.
5. **Raw material minimums in Floor Stock are far too low** for the 1 L preform (1 pkt = about 1.3 days of 1 L
   production) and far too high in practice for caps and labels. Proposed levels in section 5.

---

## 2. How the order flow works today (value stream)

```
Customer calls / WhatsApp
   │  09:00–12:00 most orders entered (59 of 110), second wave 16:00–19:00
   ▼
Order entered in Order Capture (owner 52, Dillip 33, Kedar 14, others 7, WhatsApp bot 4)
   │  waits: median 31 h, 80 % within 82 h, longest 13 days
   ▼
Stock check (by eye; nothing links the order to Floor Stock)
   │  fast products often short → production batch; slow products on the shelf
   ▼
Loading + route (no route plan; places typed freely)
   │  deliveries marked 17:00–23:00 (48 of 73), ~4 orders / 3 places per delivery day
   ▼
Delivered tapped (owner 42, Dillip 30) → order changed to what was really given (32 % of orders)
   ▼
Invoice in Zoho (invoice no. never entered in Order Capture: 0 of 73)
```

### Measured numbers

| Measure | Value |
|---|---|
| Orders entered | 110 (73 delivered, 18 pending, 19 cancelled) |
| Order value (not cancelled) | ₹3.27 lakh; average ₹3,593, median ₹1,380 |
| Entered → Delivered | median **31 h**, average 50 h, 80 % within 82 h |
| Same day / next day / later | 22 / 20 / **31** of 73 |
| Over 4 days | 12 of 73 |
| Orders changed after saving | **35 of 110 (32 %)**, 42 changes in all |
| Customers | 73; 59 ordered once, 11 twice, 3 three or more times |
| Delivery days | 17 of 20 days; 1–10 orders a day |
| Invoice no. entered on delivery | 0 of 73 |

### Demand per product (boxes, orders not cancelled, 20 days)

| Product | Boxes | Per day | Delivered | Pending now | Finished stock 1 Nov |
|---|---|---|---|---|---|
| Bluemins 1L (×12) | 1,580 | 79 (38 without 13–14 Oct) | 1,516 | 64 | **18** |
| Bluemins 500ml (×24) | 720 | 36 (17 without 13–14 Oct) | 689 | 31 | **0** |
| Hemex 1L (×12) | 500 | two bulk orders | 250 | **250** | 217 |
| Mr.Charge 1L (×12) | 145 | 7 | 98 | 47 | 74 (DM 1L) |
| Mr.Charge 5L (×4) | 142 | 7 | 97 | 45 | 56 (DM 5L) |
| Mr.Charge 2L (×9) | 48 | 2.4 | 35 | 13 | 20 (DM 2L) |
| Bluemins 250ml (×35) | 32 | 1.6 | 26 | 6 | 33 |

**Order Capture now holds nearly all sales.** Floor Stock's arithmetic for BM 1L (opening 253 + made 1,283 −
closing 18 = 1,518 boxes gone) matches the 1,516 boxes delivered in Order Capture. For BM 500ml it is 689 of about
831 (some sales still outside Order Capture).

### Production (Floor Stock, 8 Oct – 1 Nov)

Production runs in large batches with many empty days in between: BM 1L was made on 7 of 21 count days (56–413
boxes), BM 500ml on 6 days, DM 1L on 3, Hemex on 7. Big batches fill the shelf for a few days, then it runs empty
(BM 1L went 772 → 0 between 12 and 27 Oct).

---

## 3. Waste found (the 7 lean wastes)

| Waste | What we see | Effect |
|---|---|---|
| **Waiting** | 31 of 73 orders took 2+ days; 9 pending orders are 6–12 days old with stock on the shelf | Customers wait; risk they buy elsewhere |
| **Inventory (wrong place)** | Caps, labels, roll, 5 L jars: months of stock; BM 1L / 500ml finished: zero | Cash tied up in materials while fast products run out |
| **Overproduction / big batches** | 400-box batches, then days with nothing made | Shelf swings from full to empty |
| **Rework** | 32 % of orders edited after saving; ~16 quantity cuts, ~10 rate changes, ~9 additions | Staff time; the order list doesn't show true demand |
| **Defects (data)** | ~12 test / mistake orders cancelled within an hour and 11 junk "undo delivered" reasons ("dfsssss", "check") on the live copy; village names typed many ways (Ghens / Ghnes; Ekamar / Ekambra Chowk, 4 spellings; Dungripali / Dunguripali; Bijepur / bijepur) | Reports, routes and reminders become unreliable |
| **Motion / transport** | No route plan; ~3 places per delivery day | More trips than needed |
| **Over-processing / handoffs** | Owner enters and closes most orders; invoice typed again in Zoho with no link | One person is the bottleneck |

Real cancellations are few (about 7: shop closed, personal reason, 3 without a reason, "stock available").

---

## 4. Lean model proposed for the plant

**Principle:** keep a small, steady stock of finished fast movers (a "supermarket"), make slow movers to order, and
hold the main buffer at the cheapest, most flexible point: **preforms** (one preform makes any product of that
size). Let pending orders pull production and loading.

### 4.1 Finished goods: two classes

| Class | Products | Rule |
|---|---|---|
| **Fast (keep on the shelf)** | BM 1L, BM 500ml | Shelf level 2 days of demand, refill daily. BM 1L: min 80, target 120 boxes. BM 500ml: min 35, target 60 boxes. |
| **Slow (make to order / weekly)** | DM 1L, DM 2L, DM 5L, BM 250ml, DM 5L Pro | Make once a week from the pending orders + 1 week buffer. Today's stock covers 2–4 weeks: **make none this week**. |
| **Bulk (Hemex)** | Hemex 1L | Make only against a confirmed order; buy its labels and bottles when the order comes, with the delivery date agreed. |

Set these as the Floor Stock limits (Sections & items → limit), so the low-stock alert means "make today".

### 4.2 Production: a fixed daily rhythm instead of big batches

- **Takt (fast movers):** about 40–80 boxes BM 1L and 17–36 boxes BM 500ml a day (range = with / without the
  13–14 Oct backlog). Run 1 L every day to refill the shelf to target; 500 ml on alternate days.
- **Slow movers:** one slot a week (e.g. Saturday), sized from that week's pending orders.
- **Blowing:** blow bottles 1–2 days ahead of filling, not weeks. Today 15 pkt of blown BM 1L bottles (6,000) sit
  ready, about 10 days of BM 1L: that is work-in-progress taking space; 2–3 days (5–7 pkt) is enough.

### 4.3 Delivery: plan routes, not single orders

- **Fixed route days by village group** (e.g. Bijepur town daily; Barpali / Sohela / Agalpur on set days; Sambalpur /
  Bargarh weekly). Bijepur (23 orders) and Barpali (14) are a third of all orders.
- **Same-day cut-off:** orders entered by 12:00 go on today's route; after that, the next route day.
- **Daily pending review at 12:00** (the Pending tab, oldest first): anything over 2 days old gets a date or is
  cancelled with a reason. Clear the 9 orders older than 6 days this week.
- **Clean village names** (one spelling per place) so orders can be grouped by route. A fixed place list in Order
  Capture is a later option (it is already planned for the WhatsApp bot's area list).

### 4.4 Get the order right the first time

- Confirm the quantity and rate when the order is taken, and **load exactly the order**. If less is loaded, change the
  order before the vehicle leaves, not days later.
- Agree prices in the Rates screen (customer's rate is pre-filled from their last order), so rate changes at
  delivery become rare.
- Type the **Zoho invoice no.** when marking delivered (the box is there).
- Hand order entry and "Delivered" to the Order desk (Dillip, Kedar); the owner reviews instead of doing.
- Use plant 999 (test plant) or a local copy for testing; never test on plant 001's real orders.

### 4.5 Measures to watch each week (target in 2 months)

| Measure | Now | Target |
|---|---|---|
| Orders delivered same or next day | 42 of 73 (58 %) | 85 % |
| Pending orders older than 2 days | 9+ | 0 |
| Orders changed after saving | 32 % | under 10 % |
| BM 1L / 500ml out of stock days | several | 0 |
| Material on hand (days of use), caps / labels | 100–200 days | 30 days |

---

## 5. How much raw material stock to keep

### Method

For each material: **daily use** = what production needs (Floor Stock production × recipe), then:

- **Reorder level (min)** = daily use × (supplier lead time + safety days). Safety days = half the lead time, at least
  2 days (demand here swings a lot from week to week).
- **Order up to (max)** = reorder level + one week of use (order once a week), or the supplier's minimum order if
  that is bigger.

Daily use (8 Oct – 1 Nov production): BM 1L 51 boxes, BM 500ml 28, Hemex 29 (while it runs), DM 1L 5.3, DM 2L 2.2,
DM 5L 2, BM 250ml 2. **Supplier lead time is not in PlantOps:** the table shows 3 and 7 days; use the column that
matches your supplier (or tell me the real days and I'll redo it).

### Proposed levels

1 pkt preform = 25 kg. Caps 8,000 per box. Labels 5,000 per bundle (DM 2,000).

| Material | Use per day | Stock 1 Nov | Days it lasts | Min / max (3-day supplier) | Min / max (7-day supplier) | Action |
|---|---|---|---|---|---|---|
| **Preform 18.5** (all 1 L) | 0.76 pkt with Hemex, 0.50 without | 1 pkt + 15 pkt blown BM 1L bottles (= 5.4 pkt) | ~7 days | **4 / 10 pkt** | **8 / 14 pkt** | Raise Floor Stock limit from 1 to 4–8 pkt. Order now if supplier > 3 days. |
| **Preform 12.5** (500 ml) | 0.34 pkt | 1 pkt + 5 pkt blown bottles (= 3 pkt) | ~9 days | **2 / 5 pkt** | **4 / 6 pkt** | Limit 1 → 2–4 pkt. |
| Preform 9.4 (250 ml) | 0.03 pkt | 1 pkt | ~38 days | 1 / 1 pkt | 1 / 1 pkt | Reorder 1 pkt when the pack is opened. |
| Preform 32 (2 L) | 0.03 pkt | 0 pkt + 4 pkt blown (800 bottles) | ~40 days | 1 / 1 pkt | 1 / 1 pkt | Buy 1 pkt when blown bottles fall under 300. |
| DM 5L jars | 0.08 pkt (8 jars) | 6 pkt (600) | ~75 days | 1 / 2 pkt | 1 / 2 pkt | No purchase for ~2 months. |
| **Screw cap D Blue** (BM 1L, 500, 250) | 0.17 box | 21 boxes | **~105 days** | 1 / 2 boxes | 2 / 3 boxes | Stop buying ~3 months; ~17 boxes (≈1.4 lakh caps) above need. |
| Screw cap yellow (DM) | count never moves (2 boxes) | 2 boxes | unknown | 1 / 2 boxes | 1 / 2 boxes | Count open boxes in pieces; check whether Hemex needs a cap (its recipe has none). |
| BM 1L label | 0.12 bundle | 26 bundles | ~210 days | 1 / 2 bundles | 2 / 3 bundles | No purchase for ~6 months (printing minimums may force bigger runs: order the smallest run). |
| BM 500 label | 0.13 bundle | 22 bundles | ~165 days | 1 / 2 bundles | 2 / 3 bundles | Same. |
| **DM 1L label – Hemex** | 0.17 bundle (while Hemex runs) | **0** | **0** | per order | per order | **Blocks the pending 250-box Hemex order** (33 boxes short). Buy for that order now. |
| **DM 1L Empty Bottle** | 0.85 pkt (DM 1L + Hemex) | **0** | **0** | from preform 18.5 | from preform 18.5 | Blow from Preform 18.5 for the Hemex order. |
| Roll | ~0.2 roll | 28 rolls | ~20 weeks | 2 / 3 rolls | 2 / 3 rolls | No purchase for ~4 months. |

**Rule of thumb for plant 001:** keep about **one week of preforms** (the flexible buffer), **2–3 days of blown
bottles**, **2 days of BM 1L / 500ml finished**, and **no more than a month** of caps, labels and roll. With the
supplier lead time known, the min / max above go into Floor Stock as limits, so the existing low-stock alert tells
you when to order.

### Count quality to fix first

- Caps (yellow) and 5 L jars barely move in the counts although production used them: open boxes are not counted.
  Count loose caps in the second number or in pieces.
- Hemex 1L and DM 5L recipes have no cap line; if they use one, add it in Recipes so "Can make" sees it.
- Labels were counted in pieces under "bundle" until 16 Oct (already corrected by the owner).

---

## 6. Daily action plan (week of 2–8 Nov 2026)

Each action comes from a number above. "Who" is a suggestion.

| Day | Action | Who | Why (from the data) |
|---|---|---|---|
| **Mon 2 Nov** | Call the Hemex customer: deliver the 217 boxes in stock now, agree a date for the other 33. Order Hemex labels; blow DM 1L bottles from Preform 18.5 for 33 boxes (396 bottles). | Owner | 250 boxes pending, 217 in stock, 0 Hemex labels, 0 DM 1L bottles: the order can't be finished as things stand. |
| Mon 2 Nov | Make **BM 1L ~130 boxes** and **BM 500ml ~65 boxes**. | Production | BM 1L: 18 in stock vs 64 pending + 2-day shelf of ~80. BM 500ml: 0 in stock vs 31 pending + ~35. Materials are there (6,000 blown 1 L bottles, 4,000 blown 500 ml). |
| Mon 2 Nov | Ask the preform supplier how many days delivery takes; order Preform 18.5 up to the max (10 pkt for a 3-day supplier, 14 for 7 days). | Owner | 1 L cover is ~7 days (1 pkt + 15 pkt blown); Preform 18.5 already ran out on 25–27 Oct. |
| **Tue 3 Nov** | Go through the 9 oldest pending orders (O-0046, 0062, 0063, 0064, 0067, 0073, 0085, 0089, 0090): give each a delivery day or cancel it with a reason. | Order desk + owner | 6–12 days old; most of their products are on the shelf, so they are waiting for a vehicle, not for stock. |
| Tue 3 Nov | From today Dillip / Kedar enter orders and tap Delivered (with the Zoho invoice no.); the owner checks the Pending tab instead. | Owner | Owner entered 52 / 110 and delivered 42 / 73; invoice no. on 0 / 73. |
| **Wed 4 Nov** | Set Floor Stock limits: BM 1L 80, BM 500ml 35 boxes; Preform 18.5 4–8 pkt, Preform 12.5 2–4 pkt (by supplier days). | Owner | Today every preform limit is 1 pkt (= 1.3 days of 1 L); the low-stock alert fires too late. |
| Wed 4 Nov | Fix route days by village group (Bijepur daily; Barpali / Sohela / Agalpur set days; Sambalpur / Bargarh weekly) and a **12:00 cut-off** for same-day delivery. Tell customers. | Owner | Bijepur 23 + Barpali 14 = a third of orders; ~3 places per delivery day; 31 of 73 orders took 2+ days. |
| **Thu 5 Nov** | Correct the village spellings in Customers (one spelling per place). | Order desk | Ghens / Ghnes, 4 spellings of Ekamar / Ekambra Chowk, Bijepur / bijepur: orders can't be grouped into routes. |
| Thu 5 Nov | Rule for loading: **load exactly the order**; if less goes on the vehicle, change the order before it leaves, not days later. Agree the rate when taking the order. | Owner → all | 35 / 110 orders changed after saving, mostly 1–6 days later (quantity cut or rate change). |
| **Fri 6 Nov** | Tell suppliers: no caps, labels or roll for now (caps ~3 months, labels ~6 months, roll ~4 months). | Owner | 21 boxes of D Blue caps ≈ 105 days; labels 165–210 days; 28 rolls ≈ 20 weeks: cash sitting on the shelf. |
| Fri 6 Nov | With the store keeper: count loose caps and open 5 L jar packs; check if Hemex 1L and DM 5L need a cap and add it to their recipes. | Owner + store keeper | Yellow caps stayed at 2 boxes all month while DM 1L / Hemex were made; Hemex and DM 5L recipes have no cap. |
| **Sat 7 Nov** | Slow-mover slot: **make no DM / Mr.Charge this week**; use the time for deliveries. | Production | Pending vs stock: Mr.Charge 1L 47 vs 74, 2L 13 vs 20, 5L 45 vs 56, BM 250ml 6 vs 33: all covered. |
| Sat 7 Nov | Stop testing on plant 001; use plant 999 for trying things. | All | ~12 test cancellations and 11 junk "undo delivered" reasons in the real data. |
| **Sun 8 Nov** | Weekly check of the section 4.5 measures (ask Claude to re-run them) and of preform stock against min / max. | Owner | To see if same / next-day delivery rises from 58 % and pending over 2 days falls to 0. |

### Every day from Mon 2 Nov

| Time | Action | Why |
|---|---|---|
| 09:30 | Look at yesterday's Floor Stock count: BM 1L under 80 or BM 500ml under 35 → make it today. | BM 1L went 772 → 0 in 15 days with big batches; a daily refill keeps the shelf steady. |
| 12:00 | Pending tab, oldest first: anything over 2 days gets a day or a cancel reason; orders by 12:00 go on today's route. | Waiting is the biggest waste (median 31 h, 12 orders over 4 days). |
| Before the vehicle leaves | Order on screen = what is loaded. | Stops the 32 % after-the-fact changes. |
| On delivery | Tap Delivered the same evening, with the invoice no. | Delivery time and invoice link become true. |
| Evening | Floor Stock count as usual, counting loose caps and open packs. | "Can make" and the min / max only work with true counts. |

## 7. What could be built later (not now; owner to decide)

Ideas only, for `docs/TODO.md` if wanted:

1. **Order flow page** in Order Capture (owner only): the section 4.5 measures each week, pending by age, by village.
2. **Pending orders vs finished stock**: Order Capture showing "in stock / short" per pending order from Floor Stock
   (module-to-module read; WhatsApp build plan Insights D2).
3. **Fixed place list** for villages (same need as the bot's area list).
4. **Suggested purchase list** in Floor Stock: each material's days left against its min / max (needs a "supplier lead
   time" per material: schema change).
