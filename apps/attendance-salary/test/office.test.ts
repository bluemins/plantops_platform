// Phase R2 (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Office staff"): "Mark for someone" from the office phone, Fix for
// Office staff (never their own), their person page (no salary parts), advances with every rule, and the owners'
// advance_given / desk_fix notifications. Real database, real routes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as deskRoute from "@/app/api/desk/mark/route";
import * as advanceRoute from "@/app/api/salary/advances/route";
import * as addRoute from "@/app/api/fix/add/route";
import * as cancelRoute from "@/app/api/fix/cancel/route";
import PersonMonthPage from "@/app/staff/[user]/page";
import SalaryPage from "@/app/salary/page";
import SettingsPage from "@/app/settings/page";
import { describeChange } from "@/lib/changes";
import { addDays, istDay, istMonth } from "@/lib/days";
import { monthFor } from "@/server/calendar";
import { claimsTab } from "@/server/claims";
import { deskList, deskMark } from "@/server/desk";
import { addFix, cancelFix, dayStamp } from "@/server/fixes";
import { recentChanges } from "@/server/audit";
import { salaryMonths } from "@/server/salary";
import { advancePanel, salaryPanel, saveAdvance } from "@/server/salary-edit";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, jsonReq, markAt, northOf, plant, refusal, signInAs, textOf } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

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

const PLANT = { lat: 21.347, lng: 83.627 };
const R = (rupees: number) => Math.round(rupees * 100);
const TODAY = istDay();
const THIS = istMonth();
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);
const at = (metres: number, accuracy = 15) => ({ ...northOf(PLANT, metres), accuracy });
/** The components a server page renders (by name), with their props: client parts like the Salary box are not text. */
function componentsOf(node: unknown, out: { name: string; props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) componentsOf(n, out);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") out.push({ name: (el.type as { name: string }).name, props: el.props ?? {} });
  if (el.props) componentsOf(el.props.children, out);
  return out;
}

/** A plant with its location set; Ramesh (Office staff + Plant staff), Bindu and Ramu (Plant staff), Sunil (Supervisor). */
async function setup(opts: { location?: boolean } = {}) {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff", "plant_staff"], "Ramesh");
  const officeOnly = atUser(p.tenantId, ["office_staff"], "Mitu");
  const supervisor = atUser(p.tenantId, ["supervisor"], "Sunil");
  const bindu = atUser(p.tenantId, ["plant_staff"], "Bindu");
  platform.contacts = [...contactsFor(p.owner, p.worker, office, officeOnly, supervisor, bindu)];
  if (opts.location !== false) {
    await asApp(
      p.tenantId,
      `insert into attendance_salary.plant_settings (tenant_id, lat, lng, radius_m, updated_by, updated_by_name) values ('${p.tenantId}', ${PLANT.lat}, ${PLANT.lng}, 200, gen_random_uuid(), 'Sujata')`,
    );
  }
  return { p, office, officeOnly, supervisor, bindu };
}

