// Nothing in Complaint Box is ever deleted, a complaint's details never change after saving (only its status), and
// the history, files and audit log are append-only. Enforced by the database: complaint_app simply has no
// permission, whatever the app code does. Plus the database checks on what a row may hold.
import { describe, expect, it } from "vitest";
import { asApp, dbError, plant, seedPlant, TABLES } from "./helpers";

const a = plant();
let ids: Awaited<ReturnType<typeof seedPlant>>;
const t = a.tenantId;

describe("append-only for complaint_app", () => {
  it("setup", async () => {
    ids = await seedPlant(t);
  });

  /** Every statement here must be refused with "permission denied". */
  const refusedStatements = () => [
    // nothing is ever deleted
    ...TABLES.map((tbl) => `delete from complaint_box.${tbl}`),
    ...TABLES.map((tbl) => `truncate complaint_box.${tbl}`),
    // a complaint's details are locked once saved
    `update complaint_box.complaints set customer_name = 'Someone else' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set phone = '9000000000' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set phone_typed = '9000000000' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set place = 'Elsewhere' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set item_id = '${ids.item}' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set item_name = 'Other' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set batch_text = 'B12' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set description = 'Something different' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set reported_by = gen_random_uuid() where id = '${ids.complaint}'`,
    `update complaint_box.complaints set reported_by_name = 'X' where id = '${ids.complaint}'`,
    `update complaint_box.complaints set ref_no = 99 where id = '${ids.complaint}'`,
    `update complaint_box.complaints set created_at = now() where id = '${ids.complaint}'`,
    `update complaint_box.complaints set tenant_id = gen_random_uuid() where id = '${ids.complaint}'`,
    // history, files, support views and the audit log never change
    `update complaint_box.complaint_events set text = 'rewritten' where id = '${ids.event}'`,
    `update complaint_box.complaint_events set kind = 'resolved' where id = '${ids.event}'`,
    `update complaint_box.files set storage_key = 'x' where id = '${ids.file}'`,
    `update complaint_box.files set complaint_id = '${ids.complaint}' where id = '${ids.file}'`,
    `update complaint_box.support_views set path = '/x'`,
    `update complaint_box.audit_log set action = 'x'`,
    // items: only name / order / on-off change
    `update complaint_box.items set tenant_id = gen_random_uuid() where id = '${ids.item}'`,
    `update complaint_box.items set created_by = gen_random_uuid() where id = '${ids.item}'`,
    `update complaint_box.items set sku_id = gen_random_uuid() where id = '${ids.item}'`,
    // outbox: only the retry columns change
    `update complaint_box.notification_outbox set input = '{}' where id = '${ids.outbox}'`,
  ];

  it("refuses every DELETE, TRUNCATE and locked UPDATE (each statement listed)", async () => {
    const list = refusedStatements();
    expect(list.length).toBe(37);
    for (const stmt of list) expect(await dbError(asApp(t, stmt)), stmt).toMatch(/permission denied/);
  });

  it("allows what the app needs: a complaint's status, an item's name / order / on-off, the outbox retry columns", async () => {
    expect((await asApp(t, `update complaint_box.complaints set status = 'in_progress', status_changed_at = now() where id = '${ids.complaint}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update complaint_box.items set name = '20 L jar (blue)', sort_order = 2, status = 'off', updated_at = now() where id = '${ids.item}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update complaint_box.notification_outbox set attempts = 1, last_error = 'x', sent_at = now() where id = '${ids.outbox}'`)).rowCount).toBe(1);
  });
});

