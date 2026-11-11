// Order Capture Phase 1 (docs/ORDER_CAPTURE_PHASE_PLAN.md): the platform knows the module and the "Order desk" role,
// plant staff are kept out of it, and its notification kinds and alert tick boxes work like other modules'.
import { beforeAll, describe, expect, it } from "vitest";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import { sha256 } from "@/server/crypto";
import { ROLE_LABELS } from "@/lib/api";
import { MODULES, roleLine } from "@/lib/modules";
import { summaryViewFor } from "@/server/summary";
import { MODULE_IDS, PLANT_STAFF_MODULES, getsAlertsIn, pageViewIn, roleWorksIn, viewOnlyIn } from "@plantops/types";
import { canAccessModule } from "@plantops/auth";
import { cellFor } from "@/lib/permissions";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const OC_SECRET = "order-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";

let A: Awaited<ReturnType<typeof makePlant>>;
let desk: Awaited<ReturnType<typeof makeStaff>>;
let general: Awaited<ReturnType<typeof makeStaff>>;
let keeper: Awaited<ReturnType<typeof makeStaff>>;

const handoff = (cookie: string, module: string) => call(handoffRoute.POST as Handler, { cookie, body: { module } });
const tick = (cookie: string, userId: string, alert_modules: string[]) =>
  call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie, params: { id: userId }, body: { alert_modules } });
const settings = async (cookie: string) =>
  (await call(settingsRoute.GET as Handler, { cookie })).body as { kind: string; urgent: boolean; bell_only: boolean }[];

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://orders.example.test', client_secret_hash = $1 where id = 'order_capture'", [sha256(OC_SECRET)]);
  // Floor Stock too (plant staff open it here): set up in this file, not left to whichever test file ran before
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1, status = 'active' where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "order_capture"] });
  desk = await makeStaff(A, "desk", ["order_desk"]);
  general = await makeStaff(A, "general", ["plant_staff"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
});

describe("module and role", () => {
  it("the Order desk role and the tile text exist", () => {
    expect(ROLE_LABELS.order_desk).toBe("Order desk");
    expect(MODULES.order_capture).toMatchObject({ label: "Sales", staff: "Take an order", setup: { path: "/rates" } });
  });

  it("Order desk opens Order Capture; plant staff open it view-only; a store keeper opens it for purchases received only", async () => {
    expect((await handoff(desk.cookie, "order_capture")).status).toBe(200);
    expect((await handoff(desk.cookie, "floor_stock")).status).toBe(403);
    expect((await handoff(general.cookie, "order_capture")).status).toBe(200); // view-only (the module hides amounts)
    expect((await handoff(general.cookie, "floor_stock")).status).toBe(403); // plant staff alone: not Floor Stock
    expect((await handoff(keeper.cookie, "order_capture")).status).toBe(200); // purchases received only (P5, owner 2026-11-10)
  });

  it("only when the plant's plan includes it", async () => {
    const Q = await makePlant({ modules: ["floor_stock"] });
    const noPlan = await makeStaff(Q, "desk", ["order_desk"]);
    expect((await handoff(noPlan.cookie, "order_capture")).status).toBe(403);
  });

  it("an Order-desk-only user lands straight in Order Capture; the owner sees its tile; plant staff too (view-only)", async () => {
    const mine = await call(launcherRoute.GET as Handler, { cookie: desk.cookie });
    expect(mine.body.landing).toBe("order_capture");
    expect(mine.body.tiles).toEqual([{ module: "order_capture", state: "open", view: "staff" }]);
    const owner = await call(launcherRoute.GET as Handler, { cookie: A.adminCookie });
    expect(owner.body.tiles.find((t: { module: string }) => t.module === "order_capture")).toMatchObject({ state: "open", view: "owner" });
    const staff = await call(launcherRoute.GET as Handler, { cookie: general.cookie });
    expect(staff.body.tiles.map((t: { module: string }) => t.module)).toEqual(["order_capture"]);
    expect(staff.body.landing).toBe("order_capture");
  });
});

