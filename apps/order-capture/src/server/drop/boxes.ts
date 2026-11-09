// Main-brand boxes each shop bought in a date range, counted like Drop's Home box totals (src/server/drop/home.ts):
// non-cancelled bills (Zoho + PlantOps, opening balances left out) by bill date, plus delivered orders without a live
// bill by delivery date (India) — only those delivered after the plant's last Zoho invoice date, since Zoho invoiced the
// earlier ones — each box once, free boxes never. Used by the poll results (buying size) and their CSV.
import { sql } from "drizzle-orm";
import { brandKey, type BrandProduct, type LineRef } from "@/lib/brand";
import type { OcTx } from "../db";

/** The plant's last Zoho invoice date (null = never used Zoho). */
export async function zohoUntil(tx: OcTx, tenantId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ d: string | null }>(sql`
    select max(bill_date)::text as d from order_capture.bills
     where tenant_id = ${tenantId} and source = 'zoho' and coalesce(zoho_invoice_id, '') not like 'ob:%'`);
  return rows[0]?.d ?? null;
}

/** customer id → product name → boxes, for `from`..`to` (India dates, both included). */
export async function boxesByShop(tx: OcTx, tenantId: string, of: (l: LineRef) => BrandProduct | null, main: string, from: string, to: string) {
  const until = await zohoUntil(tx, tenantId);
  const billed = await tx.execute<{ cust: string; sku_id: string | null; sku_code: string | null; item_name: string; qty: string }>(sql`
    select coalesce(b.customer_id, zc.customer_id)::text as cust, l.sku_id::text, l.sku_code, l.item_name, l.quantity::text as qty
      from order_capture.bills b
      join order_capture.bill_lines l on l.tenant_id = b.tenant_id and l.bill_id = b.id and not l.free
      left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
     where b.tenant_id = ${tenantId} and b.cancelled_at is null and coalesce(b.zoho_invoice_id, '') not like 'ob:%'
       and b.bill_date between ${from}::date and ${to}::date
       and coalesce(b.customer_id, zc.customer_id) is not null`);
  const unbilled = await tx.execute<{ cust: string; sku_id: string; item_name: string; qty: string }>(sql`
    select o.customer_id::text as cust, l.sku_id::text, l.product_name as item_name, l.quantity::text as qty
      from order_capture.orders o
      join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version and not l.free
     where o.tenant_id = ${tenantId} and o.status = 'delivered'
       and (o.delivered_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
       and (${until}::date is null or (o.delivered_at at time zone 'Asia/Kolkata')::date > ${until}::date)
       and not exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null)`);
  const out = new Map<string, Map<string, number>>();
  for (const r of [...billed.rows, ...unbilled.rows]) {
    const p = of({ sku_id: r.sku_id, sku_code: "sku_code" in r ? r.sku_code : null, name: r.item_name });
    if (!p || brandKey(p.brand) !== brandKey(main)) continue;
    const m = out.get(r.cust) ?? new Map<string, number>();
    m.set(p.name, Math.round(((m.get(p.name) ?? 0) + Number(r.qty)) * 1000) / 1000);
    out.set(r.cust, m);
  }
  return out;
}

export const totalBoxes = (m: Map<string, number> | undefined) => (m ? Math.round([...m.values()].reduce((s, v) => s + v, 0) * 1000) / 1000 : 0);
