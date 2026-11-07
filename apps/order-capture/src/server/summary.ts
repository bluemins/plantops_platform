// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored. Up to 3
// badges (docs/ORDER_CAPTURE_PHASE_PLAN.md "Standard pieces", docs/CALLS_PHASE_PLAN.md "Launcher tiles"):
//   Order desk, viewers: "3 pending" (info; "No pending orders" ok)  ·  "1 pending over 2 days" (warn)  ·  "2 new today" (ok)
//   owner: the same, but "12 calls today · 1 waiting" instead of "new today" once the plant has any call recorded
//   Delivery staff ("desk"): "2 waiting" (warn; "Nobody waiting" ok)  ·  "7 calls today" (info); never orders or money
import { sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { AMBER_AFTER_DAYS } from "@/lib/history";
import { LAST_UPTO, LISTED, RING } from "./calls-tab";
import { withTenant, type OcTx } from "./db";
import { reportsTile } from "./reports";

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Calls today and numbers waiting, by the Calls tab's own rules ("Not an order number" left out). */
async function callCounts(tx: OcTx, tenantId: string, todayStart: Date) {
  const { rows } = await tx.execute<{ any: boolean; today: number; waiting: number }>(sql`
    select exists (select 1 from order_capture.call_events e where e.tenant_id = ${tenantId} and e.phone not in ${LISTED}) as any,
           (select count(*)::int from order_capture.call_events e
             where e.tenant_id = ${tenantId} and ${RING} and e.created_at >= ${todayStart} and e.phone not in ${LISTED}) as today,
           (select count(distinct e.phone)::int from order_capture.call_events e
             where e.tenant_id = ${tenantId} and ${RING} and e.created_at > ${LAST_UPTO} and e.phone not in ${LISTED}) as waiting`);
  return rows[0] ?? { any: false, today: 0, waiting: 0 };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wholeRupees = (p: bigint) => `₹${((p + 50n) / 100n).toLocaleString("en-IN")}`;

/** The owner's Reports card (dashboard): last month's sales before GST and the change on the month before. */
async function reportsSummary(tenantId: string, now: Date): Promise<ModuleSummary> {
  const t = await reportsTile(tenantId, istDay(now));
  const m = Number(t.month.slice(5)) - 1;
  const badges: ModuleSummary["badges"] = [{ text: `${MONTH[m]} sales ${wholeRupees(t.sales)}`, tone: "info" }];
  if (t.previous > 0n) {
    const pct = Number(((t.sales - t.previous) * 1000n) / t.previous) / 10;
    const r = Math.round(pct);
    badges.push({ text: `${r >= 0 ? "+" : "−"}${Math.abs(r)}% on ${MONTH[(m + 11) % 12]}`, tone: r >= 0 ? "ok" : "warn" });
  }
  return { badges };
}

/**
 * The owner's Customers card (docs/CUSTOMER_PAGE_PHASE_PLAN.md): customers switched on · money due and from how many
 * (a Zoho contact counts with the customer it is linked to) · Zoho contacts not matched to a customer yet.
 */
async function customersSummary(tenantId: string): Promise<ModuleSummary> {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ customers: number; due: string; owing: number; unmatched: number }>(sql`
      with paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${tenantId} group by bill_id),
           adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${tenantId} group by bill_id),
           d as (
             select coalesce(b.customer_id, zc.customer_id, b.zoho_contact_id) as who,
                    b.total - coalesce(p.s, 0) - coalesce(a.s, 0) as due
               from order_capture.bills b
               left join paid p on p.bill_id = b.id
               left join adj a on a.bill_id = b.id
               left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
              where b.tenant_id = ${tenantId} and b.cancelled_at is null)
      select (select count(*)::int from order_capture.customers where tenant_id = ${tenantId} and active) as customers,
             (select coalesce(sum(due), 0)::numeric(18, 2)::text from d where due > 0) as due,
             (select count(distinct who)::int from d where due > 0) as owing,
             (select count(*)::int from order_capture.zoho_contacts where tenant_id = ${tenantId} and customer_id is null) as unmatched`);
    const r = rows[0] ?? { customers: 0, due: "0", owing: 0, unmatched: 0 };
    const badges: ModuleSummary["badges"] = [{ text: `${r.customers.toLocaleString("en-IN")} customer${r.customers === 1 ? "" : "s"}`, tone: "info" }];
    const due = BigInt(Math.round(Number(r.due) * 100));
    badges.push(due > 0n ? { text: `${wholeRupees(due)} due · ${r.owing} ${r.owing === 1 ? "customer" : "customers"}`, tone: "warn" } : { text: "Nothing due", tone: "ok" });
    if (r.unmatched) badges.push({ text: `${r.unmatched.toLocaleString("en-IN")} Zoho contact${r.unmatched === 1 ? "" : "s"} to match`, tone: "info" });
    return { badges };
  });
}

export function summaryFor(tenantId: string, view: SummaryView, now = new Date()): Promise<ModuleSummary> {
  if (view === "reports") return reportsSummary(tenantId, now);
  if (view === "customers") return customersSummary(tenantId);
  // "over 2 days" = the same rule as the amber cards: entered 2 whole days ago or more
  const amberFrom = new Date(now.getTime() - AMBER_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const todayStart = new Date(`${istDay(now)}T00:00:00+05:30`);
  return withTenant(tenantId, async (tx) => {
    if (view === "desk") {
      const calls = await callCounts(tx, tenantId, todayStart);
      return {
        badges: [
          calls.waiting ? { text: `${calls.waiting} waiting`, tone: "warn" } : { text: "Nobody waiting", tone: "ok" },
          { text: `${calls.today} call${calls.today === 1 ? "" : "s"} today`, tone: "info" },
        ],
      };
    }
    const { rows } = await tx.execute<{ pending: number; old: number; today: number }>(sql`
      select count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'pending' and created_at <= ${amberFrom.toISOString()}::timestamptz)::int as old,
             count(*) filter (where created_at >= ${todayStart.toISOString()}::timestamptz)::int as today
        from order_capture.orders
       where tenant_id = ${tenantId}`);
    const { pending = 0, old = 0, today = 0 } = rows[0] ?? {};
    const badges: ModuleSummary["badges"] = [pending ? { text: `${pending} pending`, tone: "info" } : { text: "No pending orders", tone: "ok" }];
    if (old) badges.push({ text: `${old} pending over ${AMBER_AFTER_DAYS} days`, tone: "warn" });
    const calls = view === "owner" ? await callCounts(tx, tenantId, todayStart) : null;
    if (calls?.any) badges.push({ text: `${calls.today} call${calls.today === 1 ? "" : "s"} today · ${calls.waiting} waiting`, tone: calls.waiting ? "warn" : "info" });
    else if (today) badges.push({ text: `${today} new today`, tone: "ok" });
    return { badges };
  });
}
