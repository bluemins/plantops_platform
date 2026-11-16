// Reports → Day report (owner only; owner 2026-11-16): the day's facts → the page's four headline numbers, "Needs you",
// the sections, and the evening notification's text. Pure, so the wording and the rules are tested without a database.
import type { DayReportPart } from "@plantops/types";
import { differenceText, signedMoney } from "./cash";
import { unitsText } from "./money";

type Lines = { quantity: number; unit: string }[];
export type Tone = "ok" | "warn" | "bad";

export interface DayFacts {
  date: string;
  newOrders: { count: number; lines: Lines; value: bigint };
  byBrand: { brand: string; orders: number; lines: Lines }[];
  delivered: { count: number; lines: Lines; notBilled: number[] };
  cancelled: { ref: number; reason: string | null }[];
  /** pending now (whatever the date asked) */
  pending: { count: number; late: number; oldestRef: number | null; oldestDays: number | null };
  calls: { callers: number; missed: number; attended: number; new_callers: number };
  bills: { number: string; total: bigint; gst: boolean }[];
  billsCancelled: { number: string; reason: string | null }[];
  gstWaiting: number;
  payments: { mode: string; customer: string; amount: bigint }[];
  vans: { vehicle: string; person: string; sales: bigint; notPaid: bigint; handedIn: bigint; difference: bigint; costs: bigint }[];
  purchases: { bills: number; total: bigint; paid: bigint };
  /** bills + van cash sales that day, with GST; and the same weekday a week before */
  sales: bigint;
  salesWeekAgo: bigint;
  cash:
    | { started: false }
    | {
        started: true;
        beforeStart: boolean;
        close: { counted: bigint; expected: bigint; difference: bigint; reason: string | null; by: string; at: string } | null;
        cashIn: bigint;
        cashOut: bigint;
        expenses: { type: string; amount: bigint }[];
        advances: { person: string; amount: bigint }[];
      };
  /** collections and van "not paid" lines waiting in Cash → To post (now) */
  toPost: number;
  /** customers owe at the end of the day, and at the end of the day before */
  owed: bigint;
  owedBefore: bigint;
  /** what the plant owes vendors now; null for a past day */
  payables: bigint | null;
}

export type OtherPart = { state: "in"; part: DayReportPart } | { state: "off" | "unreachable" };
export interface Section {
  id: string;
  title: string;
  state: "in" | "off" | "unreachable";
  part?: DayReportPart;
}
export interface DayReport {
  date: string;
  isToday: boolean;
  tiles: { label: string; value: string; sub: string; tone?: Tone }[];
  attention: { text: string; section: string }[];
  sections: Section[];
}

const ref = (n: number) => `O-${String(n).padStart(4, "0")}`;
const m = signedMoney;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const abs = (p: bigint) => (p < 0n ? -p : p);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 16 Nov" (short), "Monday 16 Nov 2026" (long), "Mon" (weekday) for a "YYYY-MM-DD". */
export function dayLabel(d: string, form: "short" | "long" | "weekday" = "short") {
  const at = new Date(`${d}T00:00:00Z`);
  const wd = WEEKDAYS[at.getUTCDay()]!;
  if (form === "weekday") return wd.slice(0, 3);
  const dm = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  return form === "long" ? `${wd} ${dm} ${at.getUTCFullYear()}` : `${wd.slice(0, 3)} ${dm}`;
}

function change(now: bigint, before: bigint, what: string) {
  const d = now - before;
  if (d === 0n) return `Same as ${what}`;
  return `${d > 0n ? "▲" : "▼"} ${m(abs(d))} vs ${what}`;
}

function ordersPart(f: DayFacts): DayReportPart {
  const rows: DayReportPart["rows"] = [
    { label: "New orders", value: f.newOrders.count ? `${f.newOrders.count} · ${unitsText(f.newOrders.lines) || "0"} · ${m(f.newOrders.value)}` : "None" },
  ];
  for (const b of f.byBrand) rows.push({ label: `  ${b.brand}`, value: `${plural(b.orders, "order")} · ${unitsText(b.lines) || "0"}` });
  rows.push({ label: "Delivered", value: f.delivered.count ? `${f.delivered.count} · ${unitsText(f.delivered.lines)}` : "None" });
  rows.push({
    label: "Pending now",
    value: `${f.pending.count}${f.pending.late ? ` (${f.pending.late} over 2 days)` : ""}`,
    tone: f.pending.late ? "warn" : f.pending.count ? undefined : "ok",
  });
  if (f.cancelled.length) rows.push({ label: "Cancelled", value: clip(f.cancelled.map((c) => `${ref(c.ref)}${c.reason ? `: ${c.reason}` : ""}`).join(" · "), 300) });
  if (f.calls.callers)
    rows.push({ label: "Calls", value: `${plural(f.calls.callers, "caller")} · ${f.calls.attended} attended${f.calls.new_callers ? ` · ${f.calls.new_callers} new` : ""}${f.calls.missed ? ` · ${f.calls.missed} missed rings` : ""}` });
  const attention: string[] = [];
  if (f.pending.late)
    attention.push(`${plural(f.pending.late, "order")} pending over 2 days${f.pending.oldestRef !== null ? ` (oldest ${ref(f.pending.oldestRef)}, ${plural(f.pending.oldestDays ?? 0, "day")})` : ""}`);
  return { summary: `${f.newOrders.count} new · ${f.delivered.count} delivered · ${f.pending.count} pending`, tone: f.pending.late ? "warn" : "ok", rows, attention };
}

