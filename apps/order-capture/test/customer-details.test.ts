// Customer page Part 2 (docs/CUSTOMER_PAGE_PHASE_PLAN.md, migration 0010): the owner's Edit (every field, GSTIN checks,
// a new mobile with a reason, never another customer's number), comments, contact persons, the shop location (GPS at
// the shop by Order desk / Accounts / Delivery staff, a pasted Maps link by the owner, clear with a reason), the Shop
// locations screen without money, the timeline; who may; another plant sees nothing.
import { beforeAll, describe, expect, it } from "vitest";
import {
  addComment,
  addPerson,
  clearLocation,
  saveLocation,
  setPersonActive,
  shopSearch,
  shopView,
  updateCustomerDetails,
} from "@/server/customer-details";
import { account } from "@/server/ledger";
import { asApp, auditRows, ocUser, plant, refused, seedPlant } from "./helpers";

const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
const raju = ocUser(a.tenantId, ["delivery_staff"], "Raju");
let id = "";

beforeAll(async () => {
  id = (await seedPlant(a.tenantId)).customer;
  await asApp(a.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${a.tenantId}', 'Maa Tarini', '9123456780', '9123456780', 'Bargarh', gen_random_uuid(), 'X')`);
});

describe("the owner's Edit", () => {
  it("every field at once; a GSTIN fills the GST state and 'registered'; the calling name stays separate", async () => {
    const r = await updateCustomerDetails(a.owner, id, {
      legal_name: "Sri Ram Hotels Pvt Ltd",
      gstin: "21aaacl0140p4zs",
      billing_address: "Main Road",
      billing_city: "Bijepur",
      billing_pin: "768032",
      email: "Accounts@SriRam.in",
      other_phone: "0664-222 333",
      customer_type: "shop",
      delivery_address: "Back gate",
      delivery_landmark: "Near bus stand",
      payment_terms: "net15",
    });
    expect(r.changed).toEqual(expect.arrayContaining(["legal_name", "gstin", "state_code", "gst_treatment", "email", "payment_terms"]));
    const acc = await account(a.owner, { kind: "customer", id });
    expect(acc.party).toMatchObject({ name: "Sri ram hotel", gstin: "21AAACL0140P4ZS", state_code: "21" });
    expect(acc.details).toMatchObject({ legal_name: "Sri Ram Hotels Pvt Ltd", gst_treatment: "registered", email: "accounts@sriram.in", other_phone: "0664222333", customer_type: "shop", payment_terms: "net15", billing_pin: "768032" });
    // clearing a field with "" works; nothing changed = nothing written
    expect((await updateCustomerDetails(a.owner, id, { delivery_address: "" })).changed).toEqual(["delivery_address"]);
    expect((await updateCustomerDetails(a.owner, id, { email: "accounts@sriram.in" })).changed).toEqual([]);
    expect(acc.timeline.map((t) => t.text)).toContainEqual(expect.stringMatching(/^Details changed: .*legal name.*GSTIN/));
  });

  it("refuses a bad GSTIN, PIN, email; a new mobile needs a reason and must not be another customer's", async () => {
    expect((await refused(() => updateCustomerDetails(a.owner, id, { gstin: "21AAACL0140P4ZX" }))).status).toBe(400);
    expect((await refused(() => updateCustomerDetails(a.owner, id, { billing_pin: "012345" }))).status).toBe(400);
    expect((await refused(() => updateCustomerDetails(a.owner, id, { email: "not-an-email" }))).status).toBe(400);
    expect((await refused(() => updateCustomerDetails(a.owner, id, { phone: "98765 11111" }))).message).toMatch(/needs a reason/);
    expect((await refused(() => updateCustomerDetails(a.owner, id, { phone: "91234 56780", phone_reason: "new number" }))).message).toMatch(/Maa Tarini already has this number/);
    expect((await updateCustomerDetails(a.owner, id, { phone: "+91 98765 11111", phone_reason: "changed SIM" })).changed).toEqual(["phone"]);
    const row = (await auditRows(a.tenantId)).filter((x) => x.action === "customer.details").at(-1)!;
    expect(row.details).toMatchObject({ reason: "changed SIM", changes: { phone: { from: "9876543210", to: "9876511111" } } });
    // the same number typed again is no change
    expect((await updateCustomerDetails(a.owner, id, { phone: "9876511111" })).changed).toEqual([]);
  });

  it("owner only: Order desk, Accounts, Delivery staff, support refused; plant B can't reach plant A's customer", async () => {
    for (const u of [a.desk, acct, raju, a.support, a.staff]) expect((await refused(() => updateCustomerDetails(u, id, { email: "x@y.in" }))).status).toBe(403);
    expect((await refused(() => updateCustomerDetails(b.owner, id, { email: "x@y.in" }))).status).toBe(404);
  });
});

describe("comments and contact persons", () => {
  it("owner adds comments (newest first, never changed); others can't", async () => {
    await addComment(a.owner, id, { body: "Asked for 20 L jars from December." });
    const acc = await account(acct, { kind: "customer", id });
    expect(acc.comments[0]).toMatchObject({ body: "Asked for 20 L jars from December.", by: "Sujata" });
    expect(acc.comments).toHaveLength(2); // + the seeded one
    for (const u of [a.desk, acct, a.support]) expect((await refused(() => addComment(u, id, { body: "x" }))).status).toBe(403);
    expect((await refused(() => addComment(a.owner, id, { body: "  " }))).status).toBe(400);
  });

  it("contact persons: add, switch off / on (owner); in the timeline", async () => {
    const p = await addPerson(a.owner, id, { name: "Ajit Sahu", phone: "98610 23456", role: "owner" });
    await setPersonActive(a.owner, id, p.id, false);
    const acc = await account(a.owner, { kind: "customer", id });
    expect(acc.persons.find((x) => x.id === p.id)).toMatchObject({ name: "Ajit Sahu", phone: "9861023456", role: "owner", active: false });
    expect(acc.timeline.map((t) => t.text)).toEqual(expect.arrayContaining(["Contact person added: Ajit Sahu", "Contact person Ajit Sahu switched off"]));
    expect((await refused(() => addPerson(a.desk, id, { name: "X Y" }))).status).toBe(403);
  });
});

describe("shop location", () => {
  it("Delivery staff save it at the shop; too rough (worse than ±150 m) is refused", async () => {
    expect((await refused(() => saveLocation(raju, id, { source: "phone", lat: 21.02, lng: 83.78, accuracy_m: 320 }))).message).toMatch(/too rough \(±320 m\)/);
    const r = await saveLocation(raju, id, { source: "phone", lat: 21.0234567, lng: 83.7841234, accuracy_m: 17.6 });
    expect(r).toEqual({ lat: 21.023457, lng: 83.784123, accuracy_m: 18 });
    const s = await shopView(raju, id);
    expect(s.location).toMatchObject({ lat: "21.023457", lng: "83.784123", accuracy_m: 18, source: "phone", by: "Raju" });
    expect(s).toMatchObject({ can_save: true, can_clear: false, can_paste: false });
    // the Shop locations screen never carries money
    expect(JSON.stringify(s)).not.toMatch(/total|due|amount|rate/);
  });

  it("the owner pastes a Maps link (numbers, a long link, a short link opened by the server); Order desk can't paste", async () => {
    expect(await saveLocation(a.owner, id, { source: "map_link", link: "21.0300, 83.7900" })).toMatchObject({ lat: 21.03, lng: 83.79, accuracy_m: null });
    expect(await saveLocation(a.owner, id, { source: "map_link", link: "https://www.google.com/maps/place/Shop/@21.0311,83.7911,17z/data=!3d21.0312!4d83.7912" })).toMatchObject({ lat: 21.0312, lng: 83.7912 });
    const short = await saveLocation(a.owner, id, { source: "map_link", link: "https://maps.app.goo.gl/AbC123" }, async () => "https://www.google.com/maps?q=21.04,83.8");
    expect(short).toMatchObject({ lat: 21.04, lng: 83.8 });
    expect((await refused(() => saveLocation(a.owner, id, { source: "map_link", link: "https://example.com/x" }, async () => "")))).toMatchObject({ status: 400 });
    expect((await refused(() => saveLocation(a.desk, id, { source: "map_link", link: "21.03, 83.79" }))).status).toBe(403);
  });

  it("Order desk clears a wrong pin with a reason (kept on record); nothing to clear → 409; Accounts can't clear", async () => {
    expect((await refused(() => clearLocation(acct, id, { reason: "wrong shop" }))).status).toBe(403);
    await clearLocation(a.desk, id, { reason: "pin was at the wrong shop" });
    expect((await shopView(a.desk, id)).location).toBeNull();
    expect((await refused(() => clearLocation(a.desk, id, { reason: "again" }))).status).toBe(409);
    const rows = (await asApp(a.tenantId, `select kind from order_capture.customer_locations where customer_id = '${id}' order by created_at`)).rows.map((r) => r.kind);
    expect(rows).toEqual(["set", "set", "set", "set", "set", "clear"]); // seeded + 4 saves + the clear: nothing removed
    const acc = await account(a.owner, { kind: "customer", id });
    expect(acc.location).toBeNull();
    expect(acc.timeline.map((t) => t.text)).toEqual(expect.arrayContaining(["Shop location saved (±18 m)", "Shop location saved from a Maps link", "Shop location cleared: pin was at the wrong shop"]));
  });

  it("Shop locations search: name, place or phone digits; plant staff and viewers refused; plant B sees nothing", async () => {
    await saveLocation(a.desk, id, { source: "phone", lat: 21.02, lng: 83.78, accuracy_m: 40 });
    expect((await shopSearch(raju, "sri")).map((r) => [r.name, r.has_location])).toEqual([["Sri ram hotel", true]]);
    expect((await shopSearch(acct, "bargarh")).map((r) => [r.name, r.has_location])).toEqual([["Maa Tarini", false]]);
    expect((await shopSearch(a.desk, "65111")).map((r) => r.name)).toEqual(["Sri ram hotel"]);
    expect((await refused(() => shopSearch(a.staff, ""))).status).toBe(403);
    expect((await shopSearch(b.owner, "")).length).toBe(0);
    expect((await refused(() => shopView(b.owner, id))).status).toBe(404);
    expect((await refused(() => saveLocation(b.owner, id, { source: "phone", lat: 1, lng: 1, accuracy_m: 5 }))).status).toBe(404);
  });
});

// Marketing staff (owner, 2026-11-07): edit every field but the GST details and payment terms, the mobile included (with a
// reason); comments and contact persons; a customer's page with bills / payments, never its orders; another plant's
// Marketing staff reach nothing.
describe("Marketing staff", () => {
  const mitu = ocUser(a.tenantId, ["marketing_staff"], "Mitu");
  let mid = "";
  beforeAll(async () => {
    mid = String((await asApp(a.tenantId, `select id from order_capture.customers where tenant_id = '${a.tenantId}' and name = 'Maa Tarini'`)).rows[0]!.id);
  });

  it("edits name, place, email, landmark and the mobile (with a reason); recorded under their name", async () => {
    const r = await updateCustomerDetails(mitu, mid, { name: "Maa Tarini Stores", place: "Bargarh town", email: "tarini@shop.in", delivery_landmark: "Opp. temple" });
    expect(r.changed).toEqual(expect.arrayContaining(["name", "place", "email", "delivery_landmark"]));
    expect((await refused(() => updateCustomerDetails(mitu, mid, { phone: "98765 22222" }))).message).toMatch(/needs a reason/);
    expect((await updateCustomerDetails(mitu, mid, { phone: "98765 22222", phone_reason: "shop's new number" })).changed).toEqual(["phone"]);
    const rows = (await auditRows(a.tenantId)).filter((r) => r.action === "customer.details");
    expect(rows.at(-1)!.details).toMatchObject({ by: "Mitu", reason: "shop's new number" });
  });

  it("GST details and payment terms: refused when changed, fine when sent back unchanged", async () => {
    for (const patch of [{ gstin: "21AAACL0140P4ZS" }, { legal_name: "Tarini Pvt Ltd" }, { billing_city: "Sambalpur" }, { state_code: "21" }, { gst_treatment: "registered" as const }, { payment_terms: "net7" as const }])
      expect(await refused(() => updateCustomerDetails(mitu, mid, patch)), JSON.stringify(patch)).toEqual({ status: 403, message: "Only the plant owner changes GST details and payment terms." });
    await updateCustomerDetails(a.owner, mid, { legal_name: "Tarini Pvt Ltd", payment_terms: "net7" });
    expect((await updateCustomerDetails(mitu, mid, { legal_name: "Tarini Pvt Ltd", payment_terms: "net7", other_phone: "0664 111" })).changed).toEqual(["other_phone"]);
  });

  it("adds comments and contact persons; sees the customer's page with amounts but no orders", async () => {
    await addComment(mitu, mid, { body: "Wants a dispenser on trial." });
    const p = await addPerson(mitu, mid, { name: "Rina Das", role: "manager" });
    await setPersonActive(mitu, mid, p.id, false);
    const seeded = await account(mitu, { kind: "customer", id });
    expect(seeded.orders).toEqual([]); // Marketing staff never see orders
    // ... nor do orders count in their Buying & paying (only bills do): an unbilled order on a day without a bill
    await asApp(a.tenantId, `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, total, entered_by, entered_by_name, created_at)
      values ('${a.tenantId}', 9001, 'insights-old', '${id}', 'Sri ram hotel', '9876565111', 'bijepur', 90, gen_random_uuid(), 'X', '2025-01-15T06:00:00Z')`);
    const ownerSees = (await account(a.owner, { kind: "customer", id })).insights.ordering.purchases;
    expect((await account(mitu, { kind: "customer", id })).insights.ordering.purchases).toBe(ownerSees - 1);
    expect((await account(a.owner, { kind: "customer", id })).orders.length).toBeGreaterThan(0);
    expect(seeded.totals).toHaveProperty("due");
    const acc = await account(mitu, { kind: "customer", id: mid });
    expect(acc.comments[0]).toMatchObject({ body: "Wants a dispenser on trial.", by: "Mitu" });
  });

  it("saves a shop location; can't clear one or paste a Maps link", async () => {
    await saveLocation(mitu, mid, { source: "phone", lat: 21.33, lng: 83.62, accuracy_m: 12 });
    expect((await refused(() => clearLocation(mitu, mid, { reason: "wrong shop" }))).status).toBe(403);
    expect((await refused(() => saveLocation(mitu, mid, { source: "map_link", link: "21.03, 83.79" }))).status).toBe(403);
  });

  it("another plant's Marketing staff reach nothing", async () => {
    const other = ocUser(b.tenantId, ["marketing_staff"], "Other");
    expect((await refused(() => updateCustomerDetails(other, mid, { email: "x@y.in" }))).status).toBe(404);
    expect((await refused(() => account(other, { kind: "customer", id: mid }))).status).toBe(404);
    expect((await refused(() => addComment(other, mid, { body: "x" }))).status).toBe(404);
  });
});
