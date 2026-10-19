// The one access table (src/server/access.ts): who is who, what each may do, and the plain refusals. Every route and
// page in later phases checks this table on the server.
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { roleLabel, whoFor } from "@/server/session";
import { atUser, plant, refused } from "./helpers";

const p = plant();
/** Office staff and Supervisor (docs/ATTENDANCE_ROLES_PHASE_PLAN.md), alone and with Plant staff. */
const q = {
  office: atUser(p.tenantId, ["office_staff"], "Ramesh"),
  supervisor: atUser(p.tenantId, ["supervisor"], "Sunil"),
  officeWorker: atUser(p.tenantId, ["office_staff", "plant_staff"], "Ramesh"),
  supervisorWorker: atUser(p.tenantId, ["supervisor", "plant_staff"], "Sunil"),
  both: atUser(p.tenantId, ["office_staff", "supervisor", "plant_staff"], "Mitu"),
};
/** The owner's salary actions (support has salary_view only, read-only). */
const OWNER_SALARY: Action[] = ["salary_view", "salary_edit", "salary_pay", "salary_export"];
/** The owner's claim actions (support has claim_view only, read-only). */
const OWNER_CLAIMS: Action[] = ["claim_view", "claim_decide"];

describe("who is who", () => {
  it("owner, employee (Plant staff), office, supervisor, in any combination; anyone else has no rights", () => {
    expect(whoFor(["tenant_admin"])).toEqual(["owner"]);
    expect(whoFor(["tenant_admin", "plant_staff"])).toEqual(["owner", "employee"]);
    expect(whoFor(["plant_staff"])).toEqual(["employee"]);
    expect(whoFor(["plant_staff", "store_keeper"])).toEqual(["employee"]);
    expect(whoFor(["office_staff"])).toEqual(["office"]);
    expect(whoFor(["supervisor"])).toEqual(["supervisor"]);
    expect(whoFor(["office_staff", "plant_staff"])).toEqual(["employee", "office"]);
    expect(whoFor(["supervisor", "plant_staff"])).toEqual(["employee", "supervisor"]);
    expect(whoFor(["office_staff", "supervisor", "plant_staff"])).toEqual(["employee", "office", "supervisor"]);
    for (const role of ["store_keeper", "order_desk", "lab_technician", "document_keeper", "complaint_desk"] as const) {
      expect(whoFor([role]), role).toEqual([]);
    }
    expect(p.support.who).toEqual(["support"]);
  });

  it("the header says Owner / Plant staff / Read-only", () => {
    expect(roleLabel(p.owner)).toBe("Owner");
    expect(roleLabel(p.ownerWorker)).toBe("Owner");
    expect(roleLabel(p.worker)).toBe("Plant staff");
    expect(roleLabel(p.support)).toBe("Read-only");
    expect(roleLabel(q.office)).toBe("Office staff");
    expect(roleLabel(q.officeWorker)).toBe("Office staff");
    expect(roleLabel(q.supervisorWorker)).toBe("Supervisor");
  });
});

describe("the access table", () => {
  // the agreed table (docs/ATTENDANCE_PHASE_PLAN.md + Phase 2 plan): which actions each person has
  const OWNER: Action[] = ["see_everyone", "see_today", "fix", "day_mark", "settings", "view_settings", "export", "view_changes", "support_log", ...OWNER_SALARY, "advance_add", "advance_view", ...OWNER_CLAIMS];
  const EMPLOYEE: Action[] = ["mark", "see_own", "see_own_salary", "claim_own"];
  const OFFICE: Action[] = ["see_everyone", "see_today", "fix", "mark_for", "advance_add", "advance_view"];
  const expected: Record<"owner" | "ownerWorker" | "worker" | "keeper" | "support" | keyof typeof q, Action[]> = {
    owner: OWNER,
    ownerWorker: [...OWNER, ...EMPLOYEE],
    worker: EMPLOYEE,
    keeper: [],
    support: ["see_everyone", "see_today", "view_settings", "view_changes", "salary_view", "advance_view", "claim_view"],
    office: OFFICE,
    supervisor: ["see_today"],
    officeWorker: [...OFFICE, ...EMPLOYEE],
    supervisorWorker: ["see_today", ...EMPLOYEE],
    both: [...OFFICE, ...EMPLOYEE],
  };

  it("each person can do exactly their actions", () => {
    const actions = Object.keys(ACCESS) as Action[];
    expect(actions.sort()).toEqual([
      "advance_add", "advance_view", "claim_decide", "claim_own", "claim_view", "day_mark", "export", "fix", "mark", "mark_for", "salary_edit", "salary_export", "salary_pay",
      "salary_view", "see_everyone", "see_own", "see_own_salary", "see_today", "settings", "support_log", "view_changes", "view_settings",
    ]);
    const people = { ...p, ...q };
    for (const [name, allowed] of Object.entries(expected)) {
      const user = people[name as keyof typeof expected];
      expect(actions.filter((a) => can(user, a)).sort(), name).toEqual([...allowed].sort());
    }
  });

  it("a worker never sees anyone else's attendance and can't fix, set up or export", async () => {
    for (const a of ["see_everyone", "fix", "settings", "view_settings", "export", "view_changes", "support_log", ...OWNER_SALARY] as Action[]) {
      expect(await refused(() => requireAccess(p.worker, a)), a).toEqual({ status: 403, message: "Only the plant owner can do this" });
    }
  });

  it("an owner without Plant staff is told how to mark", async () => {
    for (const a of ["mark", "see_own"] as Action[]) {
      expect((await refused(() => requireAccess(p.owner, a))).message, a).toBe("Owners don't mark attendance. Add Plant staff to yourself on Manage users to mark.");
    }
  });

  it("support is refused every write; a store keeper is refused everything", async () => {
    for (const a of ["mark", "fix", "settings", "export", "support_log", "salary_edit", "salary_pay", "salary_export"] as Action[]) {
      expect(await refused(() => requireAccess(p.support, a)), a).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    }
    for (const a of (Object.keys(ACCESS) as Action[]).filter((x) => x !== "see_own_salary")) {
      expect((await refused(() => requireAccess(p.keeper, a))).message, a).toBe("You don't have access to Attendance");
    }
  });

  it("own salary pages are 'not found' (never 'not allowed') for anyone without them, so nothing hints they exist", async () => {
    for (const user of [p.owner, p.support, p.keeper]) {
      expect(await refused(() => requireAccess(user, "see_own_salary"))).toEqual({ status: 404, message: "Not found" });
    }
    expect(() => requireAccess(p.worker, "see_own_salary")).not.toThrow();
    expect(() => requireAccess(p.ownerWorker, "see_own_salary")).not.toThrow();
  });
});

