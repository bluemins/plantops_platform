// Phase R4 (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Permanent / Temporary"): the staff type saved from a month in the
// Salary box, the Salary tab's cost split and "temp" tag, and the CSV column. The salary rules never look at it.
// October 2026 is worked out as seen on 5 November.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeChange } from "@/lib/changes";
import { costOf, salaryCsv, salaryTab, SALARY_CSV_HEADER } from "@/server/salary-tab";
import { salaryPanel, saveSetting } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, markAt, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const NOW = ist("2026-11-05 12:00");
const R = (rupees: number) => Math.round(rupees * 100);

/** A setting saved the way rows were before 0006 (no staff type given), or with one. */
async function setting(u: AtUser, rupees: number, staffType: "permanent" | "temporary" | null = null, fromMonth = "2026-10") {
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime${staffType ? ", staff_type" : ""}, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(rupees)}, 480, false${staffType ? `, '${staffType}'` : ""}, gen_random_uuid(), 'Sujata')`,
  );
}
async function work(u: AtUser, days: number[]) {
  for (const d of days) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    await markAt(u, "in", `${day} 08:00`);
    await markAt(u, "out", `${day} 16:00`);
  }
}

describe("Permanent / Temporary", () => {
  it("1. rows saved before 0006 read Permanent; the Salary box saves the type from a month, earlier months keep theirs", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    await setting(p.worker, 12000, null, "2026-09");
    const tab = await salaryTab(p.owner, "2026-10", NOW);
    expect(tab.rows[0]).toMatchObject({ staffType: "permanent" });
    await saveSetting(p.owner, {
      user_id: p.worker.userId,
      pay_basis: "monthly",
      monthly: "12000",
      shift_hours: 8,
      leave_days: 2,
      gets_overtime: false,
      from_month: "2026-10",
      joined_on: null,
      left_on: null,
      reason: "on contract from October",
      expect: (await salaryPanel(p.owner, p.worker.userId, "2026-10", )).expect.setting,
      field_staff: false,
      staff_type: "temporary",
    } as never);
    expect((await salaryTab(p.owner, "2026-10", NOW)).rows[0]).toMatchObject({ staffType: "temporary" });
    expect((await salaryTab(p.owner, "2026-09", NOW)).rows[0]).toMatchObject({ staffType: "permanent" });
    const panel = await salaryPanel(p.owner, p.worker.userId, "2026-10");
    expect(panel.history.map((h) => [h.fromMonth, h.staffType])).toEqual([
      ["2026-10", "temporary"],
      ["2026-09", "permanent"],
    ]);
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'salary.set'", [p.tenantId]);
    expect(describeChange(rows[0]!.action, rows[0]!.details)).toMatch(/ · temporary: on contract from October$/);
    // the type changes no money: the same month's figures as a permanent person with the same salary
    expect((await salaryTab(p.owner, "2026-10", NOW)).rows[0]!.result.remainingPaise).toBe(tab.rows[0]!.result.remainingPaise);
  });

  it("2. a bad staff type is refused; support can't save one", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    const input = { user_id: p.worker.userId, pay_basis: "monthly", monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: "2026-11", joined_on: null, left_on: null, reason: null, expect: null, field_staff: false };
    expect((await refusal(() => saveSetting(p.support, { ...input, staff_type: "temporary" } as never))).status).toBe(403);
    const { SettingInput } = await import("@/server/salary-edit");
    expect(SettingInput.safeParse({ ...input, staff_type: "casual" }).success).toBe(false);
    expect(SettingInput.parse(input).staff_type).toBe("permanent");
  });

  it("3. the tab's split equals the sums of each type's rows; the total is the plant's manpower cost", async () => {
    const p = plant();
    const t = p.tenantId;
    const anmol = atUser(t, ["plant_staff"], "Anmol");
    const bindu = atUser(t, ["plant_staff"], "Bindu");
    const gaja = atUser(t, ["plant_staff"], "Gaja");
    const joshna = atUser(t, ["plant_staff"], "Joshna");
    platform.contacts = [...contactsFor(p.owner, anmol, bindu, gaja, joshna)];
    await setting(anmol, 14000, "permanent");
    await setting(bindu, 12000); // saved before 0006: permanent
    await setting(gaja, 9000, "temporary");
    await setting(joshna, 8000, "temporary");
    await work(anmol, [1, 2, 3, 4, 5, 6, 7, 8]);
    await work(gaja, [1, 2, 3, 4]);
    await asApp(t, `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${t}', '${joshna.userId}', 'Joshna', '2026-10-10', ${R(5000)}, gen_random_uuid(), 'Sujata')`);
    const tab = await salaryTab(p.owner, "2026-10", NOW);
    for (const type of ["permanent", "temporary"] as const) {
      const rows = tab.rows.filter((r) => r.staffType === type);
      expect(tab.split[type]).toEqual({
        people: 2,
        costPaise: rows.reduce((s, r) => s + costOf(r), 0),
        toPayPaise: rows.reduce((s, r) => s + Math.max(0, r.result.remainingPaise), 0),
      });
    }
    const t_ = tab.totals;
    expect(tab.split.permanent.costPaise + tab.split.temporary.costPaise).toBe(t_.earnedPaise + t_.otPayPaise + t_.taPaise + t_.daPaise + t_.expensesPaise);
    expect(tab.split.permanent.toPayPaise + tab.split.temporary.toPayPaise).toBe(t_.toPayPaise);
    expect(tab.split.temporary.costPaise).toBeGreaterThan(0);
  });

  it("4. the CSV has a 'Staff type' column after 'Pay basis'", async () => {
    const p = plant();
    const gaja = atUser(p.tenantId, ["plant_staff"], "Gaja");
    platform.contacts = [...contactsFor(p.owner, p.worker, gaja)];
    await setting(p.worker, 12000);
    await setting(gaja, 9000, "temporary");
    const i = SALARY_CSV_HEADER.indexOf("Staff type");
    expect(SALARY_CSV_HEADER[i - 1]).toBe("Pay basis");
    const lines = (await salaryCsv(p.owner, "2026-10", NOW)).split(/\r?\n/).filter(Boolean);
    const cells = (line: string) => line.split(",");
    expect(lines.slice(1).map((l) => [cells(l)[0], cells(l)[i]])).toEqual([
      ["Gaja", "temporary"],
      ["Ramu", "permanent"],
    ]);
  });
});
