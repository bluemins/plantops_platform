// The Match screen: every Zoho contact and every customer in one of three lists (nothing missed), suggestions by mobile
// and name, link / unlink / add as new customer; owner only; another plant sees none of it.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { nameParts, nameScore, suggest } from "@/lib/name-match";
import { matchAction, matchData } from "@/server/zoho-match";
import { asApp, asOwner, auditRows, plant, refused } from "./helpers";

describe("name suggestions", () => {
  it("drops titles and punctuation; the place in brackets is separate", () => {
    expect(nameParts("Mr. Subrat Kumar  Mishra")).toEqual({ words: ["subrat", "kumar", "mishra"], place: "" });
    expect(nameParts("Sahu Hotel(Bijepur)")).toEqual({ words: ["sahu", "hotel"], place: "bijepur" });
  });
  it("scores alike names high, different ones low; the place helps", () => {
    expect(nameScore("Mr. Naik  Dhaba", "Naik Dhaba")).toBe(1);
    expect(nameScore("Sahu Hotel(Bijepur)", "Sahu Hotel", "Bijepur")).toBe(1);
    expect(nameScore("Sahu Hotel(Bijepur)", "Sahu Hotel", "Barpali")).toBe(1);
    expect(nameScore("Ganesh Store", "Ganesha Stores")).toBeGreaterThanOrEqual(0.8);
    expect(nameScore("Ajit Kirana (Barpali)", "Maa Tarini Store")).toBe(0);
    expect(suggest("Ajit Kirana", [{ name: "Ajit Kirana Store" }, { name: "Ajit" }, { name: "Bedi Dhaba" }]).map((s) => s.item.name)).toEqual(["Ajit Kirana Store", "Ajit"]);
  });
});