/** A monthly salary from `fromMonth` for one person (as the owner's Salary box saves it). */
const salary = (u: { tenantId: string; userId: string; name: string }, fromMonth = THIS) =>
  asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(12000)}, 480, false, gen_random_uuid(), 'Sujata')`,
  );

describe("Mark for someone", () => {
  it("1. the list: every active employee with their state; yourself greyed; Supervisors, workers and owners refused", async () => {
    const { p, office, officeOnly, supervisor, bindu } = await setup();
    await markAt(bindu, "in", `${TODAY} 08:02`);
    const list = await deskList(office);
    expect(list.people.map((x) => [x.name, x.self])).toEqual([
      ["Bindu", false],
      ["Ramesh", true],
      ["Ramu", false],
    ]);
    expect(list.people[0]).toMatchObject({ next: "out", state: "IN since 8:02" });
    expect(list.people[2]).toMatchObject({ next: "in", state: "Not in today" });
    expect((await deskList(officeOnly)).people.map((x) => x.name)).toEqual(["Bindu", "Ramesh", "Ramu"]); // not themselves: not Plant staff
    for (const u of [supervisor, p.worker]) expect((await refusal(() => deskList(u))).status, u.name).toBe(403);
    expect(await refusal(() => deskList(p.owner))).toEqual({ status: 403, message: "Owners use Fix on the person's day to add a time" });
  });

  it("2. a desk mark is saved with the office phone's distance, by Office staff, and counts like a scan (never 'changed')", async () => {
    const { p, office, bindu } = await setup();
    signInAs(office);
    const res = await deskRoute.POST(jsonReq("POST", "/api/desk/mark", { user_id: bindu.userId, expect: "in", location: at(40) }), undefined as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ kind: "in", name: "Bindu" });
    const { rows } = await asOwner("select source, distance_m, accuracy_m, reason, created_by, created_by_name from attendance_salary.punches where tenant_id = $1", [p.tenantId]);
    expect(rows).toEqual([{ source: "desk", distance_m: 40, accuracy_m: 15, reason: null, created_by: office.userId, created_by_name: "Ramesh" }]);
    const month = await monthFor(p.owner, bindu.userId, THIS);
    const day = month.days.find((d) => d.date === TODAY)!;
    expect(day).toMatchObject({ changed: false });
    expect((await deskList(office)).people.find((x) => x.name === "Bindu")!.state).toMatch(/^IN since \d+:\d\d · by Ramesh$/);
    const changes = await recentChanges(p.owner);
    expect(changes[0]).toMatchObject({ by: "Ramesh (office)" });
    expect(changes[0]!.text).toMatch(/^Marked IN \d+:\d\d on .+ for Bindu \(Mark for someone\)$/);
    await settle();
    // routine: nothing to the owners; only the supervisors' scan bell (Phase R3)
    expect(sent(p.tenantId).map((n) => n.kind)).toEqual(["attendance_salary.scan"]);
    expect(sent(p.tenantId)[0]).toMatchObject({ only_listed: true, also_user_ids: [expect.any(String)] });
  });

  it("3. never yourself; never someone who left; an Office-staff-only person can't be marked (not an employee)", async () => {
    const { p, office, officeOnly, bindu } = await setup();
    expect(await refusal(() => deskMark(office, { user_id: office.userId, expect: "in", location: at(40) }))).toEqual({ status: 403, message: "Scan the QR for your own attendance" });
    // the office phone's location must be as good as a scan's (B-04: ±150 m)
    expect(await refusal(() => deskMark(office, { user_id: bindu.userId, expect: "in", location: at(40, 151) }))).toMatchObject({ status: 400 });
    expect((await refusal(() => deskMark(office, { user_id: officeOnly.userId, expect: "in", location: at(40) }))).status).toBe(404);
    const left = atUser(p.tenantId, ["plant_staff"], "Gaja");
    await markAt(left, "in", `${addDays(TODAY, -3)} 08:00`); // has marks, but no longer on the platform's list
    expect((await refusal(() => deskMark(office, { user_id: left.userId, expect: "in", location: at(40) }))).status).toBe(404);
  });

  it("4. the location rules of a scan: none, too rough, outside (the office phone, no 'outside' alert); no plant location", async () => {
    const { p, office, bindu } = await setup();
    const tap = (location: ReturnType<typeof at> | null) => refusal(() => deskMark(office, { user_id: bindu.userId, expect: "in", location }));
    expect(await tap(null)).toMatchObject({ status: 400, message: "Allow location on this phone to mark for someone." });
    expect((await tap(at(40, 600))).message).toMatch(/^Location too rough/);
    expect(await tap(at(1200))).toMatchObject({ status: 403, message: "The office phone is 1.2 km from the plant. Mark at the plant." });
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
    const q = await setup({ location: false });
    expect((await refusal(() => deskMark(q.office, { user_id: q.bindu.userId, expect: "in", location: at(40) }))).message).toBe("The owner hasn't set the plant location yet.");
  });

  it("5. the server decides IN / OUT (409 when it changed) and refuses a double tap within 2 minutes", async () => {
    const { office, bindu } = await setup();
    await deskMark(office, { user_id: bindu.userId, expect: "in", location: at(40) });
    const again = await refusal(() => deskMark(office, { user_id: bindu.userId, expect: "out", location: at(40) }));
    expect(again).toMatchObject({ status: 409 });
    expect(again.message).toMatch(/^Bindu was already marked at /);
    const q = await setup();
    // an IN 3 hours ago (no OUT): the server's next mark is an OUT
    await asApp(q.p.tenantId, `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name)
      values ('${q.p.tenantId}', '${q.bindu.userId}', 'Bindu', 'in', now() - interval '3 hours', 'scan', 30, 10, '${q.bindu.userId}', 'Bindu')`);
    expect((await refusal(() => deskMark(q.office, { user_id: q.bindu.userId, expect: "in", location: at(40) }))).message).toMatch(/^Bindu is already IN since /);
  });
});

describe("Fix by Office staff", () => {
  const DAY = "2026-09-14";

  it("6. adds a forgotten OUT for a worker: the worker gets 'corrected', the owners 'desk_fix' (bell), once each", async () => {
    const { p, office, bindu } = await setup();
    await markAt(bindu, "in", `${DAY} 09:10`);
    signInAs(office);
    const expect_ = await dayStamp(office, bindu.userId, DAY);
    const res = await addRoute.POST(jsonReq("POST", "/api/fix/add", { user_id: bindu.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to mark", expect: expect_ }), undefined as never);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await settle();
    const notes = sent(p.tenantId);
    expect(notes.map((n) => n.kind).sort()).toEqual(["attendance_salary.corrected", "attendance_salary.desk_fix"]);
    expect(notes.find((n) => n.kind === "attendance_salary.desk_fix")).toMatchObject({
      title: "Ramesh changed Bindu's attendance",
      body: "14 Sept: added OUT 18:30 · forgot to mark",
      level: "bell",
      dedupe_key: `deskfix:${id}`,
      link: `/staff/${bindu.userId}/${DAY}`,
    });
    expect(notes.find((n) => n.kind === "attendance_salary.desk_fix")).not.toHaveProperty("also_user_ids"); // the platform picks the owners
    expect((await recentChanges(p.owner))[0]).toMatchObject({ by: "Ramesh (office)" });
  });

  it("7. a cancel by Office staff tells the owners too; the owner's own fixes send no desk_fix", async () => {
    const { p, office, bindu } = await setup();
    const id = await markAt(bindu, "in", `${DAY} 09:10`);
    signInAs(office);
    const res = await cancelRoute.POST(jsonReq("POST", "/api/fix/cancel", { punch_id: id, day: DAY, reason: "marked twice", expect: await dayStamp(office, bindu.userId, DAY) }), undefined as never);
    expect(res.status).toBe(201);
    await settle();
    expect(sent(p.tenantId).find((n) => n.kind === "attendance_salary.desk_fix")).toMatchObject({ body: "14 Sept: cancelled IN 9:10 · marked twice" });
    const q = await setup();
    await markAt(q.bindu, "in", `${DAY} 09:10`);
    await addFix(q.p.owner, { user_id: q.bindu.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot", expect: await dayStamp(q.p.owner, q.bindu.userId, DAY) });
    await settle();
    expect(sent(q.p.tenantId).filter((n) => n.kind === "attendance_salary.desk_fix")).toEqual([]);
  });

  it("8. never their own attendance (add or cancel); a Supervisor can't fix at all", async () => {
    const { office, supervisor, bindu } = await setup();
    const own = await markAt(office, "in", `${DAY} 09:00`);
    const stamp = await dayStamp(office, office.userId, DAY);
    expect(await refusal(() => addFix(office, { user_id: office.userId, day: DAY, kind: "out", date: DAY, time: "18:00", reason: "forgot", expect: stamp }))).toEqual({
      status: 403,
      message: "Ask the owner to fix your own attendance",
    });
    expect((await refusal(() => cancelFix(office, { punch_id: own, day: DAY, reason: "wrong", expect: stamp }))).message).toBe("Ask the owner to fix your own attendance");
    expect((await refusal(() => addFix(supervisor, { user_id: bindu.userId, day: DAY, kind: "out", date: DAY, time: "18:00", reason: "forgot", expect: stamp }))).status).toBe(403);
  });
});

describe("advances by Office staff", () => {
  const give = (u: Parameters<typeof saveAdvance>[0], person: string, over: Record<string, unknown> = {}) =>
    saveAdvance(u, { kind: "advance", user_id: person, amount: "2000", on_date: TODAY, note: "hospital", expect: null, ...over } as never);

  it("9. saved, audited 'Ramesh (office)'; the owners get one advance_given (phone + bell); the owner's own entries send none", async () => {
    const { p, office, bindu } = await setup();
    await salary(bindu);
    signInAs(office);
    const res = await advanceRoute.POST(jsonReq("POST", "/api/salary/advances", { kind: "advance", user_id: bindu.userId, amount: "2000", on_date: TODAY, note: "hospital", expect: null }), undefined as never);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await settle();
    expect(sent(p.tenantId)).toEqual([
      expect.objectContaining({ kind: "attendance_salary.advance_given", title: "Advance ₹2,000 to Bindu", body: "Given by Ramesh · hospital", level: "push", dedupe_key: `advance:${id}`, link: `/staff/${bindu.userId}?m=${THIS}` }),
    ]);
    const changes = await recentChanges(p.owner);
    expect(changes[0]).toMatchObject({ by: "Ramesh (office)" });
    expect(describeChange("salary.advance", { amount: R(2000), person: "Bindu", on: TODAY })).toMatch(/^Advance ₹2,000 to Bindu/);
    const panel = await salaryPanel(p.owner, bindu.userId, THIS);
    signInAs(p.owner);
    await advanceRoute.POST(jsonReq("POST", "/api/salary/advances", { kind: "advance", user_id: bindu.userId, amount: "500", on_date: TODAY, note: null, expect: panel.expect.advance }), undefined as never);
    await settle();
    expect(sent(p.tenantId)).toHaveLength(1);
  });

  it("10. the rules: not yourself, today back to 7 days, never the future, at most ₹1 lakh, a salary for that month", async () => {
    const { office, bindu, p } = await setup();
    await salary(bindu, THIS);
    await salary(office, THIS);
    expect(await refusal(() => give(office, office.userId))).toEqual({ status: 403, message: "You can't give yourself an advance. Ask the owner." });
    expect((await refusal(() => give(office, bindu.userId, { on_date: addDays(TODAY, 1) }))).message).toBe("The date is in the future");
    expect((await refusal(() => give(office, bindu.userId, { on_date: addDays(TODAY, -8) }))).message).toBe("An advance can be at most 7 days back. Ask the owner for older ones.");
    expect((await refusal(() => give(office, bindu.userId, { amount: "100000.01" }))).status).toBe(400);
    expect((await refusal(() => give(office, p.worker.userId))).message).toBe("Ask the owner to set this person's salary first"); // Ramu: no salary
    let last: string | null = null;
    const sevenDaysAgo = addDays(TODAY, -7);
    if (sevenDaysAgo.slice(0, 7) === THIS) last = (await give(office, bindu.userId, { on_date: sevenDaysAgo })).id; // 7 days back is fine (same month)
    last = (await give(office, bindu.userId, { amount: "100000", expect: last })).id;
    // the owner keeps their own rules: any date from the first salary month, up to ₹1 crore
    await give(p.owner, bindu.userId, { amount: "200000", expect: last });
  });

  it("11. Office staff correct only their own entry, the same day; the owner corrects any", async () => {
    const { p, office, bindu } = await setup();
    await salary(bindu);
    const mine = await give(office, bindu.userId);
    const ownerEntry = await give(p.owner, bindu.userId, { amount: "1000", expect: mine.id });
    const correct = (u: Parameters<typeof saveAdvance>[0], id: string, expect: string) =>
      saveAdvance(u, { kind: "correction", user_id: bindu.userId, corrects_id: id, amount: "100", reason: "typed wrong", expect } as never);
    expect(await refusal(() => correct(office, ownerEntry.id, ownerEntry.id))).toEqual({ status: 403, message: "Only the owner can correct this entry" });
    const c = await correct(office, mine.id, ownerEntry.id);
    expect(c.notice).toBeNull(); // a correction sends nothing
    // the same entry a day later: only the owner
    await asOwner("update attendance_salary.salary_advances set created_at = created_at - interval '1 day' where id = $1", [mine.id]);
    expect((await refusal(() => correct(office, mine.id, c.id))).message).toBe("Only the owner can correct this entry");
    await correct(p.owner, mine.id, c.id);
  });

  it("12. their view: this month's entries, 'still to recover' from earlier months, 7 days back, Correct on their own entries only", async () => {
    const { p, office, bindu } = await setup();
    const last = addDays(`${THIS}-01`, -1).slice(0, 7);
    await salary(bindu, last);
    // last month: a ₹20,000 advance on a ₹12,000 salary with no attendance -> earlier months still owe
    await asApp(
      p.tenantId,
      `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${p.tenantId}', '${bindu.userId}', 'Bindu', '${last}-05', ${R(20000)}, gen_random_uuid(), 'Sujata')`,
    );
    const ownerOne = await give(p.owner, bindu.userId, { amount: "1000", expect: (await salaryPanel(p.owner, bindu.userId, THIS)).expect.advance });
    const mine = await give(office, bindu.userId, { expect: ownerOne.id });
    const v = await advancePanel(office, bindu.userId, THIS);
    expect(v.advances.map((a) => [a.amountPaise, a.byName])).toEqual([
      [R(1000), "Sujata"],
      [R(2000), "Ramesh"],
    ]);
    expect(v.stillToRecoverPaise).toBe(R(19200)); // ₹20,000 less last month's 2 paid-leave days (₹800)
    expect(v.firstAdvanceDate).toBe([`${last}-01`, addDays(TODAY, -7)].sort().at(-1));
    expect(v.correctable).toEqual([mine.id]);
    expect(Object.keys(v).sort()).toEqual(["advances", "correctable", "expect", "firstAdvanceDate", "month", "stillToRecoverPaise", "today"]); // nothing about pay
  });
});

