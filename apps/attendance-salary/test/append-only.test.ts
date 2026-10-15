// Nothing in Attendance is ever deleted, and a mark never changes: a fix is a new owner mark and / or a cancel (once
// per mark). Cancels, the audit log and support views are append-only; only the plant settings and the outbox retry
// columns can be updated. Enforced by the database: attendance_app simply has no permission, whatever the app code
// does. Plus the database checks on what a row may hold.
import { describe, expect, it } from "vitest";
import { asApp, dbError, plant, seedPlant, TABLES } from "./helpers";

const a = plant();
let ids: Awaited<ReturnType<typeof seedPlant>>;
const t = a.tenantId;

describe("append-only for attendance_app", () => {
  it("setup", async () => {
    ids = await seedPlant(t);
  });

  /** Every statement here must be refused with "permission denied". */
  const refusedStatements = () => {
    const punch = `where id = '${ids.scan}'`;
    const cancel = `where id = '${ids.cancel}'`;
    return [
      // nothing is ever deleted
      ...TABLES.map((tbl) => `delete from attendance_salary.${tbl}`),
      ...TABLES.map((tbl) => `truncate attendance_salary.${tbl}`),
      // a mark never changes: not its person, time, IN / OUT, how it was made, distance, reason or author
      `update attendance_salary.punches set id = gen_random_uuid() ${punch}`,
      `update attendance_salary.punches set tenant_id = gen_random_uuid() ${punch}`,
      `update attendance_salary.punches set user_id = gen_random_uuid() ${punch}`,
      `update attendance_salary.punches set user_name = 'Someone else' ${punch}`,
      `update attendance_salary.punches set kind = 'out' ${punch}`,
      `update attendance_salary.punches set at = now() ${punch}`,
      `update attendance_salary.punches set source = 'owner' ${punch}`,
      `update attendance_salary.punches set distance_m = 0 ${punch}`,
      `update attendance_salary.punches set accuracy_m = 0 ${punch}`,
      `update attendance_salary.punches set reason = 'rewritten' ${punch}`,
      `update attendance_salary.punches set created_by = gen_random_uuid() ${punch}`,
      `update attendance_salary.punches set created_by_name = 'X' ${punch}`,
      `update attendance_salary.punches set created_at = now() ${punch}`,
      // a cancel never changes either (and can't be moved to another mark)
      `update attendance_salary.punch_cancels set id = gen_random_uuid() ${cancel}`,
      `update attendance_salary.punch_cancels set tenant_id = gen_random_uuid() ${cancel}`,
      `update attendance_salary.punch_cancels set punch_id = '${ids.fix}' ${cancel}`,
      `update attendance_salary.punch_cancels set reason = 'rewritten' ${cancel}`,
      `update attendance_salary.punch_cancels set created_by = gen_random_uuid() ${cancel}`,
      `update attendance_salary.punch_cancels set created_by_name = 'X' ${cancel}`,
      `update attendance_salary.punch_cancels set created_at = now() ${cancel}`,
      // the settings row stays with its plant
      `update attendance_salary.plant_settings set tenant_id = gen_random_uuid()`,
      // support views and the audit log never change
      `update attendance_salary.support_views set path = '/x'`,
      `update attendance_salary.support_views set super_admin_id = gen_random_uuid()`,
      `update attendance_salary.audit_log set action = 'x'`,
      `update attendance_salary.audit_log set details = '{}'`,
      `update attendance_salary.audit_log set actor = 'x'`,
      // outbox: only the retry columns change
      `update attendance_salary.notification_outbox set input = '{}' where id = '${ids.outbox}'`,
      `update attendance_salary.notification_outbox set tenant_id = gen_random_uuid() where id = '${ids.outbox}'`,
      `update attendance_salary.notification_outbox set created_at = now() where id = '${ids.outbox}'`,
      `update attendance_salary.notification_outbox set id = gen_random_uuid() where id = '${ids.outbox}'`,
    ];
  };

  it("refuses every DELETE, TRUNCATE and locked UPDATE (each statement listed)", async () => {
    const list = refusedStatements();
    expect(list.length).toBe(42);
    for (const stmt of list) expect(await dbError(asApp(t, stmt)), stmt).toMatch(/permission denied/);
  });

  it("allows what the app needs: the plant settings and the outbox retry columns", async () => {
    expect(
      (await asApp(t, `update attendance_salary.plant_settings set lat = 21.5, lng = 83.9, radius_m = 500, qr_key_hash = '${"b".repeat(64)}', qr_made_at = now(), updated_by = gen_random_uuid(), updated_by_name = 'Sujata', updated_at = now()`)).rowCount,
    ).toBe(1);
    expect((await asApp(t, `update attendance_salary.notification_outbox set attempts = 1, last_error = 'x', sent_at = now(), given_up_at = null where id = '${ids.outbox}'`)).rowCount).toBe(1);
  });
});

