// The owner's Salary tab and CSV (src/server/salary-tab.ts) and the checking panel's arithmetic (panelInput in
// src/lib/salary.ts). Case numbers follow the Phase 4 plan's list. October 2026 is worked out as seen on 5 November.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as exportRoute from "@/app/api/salary/export/route";
import { OwnerNav } from "@/app/owner-nav";
import SalaryPage from "@/app/salary/page";
import { describeChange } from "@/lib/changes";
import { monthPay, panelInput } from "@/lib/salary";
import { salaryCsv, salaryTab, SALARY_CSV_HEADER } from "@/server/salary-tab";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, jsonReq, markAt, plant, refusal, signInAs, textOf } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const NOW = ist("2026-11-05 12:00");
const R = (rupees: number) => Math.round(rupees * 100);
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

async function setting(u: AtUser, rupees: number, over: { ot?: number; joined?: string } = {}) {
  const name = u.name.replace(/'/g, "''");
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, ot_rate_paise, joined_on, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${name}', '2026-10-01', ${R(rupees)}, 480, ${over.ot !== undefined}, ${over.ot !== undefined ? R(over.ot) : "null"}, ${over.joined ? `'${over.joined}'` : "null"}, gen_random_uuid(), 'Sujata')`,
  );
}
const advance = (u: AtUser, rupees: number) =>
  asApp(u.tenantId, `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', 'x', '2026-10-10', ${R(rupees)}, gen_random_uuid(), 'Sujata')`);
