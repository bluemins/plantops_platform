// Plant answers, step "word the answer": fixed sentences filled only from a card's facts. No AI (D3). A later Odia
// version of each sentence goes beside the English one (Phase 13), so wording never changes meaning.
import { dmy } from "../receivables";
import { formatValue, type Facts, type Value } from "./facts";

export const WORDING_VERSION = 3;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const rs = (v: Value | undefined) => formatValue("money", v ?? 0n);
const N = (v: Value | undefined) => Number(v ?? 0);
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (v: Value | undefined) => (v === null || v === undefined ? null : Number(v));
const upDown = (p: number | null) => (p === null ? null : p > 0 ? `up ${p} %` : p < 0 ? `down ${-p} %` : "the same");

const SENTENCES: Record<string, (f: Facts) => string> = {
  M1: (f) => {
    const n = N(f.totals.customers);
    if (!n) return "Nobody owes anything today.";
    const first = f.rows[0]!;
    const slower = N(f.totals.slower);
    return (
      `${plural(n, "customer owes", "customers owe")} ${rs(f.totals.owed)} in all. ${first.customer} owes the most: ${rs(first.due)}` +
      `${first.oldest_days !== null ? `, oldest bill ${formatValue("days", first.oldest_days)}` : ""}. ` +
      (slower ? `${plural(slower, "customer is", "customers are")} paying slower than usual.` : "Nobody is paying slower than usual.")
    );
  },
  M2: (f) => {
    const bills = Number(f.totals.bills);
    if (!bills) return "No bills are over 30 days late. Nobody to chase today.";
    const first = f.rows[0]!;
    return (
      `${plural(bills, "bill", "bills")} from ${plural(Number(f.totals.customers), "customer", "customers")} ${bills === 1 ? "is" : "are"} over 30 days late, ` +
      `${formatValue("money", f.totals.due)} in all. Call ${first.customer} first: ${formatValue("money", first.due)}, ${formatValue("days", first.oldest_days)} late.`
    );
  },
  M3: (f) => {
    const t = f.totals;
    const change = upDown(pct(t.change_pct));
    const post = N(t.to_post_count) ? ` ${rs(t.to_post)} collected is still waiting in To post.` : "";
    return (
      `${rs(t.total)} came in this week: ${rs((t.cash as bigint) + (t.van as bigint))} cash (van included), ${rs(t.online)} online. ` +
      `The same days last week: ${rs(t.last_week)}${change ? ` (${change})` : ""}.${post}`
    );
  },
  M4: (f) => {
    const t = f.totals;
    if (t.state === "Cash book not started") return "The cash book is not started yet, so there is nothing to check.";
    const open = N(t.days_open) >= 1 ? ` The day has not been closed since ${dmy(String(t.close_date))}.` : "";
    if (t.state === "Matched") return `Cash matched at the last close (${dmy(String(t.close_date))}).${open}`;
    const d = t.difference as bigint;
    const marked = f.rows.filter((r) => r.marks).length;
    return (
      `Cash was ${t.state === "Short" ? "short" : "extra"} ${rs(d < 0n ? -d : d)} at the close on ${dmy(String(t.close_date))} ` +
      `(counted ${rs(t.counted)}, expected ${rs(t.expected)}).` +
      (marked ? ` Look first at the ${plural(marked, "marked entry", "marked entries")} below.` : " No entry stands out: check the entries below one by one.") +
      open
    );
  },
  M5: (f) => {
    const t = f.totals;
    const change = upDown(pct(t.change_pct));
    const brands = (f.lists?.brands ?? []).filter((b) => b.change_pct !== null && b.brand !== "Van sales");
    const best = [...brands].sort((a, b) => N(b.change_pct) - N(a.change_pct))[0];
    const worst = [...brands].sort((a, b) => N(a.change_pct) - N(b.change_pct))[0];
    const range = `${dmy(String(t.from))} to ${dmy(String(t.to))}`;
    if ((t.now as bigint) === 0n && (t.before as bigint) === 0n) return `No sales yet for ${range}.`;
    return (
      `Sales ${range}: ${rs(t.now)}${change ? `, ${change} on the same days before (${rs(t.before)})` : ""}.` +
      (best && N(best.change_pct) > 0 ? ` ${best.brand} grew most (${formatValue("percent", best.change_pct)}).` : "") +
      (worst && N(worst.change_pct) < 0 ? ` ${worst.brand} fell ${-N(worst.change_pct)} %.` : "")
    );
  },
  M6: (f) => {
    const t = f.totals;
    const sold = `Sold today so far: ${rs(t.sold)} from ${plural(N(t.bills), "bill", "bills")} and ${plural(N(t.vans), "van report", "van reports")}`;
    const ch = t.change as bigint;
    const vs = ch === 0n ? ", the same as a week ago." : `, ${rs(ch < 0n ? -ch : ch)} ${ch > 0n ? "more" : "less"} than a week ago.`;
    if (t.cash_state === "Cash book not started") return `The cash book is not started, so cash in the box is not known. ${sold}${vs}`;
    const cash = t.cash_state === "Counted" ? `Cash in the box: ${rs(t.cash)} (counted today).` : `Cash in the box: about ${rs(t.cash)} (expected, not counted yet today).`;
    return `${cash} ${sold}${vs}`;
  },
  O1: (f) => {
    const late = N(f.totals.late);
    if (!N(f.totals.pending)) return "No pending orders.";
    if (!late) return `${plural(N(f.totals.pending), "order is", "orders are")} pending; none has waited 2 days or more.`;
    const first = f.rows[0]!;
    const short = (f.lists?.stock ?? []).filter((s) => /^\d/.test(String(s.short)));
    return (
      `${plural(late, "order has", "orders have")} waited 2 days or more. Oldest: ${first.ref} for ${first.customer}, ${formatValue("days", first.days)}.` +
      (short.length ? ` Short for all pending orders: ${short.map((s) => `${s.product} by ${s.short}`).join(", ")}.` : f.totals.stock_on ? " Stock covers them." : "")
    );
  },
  O2: (f) => {
    const late = N(f.totals.late);
    if (!late) return `No regular customer is late with their next order.${N(f.totals.stopped) ? ` ${plural(N(f.totals.stopped), "customer looks", "customers look")} stopped.` : ""}`;
    const first = f.rows[0]!;
    return `${plural(late, "regular customer is", "regular customers are")} late with their next order. ${first.customer} usually orders every ${formatValue("days", first.usual_gap)} and hasn't for ${formatValue("days", first.since_last)}.`;
  },
  O3: (f) => {
    const n = N(f.totals.stopped);
    if (!n) return `Nobody stopped buying ${f.totals.product}.`;
    return `${plural(n, "customer", "customers")} stopped buying ${f.totals.product}. ${N(f.totals.still_buying)} of them still buy other products from us.`;
  },
  O4: (f) => {
    const first = f.rows[0];
    if (!first) return `No orders from ${dmy(String(f.totals.from))} to ${dmy(String(f.totals.to))}.`;
    return `${first.place} had the most orders: ${N(first.orders)} from ${plural(N(first.customers), "customer", "customers")}. ${plural(N(f.totals.orders), "order", "orders")} came from ${plural(N(f.totals.places), "place", "places")} in all.`;
  },
  O5: (f) => {
    const t = f.totals;
    if (!f.rows.length) return `${t.customer} has too few orders yet to tell a usual order.`;
    const items = f.rows.slice(0, 3).map((r) => `${r.product} × ${r.usual}`).join(", ");
    return `${t.customer} usually orders ${items}${t.usual_gap ? `, about every ${formatValue("days", t.usual_gap)}` : ""}.${t.next_date ? ` Next order expected ${dmy(String(t.next_date))} (${t.next_state}).` : ""}`;
  },
  S1: (f) => {
    if (f.totals.stock_on === null) return "Stock is not checked, so what to make can't be worked out.";
    if (!N(f.totals.pending)) return "No pending orders, so nothing is needed for them today.";
    const make = f.rows.filter((r) => N(r.make) > 0);
    if (!make.length) return "Stock covers every pending order. Nothing needs to be made for them.";
    const list = make.map((r) => `${r.product} ${qty(N(r.make))} ${r.unit ?? "box"}`).join(", ");
    const short = make.filter((r) => r.short_material);
    return (
      `Make ${plural(make.length, "product", "products")} today: ${list}.` +
      (short.length ? ` Not enough material for ${short.map((r) => `${r.product} (${r.short_material} runs out first)`).join(", ")}.` : "")
    );
  },
  S2: (f) => {
    if (f.totals.stock_on === null) return "Stock is not checked, so run-out days can't be worked out.";
    const first = f.rows[0];
    if (!first) return "No material has a rate yet (recipes and enough counts are needed).";
    const soon = N(f.totals.soon);
    return (
      `At this rate, ${first.material} runs out first: in about ${formatValue("days", first.days_left)}.` +
      (soon > 1 ? ` ${plural(soon, "material runs", "materials run")} out within 7 days.` : soon === 1 ? "" : " Nothing runs out within 7 days.")
    );
  },
  S3: (f) => {
    const t = f.totals;
    if (t.day === null) return "Stock is not checked, so the count can't be looked at.";
    const day = dmy(String(t.day));
    if (t.done !== "Done") return `The count for ${day} was not done. Today's count: ${String(t.today).toLowerCase()}.`;
    const n = N(t.not_updated);
    return (
      `The count for ${day} was done${t.by ? ` by ${t.by}` : ""}${t.at ? ` at ${t.at}` : ""}. ` +
      (n ? `${plural(n, "material was", "materials were")} not updated: ${f.rows.map((r) => r.material).join(", ")}. Ask for a correction.` : "Every material used was updated.")
    );
  },
  S4: (f) => {
    if (f.totals.stock_on === null) return "Stock is not checked, so days of stock can't be worked out.";
    const n = N(f.totals.over);
    if (!n) return "No item has more than 60 days of stock at this rate.";
    const first = f.rows[0]!;
    return `${plural(n, "item has", "items have")} more than 60 days of stock at this rate. Most: ${first.item}, about ${formatValue("days", first.days)}.`;
  },
};

/** The sentence for a built card; a card without one is a programming error (tests check every built card). */
export function word(cardId: string, facts: Facts): string {
  const s = SENTENCES[cardId];
  if (!s) throw new Error(`No sentence for card ${cardId}`);
  return s(facts);
}

export const hasSentence = (cardId: string) => cardId in SENTENCES;