describe("matching", () => {
  const a = plant();
  const b = plant();
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const one = async (text: string) => ((await asApp(a.tenantId, text)).rows[0] as { id: string }).id;
    const customer = (name: string, phone: string, place: string) =>
      one(`insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${a.tenantId}', '${name}', '${phone}', '${phone}', '${place}', gen_random_uuid(), 'Sujata') returning id`);
    ids.sahu = await customer("Sahu Hotel", "9437000001", "Bijepur");
    ids.ajit = await customer("Ajit Kirana", "9437000009", "Barpali");
    ids.lonely = await customer("Maa Tarini Store", "9437000005", "Bargarh");
    const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${a.tenantId}', gen_random_uuid(), 'Sujata') returning id`);
    const contact = (name: string, mobile: string | null, customer: string | null) =>
      one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, mobile_typed, mobile, customer_id, import_id)
        values ('${a.tenantId}', 'zc-${randomUUID()}', '${name}', ${mobile ? `'${mobile}'` : "null"}, ${mobile ? `'${mobile}'` : "null"}, ${customer ? `'${customer}'` : "null"}, '${imp}') returning id`);
    ids.zAjit = await contact("Ajit Kirana (Barpali)", null, null);
    ids.zSahu = await contact("Sahu Hotel(Bijepur)", "9437000001", null);
    ids.zLinked = await contact("Ajit K", "9437000009", ids.ajit);
    ids.zNew = await contact("Ghens Dhaba", "9437000077", null);
    ids.zNoPhone = await contact("Ghens", null, null);
    await asApp(a.tenantId, `insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', 'INV-000009', 'zi-9', '2026-10-05', '${ids.zAjit}', 'Ajit Kirana (Barpali)', 500, 500, '${imp}', gen_random_uuid(), 'Sujata')`);
  });

  it("only the owner", async () => {
    for (const u of [a.desk, a.staff, a.support]) expect((await refused(() => matchData(u))).status).toBe(403);
    expect((await refused(() => matchAction(a.desk, { action: "unlink", contact_id: ids.zLinked! }))).status).toBe(403);
  });

  it("every contact and every customer is in exactly one list, with suggestions", async () => {
    const d = await matchData(a.owner);
    expect(d.counts).toEqual({ contacts: 5, linked: 1, unmatched: 4, customers: 3, customers_with_zoho: 1, customers_without_zoho: 2 });
    const c = (id: string) => d.contacts.find((x) => x.id === id)!;
    expect(c(ids.zSahu!).suggestions[0]).toMatchObject({ id: ids.sahu, why: "mobile" });
    expect(c(ids.zAjit!)).toMatchObject({ bills: 1, billed: "500.00", last_bill: "2026-10-05", place_guess: "Barpali" });
    expect(c(ids.zAjit!).suggestions.map((s) => s.id)).toContain(ids.ajit);
    expect(d.customers.find((x) => x.id === ids.sahu)!.suggestions.map((s) => s.id)).toContain(ids.zSahu);
    expect(d.customers.find((x) => x.id === ids.lonely)!.suggestions).toEqual([]);
  });

  it("link, change, unlink; a new customer from a contact; an existing mobile is refused", async () => {
    await matchAction(a.owner, { action: "link", contact_id: ids.zAjit!, customer_id: ids.ajit! });
    await matchAction(a.owner, { action: "link", contact_id: ids.zSahu!, customer_id: ids.sahu! });
    await matchAction(a.owner, { action: "unlink", contact_id: ids.zLinked! });
    const made = await matchAction(a.owner, { action: "new_customer", contact_id: ids.zNew!, name: "Ghens Dhaba", phone: "+91 94370 00077", place: "Ghens" });
    expect(made.customer_id).toBeTruthy();
    expect(await refused(() => matchAction(a.owner, { action: "new_customer", contact_id: ids.zNoPhone!, name: "Ghens", phone: "9437000077", place: "Ghens" }))).toEqual({
      status: 409,
      message: "9437000077 is already your customer Ghens Dhaba: link to them instead",
    });
    expect((await refused(() => matchAction(a.owner, { action: "new_customer", contact_id: ids.zNoPhone!, name: "Ghens", phone: "12345", place: "Ghens" }))).status).toBe(400);
    const d = await matchData(a.owner);
    expect(d.counts).toEqual({ contacts: 5, linked: 3, unmatched: 2, customers: 4, customers_with_zoho: 3, customers_without_zoho: 1 });
    expect((await asOwner("select name from order_capture.customers where tenant_id = $1 and id = $2", [a.tenantId, ids.ajit])).rows).toEqual([{ name: "Ajit Kirana" }]);
    expect((await auditRows(a.tenantId)).map((r) => r.action).filter((x) => x.startsWith("zoho."))).toEqual(["zoho.match", "zoho.match", "zoho.unmatch", "zoho.match"]);
  });

  it("link all with no mobile: to one customer (added once, then reused), only unmatched no-mobile contacts", async () => {
    const one = async (text: string) => ((await asApp(a.tenantId, text)).rows[0] as { id: string }).id;
    const imp = await one(`select id from order_capture.zoho_imports where tenant_id = '${a.tenantId}' limit 1`);
    const contact = (name: string, mobile: string | null) =>
      one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, mobile_typed, mobile, import_id)
        values ('${a.tenantId}', 'zc-${randomUUID()}', '${name}', ${mobile ? `'${mobile}'` : "null"}, ${mobile ? `'${mobile}'` : "null"}, '${imp}') returning id`);
    const n1 = await contact("Walk in 1", null);
    const n2 = await contact("Walk in 2", null);
    const withMobile = await contact("Has Mobile", "9437000088");
    expect((await refused(() => matchAction(a.desk, { action: "link_no_mobile", name: "Retail Customer", phone: "7999293831", place: "Plant" }))).status).toBe(403);
    expect((await refused(() => matchAction(a.owner, { action: "link_no_mobile", name: "Retail Customer", phone: "123", place: "Plant" }))).status).toBe(400);

    const r = await matchAction(a.owner, { action: "link_no_mobile", name: "Retail Customer", phone: "7999293831", place: "Plant" });
    // zNoPhone ("Ghens") from the test before + the two new ones; "Has Mobile" stays to match
    expect(r).toMatchObject({ new_customer: true, linked: 3, customer_name: "Retail Customer" });
    const d = await matchData(a.owner);
    const of = (id: string) => d.contacts.find((x) => x.id === id)!.customer?.id ?? null;
    expect([of(n1), of(n2), of(ids.zNoPhone!)]).toEqual([r.customer_id, r.customer_id, r.customer_id]);
    expect(of(withMobile)).toBeNull();

    // again later: the same customer is reused, already linked contacts are left alone
    const n3 = await contact("Walk in 3", null);
    const again = await matchAction(a.owner, { action: "link_no_mobile", name: "Other name", phone: "+91 79992 93831", place: "Bargarh" });
    expect(again).toMatchObject({ new_customer: false, linked: 1, customer_id: r.customer_id, customer_name: "Retail Customer" });
    expect((await matchData(a.owner)).contacts.find((x) => x.id === n3)!.customer?.id).toBe(r.customer_id);
    expect((await auditRows(a.tenantId)).filter((x) => x.action === "zoho.match" && x.details?.no_mobile_bulk).length).toBe(4);
  });

  it("another plant sees none of it, and can't link plant A's contact", async () => {
    expect((await matchData(b.owner)).counts.contacts).toBe(0);
    expect((await refused(() => matchAction(b.owner, { action: "unlink", contact_id: ids.zAjit! }))).status).toBe(404);
  });
});
