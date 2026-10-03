import { describe, expect, it } from "vitest";
import type { ModuleId, RoleId } from "@plantops/types";
import { AccessDeniedError, canAccessModule, requireModuleAccess, requireRole } from "../src";

const enabled: ModuleId[] = ["lab_records", "floor_stock"];

describe("canAccessModule", () => {
  it.each<[RoleId[], ModuleId, boolean]>([
    [["lab_technician"], "lab_records", true],
    [["lab_technician"], "floor_stock", false],
    [["store_keeper"], "floor_stock", true],
    [["lab_technician", "store_keeper"], "floor_stock", true],
    [["maintenance_technician"], "preventive_mgmt", false], // role ok, module not enabled
    [["tenant_admin"], "lab_records", true],
    [["tenant_admin"], "amc", false], // owner still needs the module in the plan
    [[], "lab_records", false],
  ])("%j -> %s = %s", (roles, mod, expected) => {
    expect(canAccessModule(roles, enabled, mod)).toBe(expected);
  });
});

describe("guards", () => {
  it("requireModuleAccess / requireRole throw AccessDeniedError", () => {
    expect(() => requireModuleAccess({ roles: ["store_keeper"], enabled_modules: enabled }, "lab_records")).toThrow(AccessDeniedError);
    expect(() => requireRole({ roles: ["store_keeper"] }, "tenant_admin")).toThrow(AccessDeniedError);
    expect(() => requireRole({ roles: ["store_keeper", "tenant_admin"] }, "tenant_admin")).not.toThrow();
  });
});