describe("alerts and notification settings", () => {
  it("the 'Gets alerts' tick box offers Order Capture to Order desk only, never to plant staff", async () => {
    expect((await tick(A.adminCookie, desk.userId, ["order_capture"])).body.alert_modules).toEqual(["order_capture"]);
    expect((await tick(A.adminCookie, general.userId, ["order_capture"])).status).toBe(400); // view-only: never its alerts (they carry amounts)
    expect((await tick(A.adminCookie, keeper.userId, ["order_capture"])).status).toBe(400); // doesn't work in it
    const Q = await makePlant({ modules: ["floor_stock"] });
    const off = await makeStaff(Q, "desk", ["order_desk"]);
    expect((await tick(Q.adminCookie, off.userId, ["order_capture"])).status).toBe(400); // not switched on
  });

  it("the settings page lists the Order Capture kinds (WhatsApp-bot alerts, reminders stopped, sales ledger, purchases, cash book); delivered, cancelled, note, the ledger and purchase ones are bell only, none urgent", async () => {
    const list = (await settings(desk.cookie)).filter((s) => s.kind.startsWith("order_capture."));
    expect(list.map((s) => s.kind).sort()).toEqual([
      "order_capture.bill_cancelled", "order_capture.cancelled", "order_capture.cash_closed", "order_capture.cash_expense", "order_capture.cash_not_closed", "order_capture.cash_short",
      "order_capture.delivered", "order_capture.drop_push_failed", "order_capture.drop_redeem", "order_capture.feedback_low", "order_capture.handoff",
      "order_capture.new", "order_capture.note", "order_capture.payment", "order_capture.payment_cancelled", "order_capture.purchase_bill", "order_capture.purchase_cancelled",
      "order_capture.reminder_failed", "order_capture.vendor_payment",
    ]);
    expect(list.filter((s) => s.bell_only).map((s) => s.kind).sort()).toEqual([
      "order_capture.bill_cancelled", "order_capture.cancelled", "order_capture.cash_closed", "order_capture.delivered", "order_capture.drop_push_failed", "order_capture.note", "order_capture.payment", "order_capture.payment_cancelled",
      "order_capture.purchase_bill", "order_capture.purchase_cancelled", "order_capture.vendor_payment",
    ]);
    expect(list.some((s) => s.urgent)).toBe(false);
    expect((await settings(desk.cookie)).every((s) => s.kind.startsWith("order_capture."))).toBe(true);
    expect((await settings(A.adminCookie)).some((s) => s.kind.startsWith("order_capture."))).toBe(true);
  });

  it("plant staff and an owner of a plant without Order Capture see none of its kinds", async () => {
    expect((await settings(general.cookie)).some((s) => s.kind.startsWith("order_capture."))).toBe(false);
    const Q = await makePlant({ modules: ["floor_stock"] });
    expect((await settings(Q.adminCookie)).some((s) => s.kind.startsWith("order_capture."))).toBe(false);
  });
});

