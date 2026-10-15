import { describe, expect, it } from "vitest";
import { roleWorksIn, viewOnlyIn, type ModuleId, type RoleId } from "@plantops/types";
import { AccessDeniedError, canAccessModule, requireModuleAccess, requireRole } from "../src";

const enabled: ModuleId[] = ["lab_records", "floor_stock", "complaint_box", "order_capture", "attendance_salary"];

describe("canAccessModule", () => {
  it.each<[RoleId[], ModuleId, boolean]>([
    [["lab_technician"], "lab_records", true],
    [["lab_technician"], "floor_stock", false],
    [["lab_lead"], "lab_records", true],
    [["lab_lead"], "floor_stock", false],
    [["store_keeper"], "floor_stock", true],
    [["lab_technician", "store_keeper"], "floor_stock", true],
    [["maintenance_technician"], "preventive_mgmt", false], // role ok, module not enabled
    [["tenant_admin"], "lab_records", true],
    [["tenant_admin"], "amc", false], // owner still needs the module in the plan
    [[], "lab_records", false],
    [["plant_staff"], "floor_stock", false], // plant staff = employee (owner, 2026-10-15): not Floor Stock...
    [["plant_staff"], "attendance_salary", true], // ...but Attendance & Salary
    [["plant_staff", "store_keeper"], "floor_stock", true], // the module's own role opens it
    [["plant_staff"], "lab_records", false],
    [["plant_staff"], "preventive_mgmt", false], // module not enabled
    [["plant_staff", "lab_technician"], "lab_records", true], // a lab role still opens it
    [["complaint_desk"], "complaint_box", true],
    [["complaint_desk"], "floor_stock", false],
    [["complaint_desk"], "lab_records", false],
    [["plant_staff"], "complaint_box", false], // Complaint Box needs Complaint desk
    [["store_keeper"], "complaint_box", false],
    [["order_desk"], "order_capture", true],
    [["order_desk"], "floor_stock", false],
    [["plant_staff"], "order_capture", true], // plant staff open Order Capture view-only (no amounts, no writes)
    [["plant_staff", "order_desk"], "order_capture", true], // Order desk still opens it
    [["store_keeper"], "order_capture", false],
    [["complaint_desk"], "order_capture", false],
    [["tenant_admin"], "order_capture", true],
  ])("%j -> %s = %s", (roles, mod, expected) => {
    expect(canAccessModule(roles, enabled, mod)).toBe(expected);
  });
});

describe("roleWorksIn", () => {
  it("Order desk works in Order Capture; plant staff and owners don't (owners get the owner view)", () => {
    expect(roleWorksIn("order_desk", "order_capture")).toBe(true);
    expect(roleWorksIn("order_desk", "complaint_box")).toBe(false);
    expect(roleWorksIn("plant_staff", "order_capture")).toBe(false);
    expect(roleWorksIn("plant_staff", "complaint_box")).toBe(false);
    expect(roleWorksIn("plant_staff", "document_store")).toBe(false);
    expect(roleWorksIn("plant_staff", "attendance_salary")).toBe(true);
    expect(roleWorksIn("tenant_admin", "order_capture")).toBe(false);
  });
});

describe("viewOnlyIn", () => {
  it("plant staff without a working role have the read-only view of Order Capture only", () => {
    expect(viewOnlyIn(["plant_staff"], "order_capture")).toBe(true);
    expect(viewOnlyIn(["plant_staff", "store_keeper"], "order_capture")).toBe(true);
    expect(viewOnlyIn(["plant_staff", "order_desk"], "order_capture")).toBe(false); // Order desk works there
    expect(viewOnlyIn(["tenant_admin", "plant_staff"], "order_capture")).toBe(false); // the owner sees everything
    expect(viewOnlyIn(["plant_staff"], "lab_records")).toBe(false); // still excluded
    expect(viewOnlyIn(["plant_staff"], "floor_stock")).toBe(false); // not there at all
    expect(viewOnlyIn(["store_keeper"], "order_capture")).toBe(false);
  });
});

describe("guards", () => {
  it("requireModuleAccess / requireRole throw AccessDeniedError", () => {
    expect(() => requireModuleAccess({ roles: ["store_keeper"], enabled_modules: enabled }, "lab_records")).toThrow(AccessDeniedError);
    expect(() => requireRole({ roles: ["store_keeper"] }, "tenant_admin")).toThrow(AccessDeniedError);
    expect(() => requireRole({ roles: ["store_keeper", "tenant_admin"] }, "tenant_admin")).not.toThrow();
  });
});
