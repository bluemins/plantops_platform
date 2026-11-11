// Purchases P3 + P5 reads (docs/PURCHASES_PHASE_PLAN.md): Payables (owner, Accounts, support), Reports → Purchases (owner,
// support: by item, by vendor, GST paid per month) and "Purchases received" (also Store keepers: what was bought, never
// prices or payments). Rules: src/lib/purchase-report.ts. Cancelled bills and payments are left out.
import { sql } from "drizzle-orm";
import { paise } from "@/lib/ledger";
import { byItem, byVendor, gstByMonth, payables, type PurchaseBillRow, type PurchaseLine } from "@/lib/purchase-report";
import { periodDates, PERIODS, type Period } from "@/lib/report";
import { requireAccess } from "./access";
import { withTenant, type OcTx } from "./db";
import type { OcUser } from "./session";

const IST = "Asia/Kolkata";
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
const P = (s: string | null) => (s === null ? 0n : paise(s));
const milli = (q: string) => {
  const [w, f = ""] = q.split(".");
  return BigInt(w || "0") * 1000n + BigInt((f + "000").slice(0, 3));
};

async function billRows(tx: OcTx, tenantId: string, from: string, to: string): Promise<PurchaseBillRow[]> {
  const r = await tx.execute<{ id: string; number: string; bill_date: string; due_date: string | null; vendor_id: string; vendor: string; sub_total: string; cgst: string; sgst: string; igst: string; tax_total: string; total: string; paid: string }>(sql`
    select b.id, b.number, b.bill_date::text, b.due_date::text, b.vendor_id, coalesce(v.name, b.vendor_name) as vendor,
           b.sub_total::text, b.cgst::text, b.sgst::text, b.igst::text, b.tax_total::text, b.total::text,
           coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = b.tenant_id and a.bill_id = b.id), 0)::numeric(18, 2)::text as paid
      from order_capture.purchase_bills b
      left join order_capture.vendors v on v.tenant_id = b.tenant_id and v.id = b.vendor_id
     where b.tenant_id = ${tenantId} and b.cancelled_at is null and b.bill_date between ${from}::date and ${to}::date
     order by b.bill_date, b.number`);
  return r.rows.map((b) => ({
    id: b.id, number: b.number, bill_date: b.bill_date, due_date: b.due_date, vendor_id: b.vendor_id, vendor: b.vendor,
    sub_total: P(b.sub_total), cgst: P(b.cgst), sgst: P(b.sgst), igst: P(b.igst), tax: P(b.tax_total), total: P(b.total), paid: P(b.paid),
  }));
}

async function lineRows(tx: OcTx, tenantId: string, from: string, to: string, q = "") {
  const r = await tx.execute<{ bill_id: string; number: string; bill_date: string; vendor_id: string; vendor: string; item: string; description: string | null; unit: string | null; quantity: string; line_total: string; tax_amount: string }>(sql`
    select b.id as bill_id, b.number, b.bill_date::text, b.vendor_id, coalesce(v.name, b.vendor_name) as vendor, coalesce(i.name, l.item_name) as item,
           l.description, l.unit, l.quantity::text, l.line_total::text, l.tax_amount::text
      from order_capture.purchase_bill_lines l
      join order_capture.purchase_bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id and b.cancelled_at is null
      left join order_capture.vendors v on v.tenant_id = b.tenant_id and v.id = b.vendor_id
      left join order_capture.purchase_items i on i.tenant_id = l.tenant_id and i.id = l.item_id
     where l.tenant_id = ${tenantId} and b.bill_date between ${from}::date and ${to}::date
       and (${q} = '' or coalesce(i.name, l.item_name) ilike ${"%" + q + "%"} or coalesce(v.name, b.vendor_name) ilike ${"%" + q + "%"})
     order by b.bill_date desc, b.number desc, l.line_no`);
  return r.rows;
}

export type PurchaseReportKind = "item" | "vendor" | "gst";
export const PURCHASE_REPORT_KINDS: PurchaseReportKind[] = ["item", "vendor", "gst"];
export const PURCHASE_REPORT_TITLE: Record<PurchaseReportKind, string> = { item: "Purchases by Item", vendor: "Purchases by Vendor", gst: "GST paid on purchases" };
export const PURCHASE_REPORT_ABOUT: Record<PurchaseReportKind, string> = {
  item: "Quantity, amount and average rate per item bought",
  vendor: "Bills, amount, GST and what is still to pay per vendor",
  gst: "CGST, SGST and IGST per month (input tax, to check against GSTR-2B)",
};

