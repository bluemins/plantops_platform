// Drop Phase 2: the shop's Home through the real route (docs/CUSTOMER_APP_PHASE_PLAN.md "Home"): the current order
// (pending + delivered today, free boxes, other brands' lines and cancelled / older orders hidden), due per brand from
// the same bills as the account page, the main brand's box totals (each box once, free and cancelled left out), the
// support contact; no rates, amounts, refs, notes or staff names in the answer; plant isolation; limits.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { resetRateLimits } from "@plantops/module-kit/http";
import { GET as homeRoute } from "@/app/api/app/v1/home/route";
import { createCustomer } from "@/server/customers";
import { tokenHash } from "@/server/drop/login";
import { setDrop, SetDropInput } from "@/server/drop/manage";
import { account } from "@/server/ledger";
import { saveRates } from "@/server/rates";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant } from "./helpers";

const sku = (name: string, ml: number, code: string | null = null) =>
  ({ id: randomUUID(), name, sku_code: code, volume_ml: ml, units_per_pack: ml >= 20000 ? 1 : 12, pack_type: ml >= 20000 ? "jar" : "case", status: "active" }) as TenantSku;
const b1 = sku("Bluemins 1L Water Bottle", 1000, "PV_BM_1L");
const b5 = sku("Bluemins 500ml Water Bottle", 500);
const m1 = sku("Mr.Charge 1 Litre Deionised Water", 1000);
const jar = sku("Bluemins Water - 20 Litre", 20000);
const hx = sku("Hemex 1L", 1000);

let platform: FakePlatform;
const plants: string[] = [];
const IST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

function configure() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
}
beforeAll(async () => {
  platform = await startFakePlatform();
  platform.skus = [b1, b5, m1, jar, hx];
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
});
afterAll(async () => {
  await platform.close();
  for (const k of ["DROP_APPS", "DROP_CODE_SECRET"]) delete process.env[k];
});
beforeEach(() => {
  resetRateLimits();
  configure();
});

const WHO = randomUUID();
let refNo = 0;
type L = [TenantSku, number, number, boolean?];
async function order(t: string, customer: string, status: "pending" | "delivered" | "cancelled", lines: L[], at = "now()", note: string | null = null) {
  const total = lines.reduce((s, [, q, r, f]) => s + (f ? 0 : q * r), 0);
  const delivered = status === "delivered" ? `${at}, '${WHO}', 'Atharv'` : "null, null, null";
  const { rows } = await asOwner<{ id: string }>(
    `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, order_note, status, total, entered_by, entered_by_name, created_at, status_changed_at, delivered_at, delivered_by, delivered_by_name)
     values ($1, $2, $3, $4, 'Shree Stores', '9861000001', 'Bijepur', $5, $6, $7, '${WHO}', 'Atharv', ${at}, ${at}, ${delivered}) returning id`,
    [t, ++refNo, `k-${randomUUID()}`, customer, note, status, total],
  );
  for (const [i, [s, q, r, f]] of lines.entries())
    await asOwner(
      `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total, free) values ($1, $2, 1, $3, $4, $5, 'box', $6, $7, $8, $9)`,
      [t, rows[0]!.id, i + 1, s.id, s.name, q, r, f ? 0 : q * r, !!f],
    );
  return rows[0]!.id;
}
type BL = [{ id: string | null; name: string }, number, number, boolean?];
async function bill(t: string, who: { customer?: string; contact?: string; imp?: string }, lines: BL[], o: { order?: string; number?: string; ob?: boolean; cancelled?: boolean; total?: number } = {}) {
  const total = o.total ?? lines.reduce((s, [, q, r, f]) => s + (f ? 0 : q * r), 0);
  const zoho = !!who.contact;
  const { rows } = await asOwner<{ id: string }>(
    `insert into order_capture.bills (tenant_id, source, number, ref_no, zoho_invoice_id, bill_date, customer_id, zoho_contact_id, customer_name, order_id, sub_total, total, import_id, created_by, created_by_name,
       cancelled_at, cancelled_by, cancelled_by_name, cancel_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'Shree Stores', $9, $10, $10, $11, '${WHO}', 'Sujata', ${o.cancelled ? `now(), '${WHO}', 'Sujata', 'Wrong rate'` : "null, null, null, null"}) returning id`,
    [t, zoho ? "zoho" : "plantops", o.number ?? `B-${String(++refNo).padStart(4, "0")}`, zoho ? null : refNo, zoho ? `${o.ob ? "ob:" : "zi-"}${randomUUID()}` : null, IST(new Date()), who.customer ?? null, who.contact ?? null, o.order ?? null, total, who.imp ?? null],
  );
  for (const [i, [s, q, r, f]] of lines.entries())
    await asOwner(
      `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, discount, line_total, free) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t, rows[0]!.id, i + 1, s.id, s.name, q, r, f ? q * r : 0, f ? 0 : q * r, !!f],
    );
  return rows[0]!.id;
}
async function pay(t: string, customer: string, amount: number, billId?: string) {
  const n = ++refNo;
  const { rows } = await asOwner<{ id: string }>(
    `insert into order_capture.payments (tenant_id, source, number, ref_no, payment_date, customer_id, customer_name, mode, amount, created_by, created_by_name)
     values ($1, 'plantops', $2, $3, $4, $5, 'Shree Stores', 'cash', $6, '${WHO}', 'Sujata') returning id`,
    [t, `P-${String(n).padStart(4, "0")}`, n, IST(new Date()), customer, amount],
  );
  if (billId)
    await asOwner(`insert into order_capture.payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name) values ($1, $2, $3, $4, $5, '${WHO}', 'Sujata')`, [
      t, rows[0]!.id, billId, amount, IST(new Date()),
    ]);
}

/** A plant with a switched-on shop and a session token for it. */
async function shopPlant() {
  const p = plant();
  plants.push(p.tenantId);
  configure();
  await saveRates(p.owner, { rates: [{ sku_id: jar.id, unit: "jar", default_rate: "", brand: "Bluemins 20L" }] });
  const shop = (await createCustomer(p.owner, { name: "Shree Stores", phone: "9861000001", place: "Bijepur" })).customer;
  await setDrop(p.owner, shop.id, SetDropInput.parse({ enabled: true }));
  const token = `dpt_${randomBytes(32).toString("base64url")}`;
  await asOwner(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ($1, $2, '9861000001', $3, now() + interval '90 days')`, [p.tenantId, shop.id, tokenHash(token)]);
  return { ...p, app: `app-${plants.length - 1}`, shop, token };
}

