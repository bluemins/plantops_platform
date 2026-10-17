// Phase C (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Claims only for field staff"): only a person the owner ticked "Field
// staff" sends their own claims; My claims is open to them, or to anyone with a claim on record. The owner's entries
// for someone are not limited by the tick. Real database, real routes; dates relative to today.
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as claimsRoute from "@/app/api/claims/route";
import MyClaimsPage from "@/app/my/claims/page";
import NewClaimPage from "@/app/my/claims/new/page";
import { myTabs } from "@/app/my-tabs";
import { describeChange } from "@/lib/changes";
import { addDays, addMonths, istDay, istMonth } from "@/lib/days";
import { decideClaim, enterClaim, hasOwnClaims, myClaims, sendClaim, withdrawClaim } from "@/server/claims";
import { salaryPanel, saveSetting } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, contactsFor, dbError, jsonReq, plant, refusal, signInAs, textOf } from "./helpers";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const THIS = istMonth();
const LAST = addMonths(THIS, -1);
const TODAY = istDay();
/** the last day of last month: always within the 31 days a worker may date a claim */
const LAST_DAY_OF_LAST = addDays(`${THIS}-01`, -1);
const NOT_FIELD = "Claims are only for field staff. Ask the owner.";
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

const duty = (over: Record<string, unknown> = {}) => ({ kind: "field_duty" as const, on_date: TODAY, km: "42", amount: null, note: "Cuttack delivery", ...over });
const expense = (over: Record<string, unknown> = {}) => ({ kind: "expense" as const, on_date: TODAY, km: null, amount: "450", note: "Diesel for generator", ...over });

/** The owner's Salary box, as the screen sends it. */
const save = (owner: AtUser, person: AtUser, over: Record<string, unknown> = {}) =>
  saveSetting(owner, { user_id: person.userId, pay_basis: "monthly", monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, field_staff: false, ...over } as never);

function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper)];
  return p;
}