/** Reports → Purchases (owner, support). */
export async function purchaseReport(user: OcUser, kind: PurchaseReportKind, f: { period?: string; from?: string; to?: string }) {
  requireAccess(user, "reports");
  const period = (PERIODS.includes(f.period as Period) ? f.period : "this_fy") as Period;
  const { from, to } = periodDates(period, istToday(), { from: f.from, to: f.to });
  return withTenant(user.tenantId, async (tx) => {
    const bills = await billRows(tx, user.tenantId, from, to);
    const totals = { bills: bills.length, amount: bills.reduce((a, b) => a + b.sub_total, 0n), tax: bills.reduce((a, b) => a + b.tax, 0n), total: bills.reduce((a, b) => a + b.total, 0n) };
    const base = { period, from, to, totals };
    if (kind === "item") {
      const lines: PurchaseLine[] = (await lineRows(tx, user.tenantId, from, to)).map((l) => ({
        bill_id: l.bill_id, bill_date: l.bill_date, vendor: l.vendor, item: l.item, unit: l.unit, qty_milli: milli(l.quantity), amount: P(l.line_total), tax: P(l.tax_amount),
      }));
      return { ...base, kind, items: byItem(lines) };
    }
    if (kind === "vendor") return { ...base, kind, vendors: byVendor(bills) };
    return { ...base, kind, months: gstByMonth(bills) };
  });
}
export type PurchaseReport = Awaited<ReturnType<typeof purchaseReport>>;

/** Payables today: every vendor owed, by age, less advances (owner, Accounts, support). */
export async function payablesReport(user: OcUser) {
  requireAccess(user, "payables");
  return withTenant(user.tenantId, async (tx) => {
    const bills = await billRows(tx, user.tenantId, "1900-01-01", "2999-12-31");
    const adv = await tx.execute<{ vendor_id: string; unused: string }>(sql`
      select p.vendor_id, sum(greatest(p.amount - coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = p.tenant_id and a.payment_id = p.id), 0), 0))::numeric(18, 2)::text as unused
        from order_capture.vendor_payments p
       where p.tenant_id = ${user.tenantId} and p.cancelled_at is null
       group by p.vendor_id`);
    const today = istToday();
    return { today, ...payables(bills, adv.rows.map((a) => ({ vendor_id: a.vendor_id, unused: P(a.unused) })), today) };
  });
}
export type PayablesReport = Awaited<ReturnType<typeof payablesReport>>;

/**
 * Purchases received (owner, Accounts, Store keeper, support): date, vendor, item, quantity, unit, bill no. Never rates,
 * amounts, GST or payments: the Store keeper checks deliveries against the stock count. Default: the last 30 days.
 */
export async function purchasesReceived(user: OcUser, f: { from?: string; to?: string; q?: string } = {}) {
  requireAccess(user, "purchases_received");
  const today = istToday();
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = ok(f.to) ? f.to! : today;
  const from = ok(f.from) ? f.from! : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const q = (f.q ?? "").trim().slice(0, 100);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await lineRows(tx, user.tenantId, from, to, q);
    // only what a Store keeper may see: no money field leaves the server
    const lines = rows.slice(0, 500).map((l) => ({ bill_id: l.bill_id, number: l.number, date: l.bill_date, vendor: l.vendor, item: l.item, description: l.description, quantity: l.quantity, unit: l.unit }));
    return { from, to, q, lines, more: rows.length > 500 };
  });
}
export type PurchasesReceived = Awaited<ReturnType<typeof purchasesReceived>>;

/** The Store keeper's Sales tile (summary view "purchases"): counts only, never money. */
export async function purchasesTile(tenantId: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ week: number; last_date: string | null; last_vendor: string | null }>(sql`
      select (select count(*)::int from order_capture.purchase_bills where tenant_id = ${tenantId} and cancelled_at is null and bill_date between ${weekAgo}::date and ${today}::date) as week,
             b.bill_date::text as last_date, coalesce(v.name, b.vendor_name) as last_vendor
        from (select 1) one
        left join lateral (select * from order_capture.purchase_bills where tenant_id = ${tenantId} and cancelled_at is null order by bill_date desc, created_at desc limit 1) b on true
        left join order_capture.vendors v on v.tenant_id = b.tenant_id and v.id = b.vendor_id`);
    const x = r.rows[0] ?? { week: 0, last_date: null, last_vendor: null };
    const badges: { text: string; tone: "ok" | "info" | "warn" | "danger" }[] = [
      x.week ? { text: `${x.week} purchase${x.week === 1 ? "" : "s"} this week`, tone: "info" } : { text: "No purchases this week", tone: "ok" },
    ];
    if (x.last_date && x.last_vendor) {
      const d = new Date(`${x.last_date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
      badges.push({ text: `Last: ${x.last_vendor}, ${d}`.slice(0, 40), tone: "info" });
    }
    return { badges };
  });
}
