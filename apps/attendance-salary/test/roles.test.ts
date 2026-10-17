// Phase R1 (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "One rule first: who is an employee"): Office staff and Supervisors
// open Attendance, but only people holding Plant staff are tracked: on the Staff list, a "known person", counted in
// the month-end "no salary set".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEmployee, roleWorksIn } from "@plantops/types";
import { istDay } from "@/lib/days";
import { salaryReview } from "@/server/notify";
import { knownPerson, staffList } from "@/server/people";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { atUser, contactsFor, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

function setup() {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff"], "Ramesh");
  const supervisor = atUser(p.tenantId, ["supervisor"], "Sunil");
  const officeWorker = atUser(p.tenantId, ["office_staff", "plant_staff"], "Mitu");
  const supervisorWorker = atUser(p.tenantId, ["supervisor", "plant_staff"], "Tapan");
  platform.contacts = [...contactsFor(p.owner, p.worker, p.keeper, office, supervisor, officeWorker, supervisorWorker)];
  return { p, office, supervisor, officeWorker, supervisorWorker };
}

describe("the two roles in packages/types", () => {
  it("work only in Attendance; only Plant staff is an employee", () => {
    for (const role of ["office_staff", "supervisor"] as const) {
      expect(roleWorksIn(role, "attendance_salary"), role).toBe(true);
      expect(roleWorksIn(role, "floor_stock"), role).toBe(false);
      expect(roleWorksIn(role, "order_capture"), role).toBe(false);
    }
    expect(isEmployee(["plant_staff"])).toBe(true);
    expect(isEmployee(["office_staff", "plant_staff"])).toBe(true);
    expect(isEmployee(["office_staff"])).toBe(false);
    expect(isEmployee(["supervisor"])).toBe(false);
    expect(isEmployee(["tenant_admin"])).toBe(false);
  });
});

describe("only employees are tracked", () => {
  it("the Staff list has Plant staff (with or without another role), never Office staff / Supervisors alone", async () => {
    const { p, office } = setup();
    const names = (await staffList(p.owner)).active.map((x) => x.name);
    expect(names).toEqual(["Mitu", "Ramu", "Tapan"]);
    expect((await staffList(office)).active.map((x) => x.name)).toEqual(names); // Office staff see the same list
  });

  it("an Office-staff-only or Supervisor-only person has no person page (404); with Plant staff they do", async () => {
    const { p, office, supervisor, officeWorker, supervisorWorker } = setup();
    for (const u of [office, supervisor]) expect((await refusal(() => knownPerson(p.owner, u.userId))).status, u.name).toBe(404);
    for (const u of [officeWorker, supervisorWorker]) expect(await knownPerson(p.owner, u.userId)).toEqual({ userId: u.userId, name: u.name });
  });

  it("the month-end 'no salary set' count leaves out Office staff and Supervisors without Plant staff", async () => {
    const { p } = setup();
    const r = await salaryReview(p.tenantId, new Date(`${istDay()}T03:00:00Z`));
    expect(r.noSalary).toBe(3); // Ramu, Mitu, Tapan
  });
});
