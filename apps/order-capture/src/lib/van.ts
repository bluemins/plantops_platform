// The van report's rules (cash book step C3, docs/CASHBOOK_PHASE_PLAN.md section 3.2), with no database: used by the
// server, the form and the tests. Checked against the RB payments group's real reports:
//   Mini 21 Oct: 12,450 − not paid 3,300 + collected 500 − online 8,500 = 1,150 deposit
//   Mini 7 Nov:  12,200 (Bluemins 10,730 + DM Water 1,470) − not paid 5,500 − online 1,500 = 5,200 deposit
import { paise, rupees, signedMoney } from "./cash";

export interface VanSale {
  product: string;
  brand: string;
  quantity: number;
  /** rupees per unit, "90.00" */
  rate: string;
}

export interface VanFigures {
  sales: VanSale[];
  /** not paid (credit given), rupees each */
  not_paid: string[];
  /** collected from customers: cash lines and online lines, rupees each */
  collected_cash: string[];
  collected_online: string[];
  online: string;
  meal: string;
  tiffin: string;
  diesel: string;
  toll: string;
}

const sum = (xs: string[]) => xs.reduce((s, x) => s + paise(x || "0"), 0n);

/** A line's amount: boxes × rate, in paise (exact). */
export const lineAmount = (l: Pick<VanSale, "quantity" | "rate">) => BigInt(l.quantity) * paise(l.rate || "0");

/** Sales by brand (in the order brands first appear), in paise. */
export function byBrand(sales: VanSale[]) {
  const m = new Map<string, bigint>();
  for (const l of sales) if (l.quantity > 0) m.set(l.brand || "Other", (m.get(l.brand || "Other") ?? 0n) + lineAmount(l));
  return [...m.entries()].map(([brand, amount]) => ({ brand, amount }));
}

/** Cash to hand in = sales − not paid + collected cash − online − meal − tiffin − diesel − toll (paise). */
export function vanSums(f: VanFigures) {
  const sales = f.sales.reduce((s, l) => s + lineAmount(l), 0n);
  const notPaid = sum(f.not_paid);
  const collectedCash = sum(f.collected_cash);
  const collectedOnline = sum(f.collected_online);
  const spent = { online: paise(f.online || "0"), meal: paise(f.meal || "0"), tiffin: paise(f.tiffin || "0"), diesel: paise(f.diesel || "0"), toll: paise(f.toll || "0") };
  const expected = sales - notPaid + collectedCash - spent.online - spent.meal - spent.tiffin - spent.diesel - spent.toll;
  return { sales, not_paid: notPaid, collected_cash: collectedCash, collected_online: collectedOnline, ...spent, expected };
}

/** "Short ₹50" / "Extra ₹50" / "Matches" for cash handed in against the cash to hand in (paise). */
export function vanDifferenceText(handedIn: bigint, expected: bigint) {
  const d = handedIn - expected;
  return d === 0n ? "Matches" : d < 0n ? `Short ${signedMoney(-d)}` : `Extra ${signedMoney(d)}`;
}

/** The report in the WhatsApp group's own layout (owner: "Copy as WhatsApp message" during the switch-over). */
export function vanWhatsapp(r: {
  date: string;
  vehicle: string;
  person: string;
  sales: VanSale[];
  not_paid: { name: string; amount: string }[];
  collected: { name: string; amount: string; mode: "cash" | "upi" }[];
  online: string;
  meal: string;
  tiffin: string;
  diesel: string;
  toll: string;
  handed_in: string;
}) {
  const rs = (p: bigint) => `${rupees(p).replace(/\.00$/, "")} rs`;
  const d = r.date.split("-").reverse().join("/");
  const s = vanSums({ sales: r.sales, not_paid: r.not_paid.map((x) => x.amount), collected_cash: r.collected.filter((c) => c.mode === "cash").map((c) => c.amount), collected_online: r.collected.filter((c) => c.mode === "upi").map((c) => c.amount), online: r.online, meal: r.meal, tiffin: r.tiffin, diesel: r.diesel, toll: r.toll });
  const out = [d, `${r.vehicle} = ${rs(s.sales)} (${r.person})`];
  for (const b of byBrand(r.sales)) out.push(`${b.brand} = ${rs(b.amount)}`);
  if (s.online) out.push(`Online = ${rs(s.online)}`);
  for (const n of r.not_paid) out.push(`${n.name} = ${rs(paise(n.amount))} not paid`);
  for (const c of r.collected) out.push(`${c.name} ${rs(paise(c.amount))} paid${c.mode === "upi" ? " online" : ""}`);
  out.push(`Meal = ${rs(s.meal)}`, `Tiffin = ${rs(s.tiffin)}`);
  if (s.diesel) out.push(`Diesel = ${rs(s.diesel)}`);
  if (s.toll) out.push(`Toll = ${rs(s.toll)}`);
  out.push(`Total deposit = ${rs(paise(r.handed_in))}`);
  return out.join("\n");
}
