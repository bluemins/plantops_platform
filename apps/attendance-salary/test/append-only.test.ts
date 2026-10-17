// Nothing in Attendance is ever deleted, and a mark never changes: a fix is a new owner mark and / or a cancel (once
// per mark). Cancels, the audit log, support views and all five salary tables are append-only; only the plant settings
// and the outbox retry columns can be updated. Enforced by the database: attendance_app simply has no permission, whatever the app code
// does. Plus the database checks on what a row may hold.
import { describe, expect, it } from "vitest";
import { asApp, asOwner, dbError, plant, seedPlant, TABLES } from "./helpers";

/** Every column of the five salary tables (migration 0002), in table order; each gets its own refused UPDATE. */
const SALARY_COLUMNS: Record<string, string[]> = {
  salary_advances: ["id", "tenant_id", "user_id", "user_name", "on_date", "amount_paise", "note", "corrects_id", "reason", "created_by", "created_by_name", "created_at"],
  salary_payment_undos: ["id", "tenant_id", "payment_id", "reason", "created_by", "created_by_name", "created_at"],
  salary_payments: ["id", "tenant_id", "user_id", "user_name", "month", "paid_on", "paid_paise", "remaining_paise", "figures", "note", "created_by", "created_by_name", "created_at"],
  salary_settings: ["id", "tenant_id", "user_id", "user_name", "from_month", "monthly_paise", "shift_minutes", "paid_leave_halfdays", "gets_overtime", "ot_rate_paise", "joined_on", "left_on", "reason", "created_by", "created_by_name", "created_at", "pay_basis", "day_rate_paise"],
  salary_visibility: ["id", "tenant_id", "user_id", "user_name", "can_see", "created_by", "created_by_name", "created_at"],
};

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
      // salary: nothing ever changes, in any column (a change is always a new row)
      ...Object.entries(SALARY_COLUMNS).flatMap(([tbl, cols]) => cols.map((c) => `update attendance_salary.${tbl} set ${c} = ${c}`)),
    ];
  };

  it("the salary column lists below cover every column of the salary tables", async () => {
    const { rows } = await asOwner<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
       where table_schema = 'attendance_salary' and table_name like 'salary%' order by table_name, ordinal_position`);
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.table_name] ??= []).push(r.column_name);
    expect(actual).toEqual(SALARY_COLUMNS);
  });

  it("refuses every DELETE, TRUNCATE and locked UPDATE (each statement listed)", async () => {
    const list = refusedStatements();
    expect(list.length).toBe(110);
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

describe("database checks on salary rows", () => {
  const p = plant();
  const tp = p.tenantId;
  const worker = crypto.randomUUID();
  const other = crypto.randomUUID();
  const by = "gen_random_uuid(), 'Sujata'";

  const setting = (over: Record<string, string>) => {
    const v = { user: `'${worker}'`, name: "'Ramu'", from: "'2026-10-01'", basis: "'monthly'", monthly: "1200000", day: "null", shift: "480", leave: "4", ot: "true", rate: "6000", joined: "null", left: "null", reason: "null", ...over };
    return `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, day_rate_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, joined_on, left_on, reason, created_by, created_by_name)
      values ('${tp}', ${v.user}, ${v.name}, ${v.from}, ${v.basis}, ${v.monthly}, ${v.day}, ${v.shift}, ${v.leave}, ${v.ot}, ${v.rate}, ${v.joined}, ${v.left}, ${v.reason}, ${by})`;
  };
  const advance = (over: Record<string, string>) => {
    const v = { user: `'${worker}'`, amount: "200000", note: "null", corrects: "null", reason: "null", ...over };
    return `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, note, corrects_id, reason, created_by, created_by_name)
      values ('${tp}', ${v.user}, 'Ramu', '2026-10-03', ${v.amount}, ${v.note}, ${v.corrects}, ${v.reason}, ${by}) returning id`;
  };
  const payment = (over: Record<string, string>) => {
    const v = { month: "'2026-10-01'", paid: "904000", remaining: "904000", figures: `'{"rules": 1}'`, note: "null", ...over };
    return `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, note, created_by, created_by_name)
      values ('${tp}', '${worker}', 'Ramu', ${v.month}, '2026-10-31', ${v.paid}, ${v.remaining}, ${v.figures}, ${v.note}, ${by}) returning id`;
  };
  const undo = (paymentId: string, reason: string) =>
    `insert into attendance_salary.salary_payment_undos (tenant_id, payment_id, reason, created_by, created_by_name) values ('${tp}', '${paymentId}', ${reason}, ${by})`;
  let advanceId = "";

  it.each([
    ["overtime on without a rate", { rate: "null" }],
    ["a rate without overtime", { ot: "false" }],
    ["an overtime rate of 0", { rate: "0" }],
    ["a from month that isn't the 1st", { from: "'2026-10-02'" }],
    ["a shift of 59 minutes", { shift: "59" }],
    ["a shift of 961 minutes", { shift: "961" }],
    ["a shift that isn't a whole half hour (485 minutes)", { shift: "485" }],
    ["paid leave of 21 half days", { leave: "21" }],
    ["negative paid leave", { leave: "-1" }],
    ["a salary of 0", { monthly: "0" }],
    ["a salary over ₹1 crore", { monthly: "1000000001" }],
    ["a last day before the joining day", { joined: "'2026-10-15'", left: "'2026-10-14'" }],
    ["a reason of 2 characters", { reason: "' ab '" }],
    ["an empty name", { name: "'  '" }],
    // per-day pay (migration 0003)
    ["per day without a day rate", { basis: "'per_day'", monthly: "null", leave: "0" }],
    ["per day with a monthly salary", { basis: "'per_day'", day: "45000", leave: "0" }],
    ["per day with paid leave", { basis: "'per_day'", monthly: "null", day: "45000", leave: "4" }],
    ["monthly without a salary", { monthly: "null" }],
    ["monthly with a day rate", { day: "45000" }],
    ["a day rate of 0", { basis: "'per_day'", monthly: "null", day: "0", leave: "0" }],
    ["a day rate over ₹1 lakh", { basis: "'per_day'", monthly: "null", day: "10000001", leave: "0" }],
    ["an unknown pay basis", { basis: "'weekly'" }],
  ])("settings: refuses %s", async (_, over) => {
    expect(await dbError(asApp(tp, setting(over)))).toMatch(/check constraint/);
  });

  it("settings: valid rows are fine (with and without overtime, joined and left on the same day, a reason)", async () => {
    expect((await asApp(tp, setting({}))).rowCount).toBe(1);
    expect((await asApp(tp, setting({ ot: "false", rate: "null", shift: "60", leave: "0" }))).rowCount).toBe(1);
    expect((await asApp(tp, setting({ shift: "960", leave: "20", joined: "'2026-10-15'", left: "'2026-10-15'", reason: "'agreed in September'" }))).rowCount).toBe(1);
  });

  it("settings: a per-day row is fine; a row saved without a pay basis (as before 0003) is monthly", async () => {
    expect((await asApp(tp, setting({ basis: "'per_day'", monthly: "null", day: "45000", leave: "0" }))).rowCount).toBe(1);
    expect((await asApp(tp, setting({ basis: "'per_day'", monthly: "null", day: "10000000", leave: "0", ot: "false", rate: "null" }))).rowCount).toBe(1); // ₹1 lakh
    const old = await asApp(
      tp,
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, created_by, created_by_name)
       values ('${tp}', '${other}', 'Gaja', '2026-10-01', 1000000, 480, false, ${by}) returning pay_basis, day_rate_paise, paid_leave_halfdays`,
    );
    expect(old.rows[0]).toEqual({ pay_basis: "monthly", day_rate_paise: null, paid_leave_halfdays: 4 });
  });

  it("advances: a positive advance is fine; a correction is negative, linked and has a reason", async () => {
    advanceId = ((await asApp(tp, advance({ note: "'Cash'" }))).rows[0] as { id: string }).id;
    expect((await asApp(tp, advance({ amount: "-50000", corrects: `'${advanceId}'`, reason: "'typed twice'" }))).rowCount).toBe(1);
  });

  it.each([
    ["an amount of 0", { amount: "0" }],
    ["a negative amount without a linked entry or reason", { amount: "-100" }],
    ["a negative amount without a reason", { amount: "-100", corrects: "LINK" }],
    ["a positive amount linked to an entry", { amount: "100", corrects: "LINK", reason: "'more'" }],
    ["a positive amount with a reason", { reason: "'why'" }],
    ["a correction reason under 3 characters", { amount: "-100", corrects: "LINK", reason: "'no'" }],
    ["a note over 200 characters", { note: `'${"x".repeat(201)}'` }],
    ["an amount over ₹1 crore", { amount: "1000000001" }],
  ])("advances: refuses %s", async (_, over) => {
    const o = { ...over } as Record<string, string>;
    if (o.corrects === "LINK") o.corrects = `'${advanceId}'`;
    expect(await dbError(asApp(tp, advance(o)))).toMatch(/check constraint/);
  });

  it("advances: a correction of another person's entry, or of an entry that doesn't exist, is refused", async () => {
    expect(await dbError(asApp(tp, advance({ user: `'${other}'`, amount: "-100", corrects: `'${advanceId}'`, reason: "'not theirs'" })))).toMatch(/foreign key/);
    expect(await dbError(asApp(tp, advance({ amount: "-100", corrects: "gen_random_uuid()", reason: "'no such entry'" })))).toMatch(/foreign key/);
  });

  it("visibility: an on / off row is fine; a missing choice is refused", async () => {
    const vis = (canSee: string) =>
      `insert into attendance_salary.salary_visibility (tenant_id, user_id, user_name, can_see, created_by, created_by_name) values ('${tp}', '${worker}', 'Ramu', ${canSee}, ${by})`;
    expect((await asApp(tp, vis("true"))).rowCount).toBe(1);
    expect((await asApp(tp, vis("false"))).rowCount).toBe(1);
    expect(await dbError(asApp(tp, vis("null")))).toMatch(/null value|not-null/);
  });

  it.each([
    ["a month that isn't the 1st", { month: "'2026-10-31'" }],
    ["a negative paid amount", { paid: "-1", remaining: "-1" }],
    ["a paid amount that isn't the remaining", { paid: "900000" }],
    ["a paid amount when the remaining was negative", { paid: "100", remaining: "-210000" }],
    ["figures that aren't an object", { figures: "'[1, 2]'" }],
    ["a note over 200 characters", { note: `'${"x".repeat(201)}'` }],
  ])("payments: refuses %s", async (_, over) => {
    expect(await dbError(asApp(tp, payment(over)))).toMatch(/check constraint/);
  });

  it("payments and undos: a negative remaining is paid as ₹0; a payment is undone once, with a reason", async () => {
    expect((await asApp(tp, payment({ month: "'2026-09-01'", paid: "0", remaining: "-210000" }))).rowCount).toBe(1);
    const id = ((await asApp(tp, payment({}))).rows[0] as { id: string }).id;
    expect(await dbError(asApp(tp, undo(id, "' no '")))).toMatch(/check constraint/);
    expect(await dbError(asApp(tp, undo(id, "null")))).toMatch(/null value|not-null/);
    expect((await asApp(tp, undo(id, "'paid the wrong month'"))).rowCount).toBe(1);
    expect(await dbError(asApp(tp, undo(id, "'again'")))).toMatch(/duplicate|unique/);
    expect(await dbError(asApp(tp, undo(crypto.randomUUID(), "'no such payment'")))).toMatch(/foreign key/);
  });
});
