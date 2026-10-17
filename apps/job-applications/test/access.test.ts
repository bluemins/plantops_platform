// The one access table (src/server/access.ts) for every role: owner, HR desk, PlantOps support (read-only); plant
// staff and other modules' roles get nothing (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Who uses it").
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { whoFor } from "@/server/session";
import { plant, refused } from "./helpers";

const p = plant();
const ALL = Object.keys(ACCESS) as Action[];

describe("access table", () => {
  it("who is who: owner wins, HR desk (also with Plant staff), nobody else", () => {
    expect(whoFor(["tenant_admin", "hr_desk"])).toBe("owner");
    expect(p.hr.who).toBe("hr");
    expect(p.hrStaff.who).toBe("hr");
    expect(p.general.who).toBeNull();
    expect(p.keeper.who).toBeNull();
    expect(p.support.who).toBe("support");
  });

  it("the owner may do everything", () => {
    for (const a of ALL) expect(can(p.owner, a), a).toBe(true);
  });

  it("HR desk reads and updates applications, nothing else", () => {
    expect(ALL.filter((a) => can(p.hr, a)).sort()).toEqual(["read", "update"]);
  });

  it("PlantOps support only looks", () => {
    expect(ALL.filter((a) => can(p.support, a)).sort()).toEqual(["read", "view_changes", "view_openings"]);
  });

  it("plant staff and a store keeper get nothing", () => {
    for (const u of [p.general, p.keeper]) for (const a of ALL) expect(can(u, a), a).toBe(false);
  });

  it("refusals say why", async () => {
    expect(await refused(() => requireAccess(p.support, "update"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect(await refused(() => requireAccess(p.hr, "remove"))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect(await refused(() => requireAccess(p.general, "read"))).toEqual({ status: 403, message: "You don't have access to Job applications" });
  });
});
