// Entering an order (docs/ORDER_CAPTURE_PHASE_PLAN.md "Entering an order"): field rules, products, the per-plant
// reference under concurrency, the one-time request key, a new customer in the same transaction, last-rate pre-fill,
// exact totals, copies kept, who may, and plant isolation.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/orders/route";
import { GET as lookupRoute } from "@/app/api/customers/lookup/route";
import { createCustomer, CustomerInput, updateCustomer } from "@/server/customers";
import { createOrder, formProducts, lookupCustomer, OrderInput } from "@/server/orders";
import { saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, auditRows, jsonReq, plant, refused, signInAs } from "./helpers";

// next/server's after() (the new-order notification) needs a real request; here it simply runs at once
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.skus = SKUS;
});

const [b1l, b500, jar, old] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];
let k = 0;
const key = () => `test-key-${Date.now()}-${++k}`;
type Who = Parameters<typeof createOrder>[0];
const SAMPLE = [
  { sku_id: b500.id, quantity: 1, rate: "90" },
  { sku_id: b1l.id, quantity: 3, rate: "140" },
];
/** The owner's sample order: Sri ram hotel, bijepur, 500ml 1 box × 90 + 1ltr 3 box × 140 = ₹510. */
const order = (u: Who, over: Partial<{ phone: string; name: string; place: string; lines: { sku_id: string; quantity: number; rate: string }[]; request_key: string }> = {}) =>
  createOrder(
    u,
    OrderInput.parse({
      request_key: over.request_key ?? key(),
      customer: { phone: over.phone ?? "98765 43210", name: over.name ?? "Sri ram hotel", place: over.place ?? "bijepur" },
      lines: over.lines ?? SAMPLE,
    }),
  );
const count = async (table: string, tenantId: string) => Number((await asOwner(`select count(*)::int as n from order_capture.${table} where tenant_id = $1`, [tenantId])).rows[0]!.n);

describe("the owner's sample order", () => {
  it("Sri ram hotel: 1 box × ₹90 + 3 box × ₹140 = ₹510, O-0001, new customer, lines v1, 'created' event, copies kept", async () => {
    const p = plant();
    const o = await order(p.desk);
    expect(o).toMatchObject({
      ref: "O-0001",
      created: true,
      total: "510.00",
      customer: { name: "Sri ram hotel", place: "bijepur", phone: "9876543210" },
      lines: [
        { product: "Bluemins (500 ml × 24)", unit: "box", quantity: 1, rate: "90.00", total: "90.00" },
        { product: "Bluemins (1 L × 12)", unit: "box", quantity: 3, rate: "140.00", total: "420.00" },
      ],
    });
    const [row] = (await asOwner("select * from order_capture.orders where id = $1", [o.id])).rows;
    expect(row).toMatchObject({ tenant_id: p.tenantId, ref_no: 1, status: "pending", version: 1, entered_by: p.desk.userId, entered_by_name: "Atharv", customer_phone: "9876543210" });
    const lines = (await asOwner("select version, line_no, sku_id from order_capture.order_lines where order_id = $1 order by line_no", [o.id])).rows;
    expect(lines).toEqual([
      { version: 1, line_no: 1, sku_id: b500.id },
      { version: 1, line_no: 2, sku_id: b1l.id },
    ]);
    expect((await asOwner("select kind, version, created_by from order_capture.order_events where order_id = $1", [o.id])).rows).toEqual([{ kind: "created", version: 1, created_by: p.desk.userId }]);
    expect((await auditRows(p.tenantId)).map((a) => [a.action, a.details.via])).toEqual([["customer.add", "O-0001"]]);
  });

  it("units come from the Rates page (or the default); the jar is ordered in 'jar'", async () => {
    const p = plant();
    await saveRates(p.owner, { rates: [{ sku_id: b500.id, unit: "case", default_rate: "" }] });
    const o = await order(p.owner, { lines: [{ sku_id: b500.id, quantity: 2, rate: "90" }, { sku_id: jar.id, quantity: 6, rate: "50" }] });
    expect(o.lines.map((l) => l.unit)).toEqual(["case", "jar"]);
    expect(o.total).toBe("480.00");
  });
});