describe("database checks on what a row may hold", () => {
  const complaint = (over: Record<string, string>) => {
    const v = { ref_no: "50", phone: "'9876543210'", description: "'Leaking from the cap'", customer_name: "'Ramesh'", place: "'Kalinga Nagar'", ...over };
    return `insert into complaint_box.complaints (tenant_id, ref_no, customer_name, phone_typed, phone, place, item_id, item_name, description, reported_by, reported_by_name)
      values ('${t}', ${v.ref_no}, ${v.customer_name}, 'typed', ${v.phone}, ${v.place}, '${ids.item}', 'Jar', ${v.description}, gen_random_uuid(), 'Atharv')`;
  };
  const event = (kind: string, text: string | null) =>
    `insert into complaint_box.complaint_events (tenant_id, complaint_id, kind, text, created_by, created_by_name) values ('${t}', '${ids.complaint}', '${kind}', ${text === null ? "null" : `'${text}'`}, gen_random_uuid(), 'Sujata')`;
  const file = (kind: string, type: string, size: number) =>
    `insert into complaint_box.files (tenant_id, complaint_id, kind, content_type, size_bytes, sha256, storage_key, uploaded_by, uploaded_by_name)
      values ('${t}', '${ids.complaint}', '${kind}', '${type}', ${size}, '${"b".repeat(64)}', 'k-${kind}-${type}-${size}', gen_random_uuid(), 'Atharv')`;

  it("the reference is unique per plant (another plant may use the same number)", async () => {
    expect(await dbError(asApp(t, complaint({ ref_no: "1" })))).toMatch(/unique|duplicate/);
    const b = plant();
    await seedPlant(b.tenantId, 1);
  });

  it.each([
    ["a phone that isn't a 10-digit Indian mobile", { phone: "'5876543210'" }],
    ["a phone with +91 still on it", { phone: "'+919876543210'" }],
    ["a description under 10 characters", { description: "'Leaking'" }],
    ["a one-letter customer name", { customer_name: "'R'" }],
    ["a one-letter place", { place: "' X '" }],
    ["reference 0", { ref_no: "0" }],
  ])("refuses %s", async (_, over) => {
    expect(await dbError(asApp(t, complaint(over)))).toMatch(/check constraint/);
  });

  it("an unknown status is refused", async () => {
    expect(await dbError(asApp(t, `update complaint_box.complaints set status = 'closed' where id = '${ids.complaint}'`))).toMatch(/check constraint/);
  });

  it("resolving needs a note and reopening a reason (3+ characters); a plain note may have no text", async () => {
    for (const kind of ["resolved", "reopened"]) {
      expect(await dbError(asApp(t, event(kind, null))), kind).toMatch(/check constraint/);
      expect(await dbError(asApp(t, event(kind, "  ok "))), kind).toMatch(/check constraint/);
    }
    expect((await asApp(t, event("resolved", "Jar replaced"))).rowCount).toBe(1);
    expect((await asApp(t, event("note", null))).rowCount).toBe(1);
  });

  it("files: photos are images up to 10 MB, a video up to 30 MB, nothing else", async () => {
    expect(await dbError(asApp(t, file("photo", "image/jpeg", 10 * 1024 * 1024 + 1)))).toMatch(/check constraint/);
    expect(await dbError(asApp(t, file("video", "image/jpeg", 1000)))).toMatch(/check constraint/);
    expect(await dbError(asApp(t, file("photo", "video/mp4", 1000)))).toMatch(/check constraint/);
    expect(await dbError(asApp(t, file("photo", "image/svg+xml", 1000)))).toMatch(/check constraint/);
    expect(await dbError(asApp(t, file("video", "video/mp4", 30 * 1024 * 1024 + 1)))).toMatch(/check constraint/);
    expect((await asApp(t, file("video", "video/quicktime", 30 * 1024 * 1024))).rowCount).toBe(1);
    expect((await asApp(t, file("photo", "image/webp", 10 * 1024 * 1024))).rowCount).toBe(1);
  });

  it("two active items can't share a name; a switched-off one doesn't block it", async () => {
    const add = (name: string) => `insert into complaint_box.items (tenant_id, name, created_by, created_by_name) values ('${t}', '${name}', gen_random_uuid(), 'Sujata')`;
    expect((await asApp(t, add("Dispenser"))).rowCount).toBe(1);
    expect(await dbError(asApp(t, add(" dispenser ")))).toMatch(/unique|duplicate/);
    expect((await asApp(t, add("20 L JAR (BLUE)"))).rowCount).toBe(1); // the seeded "20 L jar (blue)" was switched off above
  });
});
