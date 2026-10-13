// Customers (docs/ORDER_CAPTURE_PHASE_PLAN.md "Customers"): name, phone, place; the normalised phone is the identity
// (one customer per phone per plant, never changed); owner and Order desk add / edit / switch off; support reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/customers/route";
import { PATCH } from "@/app/api/customers/[id]/route";
import { createCustomer, CustomerInput, listCustomers, updateCustomer } from "@/server/customers";
import { asOwner, auditRows, jsonReq, plant, refused, signInAs } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const add = (u: Parameters<typeof createCustomer>[0], phone: string, name = "Sri ram hotel", place = "bijepur") => createCustomer(u, CustomerInput.parse({ name, phone, place }));
const rowsOf = async (tenantId: string) => (await asOwner("select name, phone, phone_typed, place, active from order_capture.customers where tenant_id = $1 order by created_at", [tenantId])).rows;

describe("the phone is the customer's identity", () => {
  it("+91 96929 05402, 096929 05402 and 9692905402 are one customer", async () => {
    const p = plant();
    const first = await add(p.owner, "+91 96929 05402");
    expect(first).toMatchObject({ created: true, customer: { phone: "9692905402", name: "Sri ram hotel", place: "bijepur", active: true } });
    for (const typed of ["096929 05402", "9692905402", "91 96929-05402"]) {
      expect(await add(p.desk, typed, "Someone else", "Elsewhere"), typed).toMatchObject({ created: false, customer: { id: first.customer.id, name: "Sri ram hotel" } });
    }
    expect(await rowsOf(p.tenantId)).toEqual([{ name: "Sri ram hotel", phone: "9692905402", phone_typed: "+91 96929 05402", place: "bijepur", active: true }]);
  });

  it.each(["5876543210", "12345", "98765 4321", "+1 9876543210", "9.18E+11", ""])("%j is not a mobile number", async (typed) => {
    const p = plant();
    expect(await refused(() => add(p.owner, typed))).toEqual({ status: 400, message: "Please enter a 10-digit mobile number" });
    expect(await rowsOf(p.tenantId)).toEqual([]);
  });

  it("another plant may have a customer with the same number", async () => {
    const a = plant();
    const b = plant();
    await add(a.owner, "9692905402");
    expect(await add(b.owner, "9692905402", "Other plant's customer")).toMatchObject({ created: true });
  });

  it("two people adding the same number at the same moment make one customer", async () => {
    const p = plant();
    const both = await Promise.all([add(p.owner, "9000000001", "Laxmi Bhojanalaya", "Attabira"), add(p.desk, "+91 90000 00001", "Laxmi Bhojanalaya", "Attabira")]);
    expect(both.map((r) => r.created).sort()).toEqual([false, true]);
    expect(await rowsOf(p.tenantId)).toHaveLength(1);
  });

  it("names and places are trimmed and their spaces joined; too short or too long is refused", () => {
    expect(CustomerInput.parse({ name: "  Sri   ram  hotel ", phone: "9692905402", place: " bijepur " })).toMatchObject({ name: "Sri ram hotel", place: "bijepur" });
    expect(CustomerInput.safeParse({ name: "R", phone: "9692905402", place: "bijepur" }).success).toBe(false);
    expect(CustomerInput.safeParse({ name: "Sri ram hotel", phone: "9692905402", place: " X " }).success).toBe(false);
    expect(CustomerInput.safeParse({ name: "x".repeat(101), phone: "9692905402", place: "bijepur" }).success).toBe(false);
  });
});

describe("adding through the API", () => {
  it("a new customer → 201; the same number again → 409 naming that customer (also when switched off)", async () => {
    const p = plant();
    signInAs(p.desk);
    const res = await POST(jsonReq("POST", "/api/customers", { name: "Maa Tarini Store", phone: "+91 91234 56780", place: "Bargarh" }), undefined as never);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const again = await POST(jsonReq("POST", "/api/customers", { name: "Other", phone: "091234 56780", place: "Other" }), undefined as never);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "This number is already Maa Tarini Store, Bargarh", customer: { id, active: true } });
    await updateCustomer(p.owner, id, { active: false });
    const off = await POST(jsonReq("POST", "/api/customers", { name: "Other", phone: "9123456780", place: "Other" }), undefined as never);
    expect(await off.json()).toMatchObject({ error: "This number is already Maa Tarini Store, Bargarh (switched off)", customer: { id, active: false } });
  });

  it("a request that tries to set the plant or who added it is refused (strict input)", async () => {
    const p = plant();
    signInAs(p.owner);
    const res = await POST(jsonReq("POST", "/api/customers", { name: "Sri ram hotel", phone: "9692905402", place: "bijepur", tenant_id: crypto.randomUUID() }), undefined as never);
    expect(res.status).toBe(400);
  });
});

