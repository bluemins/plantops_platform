// "Days back" for Office staff and Supervisors (owner, 2026-11-06): they add or cancel someone's IN / OUT only for today
// and the number of days before it that the owner set for them on Manage users (no number saved = 2). Owners: no limit.
// Older days are refused by the server and the day page shows a note instead of Fix.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIX_DAYS_DEFAULT } from "@plantops/types";
import PersonDayPage from "@/app/staff/[user]/[date]/page";
import { addDays, istDay } from "@/lib/days";
import { addFix, cancelFix, dayStamp, tooOldDay } from "@/server/fixes";
import { toAtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { atUser, contactsFor, markAt, plant, refusal, signInAs, textOf } from "./helpers";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const TODAY = istDay();
const ago = (n: number) => addDays(TODAY, -n);

/** Office staff with a 2-day window, a Supervisor with today only, a worker; all in one plant. */
function setup() {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff", "plant_staff"], "Mitu", undefined, 2);
  const supervisor = atUser(p.tenantId, ["supervisor"], "Sunil", undefined, 0);
  const bindu = atUser(p.tenantId, ["plant_staff"], "Bindu");
  platform.contacts = [...contactsFor(p.owner, office, supervisor, bindu)];
  return { p, office, supervisor, bindu };
}

const addOut = async (u: ReturnType<typeof atUser>, person: string, day: string) =>
  addFix(u, { user_id: person, day, kind: "out", date: day, time: "06:00", reason: "forgot", expect: await dayStamp(u, person, day) });

describe("the window comes from the platform's status check", () => {
  const session = (roles: Parameters<typeof atUser>[1], fix_days_back?: number) =>
    toAtUser({ tenant_id: "t", user_id: "u", roles, enabled_modules: ["attendance_salary"], login_at: 0, checked_at: 0, ...(fix_days_back !== undefined ? { fix_days_back } : {}) });

  it("Office staff / Supervisors get the owner's number, or 2 when none came; owners and workers have no limit", () => {
    expect(session(["office_staff"], 5).fixDaysBack).toBe(5);
    expect(session(["supervisor"], 0).fixDaysBack).toBe(0);
    expect(session(["office_staff", "plant_staff"]).fixDaysBack).toBe(FIX_DAYS_DEFAULT);
    expect(FIX_DAYS_DEFAULT).toBe(2);
    expect(session(["tenant_admin", "office_staff"], 1).fixDaysBack).toBeNull();
    expect(session(["plant_staff"], 3).fixDaysBack).toBeNull();
  });

  it("tooOldDay: today minus the window is still allowed, one day older is not", () => {
    const { p, office, supervisor } = setup();
    expect(tooOldDay(office, [ago(2)], TODAY)).toBeNull();
    expect(tooOldDay(office, [ago(3)], TODAY)).toBe(ago(3));
    expect(tooOldDay(office, [ago(1), ago(5), ago(4)], TODAY)).toBe(ago(5));
    expect(tooOldDay(supervisor, [TODAY], TODAY)).toBeNull();
    expect(tooOldDay(supervisor, [ago(1)], TODAY)).toBe(ago(1));
    expect(tooOldDay(p.owner, ["2020-01-01"], TODAY)).toBeNull();
  });
});

describe("the server refuses older days", () => {
  it("Office staff add a time 2 days back but not 3; the owner adds 30 days back", async () => {
    const { p, office, bindu } = setup();
    await markAt(bindu, "in", `${ago(2)} 09:00`);
    await addOut(office, bindu.userId, ago(2));
    const old = await refusal(() => addOut(office, bindu.userId, ago(3)));
    expect(old.status).toBe(403);
    expect(old.message).toMatch(/^You can fix today and the 2 days before\. Ask the owner to change /);
    await addOut(p.owner, bindu.userId, ago(30));
  });

  it("a cancel of an older mark is refused the same way", async () => {
    const { office, bindu } = setup();
    const id = await markAt(bindu, "in", `${ago(4)} 09:00`);
    const r = await refusal(async () => cancelFix(office, { punch_id: id, day: ago(4), reason: "wrong", expect: await dayStamp(office, bindu.userId, ago(4)) }));
    expect(r.status).toBe(403);
    expect(r.message).toContain("today and the 2 days before");
    const recent = await markAt(bindu, "in", `${ago(1)} 09:00`);
    await cancelFix(office, { punch_id: recent, day: ago(1), reason: "wrong", expect: await dayStamp(office, bindu.userId, ago(1)) });
  });

  it("0 days back = today only (a Supervisor fixing Office staff)", async () => {
    const { supervisor, office } = setup();
    await addOut(supervisor, office.userId, TODAY).catch((e: { message?: string }) => {
      // 06:00 may still be in the future early in the morning; the window itself must not be the reason
      expect(e.message).toBe("That time is in the future");
    });
    expect((await refusal(() => addOut(supervisor, office.userId, ago(1)))).message).toMatch(/^You can fix today only\./);
  });
});

describe("the day page", () => {
  it("Office staff see a note instead of Fix on an older day, and Fix within the window", async () => {
    const { office, bindu } = setup();
    signInAs(office);
    const flat = (n: unknown) => textOf(n).replace(/\s+/g, " ").replace(/ \./g, ".");
    const old = flat(await PersonDayPage({ params: Promise.resolve({ user: bindu.userId, date: ago(3) }) }));
    expect(old).toContain("You can fix today and the 2 days before. Ask the owner to change this day.");
    expect(old).not.toContain("Add a time");
    const recent = flat(await PersonDayPage({ params: Promise.resolve({ user: bindu.userId, date: ago(1) }) }));
    expect(recent).not.toContain("Ask the owner to change this day");
  });
});
