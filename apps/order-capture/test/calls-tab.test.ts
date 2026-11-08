// Phone calls Phase 3 (docs/CALLS_PHASE_PLAN.md "Calls tab", "Not an order number list"): waiting / attended grouping,
// Attended for a known customer (never renamed), a new caller (saved through the customer list's own rule), a wrong
// number, landline / hidden numbers, two taps at once, the last order without amounts, who may do what, the owner's
// list hiding earlier rings until Remove, its audit rows and Recent changes lines, and tenant isolation.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recentChanges } from "@/server/audit";
import { attendCall, AttendInput, callsTab, ignoredList, setIgnored, waitingCount } from "@/server/calls-tab";
import { recordCall, type CallKey } from "@/server/calls";
import { listCustomers, updateCustomer } from "@/server/customers";
import { asApp, asOwner, ocUser, plant, refused, seedPlant } from "./helpers";

// up to two hours ago, but still today in India (just after midnight: a few minutes ago), so "today's counts" hold
const IST_MINUTES = Math.floor(((Date.now() + 330 * 60_000) % 86_400_000) / 60_000);
const T0 = Date.now() - Math.min(120, Math.max(IST_MINUTES - 1, 4)) * 60_000;
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

function phonePlant() {
  const p = plant();
  const key: CallKey = { id: randomUUID(), tenant_id: p.tenantId, sha256: "0".repeat(64), label: "Order phone" };
  const raju = ocUser(p.tenantId, ["delivery_staff", "plant_staff"], "Raju");
  const ring = (phone: string, event: "incoming" | "missed", minutes: number) => recordCall(key, { phone, event }, at(minutes));
  return { ...p, key, raju, ring };
}
const attend = (user: Parameters<typeof attendCall>[0], phone: string, extra: Record<string, unknown> = {}) => attendCall(user, { phone, ...extra });

