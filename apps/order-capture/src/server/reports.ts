// Reports (docs/REPORTS_PHASE_PLAN.md): reads the bill lines of a period (PlantOps + imported Zoho bills; cancelled and
// opening-balance bills left out) and builds Sales by Item / Sales by Customer with src/lib/report.ts. Owner only
// (PlantOps support reads). Nothing is stored.
import { sql } from "drizzle-orm";
import {
  BREAKDOWNS,
  buildReport,
  GROUPS,
  PERIODS,
  periodDates,
  qtyOf,
  type Breakdown,
  type Group,
  type Period,
  type ReportKind,
  type SalesLine,
} from "@/lib/report";
import { paise } from "@/lib/ledger";
import { requireAccess } from "./access";
import { withTenant } from "./db";
import { kit } from "./kit";
import { istToday } from "./ledger";
import type { OcUser } from "./session";

export type ReportParams = {
  period: Period;
  from: string;
  to: string;
  breakdown: Breakdown;
  group: Group;
  amount: "before" | "with";
  salesperson: string;
  place: string;
  vehicle: string;
};

const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** The report's settings from the address (?period=prev_month&breakdown=month…); anything unknown falls back. */
export function readParams(q: Record<string, string | undefined>, today = istToday()): ReportParams {
  const period = pick(PERIODS, q.period, "prev_month");
  const { from, to } = periodDates(period, today, { from: q.from, to: q.to });
  return {
    period,
    from,
    to,
    breakdown: pick(BREAKDOWNS, q.breakdown, "none"),
    group: pick(GROUPS, q.group, "none"),
    amount: q.amount === "with" ? "with" : "before",
    salesperson: (q.salesperson ?? "").slice(0, 100),
    place: (q.place ?? "").slice(0, 200),
    vehicle: (q.vehicle ?? "").slice(0, 30),
  };
}

/** Every bill line from `from` to `to`, as the report rules want them. */
async function salesLines(tenantId: string, from: string, to: string): Promise<SalesLine[]> {
  const products = new Map((await kit.products(tenantId)).map((p) => [p.id, p]));
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{
      bill_id: string; bill_date: string; salesperson: string | null; vehicle: string | null; customer_key: string; customer_name: string;
      place: string | null; brand: string | null; sku_id: string | null; item_name: string; sku_code: string | null; qty: string; before: string; with_gst: string; free: boolean;
    }>(sql`
      select b.id as bill_id, b.bill_date::text, b.salesperson, b.vehicle,
             coalesce('c:' || cu.id::text, 'z:' || zc.id::text, 'n:' || lower(b.customer_name)) as customer_key,
             coalesce(cu.name, zc.name, b.customer_name) as customer_name,
             cu.place, pr.brand, l.sku_id, l.item_name, l.sku_code, l.quantity::text as qty, l.free,
             coalesce(l.taxable, l.line_total)::text as before,
             (coalesce(l.taxable, l.line_total) + l.tax_amount)::text as with_gst
        from order_capture.bills b
        join order_capture.bill_lines l on l.tenant_id = b.tenant_id and l.bill_id = b.id
        left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
        left join order_capture.customers cu on cu.tenant_id = b.tenant_id and cu.id = coalesce(b.customer_id, zc.customer_id)
        left join order_capture.product_rates pr on pr.tenant_id = b.tenant_id and pr.sku_id = l.sku_id
       where b.tenant_id = ${tenantId}
         and b.cancelled_at is null
         and coalesce(b.zoho_invoice_id, '') not like 'ob:%'
         and b.bill_date between ${from}::date and ${to}::date`);
    return rows.map((r) => {
      const p = r.sku_id ? products.get(r.sku_id) : undefined;
      return {
        bill_id: r.bill_id,
        bill_date: r.bill_date,
        salesperson: r.salesperson,
        customer_key: r.customer_key,
        customer_name: r.customer_name,
        place: r.place,
        vehicle: r.vehicle,
        brand: r.brand,
        // one row per PlantOps product (Zoho's two names for one code count as one); else by Zoho's name
        item_key: r.sku_id ? `s:${r.sku_id}` : `n:${r.item_name.toLowerCase()}`,
        item_name: p?.name ?? r.item_name,
        sku: p?.sku_code ?? r.sku_code,
        qty: qtyOf(r.qty),
        before: paise(r.before),
        with_gst: paise(r.with_gst),
        free: r.free,
      };
    });
  });
}

export async function salesReport(user: OcUser, kind: ReportKind, p: ReportParams) {
  requireAccess(user, "reports");
  const lines = await salesLines(user.tenantId, p.from, p.to);
  return buildReport(lines, {
    kind,
    from: p.from,
    to: p.to,
    breakdown: p.breakdown,
    group: p.group,
    amount: p.amount,
    salesperson: p.salesperson || undefined,
    place: p.place || undefined,
    vehicle: p.vehicle || undefined,
  });
}

/** For the dashboard's Reports card (owner): last month's sales before GST and the change on the month before. */
export async function reportsTile(tenantId: string, today = istToday()) {
  const last = periodDates("prev_month", today);
  // "previous month" seen from a day inside last month = the month before it
  const before = periodDates("prev_month", `${last.from.slice(0, 8)}15`);
  const lines = await salesLines(tenantId, before.from, last.to);
  const sum = (from: string, to: string) => lines.filter((l) => l.bill_date >= from && l.bill_date <= to).reduce((s, l) => s + l.before, 0n);
  return { month: last.from.slice(0, 7), sales: sum(last.from, last.to), previous: sum(before.from, before.to) };
}
