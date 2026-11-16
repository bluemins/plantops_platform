// Sales' Business charts ask Attendance for the plant's salary totals (docs/REPORTS_PHASE_PLAN.md section 9, release 2):
// only with a platform lookup ticket for scope salary_totals; totals only (no names); each paid month's cost from its
// frozen figures, undone payments left out; salary paid and advances (less corrections) per day; another plant's
// numbers never mix in.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/salary-totals/route";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, plant } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();

const ticket = (tenantId: string, scope = "salary_totals", over: Record<string, unknown> = {}) =>
  platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope, ...over }, "attendance_salary", "60s");
const ask = async (q: string, token: string | null) => {
  const res = await GET(new Request(`http://localhost:3006/api/plantops/salary-totals?${q}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), undefined as never);
  return { status: res.status, body: await res.json() };
};

/** One paid month as Attendance freezes it (only the result's money matters here). */
async function paid(tenantId: string, month: string, paidOn: string, result: Record<string, number>, paidPaise: number) {
  const figures = JSON.stringify({ rules: 9, month, result: { advancesPaise: 0, carriedInPaise: 0, ...result } });
  const r = await asApp(
    tenantId,
    `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
     values ('${tenantId}', gen_random_uuid(), 'Ramu', '${month}-01', '${paidOn}', ${paidPaise}, ${paidPaise}, '${figures}', gen_random_uuid(), 'Sujata') returning id`,
  );
  return (r.rows[0] as { id: string }).id;
}
async function advance(tenantId: string, userId: string, onDate: string, paise: number, corrects?: string) {
  const r = await asApp(
    tenantId,
    `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, corrects_id, reason, created_by, created_by_name)
     values ('${tenantId}', '${userId}', 'Ramu', '${onDate}', ${paise}, ${corrects ? `'${corrects}'` : "null"}, ${corrects ? "'typed wrong'" : "null"}, gen_random_uuid(), 'Sujata') returning id`,
  );
  return (r.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  // September: two people. Ramu ₹9,000 earned + ₹300 overtime + ₹200 TA + ₹100 DA + ₹50 expenses; Bindu ₹8,000 + ₹500
  // carried-in change. Paid 1 Oct: ₹7,650 + ₹8,500 (Ramu had a ₹2,000 advance).
  await paid(a.tenantId, "2026-09", "2026-10-01", { earnedPaise: 900_000, otPayPaise: 30_000, holidayWorkPaise: 0, taPaise: 20_000, daPaise: 10_000, expensesPaise: 5_000, adjustmentPaise: 0 }, 765_000);
  await paid(a.tenantId, "2026-09", "2026-10-01", { earnedPaise: 800_000, otPayPaise: 0, adjustmentPaise: 50_000 }, 850_000); // an old slip: no claims or holiday fields
  // October paid on 1 Nov, then undone (paid again later as another row: left out here)
  const undone = await paid(a.tenantId, "2026-10", "2026-11-01", { earnedPaise: 700_000 }, 700_000);
  await asApp(a.tenantId, `insert into attendance_salary.salary_payment_undos (tenant_id, payment_id, reason, created_by, created_by_name) values ('${a.tenantId}', '${undone}', 'wrong days', gen_random_uuid(), 'Sujata')`);
  const ramu = randomUUID();
  const adv = await advance(a.tenantId, ramu, "2026-09-12", 300_000);
  await advance(a.tenantId, ramu, "2026-09-12", -100_000, adv); // corrected down to ₹2,000
  await advance(a.tenantId, ramu, "2026-10-20", 150_000);
  // plant B: never in A's answer
  await paid(b.tenantId, "2026-09", "2026-10-01", { earnedPaise: 99_900_000 }, 99_900_000);
});
afterAll(() => platform.close());

describe("salary totals for Sales' Business charts", () => {
  it("each paid month's cost (frozen figures, undone left out); salary paid and advances per day; no names", async () => {
    const r = await ask("from=2026-09-01&to=2026-11-16", await ticket(a.tenantId));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      months: [{ month: "2026-09", cost_paise: 965_000 + 850_000, people: 2 }],
      paid: [{ date: "2026-10-01", paise: 1_615_000 }],
      advances: [{ date: "2026-09-12", paise: 200_000 }, { date: "2026-10-20", paise: 150_000 }],
      last_paid_month: "2026-09",
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Ramu|Sujata|user/);
  });

  it("a period cuts by the salary month and the day; plant B sees only its own", async () => {
    expect((await ask("from=2026-10-01&to=2026-10-31", await ticket(a.tenantId))).body).toMatchObject({ months: [], paid: [{ date: "2026-10-01" }], advances: [{ date: "2026-10-20" }] });
    expect((await ask("from=2026-09-01&to=2026-11-16", await ticket(b.tenantId))).body.months).toEqual([{ month: "2026-09", cost_paise: 99_900_000, people: 1 }]);
  });

  it("only with a lookup ticket for salary_totals; bad dates refused", async () => {
    expect((await ask("from=2026-09-01&to=2026-11-16", null)).status).toBe(401);
    expect((await ask("from=2026-09-01&to=2026-11-16", await ticket(a.tenantId, "customers"))).status).toBe(401);
    expect((await ask("from=2026-09-01&to=2026-11-16", await platform.sign({ purpose: "summary", tenant_id: a.tenantId, view: "owner" }, "attendance_salary", "60s"))).status).toBe(401);
    expect((await ask("from=2026-11-16&to=2026-09-01", await ticket(a.tenantId))).status).toBe(400);
    expect((await ask("from=yesterday&to=2026-09-01", await ticket(a.tenantId))).status).toBe(400);
  });
});
