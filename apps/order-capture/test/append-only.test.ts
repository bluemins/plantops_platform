// Nothing in Order Capture is ever deleted; an order's reference, customer copy and saved lines never change (a change
// adds a new version of the lines); the history, audit log and support views are append-only; a customer's phone is
// fixed. Enforced by the database: order_app simply has no permission, whatever the app code does. Plus the database
// checks on what a row may hold.
import { describe, expect, it } from "vitest";
import { asApp, dbError, plant, seedPlant, TABLES } from "./helpers";

const a = plant();
let ids: Awaited<ReturnType<typeof seedPlant>>;
const t = a.tenantId;

describe("append-only for order_app", () => {
  it("setup", async () => {
    ids = await seedPlant(t);
  });

  /** Every statement here must be refused with "permission denied". */
  const refusedStatements = () => {
    const order = `where id = '${ids.order}'`;
    const customer = `where id = '${ids.customer}'`;
    const line = `where id = '${ids.line}'`;
    const event = `where id = '${ids.event}'`;
    return [
      // nothing is ever deleted
      ...TABLES.map((tbl) => `delete from order_capture.${tbl}`),
      ...TABLES.map((tbl) => `truncate order_capture.${tbl}`),
      // consent answers and the pilot's groups are never changed (a new answer is a new row)
      `update order_capture.customer_consents set status = 'withdrawn' where id = '${ids.consent}'`,
      `update order_capture.customer_consents set created_at = now() where id = '${ids.consent}'`,
      `update order_capture.reminder_groups set grp = 'holdout'`,
      `update order_capture.customer_messages set kind = 'reorder_reminder' where id = '${ids.message}'`,
      `update order_capture.customer_messages set skip_reason = 'holdout' where id = '${ids.message}'`,
      // an order's reference, customer copy and who entered it are fixed
      `update order_capture.orders set customer_name = 'Someone else' ${order}`,
      `update order_capture.orders set customer_phone = '9000000000' ${order}`,
      `update order_capture.orders set customer_place = 'Elsewhere' ${order}`,
      `update order_capture.orders set customer_id = '${ids.customer}' ${order}`,
      `update order_capture.orders set ref_no = 99 ${order}`,
      `update order_capture.orders set request_key = 'another-key' ${order}`,
      `update order_capture.orders set entered_by = gen_random_uuid() ${order}`,
      `update order_capture.orders set entered_by_name = 'X' ${order}`,
      `update order_capture.orders set created_at = now() ${order}`,
      `update order_capture.orders set tenant_id = gen_random_uuid() ${order}`,
      `update order_capture.orders set order_note = 'changed' ${order}`,
      // a customer's phone is their identity; who added them is fixed
      `update order_capture.customers set phone = '9000000000' ${customer}`,
      `update order_capture.customers set phone_typed = '9000000000' ${customer}`,
      `update order_capture.customers set created_by = gen_random_uuid() ${customer}`,
      `update order_capture.customers set created_by_name = 'X' ${customer}`,
      `update order_capture.customers set created_at = now() ${customer}`,
      `update order_capture.customers set tenant_id = gen_random_uuid() ${customer}`,
      // a rate row stays on its product
      `update order_capture.product_rates set sku_id = gen_random_uuid() where id = '${ids.rate}'`,
      `update order_capture.product_rates set tenant_id = gen_random_uuid() where id = '${ids.rate}'`,
      `update order_capture.product_rates set created_at = now() where id = '${ids.rate}'`,
      // saved lines never change (a change is a new version)
      `update order_capture.order_lines set quantity = 5 ${line}`,
      `update order_capture.order_lines set rate = 1 ${line}`,
      `update order_capture.order_lines set line_total = 1 ${line}`,
      `update order_capture.order_lines set sku_id = gen_random_uuid() ${line}`,
      `update order_capture.order_lines set product_name = 'X' ${line}`,
      `update order_capture.order_lines set unit = 'jar' ${line}`,
      `update order_capture.order_lines set version = 9 ${line}`,
      `update order_capture.order_lines set line_no = 9 ${line}`,
      `update order_capture.order_lines set order_id = '${ids.order}' ${line}`,
      `update order_capture.order_lines set tenant_id = gen_random_uuid() ${line}`,
      // the history never changes
      `update order_capture.order_events set kind = 'cancelled' ${event}`,
      `update order_capture.order_events set version = 9 ${event}`,
      `update order_capture.order_events set text = 'rewritten' ${event}`,
      `update order_capture.order_events set invoice_no = 'X' ${event}`,
      `update order_capture.order_events set created_by = gen_random_uuid() ${event}`,
      `update order_capture.order_events set created_by_name = 'X' ${event}`,
      `update order_capture.order_events set created_at = now() ${event}`,
      `update order_capture.order_events set order_id = '${ids.order}' ${event}`,
      // support views and the audit log never change
      `update order_capture.support_views set path = '/x'`,
      `update order_capture.audit_log set action = 'x'`,
      `update order_capture.audit_log set details = '{}'`,
      // outbox: only the retry columns change
      `update order_capture.notification_outbox set input = '{}' where id = '${ids.outbox}'`,
      `update order_capture.notification_outbox set tenant_id = gen_random_uuid() where id = '${ids.outbox}'`,
      `update order_capture.notification_outbox set created_at = now() where id = '${ids.outbox}'`,
      // WhatsApp thank-you: who, which order and which number are fixed; only the sending columns move
      `update order_capture.customer_messages set to_phone = '9000000000' where id = '${ids.message}'`,
      `update order_capture.customer_messages set order_id = '${ids.order}' where id = '${ids.message}'`,
      `update order_capture.customer_messages set kind = 'delivery_thanks' where id = '${ids.message}'`,
      `update order_capture.customer_messages set requested_by = gen_random_uuid() where id = '${ids.message}'`,
      `update order_capture.customer_messages set requested_by_name = 'X' where id = '${ids.message}'`,
      `update order_capture.customer_messages set created_at = now() where id = '${ids.message}'`,
      `update order_capture.customer_messages set tenant_id = gen_random_uuid() where id = '${ids.message}'`,
    ];
  };

  it("refuses every DELETE, TRUNCATE and locked UPDATE (each statement listed)", async () => {
    const list = refusedStatements();
    expect(list.length).toBe(78);
    for (const stmt of list) expect(await dbError(asApp(t, stmt)), stmt).toMatch(/permission denied/);
  });

  it("allows what the app needs: rates, a customer's name / place / on-off, an order's status / version / total / delivery, the outbox retry columns", async () => {
    expect((await asApp(t, `update order_capture.product_rates set unit = 'case', default_rate = 95.50, updated_by = gen_random_uuid(), updated_at = now() where id = '${ids.rate}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update order_capture.customers set name = 'Sri Ram Hotel', place = 'Bijepur', active = false, updated_at = now() where id = '${ids.customer}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update order_capture.orders set version = 2, total = 600 where id = '${ids.order}'`)).rowCount).toBe(1);
    expect(
      (await asApp(t, `update order_capture.orders set status = 'delivered', status_changed_at = now(), delivered_by = gen_random_uuid(), delivered_by_name = 'Atharv', delivered_at = now(), delivery_note = '80 delivered, 20 next trip', invoice_no = 'INV-000123' where id = '${ids.order}'`)).rowCount,
    ).toBe(1);
    expect(
      (await asApp(t, `update order_capture.orders set status = 'pending', delivered_by = null, delivered_by_name = null, delivered_at = null, delivery_note = null, invoice_no = null where id = '${ids.order}'`)).rowCount,
    ).toBe(1);
    expect((await asApp(t, `update order_capture.notification_outbox set attempts = 1, last_error = 'x', sent_at = now() where id = '${ids.outbox}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update order_capture.customer_messages set status = 'sent', provider_sid = 'SM123', error = null, attempts = 1, sent_at = now() where id = '${ids.message}'`)).rowCount).toBe(1);
  });
});