function billsPart(f: DayFacts): DayReportPart {
  const billed = f.bills.reduce((s, b) => s + b.total, 0n);
  const paid = f.payments.reduce((s, p) => s + p.amount, 0n);
  const cash = f.payments.filter((p) => p.mode === "cash").reduce((s, p) => s + p.amount, 0n);
  const rows: DayReportPart["rows"] = [
    { label: "Bills made", value: f.bills.length ? clip(`${f.bills.length} · ${m(billed)} (${f.bills.map((b) => b.number).join(", ")})`, 300) : "None" },
  ];
  const gst = f.bills.filter((b) => b.gst).length;
  if (gst) rows.push({ label: "  GST bills", value: String(gst) });
  if (f.delivered.notBilled.length) rows.push({ label: "Delivered, no bill yet", value: clip(f.delivered.notBilled.map(ref).join(", "), 300), tone: "warn" });
  rows.push({ label: "Payments received", value: f.payments.length ? `${f.payments.length} · ${m(paid)} (cash ${m(cash)} · online ${m(paid - cash)})` : "None" });
  if (f.payments.length) rows.push({ label: "  Biggest", value: clip(`${f.payments[0]!.customer} · ${m(f.payments[0]!.amount)}`, 300) });
  if (f.billsCancelled.length) rows.push({ label: "Bills cancelled", value: clip(f.billsCancelled.map((b) => `${b.number}${b.reason ? `: ${b.reason}` : ""}`).join(" · "), 300), tone: "warn" });
  rows.push({ label: "GST invoices to make in Zoho", value: String(f.gstWaiting), tone: f.gstWaiting ? "warn" : undefined });
  rows.push({ label: "Customers owe (end of day)", value: m(f.owed) });
  const attention: string[] = [];
  if (f.delivered.notBilled.length) attention.push(`${plural(f.delivered.notBilled.length, "order")} delivered with no bill yet`);
  if (f.gstWaiting) attention.push(`${plural(f.gstWaiting, "GST invoice")} to make in Zoho`);
  return { summary: `${m(billed)} billed · ${m(paid)} in`, tone: attention.length ? "warn" : "ok", rows, attention };
}