/** Worked days: IN 08:00, OUT after `hours`, on each of `days`. */
async function work(u: AtUser, days: number[], hours: number) {
  for (const d of days) {
    await markAt(u, "in", `${day(d)} 08:00`);
    await markAt(u, "out", `${day(d)} ${String(8 + hours).padStart(2, "0")}:00`);
  }
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Anmol = the worked example (₹9,040); Pooja joined 15 Oct (part month); "=cmd Bindu" has no overtime; Ramu's advances
 * leave −₹2,100; Old left (not on the platform's list any more); Gaja is active without a salary.
 */
async function mixedPlant() {
  const p = plant();
  const t = p.tenantId;
  const anmol = atUser(t, ["plant_staff"], "Anmol");
  const pooja = atUser(t, ["plant_staff"], "Pooja");
  const bindu = atUser(t, ["plant_staff"], "=cmd Bindu");
  const ramu = atUser(t, ["plant_staff"], "Ramu");
  const old = atUser(t, ["plant_staff"], "Old");
  const gaja = atUser(t, ["plant_staff"], "Gaja");
  platform.contacts = [...contactsFor(p.owner, anmol, pooja, bindu, ramu, gaja)];

  await setting(anmol, 12000, { ot: 60 });
  await work(anmol, range(1, 14), 9);
  await work(anmol, range(15, 26), 8);
  await work(anmol, [27, 28], 5);
  await advance(anmol, 3000);

  await setting(pooja, 12000, { joined: "2026-10-15" });
  await work(pooja, range(15, 31), 8);

  await setting(bindu, 9000);
  await work(bindu, range(1, 31), 8);

  await setting(ramu, 10000);
  await work(ramu, range(1, 31), 8);
  await advance(ramu, 12100);

  await setting(old, 8000);
  await work(old, range(1, 31), 8);
  return { p, anmol, pooja, bindu, ramu, old, gaja };
}

let plantData: Awaited<ReturnType<typeof mixedPlant>>;
beforeAll(async () => {
  plantData = await mixedPlant();
});

describe("the Salary tab", () => {
  it("1. each row equals monthPay for that person; totals add up; negatives and people without a salary are named", async () => {
    const { p } = plantData;
    const tab = await salaryTab(p.owner, "2026-10", NOW);
    expect(tab.rows.map((r) => r.name)).toEqual(["=cmd Bindu", "Anmol", "Old", "Pooja", "Ramu"]);
    for (const r of tab.rows) expect(r.result, r.name).toEqual(monthPay(r.input));
    const by = Object.fromEntries(tab.rows.map((r) => [r.name, r]));
    expect(by.Anmol!.result).toMatchObject({ earnedPaise: R(11200), otPayPaise: R(840), advancesPaise: R(3000), remainingPaise: R(9040) });
    expect(by.Pooja).toMatchObject({ fullMonth: false, countedDays: 17 });
    expect(by.Pooja!.result.earnedPaise).toBe(R(6800));
    expect(by["=cmd Bindu"]).toMatchObject({ getsOvertime: false });
    expect(by["=cmd Bindu"]!.result).toMatchObject({ earnedPaise: R(9000), otPayPaise: 0 });
    expect(by.Ramu!.result.remainingPaise).toBe(-R(2100));
    expect(by.Ramu!.carriesTo).toBe("2026-11");
    expect(by.Old!.former).toBe(true);
    expect(by.Anmol!.former).toBe(false);

    expect(tab.totals).toEqual({
      salaryPaise: R(12000 + 12000 + 9000 + 10000 + 8000),
      earnedPaise: R(11200 + 6800 + 9000 + 10000 + 8000),
      otPayPaise: R(840),
      taPaise: 0,
      daPaise: 0,
      expensesPaise: 0,
      advancesPaise: R(3000 + 12100),
      carriedInPaise: 0,
      remainingPaise: R(9040 + 6800 + 9000 - 2100 + 8000),
      toPayPaise: R(9040 + 6800 + 9000 + 8000),
    });
    expect(tab.negatives).toEqual([{ name: "Ramu", remainingPaise: -R(2100), to: "2026-11" }]);
    expect(tab.noSalary!.map((x) => x.name)).toEqual(["Gaja"]);
  });

  it("2. the month: complete vs so far; a future or bad month is 404", async () => {
    const { p } = plantData;
    expect(await salaryTab(p.owner, "2026-10", NOW)).toMatchObject({ complete: true, daysOver: 31, monthLength: 31, next: "2026-11", prev: "2026-09" });
    const nov = await salaryTab(p.owner, "2026-11", NOW);
    expect(nov).toMatchObject({ complete: false, daysOver: 4, monthLength: 30, next: null });
    expect(nov.rows.find((r) => r.name === "Ramu")!.input.carriedInPaise).toBe(R(2100)); // the minus carried in
    for (const m of ["2026-12", "2026-13", "junk"]) expect((await refusal(() => salaryTab(p.owner, m, NOW))).status, m).toBe(404);
  });
});

describe("the salary CSV", () => {
  it("3. exact columns, the worked example's row, blank overtime cells, neutralised names, audited", async () => {
    const { p } = plantData;
    const text = await salaryCsv(p.owner, "2026-10", NOW);
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(SALARY_CSV_HEADER.join(","));
    const anmol = lines.find((l) => l.startsWith("Anmol,"))!.split(",");
    const col = (name: string) => anmol[SALARY_CSV_HEADER.indexOf(name)];
    expect([col("Earned"), col("Overtime pay"), col("Advances"), col("Remaining"), col("Overtime hours"), col("Overtime rate"), col("Day's pay")]).toEqual(["11200.00", "840.00", "3000.00", "9040.00", "14", "60.00", "400.00"]);
    expect([col("Present"), col("Half days"), col("Absent"), col("Paid leave used (days)"), col("Unpaid days"), col("Full or part month")]).toEqual(["26", "2", "3", "2", "2", "full"]);
    const bindu = lines.find((l) => l.includes("cmd Bindu"))!;
    expect(bindu.startsWith("'=cmd Bindu,")).toBe(true);
    const b = bindu.split(",");
    expect([b[SALARY_CSV_HEADER.indexOf("Overtime")], b[SALARY_CSV_HEADER.indexOf("Overtime hours")], b[SALARY_CSV_HEADER.indexOf("Overtime pay")]]).toEqual(["no", "", ""]);
    expect(lines.find((l) => l.startsWith("Ramu,"))!.endsWith(",-2100.00")).toBe(true);

    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'salary.export'", [p.tenantId]);
    expect(rows).toHaveLength(1);
    expect(describeChange(rows[0]!.action, rows[0]!.details)).toBe("Downloaded the October 2026 salary CSV");
  });

  it("4. the CSV is the owner's only; support may open the tab but not download", async () => {
    const { p } = plantData;
    for (const u of [p.worker, p.keeper, p.support]) expect((await refusal(() => salaryCsv(u, "2026-10", NOW))).status, u.name).toBe(403);
    expect((await salaryTab(p.support, "2026-10", NOW)).rows).toHaveLength(5);
    expect((await salaryCsv(p.ownerWorker, "2026-10", NOW)).length).toBeGreaterThan(0);
  });
});

describe("a worker gets nothing", () => {
  it("5. the page is 404, the CSV route 403, the tab 403 (worker and store keeper)", async () => {
    const { p } = plantData;
    for (const u of [p.worker, p.keeper]) expect((await refusal(() => salaryTab(u, "2026-10", NOW))).status, u.name).toBe(403);
    signInAs(p.worker);
    const res = await exportRoute.GET(jsonReq("GET", "/api/salary/export?month=2026-10"), undefined as never);
    expect(res.status).toBe(403);
    await expect(SalaryPage({ searchParams: Promise.resolve({ month: "2026-10" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});

describe("the checking panel's arithmetic", () => {
  it("6. auto gives the row's figure; 16 overtime hours for Anmol is ₹120 more; empty boxes are auto", async () => {
    const tab = await salaryTab(plantData.p.owner, "2026-10", NOW);
    const anmol = tab.rows.find((r) => r.name === "Anmol")!;
    expect(monthPay(panelInput(anmol.input, {})).remainingPaise).toBe(R(9040));
    expect(monthPay(panelInput(anmol.input, { otHours: "", monthly: " " })).remainingPaise).toBe(R(9040));
    const yours = monthPay(panelInput(anmol.input, { otHours: "16" }));
    expect(yours.remainingPaise).toBe(R(9160));
    expect(yours.remainingPaise - R(9040)).toBe(R(120));
    // 2.5 absent days instead of 3 (half a day less unpaid): ₹200 more
    expect(monthPay(panelInput(anmol.input, { absent: "2.5" })).remainingPaise).toBe(R(9240));
    // a nonsense box is ignored
    expect(monthPay(panelInput(anmol.input, { present: "-3", rate: "x" } as never)).remainingPaise).toBe(R(9040));
    // a part month: Pooja with 16 days instead of 17
    const pooja = tab.rows.find((r) => r.name === "Pooja")!;
    expect(monthPay(panelInput(pooja.input, { present: "16" })).earnedPaise).toBe(R(6400));
  });
});

describe("the tabs", () => {
  it("7. the owner and support have a Salary tab", () => {
    const { p } = plantData;
    expect(textOf(OwnerNav({ user: p.owner, current: "salary" }))).toContain("Salary");
    expect(textOf(OwnerNav({ user: p.support, current: "salary" }))).toContain("Salary");
    expect(textOf(OwnerNav({ user: p.worker, current: "today" }))).not.toContain("Salary");
  });
});

// ---------- per-day pay (docs/SALARY_EXTRAS_PHASE_PLAN.md Phase A2) ----------

describe("a per-day person on the Salary tab", () => {
  /** Anmol = the version 2 worked example (₹9,040); Ramu = worked example A, ₹450 a day (₹9,850). */
  async function perDayPlant() {
    const p = plant();
    const t = p.tenantId;
    const anmol = atUser(t, ["plant_staff"], "Anmol");
    const ramu = atUser(t, ["plant_staff"], "Ramu");
    platform.contacts = [...contactsFor(p.owner, anmol, ramu)];
    await setting(anmol, 12000, { ot: 60 });
    await work(anmol, range(1, 14), 9);
    await work(anmol, range(15, 26), 8);
    await work(anmol, [27, 28], 5);
    await advance(anmol, 3000);
    await asApp(
      t,
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, day_rate_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, created_by, created_by_name)
       values ('${t}', '${ramu.userId}', 'Ramu', '2026-10-01', 'per_day', null, ${R(450)}, 480, 0, true, ${R(60)}, gen_random_uuid(), 'Sujata')`,
    );
    await work(ramu, range(1, 10), 9); // present, +1 h overtime each = 10 h
    await work(ramu, range(11, 24), 8); // present
    await work(ramu, [25, 26], 5); // half days; 27-31 absent
    await advance(ramu, 2000);
    return { p };
  }

  it("A2-7. each row equals monthPay; Ramu is per day at ₹450 and leaves ₹9,850; the totals add up", async () => {
    const { p } = await perDayPlant();
    const tab = await salaryTab(p.owner, "2026-10", NOW);
    for (const r of tab.rows) expect(r.result, r.name).toEqual(monthPay(r.input));
    const [anmol, ramu] = tab.rows;
    expect(anmol).toMatchObject({ name: "Anmol", payBasis: "monthly", dayRatePaise: null });
    expect(anmol!.result.remainingPaise).toBe(R(9040));
    expect(ramu).toMatchObject({ name: "Ramu", payBasis: "per_day", dayRatePaise: R(450), counts: { present: 24, half: 2, absent: 5, otMinutes: 600 } });
    expect(ramu!.result).toMatchObject({ dayPayPaise: R(450), leaveUsedHalves: 0, earnedPaise: R(11250), otPayPaise: R(600), remainingPaise: R(9850) });
    expect(tab.totals).toMatchObject({ salaryPaise: R(12000), earnedPaise: R(11200 + 11250), otPayPaise: R(840 + 600), remainingPaise: R(9040 + 9850) });

    // the CSV: two new columns; for Ramu no monthly salary or paid leave
    const lines = (await salaryCsv(p.owner, "2026-10", NOW)).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(SALARY_CSV_HEADER.join(","));
    const cells = (name: string) => {
      const c = lines.find((l) => l.startsWith(`${name},`))!.split(",");
      return (h: string) => c[SALARY_CSV_HEADER.indexOf(h)];
    };
    const r = cells("Ramu");
    expect(["Monthly salary", "Pay basis", "Day rate", "Paid leave allowed (days)", "Paid leave used (days)", "Unpaid days", "Day's pay", "Earned", "Remaining"].map(r)).toEqual(["", "per day", "450.00", "", "", "", "450.00", "11250.00", "9850.00"]);
    const a = cells("Anmol");
    expect(["Monthly salary", "Pay basis", "Day rate", "Paid leave allowed (days)", "Paid leave used (days)", "Unpaid days", "Day's pay", "Remaining"].map(a)).toEqual(["12000.00", "monthly", "", "2", "2", "2", "400.00", "9040.00"]);
  });

  it("A2-8. the checking panel with a typed day rate of ₹500: 25 days × ₹500 = ₹12,500 earned, ₹1,250 more", async () => {
    const { p } = await perDayPlant();
    const ramu = (await salaryTab(p.owner, "2026-10", NOW)).rows.find((x) => x.name === "Ramu")!;
    expect(monthPay(panelInput(ramu.input, {})).remainingPaise).toBe(R(9850));
    const yours = monthPay(panelInput(ramu.input, { dayRate: "500" }));
    expect(yours).toMatchObject({ dayPayPaise: R(500), earnedPaise: R(12500) });
    expect(yours.remainingPaise - R(9850)).toBe(R(1250));
    // the paid leave box doesn't exist for per-day people, and typing one changes nothing
    expect(monthPay(panelInput(ramu.input, { leave: "2" })).remainingPaise).toBe(R(9850));
  });
});
