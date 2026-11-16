// Sales' Day report asks Attendance for one day (owner 2026-11-16): only with a platform lookup ticket for scope
// day_report (the salary_totals ticket doesn't open it); present / not marked / late after "Work starts at" / no OUT,
// worked out for the end of that day with the Today board's rules; never money; another plant's people never mix in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/day-report/route";
import { attendanceDayReport } from "@/server/day-report";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, atUser, contactsFor, ist, markAt, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const ticket = (tenantId: string, scope = "day_report") => platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, "attendance_salary", "60s");
const ask = async (date: string, token: string | null) => {
  const res = await GET(new Request(`http://localhost:3006/api/plantops/day-report?date=${date}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};
const row = (r: Awaited<ReturnType<typeof attendanceDayReport>>, label: string) => r.rows.find((x) => x.label === label);

describe("Attendance's part of the Day report", () => {
  it("refused without a ticket or with the salary totals ticket; a future date is 400", async () => {
    const p = plant();
    platform.contacts = [];
    expect((await ask(today, null)).status).toBe(401);
    expect((await ask(today, await ticket(p.tenantId, "salary_totals"))).status).toBe(401);
    expect((await ask("2999-01-01", await ticket(p.tenantId))).status).toBe(400);
    const ok = await ask(today, await ticket(p.tenantId));
    expect(ok.status).toBe(200);
    expect(ok.body.summary).toBe("0 of 0 present");
  });

  it("a past day: present, not marked, late after Work starts at, no OUT that day; never money", async () => {
    const p = plant();
    const anmol = atUser(p.tenantId, ["plant_staff"], "Anmol");
    const bindu = atUser(p.tenantId, ["plant_staff"], "Bindu");
    const dillip = atUser(p.tenantId, ["plant_staff"], "Dillip");
    platform.contacts = [...contactsFor(p.owner, anmol, bindu, dillip)];
    // Anmol's work starts at 09:00 (rule 23), ₹9,000 a month: the money must never show
    await asApp(p.tenantId, `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, ot_rate_paise, work_start_minutes, created_by, created_by_name)
      values ('${p.tenantId}', '${anmol.userId}', 'Anmol', '2026-09-01', 900000, 480, false, null, 540, '${p.owner.userId}', 'Sujata')`);
    await markAt(anmol, "in", "2026-09-10 09:12"); // no OUT that day
    await markAt(bindu, "in", "2026-09-10 08:55");
    await markAt(bindu, "out", "2026-09-10 17:30");
    // another plant's worker marks the same day
    const q = plant();
    await markAt(atUser(q.tenantId, ["plant_staff"], "Other"), "in", "2026-09-10 09:00");

    const r = await attendanceDayReport(p.tenantId, "2026-09-10", ist("2026-09-12 12:00"));
    expect(r.summary).toBe("2 of 3 present");
    expect(row(r, "Not marked")).toEqual({ label: "Not marked", value: "Dillip", tone: "warn" });
    expect(row(r, "Came after work start")!.value).toBe("Anmol 9:12 am (starts 09:00)");
    expect(row(r, "No OUT that day")!.value).toBe("Anmol (in 9:12 am)");
    expect(r.attention).toEqual(["Not marked: Dillip"]);
    expect(JSON.stringify(r)).not.toMatch(/₹|9,000|900000|Other/);
  });
});