describe("field rules", () => {
  const parse = (lines: unknown, customer: unknown = { phone: "9876543210" }) => OrderInput.safeParse({ request_key: "abcdefgh", customer, lines });
  it.each([
    ["quantity 0", [{ sku_id: b500.id, quantity: 0, rate: "90" }]],
    ["quantity over 100,000", [{ sku_id: b500.id, quantity: 100_001, rate: "90" }]],
    ["quantity 1.5", [{ sku_id: b500.id, quantity: 1.5, rate: "90" }]],
    ["quantity as text", [{ sku_id: b500.id, quantity: "abc", rate: "90" }]],
    ["a negative rate", [{ sku_id: b500.id, quantity: 1, rate: "-1" }]],
    ["a rate with 3 decimals", [{ sku_id: b500.id, quantity: 1, rate: "1.234" }]],
    ["no lines", []],
    ["51 lines", Array.from({ length: 51 }, () => ({ sku_id: crypto.randomUUID(), quantity: 1, rate: "1" }))],
    ["the same product twice", [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b500.id, quantity: 2, rate: "90" }]],
  ])("refuses %s", (_, lines) => {
    expect(parse(lines).success).toBe(false);
  });

  it("refuses a short request key", () => {
    expect(OrderInput.safeParse({ request_key: "abc", customer: { phone: "9876543210" }, lines: SAMPLE }).success).toBe(false);
  });

  it("a bad phone, or a new customer without name or place, saves nothing", async () => {
    const p = plant();
    expect(await refused(() => order(p.owner, { phone: "12345" }))).toEqual({ status: 400, message: "Enter the customer's 10-digit mobile number" });
    expect(await refused(() => order(p.owner, { name: "" }))).toEqual({ status: 400, message: "Please enter the new customer's name (at least 2 letters)" });
    expect(await refused(() => order(p.owner, { place: " x " }))).toEqual({ status: 400, message: "Please enter the new customer's place (at least 2 letters)" });
    expect([await count("orders", p.tenantId), await count("customers", p.tenantId)]).toEqual([0, 0]);
  });
});

