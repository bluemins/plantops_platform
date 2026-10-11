// The one access table (src/server/access.ts) for every kind of person, exactly as the plan's "Who uses it" says.
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { whoFor } from "@/server/session";
import { plant, refused } from "./helpers";

const p = plant();
const people = { owner: p.owner, desk: p.desk, staff: p.staff, keeper: p.keeper, support: p.support };

// [action, owner, complaint desk, plant staff, store keeper, support]
const TABLE: [Action, boolean, boolean, boolean, boolean, boolean][] = [
  ["read", true, true, true, false, true],
  ["log", true, true, true, false, false],
  ["note", true, true, true, false, false],
  ["in_progress", true, true, true, false, false],
  ["resolve", true, false, false, false, false],
  ["reopen", true, false, false, false, false],
  ["manage_items", true, false, false, false, false],
  ["view_items", true, false, false, false, true],
  ["view_changes", true, false, false, false, true],
  ["export", true, false, false, false, false],
  ["support_log", true, false, false, false, false],
];

describe("who is who", () => {
  it("owner wins; complaint desk and plant staff are staff; a store keeper or lab technician has no rights", () => {
    expect(whoFor(["tenant_admin", "complaint_desk"])).toBe("owner");
    expect(whoFor(["complaint_desk"])).toBe("staff");
    expect(whoFor(["plant_staff"])).toBe("staff");
    expect(whoFor(["store_keeper", "complaint_desk"])).toBe("staff");
    expect(whoFor(["store_keeper"])).toBeNull();
    expect(whoFor(["lab_technician", "lab_lead"])).toBeNull();
    expect(p.support.who).toBe("support");
  });
});

describe("the access table", () => {
  it("covers every action", () => {
    expect(TABLE.map((r) => r[0]).sort()).toEqual(Object.keys(ACCESS).sort());
  });

  it.each(TABLE)("%s: owner %s, complaint desk %s, plant staff %s, store keeper %s, support %s", (action, ...expected) => {
    expect(Object.values(people).map((u) => can(u, action))).toEqual(expected);
  });

  it("refusals say why in plain words", async () => {
    expect(await refused(() => requireAccess(p.support, "log"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect(await refused(() => requireAccess(p.desk, "resolve"))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect(await refused(() => requireAccess(p.keeper, "read"))).toEqual({ status: 403, message: "You don't have access to Complaint Box" });
    expect(() => requireAccess(p.owner, "export")).not.toThrow();
  });

  it("support is refused every write", async () => {
    for (const action of ["log", "note", "in_progress", "resolve", "reopen", "manage_items", "export"] as Action[]) {
      expect((await refused(() => requireAccess(p.support, action))).message, action).toBe("PlantOps support view is read-only");
    }
  });
});