describe("database checks on what a row may hold", () => {
  const customer = (over: Record<string, string>) => {
    const v = { name: "'Maa Tarini Store'", phone: "'9123456780'", place: "'Bargarh'", ...over };
    return `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${t}', ${v.name}, 'typed', ${v.phone}, ${v.place}, gen_random_uuid(), 'Atharv')`;
  };
  const order = (over: Record<string, string>) => {
    const v = { ref_no: "50", request_key: `'key-${crypto.randomUUID()}'`, status: "'pending'", total: "0", delivered: "null, null, null", note: "null, null", ...over };
    return `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, status, total, entered_by, entered_by_name, delivered_by, delivered_by_name, delivered_at, delivery_note, invoice_no)
      values ('${t}', ${v.ref_no}, ${v.request_key}, '${ids.customer}', 'Sri ram hotel', '9876543210', 'bijepur', ${v.status}, ${v.total}, gen_random_uuid(), 'Atharv', ${v.delivered}, ${v.note})`;
  };
  const line = (over: Record<string, string>) => {
    const v = { version: "5", line_no: "1", sku: "gen_random_uuid()", quantity: "2", rate: "90", line_total: "180", ...over };
    return `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
      values ('${t}', '${ids.order}', ${v.version}, ${v.line_no}, ${v.sku}, '500ml', 'box', ${v.quantity}, ${v.rate}, ${v.line_total})`;
  };
  const event = (kind: string, text: string | null, invoice: string | null = null) =>
    `insert into order_capture.order_events (tenant_id, order_id, kind, version, text, invoice_no, created_by, created_by_name)
      values ('${t}', '${ids.order}', '${kind}', 1, ${text === null ? "null" : `'${text}'`}, ${invoice === null ? "null" : `'${invoice}'`}, gen_random_uuid(), 'Sujata')`;

  it.each([
    ["a phone that isn't a 10-digit Indian mobile", { phone: "'5876543210'" }],
    ["a phone with +91 still on it", { phone: "'+919123456780'" }],
    ["a one-letter customer name", { name: "'R'" }],
    ["a customer name over 100 characters", { name: `'${"x".repeat(101)}'` }],
    ["a one-letter place", { place: "' X '" }],
  ])("customers: refuses %s", async (_, over) => {
    expect(await dbError(asApp(t, customer(over)))).toMatch(/check constraint/);
  });

  it("one customer per phone per plant; another plant may have the same number", async () => {
    expect(await dbError(asApp(t, customer({ phone: "'9876543210'" })))).toMatch(/unique|duplicate/);
    const b = plant();
    await seedPlant(b.tenantId, 1, "9876543210");
  });

  it("the reference and the request key are unique per plant", async () => {
    expect(await dbError(asApp(t, order({ ref_no: "1" })))).toMatch(/unique|duplicate/);
    expect((await asApp(t, order({ ref_no: "60", request_key: "'same-key-123'" }))).rowCount).toBe(1);
    expect(await dbError(asApp(t, order({ ref_no: "61", request_key: "'same-key-123'" })))).toMatch(/unique|duplicate/);
  });

  it.each([
    ["reference 0", { ref_no: "0" }],
    ["a short request key", { request_key: "'abc'" }],
    ["an unknown status", { status: "'shipped'" }],
    ["a negative total", { total: "-1" }],
    ["delivered without who and when", { status: "'delivered'" }],
    ["who / when on a pending order", { delivered: "gen_random_uuid(), 'Atharv', now()" }],
    ["delivered with when but no who", { status: "'delivered'", delivered: "null, null, now()" }],
    ["a delivery note on a pending order", { note: "'80 delivered', null" }],
    ["an invoice no. on a cancelled order", { status: "'cancelled'", note: "null, 'INV-1'" }],
    ["a delivery note over 300 characters", { status: "'delivered'", delivered: "gen_random_uuid(), 'Atharv', now()", note: `'${"x".repeat(301)}', null` }],
  ])("orders: refuses %s", async (_, over) => {
    expect(await dbError(asApp(t, order(over)))).toMatch(/check constraint/);
  });

  it("orders: a delivered order with who, when, a note and an invoice no. is fine", async () => {
    expect((await asApp(t, order({ ref_no: "70", status: "'delivered'", delivered: "gen_random_uuid(), 'Atharv', now()", note: "'all delivered', 'INV-7'" }))).rowCount).toBe(1);
  });

  it.each([
    ["quantity 0", { quantity: "0", line_total: "0" }],
    ["quantity over 100,000", { quantity: "100001", line_total: "9000090" }],
    ["a negative rate", { rate: "-1", line_total: "-2" }],
    ["a line total that isn't quantity × rate", { line_total: "100" }],
    ["line 0", { line_no: "0" }],
  ])("lines: refuses %s", async (_, over) => {
    expect(await dbError(asApp(t, line(over)))).toMatch(/check constraint/);
  });

  it("lines: whole quantities only; rates with 2 decimals; each product once per version", async () => {
    expect(await dbError(asApp(t, line({ quantity: "'1.5'", line_total: "135" })))).toMatch(/invalid input syntax for type integer/);
    expect((await asApp(t, line({ line_no: "1", sku: `'${ids.sku500}'`, quantity: "3", rate: "33.33", line_total: "99.99" }))).rowCount).toBe(1);
    expect(await dbError(asApp(t, line({ line_no: "2", sku: `'${ids.sku500}'` })))).toMatch(/unique|duplicate/);
    expect(await dbError(asApp(t, line({ line_no: "1" })))).toMatch(/unique|duplicate/);
  });

  it("events: cancelling and undoing Delivered need a reason (3+ characters); an invoice no. only on a delivery", async () => {
    for (const kind of ["cancelled", "undelivered"]) {
      expect(await dbError(asApp(t, event(kind, null))), kind).toMatch(/check constraint/);
      expect(await dbError(asApp(t, event(kind, "  ok "))), kind).toMatch(/check constraint/);
    }
    expect((await asApp(t, event("cancelled", "Customer changed mind"))).rowCount).toBe(1);
    expect(await dbError(asApp(t, event("changed", null, "INV-1")))).toMatch(/check constraint/);
    expect((await asApp(t, event("delivered", "80 delivered, 20 next trip", "INV-000123"))).rowCount).toBe(1);
    expect(await dbError(asApp(t, event("shipped", null)))).toMatch(/check constraint/);
  });

  it("rates: one per product per plant, no negative default, a unit of 1-20 characters", async () => {
    const rate = (sku: string, unit: string, def: string) =>
      `insert into order_capture.product_rates (tenant_id, sku_id, unit, default_rate, updated_by) values ('${t}', ${sku}, ${unit}, ${def}, gen_random_uuid())`;
    expect(await dbError(asApp(t, rate(`'${ids.sku500}'`, "'box'", "100")))).toMatch(/unique|duplicate/);
    expect(await dbError(asApp(t, rate("gen_random_uuid()", "'box'", "-1")))).toMatch(/check constraint/);
    expect(await dbError(asApp(t, rate("gen_random_uuid()", "'  '", "1")))).toMatch(/check constraint/);
    expect((await asApp(t, rate("gen_random_uuid()", "'jar'", "null"))).rowCount).toBe(1); // no default rate: typed on each order
  });
});
