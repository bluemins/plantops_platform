// The owner's "Who can do what" grid (/admin/permissions): each cell follows the same rules the servers use.
import { describe, expect, it } from "vitest";
import { cellFor, gridModules } from "@/lib/permissions";

describe("a cell of the permissions grid", () => {
  it.each([
    [["tenant_admin"], [], "order_capture", { kind: "owner", label: "Owner", alerts: true }],
    [["tenant_admin", "plant_staff"], [], "lab_records", { kind: "owner", label: "Owner", alerts: true }],
    [["lab_technician", "lab_lead"], ["lab_records"], "lab_records", { kind: "lead", label: "Lab lead", alerts: true }],
    [["lab_technician"], [], "lab_records", { kind: "work", label: "Lab technician", alerts: false }],
    [["plant_staff"], [], "lab_records", null], // never Lab Records
    [["plant_staff"], ["floor_stock"], "floor_stock", { kind: "work", label: "Plant staff", alerts: true }],
    [["plant_staff", "store_keeper"], [], "floor_stock", { kind: "work", label: "Store keeper", alerts: false }],
    [["plant_staff"], [], "order_capture", { kind: "view", label: "View only, no amounts", alerts: false }],
    [["plant_staff", "order_desk"], ["order_capture"], "order_capture", { kind: "work", label: "Order desk", alerts: true }],
    [["store_keeper"], [], "order_capture", null],
    [["complaint_desk"], [], "complaint_box", { kind: "work", label: "Complaint desk", alerts: false }],
    [[], [], "floor_stock", null],
  ] as const)("%j (alerts %j) in %s", (roles, alerts, mod, expected) => {
    expect(cellFor(roles, alerts, mod)).toEqual(expected);
  });

  it("columns: only the switched-on modules, in the usual module order", () => {
    expect(gridModules(["order_capture", "floor_stock", "lab_records", "nonsense"])).toEqual(["lab_records", "floor_stock", "order_capture"]);
  });
});
