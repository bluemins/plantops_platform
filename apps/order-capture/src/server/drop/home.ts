// Drop's Home (docs/CUSTOMER_APP_PHASE_PLAN.md "Home", Phase 2): what a logged-in shop sees, worked out when the app
// asks and never stored:
//   * orders: pending ("received") or delivered today, only lines of the shop's brands, products and boxes (+ free)
//   * dues: due per brand for the shop's brands (src/lib/brand-due.ts), from the same bills as the account page
//   * boxes: the main brand's box totals (src/lib/box-totals.ts), only for a shop that bought it in the last 12 months
//   * support: the plant's customer support phone and hours (Business details)
// The answer is built field by field (an allow-list): never rates, order or bill amounts, refs, notes, history or staff
// names. The only money in it is the brand dues.
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { boxTotals, type BoxLine } from "@/lib/box-totals";
import { brandDues } from "@/lib/brand-due";
import { brandKey, effectiveBrand, lineMatcher, sizeLabel, type BrandProduct } from "@/lib/brand";
import { billDue, paise } from "@/lib/ledger";
import { schema, withTenant } from "../db";
import { kit } from "../kit";
import { partyFacts } from "../ledger";
import type { AppSession } from "./session";

const { billLines, orderLines, orders, productRates, zohoContacts } = schema;

const IST = "Asia/Kolkata";
const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const istTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export type HomeLine = { product: string; size: string; unit: string; qty: number; free: number };
export type HomeOrder = { status: "received" | "delivered"; date: string; time: string | null; lines: HomeLine[] };
export type Home = {
  shop: { name: string };
  orders: HomeOrder[];
  dues: { brand: string; paise: number }[];
  boxes: Record<string, NonNullable<ReturnType<typeof boxTotals>>> | null;
  support: { phone: string; hours: string | null } | null;
  news: null;
};