describe("the database", () => {
  it("1. the migration ticks rows that have a TA / DA rate and leaves the others; a rate without the tick is refused", async () => {
    const sqlText = await readFile(path.resolve(import.meta.dirname, "../db/migrations/0005_field_staff.sql"), "utf8");
    const backfill = sqlText.match(/update attendance_salary\.salary_settings[^;]+;/)![0];
    const tenant = crypto.randomUUID();
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
    await c.connect();
    try {
      // replay the backfill on rows saved the v0.22.0 way (no tick), inside a transaction that is rolled back
      await c.query("begin");
      await c.query("alter table attendance_salary.salary_settings drop constraint salary_settings_rates_need_field_staff");
      const row = (name: string, km: string) =>
        c.query(
          `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, km_rate_paise, created_by, created_by_name)
           values ($1, gen_random_uuid(), $2, '2026-10-01', 1200000, 480, false, ${km}, gen_random_uuid(), 'Sujata')`,
          [tenant, name],
        );
      await row("Dillip", "300");
      await row("Bindu", "null");
      await c.query(backfill);
      const { rows } = await c.query("select user_name, field_staff from attendance_salary.salary_settings where tenant_id = $1 order by user_name", [tenant]);
      expect(rows).toEqual([
        { user_name: "Bindu", field_staff: false },
        { user_name: "Dillip", field_staff: true },
      ]);
    } finally {
      await c.query("rollback");
      await c.end();
    }

    const p = setup();
    const insert = (field: boolean) =>
      asApp(
        p.tenantId,
        `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, da_day_paise, field_staff, created_by, created_by_name)
         values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '2026-10-01', 1200000, 480, false, 15000, ${field}, gen_random_uuid(), 'Sujata')`,
      );
    expect(await dbError(insert(false))).toMatch(/salary_settings_rates_need_field_staff/);
    expect((await insert(true)).rowCount).toBe(1);
  });

  it("2. salary_settings stays append-only: UPDATE and DELETE of the tick refused", async () => {
    const p = setup();
    await save(p.owner, p.worker, { field_staff: true });
    expect(await dbError(asApp(p.tenantId, `update attendance_salary.salary_settings set field_staff = false where tenant_id = '${p.tenantId}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, `delete from attendance_salary.salary_settings where tenant_id = '${p.tenantId}'`))).toMatch(/permission denied/);
  });
});

describe("the Salary box", () => {
  it("3. the tick is saved from a month; earlier months keep theirs; history and Recent changes say 'field staff'", async () => {
    const p = setup();
    await save(p.owner, p.worker, { from_month: LAST, field_staff: true, reason: "does deliveries" });
    let panel = await salaryPanel(p.owner, p.worker.userId, THIS);
    await save(p.owner, p.worker, { field_staff: false, expect: panel.expect.setting });
    panel = await salaryPanel(p.owner, p.worker.userId, THIS);
    expect(panel.history.map((h) => [h.fromMonth, h.fieldStaff])).toEqual([
      [THIS, false],
      [LAST, true],
    ]);
    expect((await salaryPanel(p.owner, p.worker.userId, LAST)).applies).toMatchObject({ fromMonth: LAST, fieldStaff: true });
    const audit = (await asOwner("select action, details from attendance_salary.audit_log where tenant_id = $1 order by id", [p.tenantId])).rows as { action: string; details: Record<string, unknown> }[];
    expect(describeChange(audit[0]!.action, audit[0]!.details)).toMatch(/· field staff: does deliveries$/);
    expect(describeChange(audit[1]!.action, audit[1]!.details)).not.toContain("field staff");
  });

  it("4. a TA or DA rate without the tick: 400 'Tick Field staff first'", async () => {
    const p = setup();
    for (const over of [{ ta_rate: "3" }, { da_rate: "150" }]) {
      expect(await refusal(() => save(p.owner, p.worker, over))).toMatchObject({ status: 400, message: "Tick Field staff first" });
    }
    await save(p.owner, p.worker, { field_staff: true, ta_rate: "3", da_rate: "150" });
  });
});

describe("a worker who isn't ticked", () => {
  it("5. no tab, 404 on My claims and the new-claim page, 400 for their own field duty AND expense through the API", async () => {
    const p = setup();
    await save(p.owner, p.worker);
    expect(await hasOwnClaims(p.worker)).toBe(false);
    signInAs(p.worker);
    expect((await myTabs(p.worker)).claims).toBe(false);
    await expect(MyClaimsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(NOT_FOUND);
    await expect(NewClaimPage({ searchParams: Promise.resolve({ kind: "expense" }) })).rejects.toThrow(NOT_FOUND);
    for (const body of [duty(), expense()]) {
      const res = await claimsRoute.POST(jsonReq("POST", "/api/claims", body), undefined as never);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: NOT_FIELD });
    }
  });
});

describe("a ticked worker", () => {
  it("6. expenses work without a rate; field duty only with a rate", async () => {
    const p = setup();
    await save(p.owner, p.worker, { field_staff: true });
    expect(await hasOwnClaims(p.worker)).toBe(true);
    await sendClaim(p.worker, expense());
    expect((await refusal(() => sendClaim(p.worker, duty()))).message).toBe("No TA or DA rate is set for that month. Ask the owner.");
    const v = await myClaims(p.worker, null);
    expect(v).toMatchObject({ canAdd: true, fieldDuty: false });
    const panel = await salaryPanel(p.owner, p.worker.userId, THIS);
    await save(p.owner, p.worker, { field_staff: true, ta_rate: "3", expect: panel.expect.setting });
    await sendClaim(p.worker, duty());
    expect((await myClaims(p.worker, null)).fieldDuty).toBe(true);
    signInAs(p.worker);
    const page = textOf(await MyClaimsPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("+ Field duty");
    expect(page).toContain("+ Expense");
    expect(page).not.toContain("Only the owner can add claims for you.");
  });

  it("7. a tick only last month: a claim dated last month works, one dated this month is refused", async () => {
    const p = setup();
    await save(p.owner, p.worker, { from_month: LAST, field_staff: true, reason: "deliveries in September" });
    const panel = await salaryPanel(p.owner, p.worker.userId, THIS);
    await save(p.owner, p.worker, { field_staff: false, expect: panel.expect.setting });
    expect((await refusal(() => sendClaim(p.worker, expense()))).message).toBe(NOT_FIELD);
    signInAs(p.worker);
    await NewClaimPage({ searchParams: Promise.resolve({ kind: "expense" }) }); // the page opens: last month's dates are still allowed
    await sendClaim(p.worker, expense({ on_date: LAST_DAY_OF_LAST }));
    expect((await myClaims(p.worker, LAST)).canAdd).toBe(true);
    expect((await myClaims(p.worker, null)).canAdd).toBe(false); // the tab stays (a claim on record), without buttons
  });
});

describe("the owner's entries and claims already sent", () => {
  it("8. the owner's expense for someone not ticked: saved, approved, opens their tab, shown read-only 'Entered by Sujata'", async () => {
    const p = setup();
    await save(p.owner, p.worker);
    await enterClaim(p.owner, { ...expense(), user_id: p.worker.userId });
    expect(await hasOwnClaims(p.worker)).toBe(true);
    const v = await myClaims(p.worker, null);
    expect(v).toMatchObject({ canAdd: false, fieldDuty: false });
    expect(v.claims[0]).toMatchObject({ status: "approved", createdByName: "Sujata" });
    signInAs(p.worker);
    const page = textOf(await MyClaimsPage({ searchParams: Promise.resolve({}) })).replace(/\s+/g, " ");
    expect(page).toContain("Entered by Sujata");
    expect(page).toContain("Only the owner can add claims for you.");
    expect(page).not.toMatch(/\+ (Field duty|Expense)/);
    await expect(NewClaimPage({ searchParams: Promise.resolve({ kind: "expense" }) })).rejects.toThrow(NOT_FOUND);
  });

  it("9. a claim sent while ticked can still be withdrawn or decided after the tick is removed", async () => {
    const p = setup();
    await save(p.owner, p.worker, { field_staff: true });
    const a = await sendClaim(p.worker, expense());
    const b = await sendClaim(p.worker, expense({ amount: "120" }));
    const panel = await salaryPanel(p.owner, p.worker.userId, THIS);
    await save(p.owner, p.worker, { field_staff: false, expect: panel.expect.setting });
    await withdrawClaim(p.worker, a.id);
    expect((await decideClaim(p.owner, { claim_id: b.id, decision: "approve", reason: null })).decision).toBe("approved");
    expect((await myClaims(p.worker, null)).claims.map((c) => c.status).sort()).toEqual(["approved", "withdrawn"]);
  });

  it("10. an owner who is also Plant staff is unaffected: their own claim is saved and approved without the tick", async () => {
    const p = setup();
    await save(p.owner, p.ownerWorker);
    expect(await hasOwnClaims(p.ownerWorker)).toBe(true);
    expect((await sendClaim(p.ownerWorker, expense())).approved).toBe(true);
    expect((await myClaims(p.ownerWorker, null)).canAdd).toBe(true);
  });
});
