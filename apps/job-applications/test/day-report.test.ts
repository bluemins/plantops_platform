// Sales' Day report asks Job applications for one day (owner 2026-11-16): only with a platform lookup ticket for scope
// day_report; applications that came in that day by position and how many are still new; no names or phone numbers;
// another plant's applications never mix in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/day-report/route";
import { jobsDayReport } from "@/server/day-report";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { addApplication, asApp, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const ticket = (tenantId: string, scope = "day_report") => platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, "job_applications", "60s");
const ask = async (date: string, token: string | null) => {
  const res = await GET(new Request(`http://localhost:3007/api/plantops/day-report?date=${date}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("Job applications' part of the Day report", () => {
  it("refused without a ticket or with another scope; a future date is 400", async () => {
    const p = plant();
    expect((await ask(today, null)).status).toBe(401);
    expect((await ask(today, await ticket(p.tenantId, "salary_totals"))).status).toBe(401);
    expect((await ask("2999-01-01", await ticket(p.tenantId))).status).toBe(400);
  });

  it("today's applications by position, still new, no names or phones; only this plant", async () => {
    const p = plant();
    const { rows } = await asApp(p.tenantId, `insert into job_applications.openings (tenant_id, title, grp, description, min_qualification, created_by, created_by_name)
      values ('${p.tenantId}', 'Lab Assistant', 'lab_quality', 'Daily water tests', 'B.Sc.', gen_random_uuid(), 'Sujata') returning id`);
    const opening = { id: (rows[0] as { id: string }).id, title: "Lab Assistant" };
    await addApplication(p.tenantId, { opening, phone: "9876500001" });
    await addApplication(p.tenantId, { opening, phone: "9876500002" });
    await addApplication(p.tenantId, { phone: "9876500003", days: 3 });
    await addApplication(plant().tenantId, { phone: "9876500004" });
    const r = await ask(today, await ticket(p.tenantId));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      summary: "2 new that day",
      tone: "ok",
      rows: [
        { label: "Came in that day", value: "2" },
        { label: "  Lab Assistant", value: "2" },
        { label: "Still new (not handled)", value: "3" },
      ],
      attention: ["2 new job applications"],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Ramesh|98765/);
    expect((await jobsDayReport(plant().tenantId, today)).summary).toBe("0 new that day");
  });
});