describe("the Calls tab", () => {
  it("groups waiting rings per number, oldest waiting first, missed marked, with today's counts", async () => {
    const p = phonePlant();
    await p.ring("9876543210", "incoming", 0);
    await p.ring("9876543210", "missed", 0.5);
    await p.ring("7008144562", "missed", 1); // lone missed
    await p.ring("9876543210", "incoming", 3);
    const tab = await callsTab(p.raju);
    expect(tab.waiting.map((c) => c.phone)).toEqual(["9876543210", "7008144562"]);
    expect(tab.waiting[0]!.rings.map((r) => r.missed)).toEqual([true, false]);
    expect(tab.waiting[1]).toMatchObject({ number: "70081 44562", customer: null, action: "new", rings: [{ missed: true }] });
    expect(tab.today).toEqual({ calls: 3, numbers: 2 });
    expect(await waitingCount(p.raju)).toBe(2);
  });

  it("a known customer shows name, place and the last delivered order as products and quantities, no amounts", async () => {
    const p = phonePlant();
    const ids = await seedPlant(p.tenantId, 1, "9876543210");
    await asOwner("update order_capture.orders set status = 'delivered', delivered_at = now(), delivered_by = $2, delivered_by_name = 'Atharv' where id = $1", [ids.order, ids.who]);
    await p.ring("+91 98765 43210", "incoming", 0);
    const tab = await callsTab(p.raju);
    const card = tab.waiting.find((c) => c.phone === "9876543210")!;
    expect(card).toMatchObject({ customer: { name: "Sri ram hotel", place: "bijepur" }, action: "known" });
    expect(card.last_order).toMatch(/^1 × 500ml, 3 × 1ltr · delivered /);
    expect(JSON.stringify(tab)).not.toMatch(/₹|rate|total|510|420|140|"90"/);
  });

  it("landline and hidden numbers get Attended only", async () => {
    const p = phonePlant();
    await p.ring("011 2345 6789", "incoming", 0);
    await p.ring("", "incoming", 1);
    const tab = await callsTab(p.raju);
    expect(tab.waiting.map((c) => [c.number, c.action])).toEqual([["01123456789", "plain"], ["Hidden number", "plain"]]);
  });

  it("Order viewer and Plant staff alone can't open Calls; support reads but can't attend", async () => {
    const p = phonePlant();
    await p.ring("9876543210", "incoming", 0);
    for (const u of [ocUser(p.tenantId, ["order_viewer"]), p.staff, p.keeper]) expect((await refused(() => callsTab(u))).status).toBe(403);
    expect((await callsTab(p.support)).waiting).toHaveLength(1);
    expect(await refused(() => attend(p.support, "9876543210"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await callsTab(p.desk)).waiting).toHaveLength(1);
    expect((await callsTab(p.owner)).waiting).toHaveLength(1);
  });
});

describe("Attended", () => {
  it("a known customer: all waiting rings covered, never renamed; a later ring is waiting again", async () => {
    const p = phonePlant();
    const ids = await seedPlant(p.tenantId, 1, "9876543210");
    await p.ring("9876543210", "incoming", 0);
    await p.ring("9876543210", "incoming", 2);
    expect(await attend(p.raju, "9876543210", { name: "Someone Else", place: "Elsewhere" })).toEqual({ outcome: "known", customer_id: ids.customer, rings: 2 });
    const c = (await asOwner<{ name: string }>("select name from order_capture.customers where id = $1", [ids.customer])).rows[0];
    expect(c?.name).toBe("Sri ram hotel");
    let tab = await callsTab(p.raju);
    expect(tab.waiting).toEqual([]);
    expect(tab.attended[0]).toMatchObject({ name: "Sri ram hotel", place: "bijepur", rings: 2, by: "Raju", outcome: "known" });
    await p.ring("9876543210", "incoming", 4);
    tab = await callsTab(p.raju);
    expect(tab.waiting.map((w) => w.rings.length)).toEqual([1]);
  });

  it("a new mobile needs name and place, and is saved to the customer list through its own rule", async () => {
    const p = phonePlant();
    await p.ring("7008144562", "missed", 0);
    expect(await refused(() => attend(p.raju, "7008144562"))).toEqual({ status: 400, message: "Please enter the caller's name and place" });
    // the customer list's own name / place rules, checked on the way in (the route reads the body with AttendInput)
    expect(AttendInput.safeParse({ phone: "7008144562", name: "P", place: "Dharmasala" }).success).toBe(false);
    expect(AttendInput.safeParse({ phone: "7008144562", name: "Pradeep", place: "D" }).success).toBe(false);
    expect(AttendInput.safeParse({ phone: "7008144562", name: "Pradeep", place: "Dharmasala", extra: 1 }).success).toBe(false);
    const r = await attendCall(p.raju, AttendInput.parse({ phone: "7008144562", name: "  Pradeep   Nayak ", place: "Dharmasala" }));
    expect(r.outcome).toBe("new_customer");
    const list = await listCustomers(p.owner);
    expect(list.customers.find((c) => c.phone === "7008144562")).toMatchObject({ id: r.customer_id, name: "Pradeep Nayak", place: "Dharmasala", active: true });
    const changes = await recentChanges(p.owner);
    expect(changes.map((c) => c.text)).toContain("Added customer Pradeep Nayak, Dharmasala (70081 44562) from a phone call");
    expect(changes.some((c) => /attended/i.test(c.text))).toBe(false); // Attended rows stay out of Recent changes
    const audit = await asOwner<{ action: string; actor: string }>("select action, actor from order_capture.audit_log where tenant_id = $1 order by at", [p.tenantId]);
    expect(audit.rows.map((a) => a.action)).toEqual(["customer.add", "call.attended_new_customer"]);
  });

  it("a phone someone added meanwhile is linked, never a second customer", async () => {
    const p = phonePlant();
    await p.ring("7008144562", "incoming", 0);
    const tab = await callsTab(p.raju); // the card still says New number
    expect(tab.waiting[0]!.action).toBe("new");
    await asApp(p.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${p.tenantId}', 'Pradeep Nayak', '7008144562', '7008144562', 'Dharmasala', gen_random_uuid(), 'Atharv')`);
    const r = await attend(p.raju, "7008144562", { name: "Pradeep N", place: "Dharmasala" });
    expect(r.outcome).toBe("known");
    expect((await asOwner("select count(*)::int as n from order_capture.customers where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 1 });
  });

  it("Wrong number, don't save: attended, no customer; landline and hidden: attended, no customer", async () => {
    const p = phonePlant();
    await p.ring("7008144562", "incoming", 0);
    await p.ring("011 2345 6789", "incoming", 1);
    await p.ring("", "incoming", 2);
    expect(await attend(p.raju, "7008144562", { wrong_number: true })).toEqual({ outcome: "wrong_number", customer_id: null, rings: 1 });
    expect(await attend(p.raju, "01123456789")).toEqual({ outcome: "known", customer_id: null, rings: 1 });
    expect(await attend(p.desk, "hidden")).toEqual({ outcome: "known", customer_id: null, rings: 1 });
    expect((await listCustomers(p.owner)).customers).toEqual([]);
    const tab = await callsTab(p.raju);
    expect(tab.attended.map((a) => [a.name, a.place])).toEqual([["Hidden number", null], ["01123456789", null], ["70081 44562", "Wrong number"]]);
  });

  it("two taps at once: one wins, the other gets 'Already attended by …'; a ring that came meanwhile is covered", async () => {
    const p = phonePlant();
    await seedPlant(p.tenantId, 1, "9876543210"); // a known customer: Attended needs nothing typed
    await p.ring("9876543210", "incoming", 0);
    const both = await Promise.allSettled([attend(p.raju, "9876543210"), attend(p.desk, "9876543210")]);
    const ok = both.filter((b) => b.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const lost = both.find((b) => b.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.status).toBe(409);
    expect(lost.reason.message).toMatch(/^Already attended by (Raju|Atharv) at \d\d:\d\d$/);
    await p.ring("9876543210", "incoming", 5);
    expect((await attend(p.desk, "9876543210")).rings).toBe(1);
    expect((await refused(() => attend(p.raju, "9123456789"))).status).toBe(404); // never rang
  });

  it("Delivery staff can attend, yet every customer change still refuses them (no rename from anywhere)", async () => {
    const p = phonePlant();
    const ids = await seedPlant(p.tenantId);
    expect(await refused(() => updateCustomer(p.raju, ids.customer, { name: "New Name" }))).toEqual({ status: 403, message: "Delivery staff work in Calls only." });
    expect(await refused(() => listCustomers(p.raju))).toEqual({ status: 403, message: "Delivery staff work in Calls only." });
    expect(await refused(() => attend(ocUser(p.tenantId, ["order_viewer"]), "9876543210"))).toMatchObject({ status: 403 });
  });
});

describe("Not an order number", () => {
  it("owner adds a number (any spelling): its earlier rings disappear from Calls; Remove brings them back", async () => {
    const p = phonePlant();
    await p.ring("9111111111", "incoming", 0);
    await p.ring("9876543210", "incoming", 1);
    expect(await setIgnored(p.owner, { action: "add", phone: "+91 91111 11111", label: "Brother" })).toEqual({ changed: true, phone: "9111111111" });
    expect(await setIgnored(p.owner, { action: "add", phone: "09111111111", label: "Brother again" })).toEqual({ changed: false, phone: "9111111111" });
    let tab = await callsTab(p.raju);
    expect(tab.waiting.map((c) => c.phone)).toEqual(["9876543210"]);
    expect(tab.today).toEqual({ calls: 1, numbers: 1 });
    expect(await waitingCount(p.raju)).toBe(1);
    expect((await refused(() => attend(p.raju, "9111111111"))).status).toBe(409);
    expect(await recordCall(p.key, { phone: "9111111111", event: "incoming" }, at(3))).toEqual({ status: 200, body: { ignored: true } });

    expect(await ignoredList(p.owner)).toEqual([expect.objectContaining({ phone: "9111111111", number: "91111 11111", label: "Brother", by: "Sujata", customer: null })]);
    await setIgnored(p.owner, { action: "remove", phone: "9111111111" });
    tab = await callsTab(p.raju);
    expect(tab.waiting.map((c) => c.phone)).toEqual(["9111111111", "9876543210"]);
    expect(await ignoredList(p.owner)).toEqual([]);
    expect((await refused(() => setIgnored(p.owner, { action: "remove", phone: "9111111111" }))).status).toBe(404);
  });

  it("a customer's number can be listed, with the warning; the customer is unchanged", async () => {
    const p = phonePlant();
    const ids = await seedPlant(p.tenantId, 1, "9876543210");
    await setIgnored(p.owner, { action: "add", phone: "9876543210", label: "Cousin" });
    expect((await ignoredList(p.owner))[0]!.customer).toBe("Sri ram hotel");
    expect((await asOwner("select active from order_capture.customers where id = $1", [ids.customer])).rows[0]).toEqual({ active: true });
  });

  it("hidden / empty numbers and empty labels are refused; landlines are matched by their digits", async () => {
    const p = phonePlant();
    expect((await refused(() => setIgnored(p.owner, { action: "add", phone: "", label: "x" }))).status).toBe(400);
    expect((await refused(() => setIgnored(p.owner, { action: "add", phone: "Private", label: "x" }))).status).toBe(400);
    expect((await refused(() => setIgnored(p.owner, { action: "add", phone: "1".repeat(16), label: "x" }))).status).toBe(400);
    await setIgnored(p.owner, { action: "add", phone: "011-2345-6789", label: "Supplier" });
    expect(await recordCall(p.key, { phone: "011 2345 6789", event: "incoming" }, at(0))).toEqual({ status: 200, body: { ignored: true } });
  });

  it("owner only: Order desk, Delivery staff and support can't change it; support reads; others can't read", async () => {
    const p = phonePlant();
    await setIgnored(p.owner, { action: "add", phone: "9111111111", label: "Brother" });
    for (const u of [p.desk, p.raju, p.support]) expect((await refused(() => setIgnored(u, { action: "remove", phone: "9111111111" }))).status).toBe(403);
    expect(await ignoredList(p.support)).toHaveLength(1);
    for (const u of [p.desk, p.raju, p.staff]) expect((await refused(() => ignoredList(u))).status).toBe(403);
  });

  it("each change is audited and shown in Recent changes", async () => {
    const p = phonePlant();
    await setIgnored(p.owner, { action: "add", phone: "9111111111", label: "Brother" });
    await setIgnored(p.owner, { action: "remove", phone: "9111111111" });
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toEqual(["Number 91111 11111 removed from Not an order number", "Number 91111 11111 added to Not an order number (Brother)"]);
  });

  it("plant B can't see or change plant A's list", async () => {
    const a = phonePlant();
    const b = plant();
    await setIgnored(a.owner, { action: "add", phone: "9111111111", label: "Brother" });
    expect(await ignoredList(b.owner)).toEqual([]);
    expect((await refused(() => setIgnored(b.owner, { action: "remove", phone: "9111111111" }))).status).toBe(404);
    expect(await ignoredList(a.owner)).toHaveLength(1);
    expect((await callsTab(b.owner)).waiting).toEqual([]);
  });
});