const get = (app: string, token: string, ip = "10.0.0.1") =>
  homeRoute(new Request("http://localhost:3005/api/app/v1/home", { headers: { "x-drop-app": app, authorization: `Bearer ${token}`, "x-forwarded-for": ip } }));
async function homeOf(app: string, token: string) {
  const res = await get(app, token);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), cache: res.headers.get("cache-control") };
}

describe("Drop Home", () => {
  let p: Awaited<ReturnType<typeof shopPlant>>;
  let sameMonthYesterday: boolean;

  beforeAll(async () => {
    p = await shopPlant();
    const t = p.tenantId;
    const c = p.shop.id;
    platform.branding.set(t, { support_phone: "9437000111", support_hours: "Mon–Sat 9–7" });
    // orders: A delivered today and billed (with a free box and other brands' lines), B delivered today with no bill,
    // C pending Mr.Charge only, D pending, E delivered yesterday, F cancelled
    const A = await order(t, c, "delivered", [[b1, 5, 100], [b1, 1, 100, true], [m1, 3, 100], [jar, 4, 50], [hx, 2, 50]], "now()", "Leave at back door");
    await order(t, c, "delivered", [[b5, 2, 90]]);
    await order(t, c, "pending", [[m1, 6, 100]], "now() - interval '1 day'");
    await order(t, c, "pending", [[b1, 3, 100]]);
    await order(t, c, "delivered", [[b1, 8, 100]], "now() - interval '1 day'");
    await order(t, c, "cancelled", [[b1, 40, 100]]);
    sameMonthYesterday = IST(new Date(Date.now() - 86_400_000)).slice(0, 7) === IST(new Date()).slice(0, 7);
    // bills: a Zoho bill under a linked contact (an old item name, no product link), a Zoho opening balance, A's bill
    // part-paid, a cancelled bill; an unused advance
    const imp = (await asOwner<{ id: string }>(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ($1, '${WHO}', 'Sujata') returning id`, [t])).rows[0]!.id;
    const contact = (await asOwner<{ id: string }>(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, customer_id, import_id) values ($1, 'zc-1', 'Shree Stores (Bijepur)', $2, $3) returning id`, [t, c, imp])).rows[0]!.id;
    const zb = await bill(t, { contact, imp }, [[{ id: null, name: "1L Water Bottle" }, 10, 100]], { number: "INV-000777" });
    await bill(t, { contact, imp }, [], { number: "OB-1", ob: true, total: 200 });
    const ab = await bill(t, { customer: c }, [[b1, 5, 100], [b1, 1, 100, true], [m1, 3, 100], [jar, 4, 50], [hx, 2, 50]], { order: A });
    await bill(t, { customer: c }, [[b1, 100, 100]], { cancelled: true });
    await pay(t, c, 400, zb);
    await pay(t, c, 550, ab);
    await pay(t, c, 1000);
  });

  it("the current order, due per brand, box totals and support, for the main brand only", async () => {
    const r = await homeOf(p.app, p.token);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    const today = IST(new Date());
    expect(r.body.shop).toEqual({ name: "Shree Stores" });
    expect(r.body.orders).toHaveLength(3);
    expect(r.body.orders[0]).toEqual({ status: "received", date: today, time: null, lines: [{ product: "Bluemins 1L Water Bottle", size: "1L", unit: "box", qty: 3, free: 0 }] });
    const delivered = r.body.orders.slice(1).map((o: { lines: unknown[] }) => o.lines);
    expect(delivered).toContainEqual([{ product: "Bluemins 1L Water Bottle", size: "1L", unit: "box", qty: 5, free: 1 }]);
    expect(delivered).toContainEqual([{ product: "Bluemins 500ml Water Bottle", size: "500ml", unit: "box", qty: 2, free: 0 }]);
    for (const o of r.body.orders.slice(1)) expect(o).toMatchObject({ status: "delivered", date: today, time: expect.stringMatching(/^\d\d:\d\d$/) });
    // Zoho 600 + opening balance 200 + Bluemins' 500 / 1,100 of A's ₹550 due; the unused advance is not taken off
    expect(r.body.dues).toEqual([{ brand: "Bluemins", paise: 105000 }]);
    // Zoho 10 + A's bill 5 (A counted once, its free box not) + B 2 (500ml) + E 8 if yesterday was this month;
    // the cancelled bill, C / D (not delivered) and other brands never
    expect(r.body.boxes.Bluemins.this_month).toEqual({ total: sameMonthYesterday ? 25 : 17, sizes: [{ size: "1L", boxes: sameMonthYesterday ? 23 : 15 }, { size: "500ml", boxes: 2 }] });
    expect(Object.keys(r.body.boxes)).toEqual(["Bluemins"]);
    expect(r.body.support).toEqual({ phone: "9437000111", hours: "Mon–Sat 9–7" });
    expect(r.body.news).toBeNull();
  });

  it("no rates, amounts, refs, notes or staff names anywhere in the answer", async () => {
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Mr.Charge", "Hemex", "Bluemins 20L"] }));
    const { text } = await homeOf(p.app, p.token);
    for (const leak of ["rate", "amount", "1100", "550", "510", "back door", "O-0", "B-0", "INV-", "OB-1", "Atharv", "Sujata", "Wrong rate", "cash", "Shree Stores (Bijepur)", "invoice", "note"])
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true }));
  });

  it("ticked brands: their lines and orders appear, their dues are sent; all brands add up to the account's due", async () => {
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Mr.Charge"] }));
    let r = await homeOf(p.app, p.token);
    expect(r.body.dues).toEqual([{ brand: "Bluemins", paise: 105000 }, { brand: "Mr.Charge", paise: 15000 }]);
    expect(r.body.orders).toHaveLength(4);
    expect(r.body.orders.flatMap((o: { lines: { product: string }[] }) => o.lines.map((l) => l.product))).toContain("Mr.Charge 1 Litre Deionised Water");
    // box totals stay the main brand's only
    expect(Object.keys(r.body.boxes)).toEqual(["Bluemins"]);

    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Mr.Charge", "Hemex", "Bluemins 20L"] }));
    r = await homeOf(p.app, p.token);
    const sum = r.body.dues.reduce((s: number, d: { paise: number }) => s + d.paise, 0);
    const acc = await account(p.owner, { kind: "customer", id: p.shop.id });
    expect(sum).toBe(Math.round(Number(acc.totals.due) * 100));
    expect(sum).toBe(135000);
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true }));
  });

  it("a shop with nothing on the way, nothing due and no recent buying", async () => {
    const q = await shopPlant();
    const r = await homeOf(q.app, q.token);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ shop: { name: "Shree Stores" }, orders: [], dues: [{ brand: "Bluemins", paise: 0 }], boxes: null, support: null, news: null });
  });

  it("another plant's app never reads this shop; an ended session is refused", async () => {
    const q = await shopPlant();
    expect((await homeOf(q.app, p.token)).status).toBe(401);
    expect((await homeOf(q.app, q.token)).body.orders).toEqual([]);
    await setDrop(q.owner, q.shop.id, SetDropInput.parse({ enabled: false }));
    const r = await homeOf(q.app, q.token);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: "session_ended", message: expect.any(String) } });
    expect((await homeOf(p.app, "dpt_nonsense")).status).toBe(401);
  });

  it("limits: 30 a minute per session", async () => {
    for (let i = 0; i < 30; i++) expect((await get(p.app, p.token, `10.0.1.${i}`)).status).toBe(200);
    const r = await get(p.app, p.token, "10.0.2.1");
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("rate_limited");
  });
});
