// Phase 6: day statuses on the calendars (days only, never money), the month-end salary review notification, and
// PlantOps support's read-only view of the salary pages. Case numbers follow the Phase 6 plan's list.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as advancesRoute from "@/app/api/salary/advances/route";
import * as exportRoute from "@/app/api/salary/export/route";
import * as payRoute from "@/app/api/salary/pay/route";
import * as undoRoute from "@/app/api/salary/pay/undo/route";
import * as settingsRoute from "@/app/api/salary/settings/route";
import * as visibilityRoute from "@/app/api/salary/visibility/route";
import { CalendarKey, MonthCalendar } from "@/app/calendar";
import { MonthTiles } from "@/app/my-month";
import MySalaryPage from "@/app/my/salary/page";
import SalaryPage from "@/app/salary/page";
import PersonMonthPage from "@/app/staff/[user]/page";
import { monthDays } from "@/lib/days";
import { emptyDay } from "@/lib/sessions";
import { monthFor } from "@/server/calendar";
import { runDaily, salaryReview } from "@/server/notify";
import { monthStatuses } from "@/server/salary";
import type { AtUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, jsonReq, markAt, plant, refusal, signInAs, textOf } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.notifyStatus = 201;
});

const NOV5 = ist("2026-11-05 12:00");
const R = (rupees: number) => Math.round(rupees * 100);
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);