describe("salary stays closed to Office staff", () => {
  it("13. salary and claims are 'not found'; the person page has the month and advances, no Salary box, no figures", async () => {
    const { p, office, bindu } = await setup();
    await salary(bindu);
    for (const fn of [() => salaryMonths(office, THIS), () => salaryPanel(office, bindu.userId, THIS), () => claimsTab(office)]) {
      expect((await refusal(fn)).status).toBe(404);
    }
    signInAs(office);
    await expect(SalaryPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow(NOT_FOUND);
    await expect(SettingsPage()).rejects.toThrow(NOT_FOUND);
    const parts = (u: typeof office) => (signInAs(u), PersonMonthPage({ params: Promise.resolve({ user: bindu.userId }), searchParams: Promise.resolve({}) }).then((x) => componentsOf(x)));
    const office_ = await parts(office);
    expect(office_.map((c) => c.name)).toEqual(expect.arrayContaining(["MonthCalendar", "Advances"]));
    expect(office_.map((c) => c.name)).not.toEqual(expect.arrayContaining(["SalaryStrip"]));
    for (const hidden of ["SalaryStrip", "SalaryBox", "VisibilityTick", "SalaryReadOnly", "PersonClaims"]) expect(office_.some((c) => c.name === hidden), hidden).toBe(false);
    expect(office_.find((c) => c.name === "Advances")!.props).toMatchObject({ office: true, editable: true });
    const owner_ = await parts(p.owner);
    expect(owner_.map((c) => c.name)).toEqual(expect.arrayContaining(["SalaryStrip", "SalaryBox", "Advances"]));
  });
});
