// The owner's "Who can do what" grid (/admin/permissions): each cell follows the same rules the servers use.
import { describe, expect, it } from "vitest";
import { alertChoices, cellFor, gridModules, roleChoices } from "@/lib/permissions";
import { roleLine } from "@/lib/modules";

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
    expect(c.map((x) => x.role)).toEqual(["tenant_admin", "lab_technician", "lab_lead", "store_keeper", "order_desk", "plant_staff", "stock_viewer", "order_viewer"]);
    expect(c.find((x) => x.role === "stock_viewer")).toMatchObject({ hint: "Floor Stock, view only: the sections the owner picks", off: false });
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
    expect(roleChoices([], []).map((x) => x.role)).toHaveLength(15); // + Office staff, Supervisor (0015), HR desk (0016), the three viewers (0018)
    expect(roleChoices([], []).every((x) => !x.off)).toBe(true);
  });
});

describe("view-only roles (v0.27.0)", () => {
  it("a Stock viewer is 'View only, chosen sections', with 🔔 only when ticked", () => {
    expect(cellFor(["stock_viewer"], [], "floor_stock")).toEqual({ kind: "view", label: "View only, chosen sections", alerts: false });
    expect(cellFor(["stock_viewer"], ["floor_stock"], "floor_stock")).toEqual({ kind: "view", label: "View only, chosen sections", alerts: true });
    expect(cellFor(["stock_viewer"], [], "document_store")).toBeNull();
    expect(cellFor(["stock_viewer", "store_keeper"], [], "floor_stock")?.kind).toBe("work"); // the working role wins
  });

  it("an Order viewer is never shown with alerts; a Document viewer can be", () => {
    expect(cellFor(["order_viewer"], ["order_capture"], "order_capture")).toEqual({ kind: "view", label: "View only, no amounts", alerts: false });
    expect(cellFor(["document_viewer"], ["document_store"], "document_store")).toEqual({ kind: "view", label: "View only", alerts: true });
  });

  it("'Gets alerts' offers Floor Stock and Document Store to their viewers, never Order Capture", () => {
    const on = ["floor_stock", "document_store", "order_capture"];
    expect(alertChoices(on, ["stock_viewer"])).toEqual(["floor_stock"]);
    expect(alertChoices(on, ["document_viewer"])).toEqual(["document_store"]);
    expect(alertChoices(on, ["order_viewer"])).toEqual([]);
  });
});

describe("launcher tile line for view-only people (v0.27.0)", () => {
  it("'View stock' / 'View documents' / 'View orders'; a working role keeps its own line", () => {
    expect(roleLine("floor_stock", ["stock_viewer"])).toBe("View stock");
    expect(roleLine("floor_stock", ["stock_viewer", "store_keeper"])).toBeNull();
    expect(roleLine("document_store", ["document_viewer"])).toBe("View documents");
    expect(roleLine("order_capture", ["order_viewer"])).toBe("View orders");
    expect(roleLine("order_capture", ["plant_staff"])).toBe("View orders");
    expect(roleLine("attendance_salary", ["office_staff"])).toBe("Attendance desk");
  });
});
