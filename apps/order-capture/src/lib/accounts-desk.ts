// Accounts desk (owner, 2026-11-23; mock-up https://claude.ai/artifact/CGpGYjfaZdGYaUeCgwSHG6): how many orders are at each
// stage, and what each customer owes. Pure rules over the same data as Order to Payment and Receivables, so the numbers
// match the owner's reports. Never a plant-wide ₹ total (those stay owner-only). Money in paise (BigInt).
import { daysBetween, type FlowRow } from "./order-flow";
import type { RecData } from "./receivables";

export const DESK_STAGES = ["pending", "delivered", "billed", "part", "paid", "overdue"] as const;
export type DeskStage = (typeof DESK_STAGES)[number];
export const DESK_STAGE_LABEL: Record<DeskStage, string> = {
  pending: "Pending delivery",
  delivered: "Delivered, not billed",
  billed: "Billed, not paid",
  part: "Part paid",
  paid: "Paid this month",
  overdue: "Overdue orders",
};
export const DESK_STAGE_ABOUT: Record<DeskStage, string> = {
  pending: "Only watch · not delivered yet",
  delivered: "Make the bill",
  billed: "Follow up for payment",
  part: "Collect the rest",
  paid: "Nothing to do",
  overdue: "Call first",
};

const inStage = (r: FlowRow, s: DeskStage, today: string) =>
  s === "overdue" ? r.overdue : s === "paid" ? r.stage === "paid" && r.paid_on?.slice(0, 7) === today.slice(0, 7) : r.stage === s;

export function deskCounts(rows: FlowRow[], today: string): Record<DeskStage, number> {
  return Object.fromEntries(DESK_STAGES.map((s) => [s, rows.filter((r) => inStage(r, s, today)).length])) as Record<DeskStage, number>;
}

/** One stage's orders; `q` = customer name, place or order number. Keeps the order given (oldest waiting first). */
export function deskStageRows(rows: FlowRow[], stage: DeskStage, today: string, q = ""): FlowRow[] {
  const t = q.trim().toLowerCase();
  return rows
    .filter((r) => inStage(r, stage, today))
    .filter((r) => !t || r.customer_name.toLowerCase().includes(t) || r.place.toLowerCase().includes(t) || r.ref.toLowerCase().includes(t));
}

export type DeskDue = {
  key: string;
  name: string;
  place: string;
  phone: string | null;
  /** the customer's page, no tab */
  href: string;
  due: bigint;
  overdue: bigint;
  /** whole days since the oldest unpaid bill */
  oldest_days: number;
  last_paid: string | null;
  /** money paid ahead and not used on a bill yet */
  advance: bigint;
  salespeople: string[];
};

export type DuesFilter = { q?: string; place?: string; salesperson?: string; overdue?: boolean };
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Every customer who owes something today: most overdue first, then most due. */
export function deskDues(d: RecData, phones: ReadonlyMap<string, string>, today: string): DeskDue[] {
  const settled = new Map<string, bigint>();
  const used = new Map<string, bigint>();
  for (const s of d.settles) {
    if (s.on > today) continue;
    settled.set(s.bill_id, (settled.get(s.bill_id) ?? 0n) + s.amount);
    if (s.payment_id) used.set(s.payment_id, (used.get(s.payment_id) ?? 0n) + s.amount);
  }
  const lastPaid = new Map<string, string>();
  const advance = new Map<string, bigint>();
  for (const p of d.payments) {
    if (p.payment_date > today) continue;
    if ((lastPaid.get(p.customer_key) ?? "") < p.payment_date) lastPaid.set(p.customer_key, p.payment_date);
    const left = p.amount - (used.get(p.id) ?? 0n);
    if (left > 0n) advance.set(p.customer_key, (advance.get(p.customer_key) ?? 0n) + left);
  }
  const out = new Map<string, DeskDue & { oldest: string }>();
  for (const b of d.bills) {
    if (b.bill_date > today) continue;
    const due = b.total - (settled.get(b.id) ?? 0n);
    if (due <= 0n) continue;
    const a =
      out.get(b.customer_key) ??
      {
        key: b.customer_key,
        name: b.customer_name,
        place: b.place ?? "",
        phone: b.customer_key.startsWith("c:") ? (phones.get(b.customer_key.slice(2)) ?? null) : null,
        href: b.href.split("?")[0]!,
        due: 0n,
        overdue: 0n,
        oldest: b.bill_date,
        oldest_days: 0,
        last_paid: lastPaid.get(b.customer_key) ?? null,
        advance: advance.get(b.customer_key) ?? 0n,
        salespeople: [],
      };
    out.set(b.customer_key, a);
    a.due += due;
    if ((b.due_date ?? b.bill_date) < today) a.overdue += due;
    if (b.bill_date < a.oldest) a.oldest = b.bill_date;
    const sp = b.salesperson?.trim();
    if (sp && !a.salespeople.includes(sp)) a.salespeople.push(sp);
  }
  return [...out.values()]
    .map(({ oldest, ...a }) => ({ ...a, oldest_days: daysBetween(oldest, today) }))
    .sort((x, y) => (x.overdue === y.overdue ? (x.due === y.due ? x.name.localeCompare(y.name) : x.due > y.due ? -1 : 1) : x.overdue > y.overdue ? -1 : 1));
}

export function filterDues(rows: DeskDue[], f: DuesFilter): DeskDue[] {
  const q = norm(f.q);
  const digits = q.replace(/\D/g, "");
  return rows
    .filter((r) => !q || norm(r.name).includes(q) || norm(r.place).includes(q) || (digits.length >= 4 && (r.phone ?? "").includes(digits.slice(-10))))
    .filter((r) => !f.place || norm(r.place) === norm(f.place))
    .filter((r) => !f.salesperson || r.salespeople.some((s) => norm(s) === norm(f.salesperson)))
    .filter((r) => !f.overdue || r.overdue > 0n);
}

export function duesChoices(rows: DeskDue[]) {
  const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [norm(x), x.trim()])).values()].sort((a, b) => a.localeCompare(b));
  return { places: uniq(rows.map((r) => r.place)), salespeople: uniq(rows.flatMap((r) => r.salespeople)) };
}
