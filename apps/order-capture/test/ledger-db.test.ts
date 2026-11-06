// What the database itself refuses in the sales ledger tables (0008), whatever the app code does.
import { describe, expect, it } from "vitest";
import { asApp, dbError, plant, seedPlant } from "./helpers";

const a = plant();
const t = a.tenantId;
let ids: Awaited<ReturnType<typeof seedPlant>>;

const newBill = (over: Record<string, string>) => {
  const v = {
    source: "'plantops'", number: `'B-${Math.floor(Math.random() * 1e6)}'`, ref_no: String(Math.floor(Math.random() * 1e6) + 10), zoho_invoice_id: "null",
    customer_id: `'${ids.customer}'`, zoho_contact_id: "null", order_id: "null", total: "100", import_id: "null", cancel: "null, null, null, null", ...over,
  };
  return `insert into order_capture.bills (tenant_id, source, number, ref_no, zoho_invoice_id, bill_date, customer_id, zoho_contact_id, customer_name, order_id, sub_total, total, import_id, created_by, created_by_name, cancelled_at, cancelled_by, cancelled_by_name, cancel_reason)
    values ('${t}', ${v.source}, ${v.number}, ${v.ref_no}, ${v.zoho_invoice_id}, '2026-11-06', ${v.customer_id}, ${v.zoho_contact_id}, 'Sri ram hotel', ${v.order_id}, ${v.total}, ${v.total}, ${v.import_id}, gen_random_uuid(), 'Sujata', ${v.cancel})`;
};

describe("ledger database checks", () => {
  it("setup", async () => {
    ids = await seedPlant(t);
  });

  it("a bill belongs to exactly one customer or Zoho contact", async () => {
    expect(await dbError(asApp(t, newBill({ customer_id: "null" })))).toMatch(/check/);
    expect(await dbError(asApp(t, newBill({ zoho_contact_id: `'${ids.contact}'` })))).toMatch(/check/);
  });

  it("source rules: a PlantOps bill has a B-number, a Zoho bill its Zoho id and import", async () => {
    expect(await dbError(asApp(t, newBill({ ref_no: "null" })))).toMatch(/check/);
    expect(await dbError(asApp(t, newBill({ source: "'zoho'", ref_no: "null", import_id: `'${ids.imp}'` })))).toMatch(/check/);
    expect(await dbError(asApp(t, newBill({ source: "'zoho'", ref_no: "null", zoho_invoice_id: "'zi-x'" })))).toMatch(/check/);
  });

  it("numbers are unique per plant; one open bill per order, a cancelled one gives the order up", async () => {
    expect(await dbError(asApp(t, newBill({ number: "'B-0001'" })))).toMatch(/duplicate key/);
    expect(await dbError(asApp(t, newBill({ order_id: `'${ids.order}'` })))).toMatch(/duplicate key/);
    await asApp(t, `update order_capture.bills set cancelled_at = now(), cancelled_by = gen_random_uuid(), cancelled_by_name = 'Sujata', cancel_reason = 'Wrong rate' where id = '${ids.bill}'`);
    expect((await asApp(t, newBill({ order_id: `'${ids.order}'` }))).rowCount).toBe(1);
  });

  it("a cancellation needs who, when and a reason of at least 3 characters", async () => {
    expect(await dbError(asApp(t, newBill({ cancel: "now(), null, null, null" })))).toMatch(/check/);
    expect(await dbError(asApp(t, newBill({ cancel: "now(), gen_random_uuid(), 'Sujata', 'x'" })))).toMatch(/check/);
  });

  it("money: no negative bill or zero payment / allocation; a known mode only", async () => {
    expect(await dbError(asApp(t, newBill({ total: "-1" })))).toMatch(/check/);
    const payment = (amount: string, mode = "cash") =>
      `insert into order_capture.payments (tenant_id, source, number, ref_no, payment_date, customer_id, customer_name, mode, amount, created_by, created_by_name)
        values ('${t}', 'plantops', 'P-${amount}-${mode}', ${Math.floor(Math.random() * 1e6) + 10}, '2026-11-06', '${ids.customer}', 'Sri ram hotel', '${mode}', ${amount}, gen_random_uuid(), 'Sujata')`;
    expect(await dbError(asApp(t, payment("0")))).toMatch(/check/);
    expect(await dbError(asApp(t, payment("10", "paytm")))).toMatch(/check/);
    expect(await dbError(asApp(t, `insert into order_capture.payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name)
      values ('${t}', '${ids.payment}', '${ids.zohoBill}', 0, '2026-11-06', gen_random_uuid(), 'Sujata')`))).toMatch(/check/);
    // a negative allocation (undoing one) is fine
    expect((await asApp(t, `insert into order_capture.payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name)
      values ('${t}', '${ids.payment}', '${ids.zohoBill}', -300, '2026-11-06', gen_random_uuid(), 'Sujata')`)).rowCount).toBe(1);
  });

  it("'closed in Zoho' adjustments come from an import; others need a reason", async () => {
    const adjustment = (kind: string, importId: string, reason = "'Settled'") =>
      `insert into order_capture.bill_adjustments (tenant_id, bill_id, kind, amount, reason, adjusted_on, import_id, created_by, created_by_name)
        values ('${t}', '${ids.zohoBill}', '${kind}', 10, ${reason}, '2026-11-06', ${importId}, gen_random_uuid(), 'Sujata')`;
    expect(await dbError(asApp(t, adjustment("zoho_closed", "null")))).toMatch(/check/);
    expect(await dbError(asApp(t, adjustment("write_off", `'${ids.imp}'`)))).toMatch(/check/);
    expect(await dbError(asApp(t, adjustment("write_off", "null", "'x'")))).toMatch(/check/);
    expect((await asApp(t, adjustment("write_off", "null"))).rowCount).toBe(1);
  });

  it("a Zoho contact's mobile is an Indian mobile, typed and normalised together", async () => {
    const contact = (typed: string, mobile: string) =>
      `insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, mobile_typed, mobile, import_id)
        values ('${t}', 'zc-${Math.random()}', 'Barpali', ${typed}, ${mobile}, '${ids.imp}')`;
    expect(await dbError(asApp(t, contact("'12345'", "'12345'")))).toMatch(/check/);
    expect(await dbError(asApp(t, contact("'+91 9876500000'", "null")))).toMatch(/check/);
    expect((await asApp(t, contact("null", "null"))).rowCount).toBe(1);
  });
});