export async function home(s: AppSession, now = new Date()): Promise<Home> {
  const t = s.app.tenantId;
  const today = istDate(now);
  const fyStartPrev = `${(Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1) - 1}-04-01`;
  const [skus, branding] = await Promise.all([kit.products(t), kit.branding(t)]);
  const shown = new Set(s.brands.map(brandKey));

  const data = await withTenant(t, async (tx) => {
    const rates = await tx.select({ skuId: productRates.skuId, brand: productRates.brand }).from(productRates).where(eq(productRates.tenantId, t));
    const contacts = await tx.select({ id: zohoContacts.id }).from(zohoContacts).where(and(eq(zohoContacts.tenantId, t), eq(zohoContacts.customerId, s.customerId)));
    const { rows, L } = await partyFacts(tx, t, s.customerId, contacts.map((c) => c.id));
    // orders: on the way, or delivered since last year's April (for box totals and "delivered today")
    const os = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, t), eq(orders.customerId, s.customerId), or(eq(orders.status, "pending"), and(eq(orders.status, "delivered"), gte(orders.statusChangedAt, new Date(`${fyStartPrev}T00:00:00+05:30`))))));
    const ol = os.length ? await tx.select().from(orderLines).where(and(eq(orderLines.tenantId, t), inArray(orderLines.orderId, os.map((o) => o.id)))) : [];
    // bill lines: of bills with something due (dues) and of bills since last year's April (box totals)
    const dueOf = new Map(L.bills.map((b) => [b.id, billDue(b, L.allocations, L.adjustments)]));
    const wanted = rows.bills.filter((b) => !b.cancelledAt && ((dueOf.get(b.id) ?? 0n) > 0n || b.billDate >= fyStartPrev)).map((b) => b.id);
    const bl = wanted.length ? await tx.select().from(billLines).where(and(eq(billLines.tenantId, t), inArray(billLines.billId, wanted))) : [];
    return { rates, rows, dueOf, os, ol, bl };
  });

  const savedBrand = new Map(data.rates.map((r) => [r.skuId, r.brand]));
  const products: BrandProduct[] = skus.map((p) => ({ id: p.id, name: p.name, sku_code: p.sku_code, volume_ml: p.volume_ml, brand: effectiveBrand(savedBrand.get(p.id), p.name) }));
  const productOf = lineMatcher(products);

  // ---------- current orders ----------
  const current = data.os.filter((o) => o.status === "pending" || istDate(o.deliveredAt ?? o.statusChangedAt) === today);
  const homeOrders: HomeOrder[] = current
    .map((o) => {
      const byProduct = new Map<string, HomeLine & { ml: number; no: number }>();
      for (const l of data.ol.filter((x) => x.orderId === o.id && x.version === o.version).sort((a, b) => a.lineNo - b.lineNo)) {
        const p = productOf({ sku_id: l.skuId, name: l.productName });
        if (!p || !shown.has(brandKey(p.brand))) continue;
        const row = byProduct.get(p.id) ?? { product: p.name, size: sizeLabel(p.volume_ml), unit: l.unit, qty: 0, free: 0, ml: p.volume_ml, no: l.lineNo };
        if (l.free) row.free += l.quantity;
        else {
          row.qty += l.quantity;
          row.unit = l.unit;
        }
        byProduct.set(p.id, row);
      }
      const lines = [...byProduct.values()].sort((a, b) => a.no - b.no).map(({ product, size, unit, qty, free }) => ({ product, size, unit, qty, free }));
      const delivered = o.status === "delivered";
      const at = delivered ? (o.deliveredAt ?? o.statusChangedAt) : o.createdAt;
      return { status: delivered ? ("delivered" as const) : ("received" as const), date: istDate(at), time: delivered ? istTime(at) : null, lines, sort: at.getTime() };
    })
    .filter((o) => o.lines.length > 0)
    .sort((a, b) => (a.status === b.status ? b.sort - a.sort : a.status === "received" ? -1 : 1))
    .map(({ sort: _sort, ...o }) => o);

  // ---------- dues per brand ----------
  const linesOf = new Map<string, typeof data.bl>();
  for (const l of data.bl) linesOf.set(l.billId, [...(linesOf.get(l.billId) ?? []), l]);
  const brandOfLine = (l: (typeof data.bl)[number]) => productOf({ sku_id: l.skuId, sku_code: l.skuCode, name: l.itemName })?.brand ?? "";
  const dues = brandDues(
    data.rows.bills
      .filter((b) => !b.cancelledAt)
      .map((b) => ({
        due: data.dueOf.get(b.id) ?? 0n,
        lines: (linesOf.get(b.id) ?? []).map((l) => ({ brand: brandOfLine(l), value: paise(l.taxable ?? l.lineTotal) + paise(l.taxAmount) })),
      })),
    s.app.brand,
  );

  // ---------- box totals (the main brand) ----------
  const billedOrders = new Set(data.rows.bills.filter((b) => !b.cancelledAt && b.orderId).map((b) => b.orderId!));
  const boxLines: BoxLine[] = [];
  const addBox = (date: string, p: BrandProduct | null, qty: number) => {
    if (p) boxLines.push({ date, brand: p.brand, size: sizeLabel(p.volume_ml), ml: p.volume_ml, qty });
  };
  for (const b of data.rows.bills) {
    if (b.cancelledAt || b.zohoInvoiceId?.startsWith("ob:")) continue;
    for (const l of linesOf.get(b.id) ?? []) if (!l.free) addBox(b.billDate, productOf({ sku_id: l.skuId, sku_code: l.skuCode, name: l.itemName }), Number(l.quantity));
  }
  for (const o of data.os) {
    if (o.status !== "delivered" || billedOrders.has(o.id)) continue;
    const on = istDate(o.deliveredAt ?? o.statusChangedAt);
    for (const l of data.ol) if (l.orderId === o.id && l.version === o.version && !l.free) addBox(on, productOf({ sku_id: l.skuId, name: l.productName }), l.quantity);
  }
  const main = boxTotals(boxLines, s.app.brand, today);

  return {
    shop: { name: s.name },
    orders: homeOrders,
    dues: s.brands.map((brand) => ({ brand, paise: Number(dues.get(brandKey(brand)) ?? 0n) })),
    boxes: main ? { [s.app.brand]: main } : null,
    support: branding?.support_phone ? { phone: branding.support_phone, hours: branding.support_hours ?? null } : null,
    news: null,
  };
}

