// Link bills to orders (owner 2026-11-10; docs/REPORTS_PHASE_PLAN.md section 8). Orders delivered while bills were made in
// Zoho often have their bill imported but not linked to the order, so Order to Payment shows them as "Delivered, not
// billed". The owner links them, one by one or the sure matches together. Pure rules; the server reads and writes
// (src/server/bill-link.ts).
//
// - A candidate bill: imported from Zoho, not cancelled, not an opening balance, not linked to any order, dated within
//   LINK_DAYS days of the delivery, and either the order's customer or the order's exact amount.
// - Ranked: same customer + same amount, then same customer, then same amount under another customer (e.g. the Zoho
//   bill was made to "Retail Sales"); nearer dates first. At most 3 shown per order.
// - Sure match: same customer, same amount, within SURE_DAYS days, the only such bill for that order, and no other order
//   has that bill as a sure match. Only these may be linked all together.
// - Linking moves no money: the bill stays in its own customer's account.

export const LINK_DAYS = 7;
export const SURE_DAYS = 3;
export const SHOW = 3;

export type LinkOrder = { id: string; ref_no: number; customer_id: string; customer_name: string; place: string | null; total: bigint; delivered: string };
export type LinkBill = { id: string; number: string; bill_date: string; total: bigint; customer_id: string | null; customer_name: string };
export type Suggestion = LinkBill & { rank: 0 | 1 | 2; gap: number };
export type LinkRow = { order: LinkOrder; suggestions: Suggestion[]; sure: Suggestion | null };

const day = 86_400_000;
const gapDays = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / day);

/** Every candidate bill for one order, best first (all of them; the screen shows the first SHOW). */
export function candidates(o: LinkOrder, bills: LinkBill[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const b of bills) {
    const gap = gapDays(b.bill_date, o.delivered);
    if (gap > LINK_DAYS) continue;
    const sameCustomer = b.customer_id === o.customer_id;
    const sameAmount = b.total === o.total;
    if (!sameCustomer && !sameAmount) continue;
    out.push({ ...b, gap, rank: sameCustomer && sameAmount ? 0 : sameCustomer ? 1 : 2 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.gap - b.gap || a.number.localeCompare(b.number));
}

const isSure = (s: Suggestion) => s.rank === 0 && s.gap <= SURE_DAYS;

/** One row per order (oldest delivery first), with its suggestions and its sure match if there is one. */
export function linkRows(orders: LinkOrder[], bills: LinkBill[]): LinkRow[] {
  const all = orders.map((order) => ({ order, cands: candidates(order, bills) }));
  // how many orders want each bill as a sure match
  const wanted = new Map<string, number>();
  for (const { cands } of all) for (const s of cands.filter(isSure)) wanted.set(s.id, (wanted.get(s.id) ?? 0) + 1);
  return all
    .map(({ order, cands }) => {
      const sures = cands.filter(isSure);
      const sure = sures.length === 1 && wanted.get(sures[0]!.id) === 1 ? sures[0]! : null;
      return { order, suggestions: cands.slice(0, SHOW), sure };
    })
    .sort((a, b) => a.order.delivered.localeCompare(b.order.delivered) || a.order.ref_no - b.order.ref_no);
}

export const RANK_LABEL: Record<Suggestion["rank"], string> = {
  0: "Same customer, same amount",
  1: "Same customer, other amount",
  2: "Same amount, other customer",
};
