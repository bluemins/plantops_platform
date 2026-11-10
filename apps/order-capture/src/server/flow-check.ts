// Order flow check (Reports → Sales; src/lib/flow-check.ts): reads the plant's orders with their events and bills.
// Read-only; owner (support reads), the same access row as every report.
import { sql } from "drizzle-orm";
import { checkDates, CHECK_PERIODS, flowCheck, type CheckOrder, type CheckPeriod } from "@/lib/flow-check";
import { paise } from "@/lib/ledger";
import { requireAccess } from "./access";
import { withTenant } from "./db";
import { istToday } from "./ledger";
import type { OcUser } from "./session";

export type CheckParams = { period: CheckPeriod; from: string; to: string };

/** The settings from the address; anything unknown falls back. Default: the last 14 days. */
export function readCheckParams(q: Record<string, string | undefined>, today = istToday()): CheckParams {
  const period = (CHECK_PERIODS as readonly string[]).includes(q.period ?? "") ? (q.period as CheckPeriod) : "last_14";
  return { period, ...checkDates(period, today, { from: q.from, to: q.to }) };
}

async function checkData(tenantId: string): Promise<CheckOrder[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{
      id: string; ref_no: number; status: CheckOrder["status"]; entered_at: string; delivered_at: string | null; cancelled_at: string | null;
      entered: string; delivered: string | null; entered_hour: number; delivered_hour: number | null;
      entered_by: string; delivered_by: string | null; customer_id: string; customer_name: string; place: string; total: string;
      changes: number; changes_later: number; undone: number; cancel_reason: string | null; billed: boolean;
    }>(sql`
      select o.id, o.ref_no, o.status,
             (extract(epoch from o.created_at) * 1000)::bigint::text as entered_at,
             (extract(epoch from o.delivered_at) * 1000)::bigint::text as delivered_at,
             (extract(epoch from c.at) * 1000)::bigint::text as cancelled_at,
             (o.created_at at time zone 'Asia/Kolkata')::date::text as entered,
             (o.delivered_at at time zone 'Asia/Kolkata')::date::text as delivered,
             extract(hour from o.created_at at time zone 'Asia/Kolkata')::int as entered_hour,
             extract(hour from o.delivered_at at time zone 'Asia/Kolkata')::int as delivered_hour,
             o.entered_by_name as entered_by, o.delivered_by_name as delivered_by,
             o.customer_id, coalesce(cu.name, o.customer_name) as customer_name, coalesce(cu.place, o.customer_place) as place,
             o.total::text,
             coalesce(e.changes, 0)::int as changes, coalesce(e.changes_later, 0)::int as changes_later, coalesce(e.undone, 0)::int as undone,
             c.reason as cancel_reason,
             (o.invoice_no is not null and trim(o.invoice_no) <> '')
               or exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null) as billed
        from order_capture.orders o
        left join order_capture.customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
        left join lateral (
          select count(*) filter (where ev.kind = 'changed') as changes,
                 count(*) filter (where ev.kind = 'changed'
                   and (ev.created_at at time zone 'Asia/Kolkata')::date > (o.created_at at time zone 'Asia/Kolkata')::date) as changes_later,
                 count(*) filter (where ev.kind = 'undelivered') as undone
            from order_capture.order_events ev
           where ev.tenant_id = o.tenant_id and ev.order_id = o.id
        ) e on true
        left join lateral (
          select ev.created_at as at, ev.text as reason
            from order_capture.order_events ev
           where ev.tenant_id = o.tenant_id and ev.order_id = o.id and ev.kind = 'cancelled'
           order by ev.created_at desc limit 1
        ) c on o.status = 'cancelled'
       where o.tenant_id = ${tenantId}`);
    return r.rows.map((x) => ({
      id: x.id,
      ref_no: x.ref_no,
      status: x.status,
      entered_at: Number(x.entered_at),
      delivered_at: x.delivered_at === null ? null : Number(x.delivered_at),
      cancelled_at: x.cancelled_at === null ? null : Number(x.cancelled_at),
      entered: x.entered,
      delivered: x.delivered,
      entered_hour: x.entered_hour,
      delivered_hour: x.delivered_hour,
      entered_by: x.entered_by,
      delivered_by: x.delivered_by,
      customer_id: x.customer_id,
      customer_name: x.customer_name,
      place: x.place ?? "",
      total: paise(x.total),
      changes: x.changes,
      changes_later: x.changes_later,
      undone: x.undone,
      cancel_reason: x.cancel_reason,
      billed: x.billed,
    }));
  });
}

/** Owner (support reads): the order flow check for the chosen dates. */
export async function flowCheckReport(user: OcUser, p: CheckParams, now = Date.now()) {
  requireAccess(user, "reports");
  return flowCheck(await checkData(user.tenantId), p.from, p.to, now);
}