describe("database checks on what a row may hold", () => {
  const settings = (tenantId: string, over: Record<string, string>) => {
    const v = { lat: "21.347", lng: "83.627", radius: "200", hash: "null", made: "null", name: "'Sujata'", ...over };
    return `insert into attendance_salary.plant_settings (tenant_id, lat, lng, radius_m, qr_key_hash, qr_made_at, updated_by, updated_by_name)
      values ('${tenantId}', ${v.lat}, ${v.lng}, ${v.radius}, ${v.hash}, ${v.made}, gen_random_uuid(), ${v.name})`;
  };
  const punch = (over: Record<string, string>) => {
    const w = crypto.randomUUID();
    const v = { user: `'${w}'`, name: "'Ramu'", kind: "'in'", source: "'scan'", distance: "40", accuracy: "15", reason: "null", by: `'${w}'`, byName: "'Ramu'", ...over };
    return `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, reason, created_by, created_by_name)
      values ('${t}', ${v.user}, ${v.name}, ${v.kind}, now(), ${v.source}, ${v.distance}, ${v.accuracy}, ${v.reason}, ${v.by}, ${v.byName})`;
  };
  const ownerMark = { source: "'owner'", distance: "null", accuracy: "null", reason: "'forgot to scan'", by: "gen_random_uuid()", byName: "'Sujata'" };

  it.each([
    ["latitude over 90", { lat: "90.5" }],
    ["longitude under -180", { lng: "-180.5" }],
    ["a latitude without a longitude", { lng: "null" }],
    ["a circle of 49 m", { radius: "49" }],
    ["a circle of 2,001 m", { radius: "2001" }],
    ["a QR hash that isn't 64 hex characters", { hash: "'abc'", made: "now()" }],
    ["a QR hash without its date", { hash: `'${"c".repeat(64)}'` }],
    ["an empty name", { name: "'  '" }],
  ])("settings: refuses %s", async (_, over) => {
    const p = crypto.randomUUID();
    expect(await dbError(asApp(p, settings(p, over)))).toMatch(/check constraint/);
  });

  it("settings: one row per plant; 50 m and 2,000 m are fine; a plant without a location yet is fine", async () => {
    const p = plant();
    const ins = (over: Record<string, string>) => asApp(p.tenantId, settings(p.tenantId, over));
    expect((await ins({ radius: "50" })).rowCount).toBe(1);
    expect(await dbError(ins({ radius: "2000" }))).toMatch(/duplicate|unique/);
    const q = plant();
    expect((await asApp(q.tenantId, settings(q.tenantId, { lat: "null", lng: "null", radius: "2000" }))).rowCount).toBe(1);
  });

  it.each([
    ["an unknown kind", { kind: "'lunch'" }],
    ["an unknown source", { source: "'gate'" }],
    ["a scan without a distance", { distance: "null" }],
    ["a scan without the accuracy", { accuracy: "null" }],
    ["a scan made for someone else", { by: "gen_random_uuid()" }],
    ["a scan with a reason", { reason: "'why'" }],
    ["an owner mark without a reason", { ...ownerMark, reason: "null" }],
    ["an owner mark with a reason under 3 characters", { ...ownerMark, reason: "' ok '" }],
    ["an owner mark with a distance", { ...ownerMark, distance: "40" }],
    ["a negative distance", { distance: "-1" }],
    ["an empty name", { name: "''" }],
    ["an empty author name", { byName: "' '" }],
  ])("marks: refuses %s", async (_, over) => {
    expect(await dbError(asApp(t, punch(over)))).toMatch(/check constraint/);
  });

  it("marks: a scan and an owner mark with a reason are fine", async () => {
    expect((await asApp(t, punch({}))).rowCount).toBe(1);
    expect((await asApp(t, punch(ownerMark))).rowCount).toBe(1);
  });

  it("cancels: a reason of 3+ characters is required, and a mark can be cancelled only once", async () => {
    const c = (punchId: string, reason: string) =>
      asApp(t, `insert into attendance_salary.punch_cancels (tenant_id, punch_id, reason, created_by, created_by_name) values ('${t}', '${punchId}', ${reason}, gen_random_uuid(), 'Sujata')`);
    expect(await dbError(c(ids.fix, "null"))).toMatch(/null value|not-null/);
    expect(await dbError(c(ids.fix, "' no '"))).toMatch(/check constraint/);
    expect((await c(ids.fix, "'added by mistake'")).rowCount).toBe(1);
    expect(await dbError(c(ids.fix, "'again'"))).toMatch(/duplicate|unique/);
    expect(await dbError(c(ids.scan, "'again'"))).toMatch(/duplicate|unique/); // cancelled in the seed
  });
});
