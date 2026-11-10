// Order to Payment (Reports → Sales; owner 2026-11-10, mock-up https://claude.ai/artifact/VUbSpP5peyr332yuX9pSCS):
// where every order stands, order → delivered → bill → paid, as a Board (a column per stage) or a List. Pure rules over
// the plant's orders with their bill; the server reads them (src/server/reports.ts). Money in paise (BigInt).
//
// Stages (worked out every time, nothing stored):
//   pending    the order is not delivered                                     waiting since it was entered
//   delivered  delivered, no bill                                              waiting since delivery
//   billed     a bill, nothing received on it                                 waiting since the bill date
//   part       a bill, part received                                          waiting since the bill date
//   paid       the bill is fully settled (the order shows "Closed")
//   cancelled  cancelled orders (left out unless asked for)
// One ledger (owner 2026-11-10): bills imported from Zoho and bills made in PlantOps count the same; nothing tells them
// apart. A delivered order whose bill isn't linked to it shows as "Delivered, not billed" until it is linked.
// Amount of a stage: pending / delivered = the order's total; billed / part = still due on the bill (with GST);
// paid = the bill's total. Overdue = something still due after the bill's due date (no due date = the bill date).
import { NOT_MENTIONED, periodDates, PERIOD_LABEL, PERIODS, type Period } from "./report";

export const FLOW_STAGES = ["pending", "delivered", "billed", "part", "paid", "cancelled"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];
export const FLOW_STAGE_LABEL: Record<FlowStage, string> = {
  pending: "Pending",
  delivered: "Delivered, not billed",
  billed: "Billed, not paid",
  part: "Part paid",
  paid: "Paid (Closed)",
  cancelled: "Cancelled",
};
export const FLOW_STAGE_ABOUT: Record<FlowStage, string> = {
  pending: "Not delivered yet · days since entered",
  delivered: "Make the bill · days since delivered",
  billed: "Nothing received · days since the bill",
  part: "Some money received · days since the bill",
  paid: "Bill fully paid",
  cancelled: "Cancelled orders",
};

/** Periods by the day the order was entered; "all" = every order. */
export const FLOW_PERIODS = ["all", ...PERIODS] as const;
export type FlowPeriod = (typeof FLOW_PERIODS)[number];
export const FLOW_PERIOD_LABEL: Record<FlowPeriod, string> = { all: "All orders", ...PERIOD_LABEL };

export type FlowOrder = {
  id: string;
  ref_no: number;
  status: "pending" | "delivered" | "cancelled";
  /** India dates (YYYY-MM-DD) */
  entered: string;
  delivered: string | null;
  delivered_by: string | null;
  total: bigint;
  customer_id: string;
  customer_name: string;
  phone: string;
  place: string | null;
  brands: string[];
  /** the order's bill that is not cancelled (one at most) */
  bill: null | {
    id: string;
    number: string;
    bill_date: string;
    due_date: string | null;
    total: bigint;
    /** received on it + adjustments, leaving out cancelled payments */
    settled: bigint;
    /** the last day something settled it */
    settled_on: string | null;
    salesperson: string | null;
  };
};

export type FlowRow = {
  id: string;
  ref: string;
  href: string;
  stage: FlowStage;
  entered: string;
  delivered: string | null;
  customer_name: string;
  customer_href: string;
  place: string;
  order_total: bigint;
  bill: { href: string; number: string; date: string; total: bigint; received: bigint } | null;
  due: bigint;
  /** what the stage counts: see the header */
  amount: bigint;
  /** whole days in this stage (null for paid / cancelled) */
  days: number | null;
  overdue: boolean;
  /** paid: the day it was fully paid */
  paid_on: string | null;
  salesperson: string;
};

export const orderRef = (n: number) => `O-${String(n).padStart(4, "0")}`;
const dayMs = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / dayMs));

/** The stage of one order. */
export function flowStage(o: FlowOrder): FlowStage {
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "pending") return "pending";
  if (!o.bill) return "delivered";
  const due = o.bill.total - o.bill.settled;
  if (due <= 0n) return "paid";
  return o.bill.settled > 0n ? "part" : "billed";
}