describe("claims in the access table (Salary extras Part B)", () => {
  it("a worker gets 404 for the Claims tab (nothing hints it exists) and 403 for deciding", async () => {
    expect(await refused(() => requireAccess(p.worker, "claim_view"))).toMatchObject({ status: 404 });
    expect(await refused(() => requireAccess(p.worker, "claim_decide"))).toEqual({ status: 403, message: "Only the plant owner can do this" });
  });

  it("support may look but never decide or send; an owner without Plant staff sends no claims of their own", async () => {
    expect(can(p.support, "claim_view")).toBe(true);
    for (const a of ["claim_decide", "claim_own"] as Action[]) {
      expect(await refused(() => requireAccess(p.support, a)), a).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    }
    expect(can(p.owner, "claim_own")).toBe(false);
    expect(can(p.ownerWorker, "claim_own")).toBe(true);
  });
});

describe("Office staff and Supervisor in the access table (docs/ATTENDANCE_ROLES_PHASE_PLAN.md)", () => {
  const SALARY: Action[] = ["salary_view", "salary_edit", "salary_pay", "salary_export", "see_own_salary", "claim_own", "claim_view", "claim_decide"];

  it("salary and claims are 'not found' (never 'not allowed') for Office staff and Supervisors without Plant staff", async () => {
    for (const user of [q.office, q.supervisor]) {
      for (const a of SALARY) expect(await refused(() => requireAccess(user, a)), `${user.name} ${a}`).toEqual({ status: 404, message: "Not found" });
    }
    // with Plant staff they keep their own claims / slip rights, still never anyone's salary
    for (const user of [q.officeWorker, q.supervisorWorker, q.both]) {
      for (const a of ["salary_view", "salary_edit", "salary_pay", "salary_export", "claim_view", "claim_decide"] as Action[]) {
        expect((await refused(() => requireAccess(user, a))).status, `${user.name} ${a}`).toBe(404);
      }
    }
  });

  it("their other refusals are 403 'Only the plant owner can do this'", async () => {
    for (const a of ["settings", "view_settings", "export", "view_changes", "support_log"] as Action[]) {
      expect(await refused(() => requireAccess(q.office, a)), a).toEqual({ status: 403, message: "Only the plant owner can do this" });
    }
    for (const a of ["see_everyone", "fix", "mark_for", "advance_add", "advance_view", "mark", "see_own"] as Action[]) {
      expect(await refused(() => requireAccess(q.supervisor, a)), a).toEqual({ status: 403, message: "Only the plant owner can do this" });
    }
  });

  it("workers, owners, support and a store keeper keep their earlier answers for the new actions", async () => {
    expect(await refused(() => requireAccess(p.worker, "mark_for"))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect(await refused(() => requireAccess(p.owner, "mark_for"))).toEqual({ status: 403, message: "Owners use Fix on the person's day to add a time" });
    expect(await refused(() => requireAccess(p.support, "advance_add"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect(await refused(() => requireAccess(p.keeper, "see_today"))).toEqual({ status: 403, message: "You don't have access to Attendance" });
  });
});
