// The owner's "Who can do what" grid (/admin/permissions): each cell follows the same rules the servers use.
import { describe, expect, it } from "vitest";
import { cellFor, gridModules, roleChoices } from "@/lib/permissions";

describe("a cell of the permissions grid", () => {
  it.each([
    [["tenant_admin"], [], "order_capture", { kind: "owner", label: "Owner", alerts: true }],
    [["tenant_admin", "plant_staff"], [], "lab_records", { kind: "owner", label: "Owner", alerts: true }],
    [["lab_technician", "lab_lead"], ["lab_records"], "lab_records", { kind: "lead", label: "Lab lead", alerts: true }],
    [["lab_technician"], [], "lab_records", { kind: "work", label: "Lab technician", alerts: false }],
    [["plant_staff"], [], "lab_records", null], // never Lab Records
    [["plant_staff"], ["floor_stock"], "floor_stock", null], // plant staff = employee: not Floor Stock
    [["plant_staff"], [], "attendance_salary", { kind: "work", label: "Plant staff", alerts: false }],
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

describe("role buttons on Add / Edit user", () => {
  const plant = ["lab_records", "floor_stock", "order_capture"];

  it("offers owner, plant staff and the roles of switched-on modules, each with its module", () => {
    const c = roleChoices(plant, []);
    expect(c.map((x) => x.role)).toEqual(["tenant_admin", "lab_technician", "lab_lead", "store_keeper", "order_desk", "plant_staff"]);
    expect(c.find((x) => x.role === "store_keeper")).toMatchObject({ hint: "Floor Stock", off: false });
    expect(c.find((x) => x.role === "lab_lead")?.hint).toBe("Lab Records");
    expect(c.some((x) => x.role === "document_keeper" || x.role === "maintenance_technician")).toBe(false);
  });

  it("Plant staff says what it opens here, from the servers' rules", () => {
    expect(roleChoices(plant, []).find((x) => x.role === "plant_staff")?.hint).toBe("Employee · Order Capture (view only, no amounts)");
    expect(roleChoices(["document_store", "complaint_box"], []).find((x) => x.role === "plant_staff")?.hint).toBe("Employee · opens no module here yet");
    expect(roleChoices(["floor_stock", "attendance_salary"], []).find((x) => x.role === "plant_staff")?.hint).toBe("Employee · Attendance & Salary");
  });

  it("a held role for a module that is off stays visible (to remove it), marked off", () => {
    expect(roleChoices(plant, ["document_keeper"]).find((x) => x.role === "document_keeper")).toMatchObject({ hint: "Document Store · not switched on", off: true });
  });

  it("offers every role when the module list did not load", () => {
    expect(roleChoices([], []).map((x) => x.role)).toHaveLength(9);
    expect(roleChoices([], []).every((x) => !x.off)).toBe(true);
  });
});