describe("editing", () => {
  it("name and place change, audited; the phone can't be changed through the API", async () => {
    const p = plant();
    const { customer } = await add(p.owner, "9692905402");
    const u = await updateCustomer(p.desk, customer.id, { name: "Sri Ram Hotel", place: "Bijepur" });
    expect(u).toMatchObject({ name: "Sri Ram Hotel", place: "Bijepur", phone: "9692905402" });
    signInAs(p.owner);
    const res = await PATCH(jsonReq("PATCH", `/api/customers/${customer.id}`, { phone: "9000000000" }), { params: Promise.resolve({ id: customer.id }) });
    expect([res.status, (await res.json()).error]).toEqual([400, "phone: The phone can't be changed: a different number is a new customer"]);
    expect((await rowsOf(p.tenantId))[0]).toMatchObject({ phone: "9692905402" });
    const audit = await auditRows(p.tenantId);
    expect(audit.map((a) => a.action)).toEqual(["customer.add", "customer.update"]);
    expect(audit[1]!.details.changes).toEqual({ name: { from: "Sri ram hotel", to: "Sri Ram Hotel" }, place: { from: "bijepur", to: "Bijepur" } });
  });

  it("switch off / on; nothing changed = nothing written", async () => {
    const p = plant();
    const { customer } = await add(p.owner, "9692905402");
    expect(await updateCustomer(p.owner, customer.id, { active: false })).toMatchObject({ active: false });
    expect(await updateCustomer(p.desk, customer.id, { active: true })).toMatchObject({ active: true });
    await updateCustomer(p.owner, customer.id, { name: "Sri ram hotel", active: true });
    expect((await auditRows(p.tenantId)).map((a) => a.details.changes ?? null)).toEqual([null, { active: { from: true, to: false } }, { active: { from: false, to: true } }]);
  });

  it("another plant's customer is not found", async () => {
    const a = plant();
    const b = plant();
    const { customer } = await add(a.owner, "9692905402");
    expect(await refused(() => updateCustomer(b.owner, customer.id, { name: "Hacked" }))).toEqual({ status: 404, message: "Customer not found" });
  });
});

describe("who may do what", () => {
  it("owner and Order desk add and edit; plant staff, a store keeper and support are refused", async () => {
    const p = plant();
    const { customer } = await add(p.desk, "9692905402");
    expect(await refused(() => add(p.support, "9000000002"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect(await refused(() => updateCustomer(p.support, customer.id, { active: false }))).toMatchObject({ status: 403 });
    for (const u of [p.staff, p.keeper]) {
      expect(await refused(() => add(u, "9000000003"))).toEqual({ status: 403, message: "You don't have access to Order Capture" });
      expect((await refused(() => listCustomers(u))).status).toBe(403);
    }
    expect((await listCustomers(p.support)).customers).toHaveLength(1);
  });
});

describe("the list", () => {
  it("search by name, place or phone digits; switched-off ones only when asked; each plant sees its own", async () => {
    const p = plant();
    await add(p.owner, "9692905402", "Sri ram hotel", "bijepur");
    await add(p.owner, "9123456780", "Maa Tarini Store", "Bargarh");
    const { customer: off } = await add(p.owner, "9000000004", "Laxmi Bhojanalaya", "Attabira");
    await updateCustomer(p.owner, off.id, { active: false });
    const names = async (q: string, showOff = false) => (await listCustomers(p.desk, { q, showOff })).customers.map((c) => c.name);
    expect(await names("")).toEqual(["Maa Tarini Store", "Sri ram hotel"]);
    expect(await names("", true)).toEqual(["Laxmi Bhojanalaya", "Maa Tarini Store", "Sri ram hotel"]);
    expect(await names("RAM")).toEqual(["Sri ram hotel"]);
    expect(await names("bargarh")).toEqual(["Maa Tarini Store"]);
    expect(await names("05402")).toEqual(["Sri ram hotel"]);
    expect(await names("96929 05402")).toEqual(["Sri ram hotel"]);
    expect(await names("+91 96929 05402")).toEqual(["Sri ram hotel"]);
    expect(await names("100%")).toEqual([]);
    expect(await listCustomers(p.owner)).toMatchObject({ total: 3, off: 1, more: false });
    expect((await listCustomers(p.owner, { limit: 1 })).more).toBe(true);
    expect((await listCustomers(plant().owner)).customers).toEqual([]);
  });
});
