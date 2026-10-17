// The one access table (src/server/access.ts): who is who, what each may do, and the plain refusals. Every route and
// page in later phases checks this table on the server.
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { roleLabel, whoFor } from "@/server/session";
import { plant, refused } from "./helpers";

const p = plant();
/** The owner's salary actions (support has salary_view only, read-only). */
const OWNER_SALARY: Action[] = ["salary_view", "salary_edit", "salary_pay", "salary_export"];

describe("who is who", () => {
  it("owner, owner who is also Plant staff, Plant staff; anyone else has no rights", () => {
    expect(whoFor(["tenant_admin"])).toBe("owner");
    expect(whoFor(["tenant_admin", "plant_staff"])).toBe("owner_worker");
    expect(whoFor(["plant_staff"])).toBe("worker");
    expect(whoFor(["plant_staff", "store_keeper"])).toBe("worker");
    for (const role of ["store_keeper", "order_desk", "lab_technician", "document_keeper", "complaint_desk"] as const) {
      expect(whoFor([role]), role).toBeNull();
    }
    expect(p.support.who).toBe("support");
  });

  it("the header says Owner / Plant staff / Read-only", () => {
    expect(roleLabel(p.owner)).toBe("Owner");
    expect(roleLabel(p.ownerWorker)).toBe("Owner");
    expect(roleLabel(p.worker)).toBe("Plant staff");
    expect(roleLabel(p.support)).toBe("Read-only");
  });
});

describe("the access table", () => {
  // the agreed table (docs/ATTENDANCE_PHASE_PLAN.md + Phase 2 plan): which actions each person has
  const expected: Record<"owner" | "ownerWorker" | "worker" | "keeper" | "support", Action[]> = {
    owner: ["see_everyone", "fix", "settings", "view_settings", "export", "view_changes", "support_log", ...OWNER_SALARY],
    ownerWorker: ["mark", "see_own", "see_everyone", "fix", "settings", "view_settings", "export", "view_changes", "support_log", ...OWNER_SALARY, "see_own_salary"],
    worker: ["mark", "see_own", "see_own_salary"],
    keeper: [],
    support: ["see_everyone", "view_settings", "view_changes", "salary_view"],
  };

  it("each person can do exactly their actions", () => {
    const actions = Object.keys(ACCESS) as Action[];
    expect(actions.sort()).toEqual([
      "export", "fix", "mark", "salary_edit", "salary_export", "salary_pay", "salary_view", "see_everyone", "see_own",
      "see_own_salary", "settings", "support_log", "view_changes", "view_settings",
    ]);
    for (const [name, allowed] of Object.entries(expected)) {
      const user = p[name as keyof typeof expected];
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