function cashPart(f: DayFacts, isToday: boolean, shortAlert: bigint): DayReportPart {
  const c = f.cash;
  if (!c.started) return { summary: "Cash book not started", rows: [], attention: [] };
  if (c.beforeStart) return { summary: "Before the cash book started", rows: [], attention: [] };
  const rows: DayReportPart["rows"] = [];
  const attention: string[] = [];
  let summary: string;
  let tone: Tone = "ok";
  if (c.close) {
    const when = new Date(c.close.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    rows.push({ label: "Day closed", value: `${when} by ${c.close.by}` });
    rows.push({ label: "Cash counted", value: `${m(c.close.counted)} (expected ${m(c.close.expected)})` });
    const off = abs(c.close.difference) >= shortAlert;
    rows.push({ label: "Difference", value: clip(`${differenceText(c.close.difference)}${c.close.reason ? `: "${c.close.reason}"` : ""}`, 300), tone: c.close.difference === 0n ? "ok" : off ? "bad" : "warn" });
    if (off) {
      attention.push(clip(`Cash box ${differenceText(c.close.difference).toLowerCase()}${c.close.reason ? `. Reason: "${c.close.reason}"` : ""}`, 200));
      tone = "bad";
    }
    summary = c.close.difference === 0n ? "Closed, matches" : `Closed, ${differenceText(c.close.difference).toLowerCase()}`;
  } else {
    rows.push({ label: "Day closed", value: "Not yet", tone: "warn" });
    attention.push(isToday ? "Cash book not closed yet today" : "Cash book not closed that day");
    summary = "Not closed";
    tone = "warn";
  }
  rows.push({ label: "Cash in / out", value: `${m(c.cashIn)} in · ${m(c.cashOut)} out` });
  const spent = c.expenses.reduce((s, e) => s + e.amount, 0n);
  rows.push({ label: "Expenses", value: c.expenses.length ? m(spent) : "None" });
  for (const e of c.expenses) rows.push({ label: `  ${e.type}`, value: m(e.amount) });
  if (c.advances.length) rows.push({ label: "Advances to staff", value: clip(c.advances.map((a) => `${a.person} ${m(a.amount)}`).join(", "), 300) });
  for (const v of f.vans) {
    rows.push({
      label: `Van: ${v.vehicle} (${v.person})`,
      value: `sales ${m(v.sales)}${v.notPaid ? ` (not paid ${m(v.notPaid)})` : ""} · costs ${m(v.costs)} · handed in ${m(v.handedIn)}${v.difference ? ` · ${differenceText(v.difference).toLowerCase()}` : ""}`,
      tone: abs(v.difference) >= shortAlert ? "bad" : undefined,
    });
    if (abs(v.difference) >= shortAlert) attention.push(`Van ${v.vehicle}: ${differenceText(v.difference).toLowerCase()} (${v.person})`);
  }
  rows.push({ label: "Waiting in To post (now)", value: String(f.toPost), tone: f.toPost ? "warn" : undefined });
  if (f.toPost) attention.push(`${plural(f.toPost, "line")} waiting in Cash → To post`);
  return { summary, tone, rows, attention };
}

function purchasesPart(f: DayFacts): DayReportPart {
  const rows: DayReportPart["rows"] = [
    { label: "Purchase bills", value: f.purchases.bills ? `${f.purchases.bills} · ${m(f.purchases.total)}` : "None" },
    { label: "Paid to vendors", value: m(f.purchases.paid) },
  ];
  if (f.payables !== null) rows.push({ label: "You owe vendors (now)", value: m(f.payables) });
  return { summary: f.purchases.bills ? `${plural(f.purchases.bills, "bill")} · ${m(f.purchases.total)}` : "No purchase bills", tone: "ok", rows, attention: [] };
}

export function buildDayReport(f: DayFacts, others: ({ id: string; title: string } & OtherPart)[], o: { today: string; shortAlert: bigint }): DayReport {
  const isToday = f.date === o.today;
  const paid = f.payments.reduce((s, p) => s + p.amount, 0n);
  const cash = f.payments.filter((p) => p.mode === "cash").reduce((s, p) => s + p.amount, 0n);
  const owedChange = f.owed - f.owedBefore;
  const tiles: DayReport["tiles"] = [
    { label: "Sales (bills + van)", value: m(f.sales), sub: change(f.sales, f.salesWeekAgo, `last ${dayLabel(f.date, "weekday")}`) },
    { label: "Money received", value: m(paid), sub: `Cash ${m(cash)} · Online ${m(paid - cash)}` },
    { label: "Delivered", value: unitsText(f.delivered.lines) || "0", sub: plural(f.delivered.count, "order") },
    {
      label: "Customers owe",
      value: m(f.owed),
      sub: owedChange === 0n ? "Same as the day before" : `${owedChange > 0n ? "▲" : "▼"} ${m(abs(owedChange))} since the day before`,
      tone: owedChange > 0n ? "warn" : owedChange < 0n ? "ok" : undefined,
    },
  ];
  const sections: Section[] = [
    { id: "orders", title: "Orders", state: "in", part: ordersPart(f) },
    { id: "bills", title: "Bills & payments", state: "in", part: billsPart(f) },
    { id: "cash", title: "Cash book", state: "in", part: cashPart(f, isToday, o.shortAlert) },
    { id: "purchases", title: "Purchases", state: "in", part: purchasesPart(f) },
    ...others.filter((x) => x.state !== "off").map((x) => ({ id: x.id, title: x.title, state: x.state, part: x.state === "in" ? x.part : undefined })),
  ];
  const attention = sections.flatMap((s) => (s.part?.attention ?? []).map((text) => ({ text, section: s.id })));
  for (const s of sections) if (s.state === "unreachable") attention.push({ text: `${s.title} didn't answer: its numbers are missing`, section: s.id });
  return { date: f.date, isToday, tiles, attention, sections };
}

/** "Copy as WhatsApp message": the headline numbers, each section's one line, and "Needs you". */
export function dayWhatsappText(r: DayReport) {
  const lines = [`*Day report · ${dayLabel(r.date, "long")}*`];
  lines.push(r.tiles.map((t) => `${t.label}: ${t.value}`).join("\n"));
  for (const s of r.sections) lines.push(`${s.title}: ${s.part ? s.part.summary : "numbers missing"}`);
  if (r.attention.length) lines.push(["*Needs you*", ...r.attention.map((a) => `• ${a.text}`)].join("\n"));
  return lines.join("\n");
}

/** The evening notification: title ≤ 80, body ≤ 300 (CLAUDE.md "Notifications"). */
export function dayNotificationText(r: DayReport) {
  const cash = r.sections.find((s) => s.id === "cash")?.part?.summary;
  const parts = [`Sales ${r.tiles[0]!.value}`, `Received ${r.tiles[1]!.value}`];
  if (cash && cash !== "Cash book not started") parts.push(`Cash: ${cash.toLowerCase()}`);
  parts.push(r.attention.length ? `${plural(r.attention.length, "thing")} ${r.attention.length === 1 ? "needs" : "need"} you` : "Nothing needs you");
  return { title: clip(`Day report · ${dayLabel(r.date)}`, 80), body: clip(parts.join(" · "), 300) };
}
