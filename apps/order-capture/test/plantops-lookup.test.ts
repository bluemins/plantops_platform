// Field day log, Phase 1 (docs/FIELD_DAY_PHASE_PLAN.md; Sales migration 0023): what Attendance may ask Sales with a
// platform lookup ticket. The customer search answers name / place / location-saved only (never a phone, also for a
// phone search); a field visit saves the shop's location once per visit. Plus the 📍 Map link on orders and in the
// delivery WhatsApp copy, for everyone who sees the order.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as search } from "@/app/api/plantops/customers/route";
import { POST as saveLoc } from "@/app/api/plantops/customers/[id]/location/route";
import { whatsappText } from "@/lib/whatsapp";
import { clearLocation, saveLocation } from "@/server/customer-details";
import { getOrder } from "@/server/handling";
import { listOrders } from "@/server/list";
import { recentChanges } from "@/server/audit";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, dbError, ocUser, plant, refused, seedPlant } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
let sai = ""; // seeded customer of plant A (phone 9876543210), with an order
let tarini = "";
let off = "";
let bShop = "";

const ticket = (scope: "customers" | "customer_location", tenantId = a.tenantId, over: Record<string, unknown> = {}) =>
  platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "attendance_salary", scope, ...over }, "order_capture", "60s");
const find = async (q: string, token: string | null) => {
  const res = await search(new Request(`http://localhost:3005/api/plantops/customers?q=${encodeURIComponent(q)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), undefined as never);
  return { status: res.status, body: await res.json() };
};
const visit = (over: Record<string, unknown> = {}) => ({ lat: 21.056312, lng: 86.502145, accuracy_m: 8.4, visit_id: randomUUID(), set_by_user_id: randomUUID(), set_by_name: "Ravi", ...over });
const save = async (customerId: string, body: unknown, token: string | null) => {
  const res = await saveLoc(
    new Request(`http://localhost:3005/api/plantops/customers/${customerId}/location`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: customerId }) },
  );
  return { status: res.status, body: await res.json() };
};
const addCustomer = async (tenantId: string, name: string, phone: string, place: string, active = true) =>
  (await asApp(tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, active, created_by, created_by_name) values ('${tenantId}', '${name}', '${phone}', '${phone}', '${place}', ${active}, gen_random_uuid(), 'X') returning id`)).rows[0]!.id as string;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  sai = (await seedPlant(a.tenantId)).customer;
  tarini = await addCustomer(a.tenantId, "Maa Tarini Hotel", "9861044210", "Charampa");
  off = await addCustomer(a.tenantId, "Sai Old Shop", "9861055555", "Bhadrak", false);
  bShop = await addCustomer(b.tenantId, "Sai Other Plant", "9861066666", "Bhadrak");
});
afterAll(() => platform.close());

describe("customer search for Attendance", () => {
  it("by name or place: switched-on customers of the ticket's plant only, no phone in the answer", async () => {
    const r = await find("tarini", await ticket("customers"));
    expect(r.status).toBe(200);
    expect(r.body.customers).toEqual([{ id: tarini, name: "Maa Tarini Hotel", place: "Charampa", location: null }]);
    const all = await find("bhadrak", await ticket("customers"));
    expect(all.body.customers.map((c: { id: string }) => c.id)).not.toContain(off); // switched off
    expect(all.body.customers.map((c: { id: string }) => c.id)).not.toContain(bShop); // another plant
    expect(JSON.stringify(all.body)).not.toMatch(/986105|986106|phone/);
  });

  it("by phone (6+ digits, any spelling): finds the shop but never sends the number back", async () => {
    for (const q of ["+91 98610 44210", "986104", "9861044210"]) {
      const r = await find(q, await ticket("customers"));
      expect(r.body.customers.map((c: { name: string }) => c.name), q).toEqual(["Maa Tarini Hotel"]);
      expect(JSON.stringify(r.body)).not.toContain("9861044210");
    }
    // fewer than 6 digits never searches phones
    expect((await find("98610", await ticket("customers"))).body.customers).toEqual([]);
  });

  it("refused: no ticket, a login / summary token, another scope, another module's ticket; too short a search", async () => {
    expect((await find("tarini", null)).status).toBe(401);
    expect((await find("tarini", await platform.loginToken(["tenant_admin"]))).status).toBe(401);
    expect((await find("tarini", await platform.summaryToken())).status).toBe(401);
    expect((await find("tarini", await ticket("customer_location"))).status).toBe(401);
    expect((await find("tarini", await platform.sign({ purpose: "lookup", tenant_id: a.tenantId, from: "attendance_salary", scope: "customers" }, "floor_stock", "60s"))).status).toBe(401);
    expect((await find("t", await ticket("customers"))).status).toBe(400);
  });
});

describe("shop location from a field visit", () => {
  it("saves once per visit (a retry answers OK and saves nothing more); the search then says who saved it", async () => {
    const v = visit();
    expect(await save(tarini, v, await ticket("customer_location"))).toEqual({ status: 200, body: { saved: true, already: false } });
    expect(await save(tarini, v, await ticket("customer_location"))).toEqual({ status: 200, body: { saved: true, already: true } });
    const rows = (await asApp(a.tenantId, `select source, visit_id, accuracy_m, lat, by_name from order_capture.customer_locations where customer_id = '${tarini}'`)).rows;
    expect(rows).toEqual([{ source: "field_visit", visit_id: v.visit_id, accuracy_m: 8, lat: "21.056312", by_name: "Ravi" }]);
    const r = await find("tarini", await ticket("customers"));
    expect(r.body.customers[0].location).toMatchObject({ by: "Ravi", source: "field_visit" });
    expect(JSON.stringify(r.body)).not.toContain("21.056"); // the position itself is never in the search answer
    expect((await recentChanges(a.owner)).map((c) => c.text)).toContain("Shop location saved for Maa Tarini Hotel (field visit, ±8 m)");
  });

  it("refused: a customers ticket, no ticket, another plant's or a switched-off customer, rougher than ±150 m, bad input", async () => {
    expect((await save(tarini, visit(), await ticket("customers"))).status).toBe(401);
    expect((await save(tarini, visit(), null)).status).toBe(401);
    expect((await save(bShop, visit(), await ticket("customer_location"))).status).toBe(404);
    expect((await save(off, visit(), await ticket("customer_location"))).status).toBe(404);
    expect((await save(tarini, visit({ accuracy_m: 151 }), await ticket("customer_location"))).status).toBe(400);
    expect((await save(tarini, visit({ visit_id: "nope" }), await ticket("customer_location"))).status).toBe(400);
    expect((await save(tarini, { ...visit(), extra: 1 }, await ticket("customer_location"))).status).toBe(400);
    // plant B's ticket can't reach plant A's customer
    expect((await save(tarini, visit(), await ticket("customer_location", b.tenantId))).status).toBe(404);
  });

  it("the database: a field visit needs its visit id, other sources can't have one; nothing can be changed or deleted", async () => {
    const ins = (source: string, visitId: string | null, acc: number | null = 10) =>
      asApp(a.tenantId, `insert into order_capture.customer_locations (tenant_id, customer_id, kind, lat, lng, accuracy_m, source, visit_id, by_user, by_name) values ('${a.tenantId}', '${tarini}', 'set', 21, 86, ${acc}, '${source}', ${visitId ? `'${visitId}'` : "null"}, gen_random_uuid(), 'X')`);
    expect(await dbError(ins("field_visit", null))).toMatch(/customer_locations_visit_check/);
    expect(await dbError(ins("phone", randomUUID()))).toMatch(/customer_locations_visit_check/);
    expect(await dbError(ins("field_visit", randomUUID(), null))).toMatch(/customer_locations_field_accuracy/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.customer_locations set lat = 1 where customer_id = '${tarini}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(a.tenantId, `delete from order_capture.customer_locations where customer_id = '${tarini}'`))).toMatch(/permission denied/);
  });

  it("clearing still needs a reason and stays owner / Order desk", async () => {
    expect((await refused(() => clearLocation(a.desk, tarini, { reason: "x" }))).status).toBe(400);
    expect((await refused(() => clearLocation(a.staff, tarini, { reason: "wrong shop" }))).status).toBe(403);
  });
});

describe("📍 Map on orders and in the delivery message", () => {
  it("the order page, the list and the WhatsApp copy carry the shop's map link, also for plant staff and viewers", async () => {
    await saveLocation(a.desk, sai, { source: "phone", lat: 21.0612, lng: 86.4974, accuracy_m: 12 });
    const viewer = ocUser(a.tenantId, ["order_viewer"], "Viewer");
    for (const u of [a.owner, a.desk, a.staff, viewer]) {
      const { orders } = await listOrders(u);
      const row = orders.find((o) => o.customer !== "Maa Tarini Hotel")!;
      expect(row.map, u.name).toBe("https://www.google.com/maps?q=21.061200,86.497400");
      const o = await getOrder(u, row.id);
      expect(o.customer.location).toMatchObject({ lat: "21.061200", lng: "86.497400", accuracy_m: 12, by: "Atharv", source: "phone" });
      expect(whatsappText([row])).toContain("📍 https://www.google.com/maps?q=21.061200,86.497400");
    }
  });

  it("a cleared shop location: no map line", async () => {
    const p = plant();
    const shop = (await seedPlant(p.tenantId)).customer; // the seed has a shop location
    expect((await listOrders(p.owner)).orders[0]!.map).not.toBeNull();
    await clearLocation(p.desk, shop, { reason: "wrong shop" });
    const { orders } = await listOrders(p.owner);
    expect(orders[0]!.map).toBeNull();
    expect(whatsappText(orders)).not.toContain("📍");
    expect((await getOrder(p.owner, orders[0]!.id)).customer.location).toBeNull();
  });
});
