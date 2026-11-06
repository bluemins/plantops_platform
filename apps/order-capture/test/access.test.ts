// The one access table (src/server/access.ts) for every kind of person, exactly as the plan's "Who uses it" says.
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { roleLabel, whoFor } from "@/server/session";
import { ocUser, plant, refused } from "./helpers";

const p = plant();
const people = { owner: p.owner, desk: p.desk, staff: p.staff, keeper: p.keeper, support: p.support };

// [action, owner, Order desk, plant staff, store keeper, support]
const TABLE: [Action, boolean, boolean, boolean, boolean, boolean][] = [
  ["read", true, true, true, false, true],
  ["see_amounts", true, true, false, false, true],
  ["copy_list", true, true, true, false, false],
  ["view_customers", true, true, false, false, true],
  ["enter", true, true, false, false, false],
  ["customers", true, true, false, false, false],
  ["deliver", true, true, false, false, false],
  ["cancel", true, true, false, false, false],
  ["undo_delivered", true, false, false, false, false],
  ["add_note", true, true, false, false, false],
  ["rates", true, false, false, false, false],
  ["view_rates", true, false, false, false, true],
  ["customer_upload", true, false, false, false, false],
  ["view_changes", true, false, false, false, true],
  ["export", true, false, false, false, false],
  ["pending_summary", true, false, false, false, false],
  ["support_log", true, false, false, false, false],
  ["consent", true, true, false, false, false],
  ["reminder_pilot", true, false, false, false, true],
  // phone calls (docs/CALLS_PHASE_PLAN.md "Who uses it")
  ["calls_view", true, true, false, false, true],
  ["calls_attend", true, true, false, false, false],
  ["calls_numbers", true, false, false, false, true],
  ["view_ignored", true, false, false, false, true],
  ["calls_ignore", true, false, false, false, false],
  ["zoho_import", true, false, false, false, false],
  ["zoho_match", true, false, false, false, false],
  ["ledger_view", true, true, false, false, true],
  ["bill_make", true, true, false, false, false],
  ["bill_cancel", true, false, false, false, false],
  ["payment_receive", true, true, false, false, false],
  ["payment_cancel", true, false, false, false, false],
  ["ledger_export", true, false, false, false, false],
  ["ledger_totals", true, false, false, false, true],
];

describe("who is who", () => {
  it("owner wins; Order desk is desk; plant staff are viewers; a store keeper or a complaint desk have no rights", () => {
    expect(whoFor(["tenant_admin", "order_desk"])).toBe("owner");
    expect(whoFor(["tenant_admin"])).toBe("owner");
    expect(whoFor(["order_desk"])).toBe("desk");
    expect(whoFor(["plant_staff", "order_desk"])).toBe("desk");
    expect(whoFor(["store_keeper", "order_desk"])).toBe("desk");
    expect(whoFor(["plant_staff"])).toBe("viewer"); // view only, no amounts (owner, 2026-10-14)
    expect(whoFor(["plant_staff", "store_keeper"])).toBe("viewer");
    expect(whoFor(["tenant_admin", "plant_staff"])).toBe("owner");
    expect(whoFor(["order_viewer"])).toBe("viewer"); // Order viewer role (v0.27.0): same view as plant staff
    expect(whoFor(["order_viewer", "order_desk"])).toBe("desk");
    expect(whoFor(["stock_viewer"])).toBeNull(); // another module's viewer
    expect(whoFor(["delivery_staff"])).toBe("delivery"); // Calls only (docs/CALLS_PHASE_PLAN.md)
    expect(whoFor(["delivery_staff", "plant_staff"])).toBe("delivery"); // also with Plant staff: Calls only (owner, 2026-11-04)
    expect(whoFor(["delivery_staff", "order_viewer"])).toBe("delivery");
    expect(whoFor(["delivery_staff", "order_desk"])).toBe("desk");
    expect(whoFor(["delivery_staff", "tenant_admin"])).toBe("owner");
    expect(whoFor(["store_keeper"])).toBeNull();
    expect(whoFor(["complaint_desk"])).toBeNull();
    expect(whoFor(["lab_technician", "lab_lead"])).toBeNull();
    expect(p.support.who).toBe("support");
  });

  it("the header says Owner / Order desk / View only / Read-only", () => {
    expect([p.owner, p.desk, p.staff, p.support].map(roleLabel)).toEqual(["Owner", "Order desk", "View only", "Read-only"]);
  });
});

describe("the access table", () => {
  it("covers every action", () => {
    expect(TABLE.map((r) => r[0]).sort()).toEqual(Object.keys(ACCESS).sort());
  });

  it.each(TABLE)("%s: owner %s, Order desk %s, plant staff %s, store keeper %s, support %s", (action, ...expected) => {
    expect(Object.values(people).map((u) => can(u, action))).toEqual(expected);
  });

  it.each(TABLE)("%s: Delivery staff may only see Calls and mark attended", (action) => {
    expect(can(ocUser(p.owner.tenantId, ["delivery_staff"], "Raju"), action)).toBe(action === "calls_view" || action === "calls_attend");
  });

  it("Delivery staff are told they work in Calls only; the header says Delivery staff", async () => {
    const raju = ocUser(p.owner.tenantId, ["delivery_staff"], "Raju");
    expect(await refused(() => requireAccess(raju, "read"))).toEqual({ status: 403, message: "Delivery staff work in Calls only." });
    expect(roleLabel(raju)).toBe("Delivery staff");
  });

  it.each(TABLE)("%s: an Order viewer may do exactly what plant staff may", (action, _o, _d, staff) => {
    expect(can(ocUser(p.owner.tenantId, ["order_viewer"], "Vimal"), action)).toBe(staff);
  });

  it("refusals say why in plain words", async () => {
    expect(await refused(() => requireAccess(p.support, "enter"))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect(await refused(() => requireAccess(p.desk, "undo_delivered"))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect(await refused(() => requireAccess(p.staff, "deliver"))).toEqual({ status: 403, message: "You can view orders only. Order desk or the owner does this." });
    expect(await refused(() => requireAccess(p.keeper, "read"))).toEqual({ status: 403, message: "You don't have access to Order Capture" });
    expect(() => requireAccess(p.owner, "export")).not.toThrow();
  });

  it("plant staff are refused every write, the customer list and amounts", async () => {
    for (const action of ["enter", "customers", "deliver", "cancel", "undo_delivered", "rates", "view_rates", "customer_upload", "export", "pending_summary", "view_customers", "see_amounts"] as Action[]) {
      expect((await refused(() => requireAccess(p.staff, action))).status, action).toBe(403);
    }
  });

  it("support is refused every write", async () => {
    for (const action of ["enter", "customers", "deliver", "cancel", "undo_delivered", "rates", "customer_upload", "export"] as Action[]) {
      expect((await refused(() => requireAccess(p.support, action))).message, action).toBe("PlantOps support view is read-only");
    }
  });
});
