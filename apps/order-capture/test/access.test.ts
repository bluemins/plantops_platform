// The one access table (src/server/access.ts) for every kind of person, exactly as the plan's "Who uses it" says.
import { describe, expect, it } from "vitest";
import { ACCESS, can, requireAccess, type Action } from "@/server/access";
import { roleLabel, whoFor } from "@/server/session";
import { plant, refused } from "./helpers";

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
  ["rates", true, false, false, false, false],
  ["view_rates", true, false, false, false, true],
  ["customer_upload", true, false, false, false, false],
  ["view_changes", true, false, false, false, true],
  ["export", true, false, false, false, false],
  ["pending_summary", true, false, false, false, false],
  ["support_log", true, false, false, false, false],
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
