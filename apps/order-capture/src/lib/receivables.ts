// Receivables reports (docs/REPORTS_PHASE_PLAN.md section 6, owner 2026-11-10): Customer Balances, Aging Summary, Aging
// Details and Bill Details, with filters like Sales by Item (period or "as of", salesperson, place, vehicle, group by).
// Pure functions over the plant's bills, payments and what settled each bill; the server reads them
// (src/server/reports.ts). Money in paise (BigInt), so totals are exact.
//
// Rules (owner, 2026-11-10):
// - Amounts are always with GST: the customer owes the whole bill.
// - Opening-balance bills (OB-…) count: they are money owed (Sales leaves them out).
// - Cancelled bills and cancelled payments are left out completely, with everything that settled them, even when looking
//   back to a date before they were cancelled.
// - "As of" a date: only bills dated up to it, and only payments / adjustments dated up to it, count.
// - Aging by due date (Zoho's way; a bill without one is due on its bill date) or by bill date; bands of 15 or 30 days.
// - Salesperson and vehicle belong to a bill, not to a customer. With either as a filter or a grouping, Customer
//   Balances works per bill (what those bills still owe); advances can't be split that way and are left out.
import { billStatus, BILL_STATUS_LABEL, type BillStatus } from "./ledger";
import { NOT_MENTIONED, periodDates } from "./report";

export const REC_KINDS = ["balances", "aging", "aging-details", "bills"] as const;
export type RecKind = (typeof REC_KINDS)[number];
export const REC_TITLE: Record<RecKind, string> = {
  balances: "Customer Balances",
  aging: "Aging Summary",
  "aging-details": "Aging Details",
  bills: "Bill Details",
};
export const REC_ABOUT: Record<RecKind, string> = {
  balances: "Opening, billed, received and closing balance per customer",
  aging: "What each customer owes, by how old it is",
  "aging-details": "Every unpaid bill with its age",
  bills: "Every bill in a period with its status and what is still due",
};