export function flowRow(o: FlowOrder, today: string): FlowRow {
  const stage = flowStage(o);
  const b = o.bill;
  const due = b && stage !== "cancelled" ? (b.total - b.settled > 0n ? b.total - b.settled : 0n) : 0n;
  const amount = stage === "billed" || stage === "part" ? due : stage === "paid" ? b!.total : o.total;
  const since = stage === "pending" ? o.entered : stage === "delivered" ? o.delivered : stage === "billed" || stage === "part" ? b!.bill_date : null;
  const dueDate = b ? (b.due_date ?? b.bill_date) : null;
  return {
    id: o.id,
    ref: orderRef(o.ref_no),
    href: `/o/${o.id}`,
    stage,
    entered: o.entered,
    delivered: o.delivered,
    customer_name: o.customer_name,
    customer_href: `/customers/${o.customer_id}`,
    place: o.place ?? "",
    order_total: o.total,
    bill: b ? { href: `/bills/${b.id}`, number: b.number, date: b.bill_date, total: b.total, received: b.settled } : null,
    due,
    amount,
    days: since ? daysBetween(since, today) : null,
    overdue: (stage === "billed" || stage === "part") && !!dueDate && dueDate < today,
    paid_on: stage === "paid" ? (b!.settled_on ?? b!.bill_date) : null,
    salesperson: b?.salesperson?.trim() || o.delivered_by?.trim() || NOT_MENTIONED,
  };
}

export type FlowFilter = {
  period: FlowPeriod;
  from: string;
  to: string;
  /** name or phone digits */
  customer: string;
  salesperson: string;
  place: string;
  brand: string;
  overdue: boolean;
  cancelled: boolean;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every order of the period that passes the filters, as rows. */
export function flowRows(orders: FlowOrder[], today: string, f: FlowFilter): FlowRow[] {
  const q = f.customer.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return orders
    .filter((o) => f.period === "all" || (o.entered >= f.from && o.entered <= f.to))
    .filter((o) => !q || o.customer_name.toLowerCase().includes(q) || (digits.length >= 4 && o.phone.includes(digits.slice(-10))))
    .filter((o) => !f.place || same(o.place ?? "", f.place))
    .filter((o) => !f.brand || o.brands.some((b) => same(b, f.brand)))
    .map((o) => flowRow(o, today))
    .filter((r) => !f.salesperson || same(r.salesperson, f.salesperson))
    .filter((r) => !f.overdue || r.overdue)
    .filter((r) => f.cancelled || r.stage !== "cancelled");
}

const ORDER: FlowStage[] = ["billed", "part", "delivered", "pending", "paid", "cancelled"];
/** List order: money waiting first (oldest bill first), then not billed, pending (oldest first), paid (newest first). */
export function sortRows(rows: FlowRow[]): FlowRow[] {
  return [...rows].sort((a, b) => {
    const s = ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage);
    if (s) return s;
    if (a.stage === "paid") return (b.paid_on ?? "").localeCompare(a.paid_on ?? "") || b.ref.localeCompare(a.ref);
    return (b.days ?? 0) - (a.days ?? 0) || a.ref.localeCompare(b.ref);
  });
}

export type StageSum = { stage: FlowStage; count: number; amount: bigint; overdue: number };

/** Count and amount per stage, in board order; cancelled only when it is shown. */
export function stageSums(rows: FlowRow[], withCancelled: boolean): StageSum[] {
  const stages = FLOW_STAGES.filter((s) => withCancelled || s !== "cancelled");
  return stages.map((stage) => {
    const in_ = rows.filter((r) => r.stage === stage);
    return { stage, count: in_.length, amount: in_.reduce((t, r) => t + r.amount, 0n), overdue: in_.filter((r) => r.overdue).length };
  });
}

/** The Paid column shows only what was paid in the last `days` days; the rest are in the List. */
export const PAID_RECENT_DAYS = 7;
export const recentlyPaid = (r: FlowRow, today: string) => r.stage === "paid" && !!r.paid_on && daysBetween(r.paid_on, today) <= PAID_RECENT_DAYS;

/** The filter choices on the page: places, salespeople and brands that appear on the plant's orders. */
export function flowChoices(orders: FlowOrder[], today: string) {
  const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.trim().toLowerCase(), x.trim()])).values()].sort((a, b) => a.localeCompare(b));
  return {
    places: uniq(orders.map((o) => o.place ?? "")),
    salespeople: uniq(orders.map((o) => flowRow(o, today).salesperson)).filter((s) => s !== NOT_MENTIONED),
    brands: uniq(orders.flatMap((o) => o.brands)),
  };
}

/** The period's dates (for "all" the dates are unused). */
export function flowDates(period: FlowPeriod, today: string, custom: { from?: string; to?: string }) {
  return period === "all" ? { from: "", to: today } : periodDates(period as Period, today, custom);
}