async function setting(u: AtUser, ot: number | null, fromMonth = "2026-10") {
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, ot_rate_paise, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(12000)}, 480, ${ot !== null}, ${ot !== null ? R(ot) : "null"}, gen_random_uuid(), 'Sujata')`,
  );
}
async function work(u: AtUser, days: number[], hours: number) {
  for (const d of days) {
    await markAt(u, "in", `${day(d)} 08:00`);
    await markAt(u, "out", `${day(d)} ${String(8 + hours).padStart(2, "0")}:00`);
  }
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** The worker's October days as the calendar loads them (seen on 5 Nov). */
const octDays = async (viewer: AtUser, u: AtUser) => {
  const v = await monthFor(viewer, u.userId, "2026-10");
  return new Map(v.days.map((d) => [d.date, d]));
};

/** The worked example: 14 days 9 h, 12 days 8 h, 2 half days, 3 absent; salary with overtime ₹60/h. */
async function workedExample() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.worker)];
  await setting(p.worker, 60);
  await work(p.worker, range(1, 14), 9);
  await work(p.worker, range(15, 26), 8);
  await work(p.worker, [27, 28], 5);
  return p;
}

describe("day statuses for the calendars", () => {
  it("1. the worked example: 26 / 2 / 3 and 14 h; nothing about money in the answer", async () => {
    const p = await workedExample();
    const st = (await monthStatuses(p.worker, p.worker.userId, "2026-10", await octDays(p.worker, p.worker), NOV5))!;
    expect(st.counts).toEqual({ present: 26, half: 2, absent: 3, off: 0, otMinutes: 14 * 60 });
    expect(st).toMatchObject({ getsOvertime: true, complete: true, countedDays: 31 });
    expect(st.days[day(1)]).toEqual({ status: "present", otMinutes: 60 });
    expect(st.days[day(27)]).toEqual({ status: "half", otMinutes: 0 });
    expect(st.days[day(30)]).toEqual({ status: "absent", otMinutes: 0 });
    expect(JSON.stringify(st)).not.toMatch(/paise|monthly|rate|shift|₹/i);
  });

  it("1b. without Gets overtime: 0 overtime even on 12 h days; without a setting: nothing", async () => {
    const p = plant();
    await setting(p.worker, null);
    await work(p.worker, [1, 2], 12);
    const st = (await monthStatuses(p.worker, p.worker.userId, "2026-10", await octDays(p.worker, p.worker), NOV5))!;
    expect(st.counts).toMatchObject({ present: 2, otMinutes: 0 });
    expect(st.getsOvertime).toBe(false);
    expect(await monthStatuses(p.ownerWorker, p.ownerWorker.userId, "2026-10", new Map(), NOV5)).toBeNull();
  });

  it("2. a worker can't ask for someone else's days; the owner and support can", async () => {
    const p = await workedExample();
    const days = await octDays(p.owner, p.worker);
    expect(await monthStatuses(p.ownerWorker, p.worker.userId, "2026-10", days, NOV5)).not.toBeNull();
    const other = atUser(p.tenantId, ["plant_staff"], "Gaja");
    expect((await refusal(() => monthStatuses(other, p.worker.userId, "2026-10", days, NOV5))).status).toBe(404);
    expect((await refusal(() => monthStatuses(p.keeper, p.worker.userId, "2026-10", days, NOV5))).status).toBe(404);
    expect(await monthStatuses(p.owner, p.worker.userId, "2026-10", days, NOV5)).not.toBeNull();
    expect(await monthStatuses(p.support, p.worker.userId, "2026-10", days, NOV5)).not.toBeNull();
  });
});

describe("a worker never sees money", () => {
  it("3. the calendar, the tiles and the key show days and hours only", async () => {
    const p = await workedExample();
    const view = await monthFor(p.worker, p.worker.userId, "2026-10");
    const st = (await monthStatuses(p.worker, p.worker.userId, "2026-10", new Map(view.days.map((d) => [d.date, d])), NOV5))!;
    const cal = textOf(MonthCalendar({ view: { ...view, today: "2026-11-05" }, dayHref: (d) => d, monthHref: (m) => m, statuses: st }));
    const tiles = textOf(MonthTiles({ statuses: st }));
    const key = textOf(CalendarKey({ statuses: st }));
    for (const t of [cal, tiles, key]) expect(t).not.toMatch(/₹|salary|advance/i);
    expect(tiles).toMatch(/26 Present .*2 Half days .*3 Absent .*14 h Overtime/);
    expect(cal).toMatch(/\+\s*1\s+h/); // "+1 h" (the text helper spaces out JSX pieces)
    expect(cal).toContain("absent");
    expect(key).toMatch(/Half day.*Absent.*overtime/);
  });

  it("3b. every salary route a worker can call answers 403 / 404 without a single amount", async () => {
    const p = await workedExample();
    signInAs(p.worker);
    const w = p.worker.userId;
    const calls: [string, () => Promise<Response>][] = [
      ["settings", () => settingsRoute.POST(jsonReq("POST", "/api/salary/settings", { user_id: w, monthly: "99999", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: "2026-10", expect: null }), undefined as never)],
      ["visibility", () => visibilityRoute.POST(jsonReq("POST", "/api/salary/visibility", { user_id: w, can_see: true, expect: null }), undefined as never)],
      ["advances", () => advancesRoute.POST(jsonReq("POST", "/api/salary/advances", { kind: "advance", user_id: w, amount: "100", on_date: "2026-10-05", expect: null }), undefined as never)],
      ["pay", () => payRoute.POST(jsonReq("POST", "/api/salary/pay", { user_id: w, month: "2026-10", paid_on: "2026-10-31", expect_remaining: 0 }), undefined as never)],
      ["undo", () => undoRoute.POST(jsonReq("POST", "/api/salary/pay/undo", { payment_id: crypto.randomUUID(), reason: "because" }), undefined as never)],
      ["export", () => exportRoute.GET(jsonReq("GET", "/api/salary/export?month=2026-10"), undefined as never)],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect([403, 404], name).toContain(res.status);
      expect(await res.text(), name).not.toContain("₹");
    }
    await expect(MySalaryPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(SalaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("4. without Gets overtime there's no '+N h' and no Overtime tile", async () => {
    const p = plant();
    await setting(p.worker, null);
    await work(p.worker, range(1, 5), 11);
    const view = await monthFor(p.worker, p.worker.userId, "2026-10");
    const st = (await monthStatuses(p.worker, p.worker.userId, "2026-10", new Map(view.days.map((d) => [d.date, d])), NOV5))!;
    expect(textOf(MonthCalendar({ view, dayHref: (d) => d, monthHref: (m) => m, statuses: st }))).not.toMatch(/\+\s*\d/);
    expect(textOf(MonthTiles({ statuses: st }))).not.toContain("Overtime");
    expect(textOf(CalendarKey({ statuses: st }))).not.toContain("overtime");
    // an empty month renders too
    expect(textOf(MonthCalendar({ view: { ...view, days: monthDays("2026-10").map(emptyDay) }, dayHref: (d) => d, monthHref: (m) => m, statuses: null }))).not.toContain("absent");
  });
});

describe("the month-end salary review", () => {
  /** A plant with Ramu on salary (one no-exit day on 10 Oct), and Gaja active without salary. */
  async function reviewPlant() {
    const p = plant();
    const gaja = atUser(p.tenantId, ["plant_staff"], "Gaja");
    platform.contacts = [...contactsFor(p.owner, p.worker, gaja)];
    await setting(p.worker, null);
    await work(p.worker, [1, 2], 8);
    await markAt(p.worker, "in", `${day(10)} 09:00`); // no OUT: no exit
    await markAt(p.worker, "in", `${day(11)} 09:00`);
    await markAt(p.worker, "out", `${day(11)} 17:00`);
    return { p, gaja };
  }
  const reviews = (tenantId: string) => sent(tenantId).filter((n) => n.kind === "attendance_salary.salary_review");

  it("5. on 31 Oct at 07:00: once, to the owners, with what is left to fix; nothing on the 30th", async () => {
    const { p } = await reviewPlant();
    await runDaily(ist("2026-10-30 07:00"));
    expect(reviews(p.tenantId)).toEqual([]);
    expect(await salaryReview(p.tenantId, ist("2026-10-31 07:00"))).toMatchObject({ month: "2026-10", onSalary: 1, noExitDays: 1, noSalary: 1 });
    const out = await runDaily(ist("2026-10-31 07:00"));
    expect(out.salary_review.notified).toBeGreaterThanOrEqual(1);
    expect(reviews(p.tenantId)).toEqual([
      {
        kind: "attendance_salary.salary_review",
        title: "October salary review today",
        body: "1 day with no exit to fix · 1 person without salary",
        link: "/salary?month=2026-10",
        level: "push",
        dedupe_key: "salary_review:2026-10",
      },
    ]);
    // a second run sends the same dedupe key (the platform keeps one per person)
    await runDaily(ist("2026-10-31 07:30"));
    expect(new Set(reviews(p.tenantId).map((n) => n.dedupe_key))).toEqual(new Set(["salary_review:2026-10"]));
  });

  it("5b. 'All set' when nothing is left; a plant with nobody on salary this month gets nothing", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    await setting(p.worker, null);
    await runDaily(ist("2026-10-31 07:00"));
    expect(reviews(p.tenantId).map((n) => n.body)).toEqual(["All set: check the figures and mark them paid"]);

    const later = plant();
    await setting(later.worker, null, "2026-12"); // on salary only from December
    await runDaily(ist("2026-10-31 07:00"));
    expect(reviews(later.tenantId)).toEqual([]);
  });

  it("5c. the platform down: the review waits in the outbox", async () => {
    const { p } = await reviewPlant();
    platform.notifyStatus = 503;
    await runDaily(ist("2026-10-31 07:00"));
    const { rows } = await asOwner<{ input: { kind: string } }>("select input from attendance_salary.notification_outbox where tenant_id = $1 and sent_at is null", [p.tenantId]);
    expect(rows.map((r) => r.input.kind)).toContain("attendance_salary.salary_review");
  });
});

describe("PlantOps support", () => {
  it("6. every salary write is refused; the salary pages are logged and named for the owner", async () => {
    const p = await workedExample();
    signInAs(p.support);
    const w = p.worker.userId;
    const writes: [string, () => Promise<Response>][] = [
      ["settings", () => settingsRoute.POST(jsonReq("POST", "/api/salary/settings", { user_id: w, monthly: "1", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: "2026-10", expect: null }), undefined as never)],
      ["visibility", () => visibilityRoute.POST(jsonReq("POST", "/api/salary/visibility", { user_id: w, can_see: true, expect: null }), undefined as never)],
      ["advances", () => advancesRoute.POST(jsonReq("POST", "/api/salary/advances", { kind: "advance", user_id: w, amount: "1", on_date: "2026-10-05", expect: null }), undefined as never)],
      ["pay", () => payRoute.POST(jsonReq("POST", "/api/salary/pay", { user_id: w, month: "2026-10", paid_on: "2026-10-31", expect_remaining: 0 }), undefined as never)],
      ["undo", () => undoRoute.POST(jsonReq("POST", "/api/salary/pay/undo", { payment_id: crypto.randomUUID(), reason: "because" }), undefined as never)],
      ["export", () => exportRoute.GET(jsonReq("GET", "/api/salary/export?month=2026-10"), undefined as never)],
    ];
    for (const [name, call] of writes) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect((await res.json()).error, name).toBe("PlantOps support view is read-only");
    }
    expect((await asOwner("select 1 from attendance_salary.salary_settings where tenant_id = $1", [p.tenantId])).rowCount).toBe(1);

    await SalaryPage({ searchParams: Promise.resolve({ month: "2026-10" }) });
    await PersonMonthPage({ params: Promise.resolve({ user: w }), searchParams: Promise.resolve({ m: "2026-10" }) });
    vi.restoreAllMocks();
    const seen = (await listSupportViews(p.owner)).map((v) => v.what);
    expect(seen).toEqual(expect.arrayContaining(["the Salary tab", "a person's attendance and salary"]));
  });
});