// Phone calls Phase 1 (docs/CALLS_PHASE_PLAN.md): Delivery staff work in Order Capture's Calls tab only, never get its
// order alerts (they carry amounts), get only "Customer called", and see the desk numbers on their tile.
describe("Delivery staff", () => {
  let delivery: Awaited<ReturnType<typeof makeStaff>>;
  beforeAll(async () => {
    delivery = await makeStaff(A, "delivery", ["delivery_staff"]);
  });

  it("the role exists, works in Order Capture only, is not view-only and never gets alerts by a tick", async () => {
    expect(ROLE_LABELS.delivery_staff).toBe("Delivery staff");
    expect((await asOwner("select module_id, label from platform.roles where id = 'delivery_staff'")).rows).toEqual([{ module_id: "order_capture", label: "Delivery staff" }]);
    for (const m of MODULE_IDS) expect(roleWorksIn("delivery_staff", m)).toBe(m === "order_capture");
    expect(viewOnlyIn(["delivery_staff"], "order_capture")).toBe(false);
    for (const m of MODULE_IDS) expect(getsAlertsIn("delivery_staff", m)).toBe(false);
    expect(getsAlertsIn("order_desk", "order_capture")).toBe(true);
    expect(PLANT_STAFF_MODULES).toEqual(["attendance_salary"]); // plant staff unchanged
    expect(viewOnlyIn(["plant_staff"], "order_capture")).toBe(true);
  });

  it("opens Order Capture only and lands straight in it, tile 'Calls' with the desk numbers", async () => {
    expect((await handoff(delivery.cookie, "order_capture")).status).toBe(200);
    expect((await handoff(delivery.cookie, "floor_stock")).status).toBe(403);
    const mine = await call(launcherRoute.GET as Handler, { cookie: delivery.cookie });
    expect(mine.body.landing).toBe("order_capture");
    expect(mine.body.tiles).toHaveLength(1);
    expect(mine.body.tiles[0]).toMatchObject({ module: "order_capture", state: "open", view: "staff", subtitle: "Calls" });
    expect(roleLine("order_capture", ["delivery_staff"])).toBe("Calls");
    expect(summaryViewFor(["delivery_staff"], "order_capture")).toBe("desk"); // the numbers request for their tile
    expect(summaryViewFor(["order_desk"], "order_capture")).toBe("staff");
  });

  it("the 'Gets alerts' tick for Order Capture is refused for them (400)", async () => {
    expect((await tick(A.adminCookie, delivery.userId, ["order_capture"])).status).toBe(400);
  });

  it("'Customer called' is in Delivery staff's settings only, never the owner's or Order desk's", async () => {
    expect((await settings(delivery.cookie)).map((s) => s.kind)).toEqual(["order_capture.call"]);
    expect((await settings(delivery.cookie))[0]).toMatchObject({ urgent: false, bell_only: false });
    expect((await settings(desk.cookie)).some((s) => s.kind === "order_capture.call")).toBe(false);
    expect((await settings(A.adminCookie)).some((s) => s.kind === "order_capture.call")).toBe(false);
  });
});

// Purchases P5 (docs/PURCHASES_PHASE_PLAN.md, owner 2026-11-10): a Store keeper opens Sales for "Purchases received" only
// (no prices), never works there and never gets its alerts; with an order role the order role wins the tile.
describe("Store keeper in Sales (purchases received)", () => {
  it("opens Sales for one page only; works in Floor Stock; never Sales alerts", async () => {
    expect(pageViewIn(["store_keeper"], "order_capture")).toBe(true);
    expect(pageViewIn(["store_keeper"], "floor_stock")).toBe(false);
    expect(pageViewIn(["store_keeper", "order_desk"], "order_capture")).toBe(false); // the order role says more
    expect(pageViewIn(["store_keeper", "plant_staff"], "order_capture")).toBe(false); // the orders view says more
    expect(pageViewIn(["store_keeper", "tenant_admin"], "order_capture")).toBe(false);
    expect(roleWorksIn("store_keeper", "order_capture")).toBe(false);
    expect(getsAlertsIn("store_keeper", "order_capture")).toBe(false);
    expect(canAccessModule(["store_keeper"], ["floor_stock", "order_capture"], "order_capture")).toBe(true);
    expect(canAccessModule(["store_keeper"], ["floor_stock"], "order_capture")).toBe(false); // Sales not switched on
  });

  it("tile 'Purchases received' with the purchases numbers; the Permissions screen says so", async () => {
    const keeper = await makeStaff(A, "keeperp", ["store_keeper"]);
    expect((await handoff(keeper.cookie, "order_capture")).status).toBe(200);
    const mine = await call(launcherRoute.GET as Handler, { cookie: keeper.cookie });
    expect(mine.body.tiles.find((t: { module: string }) => t.module === "order_capture")).toMatchObject({ state: "open", view: "staff", subtitle: "Purchases received" });
    expect(summaryViewFor(["store_keeper"], "order_capture")).toBe("purchases");
    expect(summaryViewFor(["store_keeper", "order_desk"], "order_capture")).toBe("staff");
    expect(roleLine("order_capture", ["store_keeper", "order_desk"])).toBeNull();
    expect(cellFor(["store_keeper"], [], "order_capture")).toEqual({ kind: "view", label: "Purchases received (no prices)", alerts: false });
  });
});