describe("the order note", () => {
  const withNote = (u: Who, note: unknown) =>
    createOrder(u, OrderInput.parse({ request_key: key(), customer: { phone: "98765 43210", name: "Sri ram hotel", place: "bijepur" }, lines: SAMPLE, note }));

  it("is optional: no note and a blank note both save null", async () => {
    const p = plant();
    expect((await order(p.desk)).note).toBeNull();
    expect((await withNote(p.desk, "  \n  ")).note).toBeNull();
    expect((await asOwner("select order_note from order_capture.orders where tenant_id = $1", [p.tenantId])).rows).toEqual([{ order_note: null }, { order_note: null }]);
  });

  it("is saved with the order, spaces tidied, line breaks kept", async () => {
    const p = plant();
    const o = await withNote(p.desk, "  Deliver   after 4 pm \r\n\n\n\nGate 2 ");
    expect(o.note).toBe("Deliver after 4 pm\n\nGate 2");
    expect((await asOwner("select order_note from order_capture.orders where id = $1", [o.id])).rows[0]!.order_note).toBe(o.note);
  });

  it("at most 300 characters", () => {
    const base = { request_key: "abcdefgh", customer: { phone: "9876543210" }, lines: SAMPLE };
    expect(OrderInput.safeParse({ ...base, note: "x".repeat(300) }).success).toBe(true);
    expect(OrderInput.safeParse({ ...base, note: "x".repeat(301) }).success).toBe(false);
  });

  it("through the API: saved and shown in the answer", async () => {
    const p = plant();
    signInAs(p.desk);
    const res = await POST(jsonReq("POST", "/api/orders", { request_key: key(), customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" }, lines: SAMPLE, note: "Call before coming" }), undefined as never);
    expect(res.status).toBe(201);
    expect((await res.json()).note).toBe("Call before coming");
  });
});

describe("products", () => {
  it("an inactive or unknown (e.g. another plant's) product is refused", async () => {
    const p = plant();
    expect((await refused(() => order(p.owner, { lines: [{ sku_id: old.id, quantity: 1, rate: "1" }] }))).status).toBe(400);
    expect((await refused(() => order(p.owner, { lines: [{ sku_id: crypto.randomUUID(), quantity: 1, rate: "1" }] }))).status).toBe(400);
    expect(await count("orders", p.tenantId)).toBe(0);
  });

  it("platform unreachable: 503 'Products can't be loaded right now', nothing saved", async () => {
    platform.skus = null;
    const p = plant();
    expect(await refused(() => order(p.owner))).toEqual({ status: 503, message: "Products can't be loaded right now, try again" });
    expect([await count("orders", p.tenantId), await count("customers", p.tenantId)]).toEqual([0, 0]);
    expect(await formProducts(p.owner)).toEqual([]);
  });
});

describe("what the browser sends that it shouldn't is ignored", () => {
  it("tenant_id, entered_by, ref_no, status and total in the body change nothing", async () => {
    const p = plant();
    const other = plant();
    signInAs(p.desk);
    const res = await POST(
      jsonReq("POST", "/api/orders", {
        request_key: key(),
        tenant_id: other.tenantId,
        entered_by: other.owner.userId,
        ref_no: 99,
        status: "delivered",
        total: "1.00",
        customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur", tenant_id: other.tenantId },
        lines: SAMPLE.map((l) => ({ ...l, line_total: "1.00", tenant_id: other.tenantId })),
      }),
      undefined as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ref: "O-0001", total: "510.00" });
    const [row] = (await asOwner("select tenant_id, entered_by, ref_no, status, total from order_capture.orders where id = $1", [body.id])).rows;
    expect(row).toEqual({ tenant_id: p.tenantId, entered_by: p.desk.userId, ref_no: 1, status: "pending", total: "510.00" });
    expect(await count("orders", other.tenantId)).toBe(0);
  });
});

describe("references and the one-time request key", () => {
  it("two orders saved at the same moment get O-0001 and O-0002; ten get ten different numbers", async () => {
    const p = plant();
    const two = await Promise.all([order(p.owner, { phone: "9000000001" }), order(p.desk, { phone: "9000000002", name: "Laxmi Bhojanalaya", place: "Attabira" })]);
    expect(two.map((o) => o.ref).sort()).toEqual(["O-0001", "O-0002"]);
    const ten = await Promise.all(Array.from({ length: 10 }, (_, i) => order(p.owner, { phone: `91000000${String(i).padStart(2, "0")}`, name: `Shop ${i}`, place: "Bargarh" })));
    expect(new Set(ten.map((o) => o.ref)).size).toBe(10);
    expect(ten.map((o) => o.ref).sort().at(-1)).toBe("O-0012");
  });

  it("another plant starts at O-0001 too", async () => {
    const a = plant();
    const b = plant();
    await order(a.owner);
    expect((await order(b.owner)).ref).toBe("O-0001");
  });

  it("the same key twice gives one order (the same reference, created: false); also at the same moment", async () => {
    const p = plant();
    const k1 = key();
    const first = await order(p.desk, { request_key: k1 });
    const again = await order(p.desk, { request_key: k1, lines: [{ sku_id: jar.id, quantity: 9, rate: "1" }] });
    expect([again.id, again.ref, again.created, again.total]).toEqual([first.id, "O-0001", false, "510.00"]);
    const k2 = key();
    const both = await Promise.all([order(p.desk, { request_key: k2 }), order(p.desk, { request_key: k2 })]);
    expect(both[0]!.id).toBe(both[1]!.id);
    expect(both.map((o) => o.created).sort()).toEqual([false, true]);
    expect(await count("orders", p.tenantId)).toBe(2);
  });

  it("through the API: 201 the first time, 200 with the same order for a repeated key", async () => {
    const p = plant();
    signInAs(p.owner);
    const body = { request_key: key(), customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" }, lines: SAMPLE };
    const first = await POST(jsonReq("POST", "/api/orders", body), undefined as never);
    const second = await POST(jsonReq("POST", "/api/orders", body), undefined as never);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect((await second.json()).ref).toBe((await first.json()).ref);
  });
});

describe("the customer", () => {
  it("a new customer is created in the same transaction: a failing order leaves no customer behind", async () => {
    const p = plant();
    // quantity 0 passes nothing in the form; sent straight to createOrder it reaches the database and fails there
    await expect(createOrder(p.owner, { request_key: key(), customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" }, lines: [{ sku_id: b500.id, quantity: 0, rate: "90" }], note: null })).rejects.toThrow();
    expect([await count("orders", p.tenantId), await count("customers", p.tenantId), await count("audit_log", p.tenantId)]).toEqual([0, 0, 0]);
  });

  it("an existing customer is used as is: the name / place typed are ignored (any phone spelling)", async () => {
    const p = plant();
    await createCustomer(p.owner, CustomerInput.parse({ name: "Sri ram hotel", phone: "9876543210", place: "bijepur" }));
    const o = await order(p.desk, { phone: "+91 98765 43210", name: "Someone else", place: "Elsewhere" });
    expect(o.customer).toEqual({ name: "Sri ram hotel", place: "bijepur", phone: "9876543210" });
    expect(await count("customers", p.tenantId)).toBe(1);
  });

  it("a switched-off customer: 409 until switched back on", async () => {
    const p = plant();
    const { customer } = await createCustomer(p.owner, CustomerInput.parse({ name: "Raju Store", phone: "9700000455", place: "Sambalpur" }));
    await updateCustomer(p.owner, customer.id, { active: false });
    expect(await refused(() => order(p.desk, { phone: "9700000455" }))).toEqual({ status: 409, message: "Raju Store is switched off. Switch them back on first." });
    await updateCustomer(p.desk, customer.id, { active: true });
    expect((await order(p.desk, { phone: "9700000455" })).ref).toBe("O-0001");
  });
});

describe("rate pre-fill: this customer's last rate, else the default", () => {
  it("no orders and no default: nothing to pre-fill", async () => {
    const p = plant();
    expect(await lookupCustomer(p.desk, "9876543210")).toEqual({ phone: "9876543210", customer: null, last_order_at: null, last_rates: {} });
    expect((await formProducts(p.desk)).find((r) => r.sku_id === b500.id)!.default_rate).toBeNull();
  });

  it("the default rate comes with the product list", async () => {
    const p = plant();
    await saveRates(p.owner, { rates: [{ sku_id: b500.id, unit: "box", default_rate: "88" }] });
    expect((await formProducts(p.desk)).find((r) => r.sku_id === b500.id)!.default_rate).toBe("88.00");
  });

  it("their last order's rate wins over the default; a later cancelled order is skipped; others' orders don't count", async () => {
    const p = plant();
    await saveRates(p.owner, { rates: [{ sku_id: b500.id, unit: "box", default_rate: "88" }] });
    await order(p.desk, { lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: jar.id, quantity: 2, rate: "50" }] });
    const later = await order(p.desk, { lines: [{ sku_id: b500.id, quantity: 1, rate: "95" }] });
    await order(p.desk, { phone: "9123456780", name: "Maa Tarini Store", place: "Bargarh", lines: [{ sku_id: b500.id, quantity: 1, rate: "70" }] });
    let found = await lookupCustomer(p.desk, "098765 43210");
    expect(found.last_rates).toEqual({ [b500.id]: "95.00", [jar.id]: "50.00" });
    expect(found.customer).toMatchObject({ name: "Sri ram hotel", active: true });
    expect(found.last_order_at).not.toBeNull();
    // the later order is cancelled (Phase 5 does this through the screen): its rate no longer counts
    await asApp(p.tenantId, `update order_capture.orders set status = 'cancelled' where id = '${later.id}'`);
    found = await lookupCustomer(p.desk, "9876543210");
    expect(found.last_rates[b500.id]).toBe("90.00");
  });

  it("the order's current lines version counts, not the first one", async () => {
    const p = plant();
    const o = await order(p.desk, { lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }] });
    await asApp(p.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total) values ('${p.tenantId}', '${o.id}', 2, 1, '${b500.id}', 'x', 'box', 1, 92, 92)`);
    await asApp(p.tenantId, `update order_capture.orders set version = 2, total = 92 where id = '${o.id}'`);
    expect((await lookupCustomer(p.desk, "9876543210")).last_rates[b500.id]).toBe("92.00");
  });

  it("through the API, and never across plants", async () => {
    const a = plant();
    const b = plant();
    await order(a.desk);
    signInAs(b.owner);
    const res = await lookupRoute(new Request("http://localhost:3005/api/customers/lookup?phone=9876543210"), undefined as never);
    expect(await res.json()).toMatchObject({ customer: null, last_rates: {} });
    vi.restoreAllMocks();
    signInAs(a.owner);
    const bad = await lookupRoute(new Request("http://localhost:3005/api/customers/lookup?phone=12345"), undefined as never);
    expect(bad.status).toBe(400);
  });
});

describe("copies kept", () => {
  it("later edits to the customer or the rates don't change a saved order", async () => {
    const p = plant();
    const o = await order(p.desk);
    const { customer } = await createCustomer(p.owner, CustomerInput.parse({ name: "x y", phone: "9876543210", place: "z z" }));
    await updateCustomer(p.owner, customer.id, { name: "Sri Ram Hotel (new)", place: "Bijepur town" });
    await saveRates(p.owner, { rates: [{ sku_id: b500.id, unit: "case", default_rate: "200" }] });
    const [row] = (await asOwner("select customer_name, customer_place, total from order_capture.orders where id = $1", [o.id])).rows;
    expect(row).toEqual({ customer_name: "Sri ram hotel", customer_place: "bijepur", total: "510.00" });
    const units = (await asOwner("select unit, product_name, rate from order_capture.order_lines where order_id = $1 order by line_no", [o.id])).rows;
    expect(units).toEqual([
      { unit: "box", product_name: "Bluemins (500 ml × 24)", rate: "90.00" },
      { unit: "box", product_name: "Bluemins (1 L × 12)", rate: "140.00" },
    ]);
  });
});

describe("who may enter an order", () => {
  it("owner and Order desk; support, plant staff and a store keeper are refused (API 403)", async () => {
    const p = plant();
    expect((await order(p.owner)).created).toBe(true);
    expect(await refused(() => order(p.support))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    for (const u of [p.staff, p.keeper]) {
      expect(await refused(() => order(u))).toEqual({ status: 403, message: u === p.staff ? "You can view orders only. Order desk or the owner does this." : "You don't have access to Order Capture" });
      expect((await refused(() => lookupCustomer(u, "9876543210"))).status).toBe(403);
    }
    signInAs(p.support);
    expect((await POST(jsonReq("POST", "/api/orders", { request_key: key(), customer: { phone: "9876543210" }, lines: SAMPLE }), undefined as never)).status).toBe(403);
  });
});
