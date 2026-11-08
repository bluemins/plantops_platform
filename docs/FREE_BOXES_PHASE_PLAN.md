# Free boxes on the order (scheme): phase plan

Asked by the owner 2026-11-08 (order O-0100, Bikash Kirana, "12+1 free" for Bluemins 1L). Status: **approved by the owner
2026-11-08** ("build it": the design, Sales migration `0011`, and the recommended answers to section 6). Release: **v0.48.0** (Sales only).
Mock-ups (4 phone screens, 2026-11-08): https://claude.ai/artifact/EFA2zpUquncm4dRihjtmSR

## 1. Why
Some customers get a scheme: "12 + 1 free", "24 + 2 free", sometimes a free box of another product. Today it can only be
written in the order note. Make bill takes the order's lines only and an order can hold each product once, so the free
box can't be put on the order or the bill. So the bill, the Zoho file and every count of boxes show 12 when 13
left the plant. Live check (2026-11-08): 5 orders carry a free box only in the note (O-0025 "+2 free", O-0059, O-0063,
O-0100, O-0105). For O-0100, bills B-0012 and B-0014 were made and both cancelled.

A rupee discount ("₹50 off") already works on Make bill (whole-bill discount, and per line ₹ or % under "Show all
fields"). This plan adds **free boxes**, captured **on the order from the start**.

## 2. What changes on screen (mock-ups 1–4)
1. **New order / Change:** below "+ Add product", a section **Free boxes (scheme)** with **+ Add free boxes**: pick any
   active product (the same one as a paid line, or another), type the count. The card is green with a FREE tag, no rate
   box, and "Not charged. Worth ₹100 at their rate." The total stays the paid amount, with "+ 1 box free (Bluemins 1L)"
   under it. Each product at most once as free and once as paid.
2. **Order page, list cards, history, versions:** a separate line "Bluemins 1L · 1 box · FREE · ₹0" and "Boxes to load:
   13 × Bluemins 1L, …". Plant staff / Order viewer / Delivery staff see the FREE tag and the count, never rates or
   amounts (as today).
3. **Copy as WhatsApp message:** "• Bluemins 1L: 1 box FREE". **Owner's pending summary:** a Free column per product.
   **Order CSV:** a "Free" column per line (yes / no).
4. **Make bill:** the free line comes over from the order, can't be changed there: "1 box × ₹100 − ₹100 free = ₹0", with
   a description box pre-filled "Free". The "Discount ₹" box stays as it is (money off). The totals show "Free boxes (1
   box, worth ₹100) ₹0".
5. **The bill, the statement, print:** the free line shown at ₹0 with the FREE tag.
6. **Download for Zoho:** the free line as its own row: Quantity 1, Item Price 100, Discount Amount 100 (line = ₹0), Item
   Desc "Free" (or what was typed). GST on a free line = 0.
7. **Reports → Sales by Item / Customer:** a "Free" quantity column; the amounts don't change.

## 3. Rules
- **"Worth" rate:** a free line keeps the rate the customer would pay (their last rate, else the default rate), only to
  show the value given away. Its amount is always ₹0 and it never counts in the order total, the bill total, money due,
  "Buying & paying", the customer's last rate or the bot's "usual order".
- **Who:** whoever can enter or change an order (owner, Order desk). No new permission. Bot orders never have free lines.
- **Notifications:** "New order" text adds "+ 1 free" after the product; amounts unchanged.
- **Thank-you / reminders / Calls:** unchanged.
- **Old orders:** nothing is changed automatically. O-0100 is delivered with no open bill: Undo delivered → Change (add
  1 free Bluemins 1L) → Mark delivered → Make bill. The other four stay as they are unless the owner changes them.

## 4. Database (Sales migration `0011_free_lines.sql`: **needs the owner's OK**)
- `order_lines.free boolean not null default false`.
  - The check `line_total = quantity * rate` becomes "free → `line_total = 0`; else `line_total = quantity * rate`".
  - The unique `(tenant_id, order_id, version, sku_id)` becomes `(…, sku_id, free)`: one paid and one free line per
    product.
- `bill_lines.free boolean not null default false` (Zoho-imported bills: false).
- Existing rows read as not free, so nothing already saved changes. No new table, no grant change (both tables stay
  SELECT + INSERT). Platform and SSO token unchanged.

## 5. Build steps (one release, v0.48.0)
1. Migration `0011` + `schema.ts`.
2. `src/server/orders.ts`: lines input gains `free`; the uniqueness rule per (product, free); free lines saved at amount 0
   with the worth rate; `lastRates` skips free lines; the change diff in History says "+1 box free".
3. `src/app/lines-editor.tsx` + `src/app/new/form.tsx` + the Change form: the Free boxes section (mock-up 1).
4. Order page, list cards, pending summary, WhatsApp copy, order CSV, notification text (`list.ts`, `handling.ts`,
   `order-cards.tsx`, `notify.ts`).
5. `src/server/bill-make.ts`: free order lines → bill lines with `free`, rate = worth rate, discount = full line; bill
   page, statement, print, Zoho CSV (`free` row); `src/lib/ledger.ts` already allows a line discount equal to the line.
6. Reports: "Free" column in Sales by Item / Customer (`src/lib/report.ts`); `customer-insights.ts` ignores free lines.
7. Tests: a free line saved and shown; the same product paid + free; refused: two free lines of one product, a free line
   with an amount; totals unchanged; Make bill copies it at ₹0; the Zoho row; plant staff see FREE but no amounts;
   tenant isolation unchanged; the bot can't send `free`.
8. `next build` for Sales, NOTES.md, CLAUDE.md status note, deploy (migration first).

## 6. Open points for the owner
1. A free box of **another product** (12 × 1L + 1 × 500ml free) allowed? **Recommended: yes** (same work).
2. The bill shows the free box's **worth** (₹100 − ₹100 = ₹0) rather than a plain ₹0 rate? **Recommended: yes**, the
   customer sees what the scheme gave them and the Zoho file keeps the value.
3. Save the scheme on the customer so the order form suggests it? **Recommended: not now**; add later if schemes grow.
