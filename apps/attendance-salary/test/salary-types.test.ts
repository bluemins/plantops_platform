// The three salary types (owner, 2026-10-23): PV_SALARY_DAY_STAFF (per_day), PV_SALARY_MONTHLY_STAFF (monthly) and
// PV_SALARY_FIXED_MONTHLY (fixed: the full monthly salary whatever the attendance). Rules in src/lib/salary.ts, saved
// through the Salary box (src/server/salary-edit.ts), shown on the Salary tab and in the CSV.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SALARY_TYPES, monthPay, salaryType, type PayInput } from "@/lib/salary";
import { saveSetting } from "@/server/salary-edit";
import { salaryCsv, salaryTab, SALARY_CSV_HEADER } from "@/server/salary-tab";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, contactsFor, dbError, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const R = (rupees: number) => rupees * 100;
const THIS = new Date().toISOString().slice(0, 7);

const input = (over: Partial<PayInput>): PayInput => ({
  present: 20,
  half: 0,
  short: 3,
  shortMinutes: 15 * 60,
  absent: 5,
  off: 3,
  otMinutes: 600,
  payBasis: "fixed",
  monthlyPaise: R(10000),
  dayRatePaise: null,
  shiftMinutes: 480,
  fullMonth: true,
  paidLeaveHalfdays: 0,
  getsOvertime: false,
  otRatePaise: null,
  advancesPaise: R(1000),
  taPaise: 0,
  daPaise: 0,
  expensesPaise: 0,
  carriedInPaise: 0,
  adjustmentPaise: 0,
  ...over,
});

describe("the type names", () => {
  it("one name per pay basis", () => {
    expect(SALARY_TYPES).toEqual({ per_day: "PV_SALARY_DAY_STAFF", monthly: "PV_SALARY_MONTHLY_STAFF", fixed: "PV_SALARY_FIXED_MONTHLY" });
    expect(salaryType("fixed")).toBe("PV_SALARY_FIXED_MONTHLY");
  });
});

describe("PV_SALARY_FIXED_MONTHLY", () => {
  it("a full month: the whole salary whatever the absent, OFF and short days; only advances are taken off", () => {
    const r = monthPay(input({}));
    expect(r).toMatchObject({ earnedPaise: R(10000), deductionPaise: 0, unpaidHalves: 0, leaveUsedHalves: 0, otPayPaise: 0, remainingPaise: R(9000) });
    // nothing at all marked: still the full salary
    expect(monthPay(input({ present: 0, short: 0, shortMinutes: 0, absent: 31, off: 0 })).earnedPaise).toBe(R(10000));
  });

  it("never overtime, even if a setting or the panel hands some in", () => {
    expect(monthPay(input({ getsOvertime: true, otRatePaise: R(50) })).otPayPaise).toBe(0);
  });

  it("a part month (joined / last day) pays its counted days at salary ÷ 30, at most the salary", () => {
    // joined on the 17th of a 31-day month: 15 counted days, whatever was marked
    const r = monthPay(input({ fullMonth: false, present: 8, short: 2, shortMinutes: 600, absent: 3, off: 2 }));
    expect(r.earnedPaise).toBe(15 * Math.round(R(10000) / 30));
  });
});

describe("saving a fixed salary", () => {
  const setup = () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    const save = (by: AtUser, over: Record<string, unknown> = {}) =>
      saveSetting(by, { user_id: p.worker.userId, pay_basis: "fixed", monthly: "10000", shift_hours: 9, leave_days: 2, gets_overtime: false, ot_rate: null, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, ...over } as never);
    return { p, save };
  };

  it("saves the monthly salary with 0 paid leave, whatever leave is sent", async () => {
    const { p, save } = setup();
    await save(p.owner);
    const [row] = (await asOwner(`select pay_basis, monthly_paise, day_rate_paise, paid_leave_halfdays, gets_overtime from attendance_salary.salary_settings where tenant_id = $1`, [p.tenantId])).rows;
    expect(row).toEqual({ pay_basis: "fixed", monthly_paise: String(R(10000)), day_rate_paise: null, paid_leave_halfdays: 0, gets_overtime: false });
  });

  it("refuses overtime and a missing salary; the database refuses a fixed row with overtime or leave too", async () => {
    const { p, save } = setup();
    expect((await refusal(() => save(p.owner, { gets_overtime: true, ot_rate: "50" }))).message).toMatch(/fixed monthly salary has no overtime/);
    expect((await refusal(() => save(p.owner, { monthly: "" }))).status).toBe(400);
    const insert = (extra: string) =>
      asOwner(
        `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, created_by, created_by_name)
         values ($1, $2, 'Kedar', '2026-10-01', 'fixed', 1000000, 540, ${extra}, gen_random_uuid(), 'Sujata')`,
        [p.tenantId, p.worker.userId],
      );
    expect(await dbError(insert("0, true, 5000"))).toMatch(/salary_settings_pay_basis_fields/);
    expect(await dbError(insert("4, false, null"))).toMatch(/salary_settings_pay_basis_fields/);
  });

  it("the Salary tab and the CSV show the type: full salary, 'fixed monthly', no leave columns", async () => {
    const { p, save } = setup();
    await save(p.owner);
    const tab = await salaryTab(p.owner, THIS);
    expect(tab.rows[0]).toMatchObject({ band: "PV_SALARY_FIXED_MONTHLY", payBasis: "fixed", result: { earnedPaise: R(10000), otPayPaise: 0 } });
    const [, line] = (await salaryCsv(p.owner, THIS)).trim().split("\n");
    const cells = line!.split(",");
    const col = (h: string) => cells[SALARY_CSV_HEADER.indexOf(h)];
    expect([col("Salary type"), col("Pay basis"), col("Paid leave allowed (days)"), col("Earned")]).toEqual(["PV_SALARY_FIXED_MONTHLY", "fixed monthly", "", "10000.00"]);
  });
});