export const AS_OFS = ["today", "end_prev_month", "end_prev_quarter", "end_prev_fy", "custom"] as const;
export type AsOf = (typeof AS_OFS)[number];
export const AS_OF_LABEL: Record<AsOf, string> = {
  today: "Today",
  end_prev_month: "End of last month",
  end_prev_quarter: "End of last quarter",
  end_prev_fy: "End of last financial year",
  custom: "Custom date",
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The date an "as of" choice means on `today` (an India date). */
export function asOfDate(choice: AsOf, today: string, custom?: string): string {
  switch (choice) {
    case "today":
      return today;
    case "end_prev_month":
      return periodDates("prev_month", today).to;
    case "end_prev_quarter":
      return periodDates("prev_quarter", today).to;
    case "end_prev_fy":
      return periodDates("prev_fy", today).to;
    case "custom":
      return custom && YMD.test(custom) && !Number.isNaN(Date.parse(custom)) ? custom : today;
  }
}

export type Basis = "due" | "bill";
export type Interval = 15 | 30;

/** "Current", "1–15 days", "16–30 days", "31–45 days", "Over 45 days" (or 30-day steps). */
export function bandLabels(i: Interval) {
  return ["Current", `1–${i} days`, `${i + 1}–${2 * i} days`, `${2 * i + 1}–${3 * i} days`, `Over ${3 * i} days`];
}
/** age in days → band 0 (current: not yet due) … 4 */
export const bandIndex = (age: number, i: Interval) => (age <= 0 ? 0 : Math.min(4, Math.ceil(age / i)));

/** whole days from `a` to `b` (YYYY-MM-DD) */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ---------- the rows the server reads ----------

type Party = {
  /** 'c:<customer id>' or 'z:<zoho contact id>' (a Zoho contact not matched yet) */
  customer_key: string;
  customer_name: string;
  /** the customer's statement page */
  href: string;
  place: string | null;
};
export type RecBill = Party & {
  id: string;
  number: string;
  bill_date: string;
  due_date: string | null;
  total: bigint;
  salesperson: string | null;
  vehicle: string | null;
};
export type RecPayment = Party & { id: string; payment_date: string; amount: bigint };
/** what settled part of a bill: a payment's allocation (a negative row undoes one) or an adjustment (no payment) */
export type RecSettle = { bill_id: string; payment_id: string | null; amount: bigint; on: string };
/** Only bills and payments that are not cancelled, and only settles between those. */
export type RecData = { bills: RecBill[]; payments: RecPayment[]; settles: RecSettle[] };

export type RecFilter = { salesperson?: string; place?: string; vehicle?: string };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const same = (a: string | null, b: string) => (b === NOT_MENTIONED ? !a?.trim() : norm(a) === norm(b));
const placeOk = (f: RecFilter, x: { place: string | null }) => !f.place || same(x.place, f.place);
const billOk = (f: RecFilter, b: RecBill) =>
  placeOk(f, b) && (!f.salesperson || same(b.salesperson, f.salesperson)) && (!f.vehicle || same(b.vehicle, f.vehicle));

/** The choices for the filter drop-downs: what the plant's bills have. */
export function recChoices(d: RecData) {
  const uniq = (xs: (string | null)[]) => {
    const seen = new Map<string, string>();
    for (const x of xs) if (x?.trim() && !seen.has(norm(x))) seen.set(norm(x), x.trim());
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  };
  return { salespeople: uniq(d.bills.map((b) => b.salesperson)), places: uniq(d.bills.map((b) => b.place)), vehicles: uniq(d.bills.map((b) => b.vehicle)) };
}

// ---------- grouping ----------

export const REC_GROUPS = ["none", "band", "customer", "salesperson", "place", "vehicle", "status"] as const;
export type RecGroup = (typeof REC_GROUPS)[number];
export const REC_GROUP_LABEL: Record<RecGroup, string> = {
  none: "None",
  band: "Age band",
  customer: "Customer",
  salesperson: "Salesperson",
  place: "Place",
  vehicle: "Vehicle",
  status: "Status",
};
/** which groupings each report offers (the first is its default) */
export const GROUPS_FOR: Record<RecKind, RecGroup[]> = {
  balances: ["none", "salesperson", "place", "vehicle"],
  aging: ["none", "salesperson", "place", "vehicle"],
  "aging-details": ["band", "none", "customer", "salesperson", "place", "vehicle"],
  bills: ["none", "customer", "salesperson", "place", "vehicle", "status"],
};

const NO_PLACE = "No place (Zoho contact not matched)";
function partyGroup(g: RecGroup, x: Party & { salesperson?: string | null; vehicle?: string | null }): { key: string; label: string; order: number } {
  switch (g) {
    case "salesperson": {
      const label = x.salesperson?.trim() || NOT_MENTIONED;
      return { key: norm(label), label, order: x.salesperson?.trim() ? 1 : 0 };
    }
    case "place": {
      const label = x.place?.trim() || NO_PLACE;
      return { key: norm(label), label, order: x.place?.trim() ? 1 : 0 };
    }
    case "vehicle": {
      const label = x.vehicle?.trim() || "No vehicle";
      return { key: norm(label), label, order: x.vehicle?.trim() ? 1 : 0 };
    }
    case "customer":
      return { key: x.customer_key, label: x.customer_name, order: 1 };
    default:
      return { key: "all", label: "", order: 0 };
  }
}

// ---------- the table every report gives (the page draws it, the CSV writes it) ----------

/** bigint = money (paise); text = anything else */
export type RecCell = bigint | string;
export type RecRow = { key: string; label: string; href: string; cells: RecCell[] };
export type RecTableGroup = { key: string; label: string; rows: RecRow[]; total: RecCell[] };
export type RecTable = {
  firstHead: string;
  heads: string[];
  /** right-aligned (numbers) */
  right: boolean[];
  grouped: boolean;
  groups: RecTableGroup[];
  total: RecCell[];
  /** how many rows (customers or bills) the report has */
  count: number;
  empty: string;
  notes: string[];
  /** aging: money paid ahead and not yet used on a bill on the "as of" day (not taken off the table) */
  advance?: bigint | null;
};

const sumCol = (rows: RecRow[], i: number, kind: "money" | "count" | "blank"): RecCell =>
  kind === "money" ? rows.reduce((s, r) => s + (r.cells[i] as bigint), 0n) : kind === "count" ? String(rows.reduce((s, r) => s + Number(r.cells[i]), 0)) : "";

/** Rows into groups (in `order`, then by name; or by `rank` when given), each with its column totals. */
function assemble(
  rows: (RecRow & { group: { key: string; label: string; order: number; rank?: number } })[],
  cols: ("money" | "count" | "blank")[],
  grouped: boolean,
) {
  const map = new Map<string, { key: string; label: string; order: number; rank?: number; rows: RecRow[] }>();
  for (const r of rows) {
    const g = map.get(r.group.key) ?? { ...r.group, rows: [] };
    map.set(r.group.key, g);
    g.rows.push({ key: r.key, label: r.label, href: r.href, cells: r.cells });
  }
  const groups: RecTableGroup[] = [...map.values()]
    .sort((a, b) =>
      a.rank !== undefined && b.rank !== undefined ? a.rank - b.rank : a.order - b.order || a.label.localeCompare(b.label, "en", { sensitivity: "base" }),
    )
    .map((g) => ({ key: g.key, label: g.label, rows: g.rows, total: cols.map((c, i) => sumCol(g.rows, i, c)) }));
  const all = groups.flatMap((g) => g.rows);
  return { grouped, groups, total: cols.map((c, i) => sumCol(all, i, c)), count: all.length };
}

const byMoneyDesc = (i: number) => (a: RecRow, b: RecRow) => {
  const x = a.cells[i] as bigint;
  const y = b.cells[i] as bigint;
  return x === y ? a.label.localeCompare(b.label, "en", { sensitivity: "base" }) : x > y ? -1 : 1;
};

export const dmy = (d: string) => d.split("-").reverse().join("-");

// ---------- 1. Customer Balances ----------

export type Show = "owe" | "nonzero" | "all";
export const SHOW_LABEL: Record<Show, string> = { owe: "Customers who owe", nonzero: "Who owe or paid ahead", all: "Everyone with a balance or bills" };

export function customerBalances(d: RecData, o: { from: string; to: string; filter: RecFilter; group: RecGroup; show: Show }): RecTable {
  const group = GROUPS_FOR.balances.includes(o.group) ? o.group : "none";
  const perBill = !!o.filter.salesperson || !!o.filter.vehicle || group === "salesperson" || group === "vehicle";
  type Acc = { party: Party; gx: RecBill | Party; opening: bigint; billed: bigint; received: bigint };
  const accs = new Map<string, Acc>();
  const acc = (party: Party, gx: RecBill | Party) => {
    const g = partyGroup(group, gx);
    const k = `${g.key}\u0000${party.customer_key}`;
    const a = accs.get(k) ?? { party, gx, opening: 0n, billed: 0n, received: 0n };
    accs.set(k, a);
    return a;
  };
  const bills = d.bills.filter((b) => b.bill_date <= o.to && (perBill ? billOk(o.filter, b) : placeOk(o.filter, b)));
  for (const b of bills) {
    const a = acc(b, b);
    if (b.bill_date < o.from) a.opening += b.total;
    else a.billed += b.total;
  }
  // what came in: per bill = what settled those bills; per customer = payments + adjustments (Zoho credit notes etc.)
  const kept = new Map(bills.map((b) => [b.id, b]));
  const allBills = new Map(d.bills.map((b) => [b.id, b]));
  const credit = (party: Party, gx: RecBill | Party, amount: bigint, on: string) => {
    if (on > o.to) return;
    const a = acc(party, gx);
    if (on < o.from) a.opening -= amount;
    else a.received += amount;
  };
  for (const s of d.settles) {
    if (perBill) {
      const b = kept.get(s.bill_id);
      if (b) credit(b, b, s.amount, s.on);
    } else if (s.payment_id === null) {
      const b = allBills.get(s.bill_id);
      if (b && placeOk(o.filter, b)) credit(b, b, s.amount, s.on);
    }
  }
  if (!perBill) for (const p of d.payments) if (placeOk(o.filter, p)) credit(p, p, p.amount, p.payment_date);

  const rows = [...accs.values()]
    .map((a) => ({ ...a, closing: a.opening + a.billed - a.received }))
    .filter((a) =>
      o.show === "owe" ? a.closing > 0n : o.show === "nonzero" ? a.closing !== 0n : a.closing !== 0n || a.opening !== 0n || a.billed !== 0n || a.received !== 0n,
    )
    .map((a) => ({
      key: a.party.customer_key,
      label: a.party.customer_name,
      href: a.party.href,
      cells: [a.opening, a.billed, a.received, a.closing] as RecCell[],
      group: partyGroup(group, a.gx),
    }))
    .sort(byMoneyDesc(3));
  const notes = [
    "Received includes amounts closed in Zoho without a payment (credit notes). A minus balance is an advance: paid ahead of bills.",
  ];
  if (perBill)
    notes.push("Salesperson and vehicle belong to a bill, so this shows what those bills owe. Advances (money paid ahead of a bill) are left out.");
  return {
    firstHead: "Customer",
    heads: ["Opening balance", "Billed", "Received", "Closing balance"],
    right: [true, true, true, true],
    ...assemble(rows, ["money", "money", "money", "money"], group !== "none"),
    empty: o.show === "owe" ? "Nobody owes anything in this period." : "No balances in this period.",
    notes,
  };
}

// ---------- 2. + 3. Aging ----------

type OpenBill = RecBill & { due: bigint; age: number; band: number };

/** Bills dated up to `asOf` that still owe something on that day, with their age. */
function openBillsAsOf(d: RecData, asOf: string, basis: Basis, interval: Interval, filter: RecFilter): OpenBill[] {
  const settled = new Map<string, bigint>();
  for (const s of d.settles) if (s.on <= asOf) settled.set(s.bill_id, (settled.get(s.bill_id) ?? 0n) + s.amount);
  return d.bills
    .filter((b) => b.bill_date <= asOf && billOk(filter, b))
    .map((b) => {
      const age = daysBetween(basis === "due" ? (b.due_date ?? b.bill_date) : b.bill_date, asOf);
      return { ...b, due: b.total - (settled.get(b.id) ?? 0n), age, band: bandIndex(age, interval) };
    })
    .filter((b) => b.due > 0n);
}

/** Money paid ahead and not used on a bill by `asOf`, for customers matching the place filter. */
export function advancesAsOf(d: RecData, asOf: string, filter: RecFilter): bigint {
  const used = new Map<string, bigint>();
  for (const s of d.settles) if (s.payment_id && s.on <= asOf) used.set(s.payment_id, (used.get(s.payment_id) ?? 0n) + s.amount);
  let total = 0n;
  for (const p of d.payments) {
    if (p.payment_date > asOf || !placeOk(filter, p)) continue;
    const left = p.amount - (used.get(p.id) ?? 0n);
    if (left > 0n) total += left;
  }
  return total;
}

/** advances are per customer: not shown when the report is filtered by a bill's salesperson or vehicle */
const advanceFor = (d: RecData, asOf: string, filter: RecFilter): bigint | null => {
  if (filter.salesperson || filter.vehicle) return null;
  const adv = advancesAsOf(d, asOf, filter);
  return adv > 0n ? adv : null;
};

export type AgingOptions = { asOf: string; basis: Basis; interval: Interval; filter: RecFilter; group: RecGroup };

export function agingSummary(d: RecData, o: AgingOptions): RecTable {
  const group = GROUPS_FOR.aging.includes(o.group) ? o.group : "none";
  const open = openBillsAsOf(d, o.asOf, o.basis, o.interval, o.filter);
  const accs = new Map<string, { b: OpenBill; bills: number; bands: bigint[] }>();
  for (const b of open) {
    const k = `${partyGroup(group, b).key}\u0000${b.customer_key}`;
    const a = accs.get(k) ?? { b, bills: 0, bands: [0n, 0n, 0n, 0n, 0n] };
    accs.set(k, a);
    a.bills += 1;
    a.bands[b.band]! += b.due;
  }
  const rows = [...accs.values()]
    .map((a) => ({
      key: a.b.customer_key,
      label: a.b.customer_name,
      href: a.b.href,
      cells: [String(a.bills), ...a.bands, a.bands.reduce((s, x) => s + x, 0n)] as RecCell[],
      group: partyGroup(group, a.b),
    }))
    .sort(byMoneyDesc(6));
  return {
    firstHead: "Customer",
    heads: ["Bills", ...bandLabels(o.interval), "Total due"],
    right: [true, true, true, true, true, true, true],
    ...assemble(rows, ["count", "money", "money", "money", "money", "money", "money"], group !== "none"),
    empty: `Nothing was due on ${dmy(o.asOf)}.`,
    notes: [o.basis === "due" ? "Age counted from each bill's due date (a bill without one: its bill date). Current = not yet due." : "Age counted from each bill's date."],
    advance: advanceFor(d, o.asOf, o.filter),
  };
}

export function agingDetails(d: RecData, o: AgingOptions): RecTable {
  const group = GROUPS_FOR["aging-details"].includes(o.group) ? o.group : "band";
  const labels = bandLabels(o.interval);
  const rows = openBillsAsOf(d, o.asOf, o.basis, o.interval, o.filter)
    .sort((a, b) => b.age - a.age || a.number.localeCompare(b.number, "en", { numeric: true }))
    .map((b) => ({
      key: b.id,
      label: b.number,
      href: `/bills/${b.id}`,
      cells: [dmy(b.bill_date), b.customer_name, dmy(b.due_date ?? b.bill_date), b.age > 0 ? String(b.age) : "—", labels[b.band]!, b.total, b.due] as RecCell[],
      group: group === "band" ? { key: `band${b.band}`, label: labels[b.band]!, order: 0, rank: -b.band } : partyGroup(group, b),
    }));
  return {
    firstHead: "Bill",
    heads: ["Date", "Customer", "Due date", o.basis === "due" ? "Days overdue" : "Days old", "Age", "Bill total", "Still due"],
    right: [false, false, false, true, false, true, true],
    ...assemble(rows, ["blank", "blank", "blank", "blank", "blank", "money", "money"], group !== "none"),
    empty: `Nothing was due on ${dmy(o.asOf)}.`,
    notes: [o.basis === "due" ? "Age counted from each bill's due date (a bill without one: its bill date)." : "Age counted from each bill's date."],
    advance: advanceFor(d, o.asOf, o.filter),
  };
}

// ---------- 4. Bill Details ----------

export const BILL_SHOWS = ["all", "open", "overdue", "paid"] as const;
export type BillShow = (typeof BILL_SHOWS)[number];
export const BILL_SHOW_LABEL: Record<BillShow, string> = { all: "All bills", open: "Not fully paid", overdue: "Overdue", paid: "Paid" };
const STATUS_RANK: Record<BillStatus, number> = { overdue: 0, part_paid: 1, due: 2, paid: 3, cancelled: 4 };

export function billDetails(d: RecData, o: { from: string; to: string; today: string; status: BillShow; filter: RecFilter; group: RecGroup }): RecTable {
  const group = GROUPS_FOR.bills.includes(o.group) ? o.group : "none";
  const settled = new Map<string, bigint>();
  for (const s of d.settles) settled.set(s.bill_id, (settled.get(s.bill_id) ?? 0n) + s.amount);
  const rows = d.bills
    .filter((b) => b.bill_date >= o.from && b.bill_date <= o.to && billOk(o.filter, b))
    .map((b) => {
      const due = b.total - (settled.get(b.id) ?? 0n);
      const status = billStatus({ id: b.id, number: b.number, bill_date: b.bill_date, due_date: b.due_date, total: b.total, cancelled: false, order_id: null }, due, o.today);
      return { b, due: due > 0n ? due : 0n, status };
    })
    .filter((x) => (o.status === "open" ? x.due > 0n : o.status === "overdue" ? x.status === "overdue" : o.status === "paid" ? x.due <= 0n : true))
    .sort((x, y) => y.b.bill_date.localeCompare(x.b.bill_date) || y.b.number.localeCompare(x.b.number, "en", { numeric: true }))
    .map(({ b, due, status }) => ({
      key: b.id,
      label: b.number,
      href: `/bills/${b.id}`,
      cells: [dmy(b.bill_date), b.customer_name, b.due_date ? dmy(b.due_date) : "—", BILL_STATUS_LABEL[status], b.total, due] as RecCell[],
      group:
        group === "status"
          ? { key: status, label: BILL_STATUS_LABEL[status], order: 0, rank: STATUS_RANK[status] }
          : partyGroup(group, b),
    }));
  return {
    firstHead: "Bill",
    heads: ["Date", "Customer", "Due date", "Status", "Bill total", "Still due"],
    right: [false, false, false, false, true, true],
    ...assemble(rows, ["blank", "blank", "blank", "blank", "money", "money"], group !== "none"),
    empty: "No bills in this period.",
    notes: ["Status and what is still due are as of today. Opening balances imported from Zoho are the OB-… bills."],
  };
}
