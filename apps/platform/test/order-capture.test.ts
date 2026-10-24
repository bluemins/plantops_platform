// Order Capture Phase 1 (docs/ORDER_CAPTURE_PHASE_PLAN.md): the platform knows the module and the "Order desk" role,
// plant staff are kept out of it, and its notification kinds and alert tick boxes work like other modules'.
import { beforeAll, describe, expect, it } from "vitest";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import { sha256 } from "@/server/crypto";
import { ROLE_LABELS } from "@/lib/api";
import { MODULES } from "@/lib/modules";
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
    expect(MODULES.order_capture).toMatchObject({ label: "Order Capture", staff: "Take an order", setup: { path: "/rates" } });
  });

  it("Order desk opens Order Capture; plant staff open it view-only; a store keeper doesn't", async () => {
    expect((await handoff(desk.cookie, "order_capture")).status).toBe(200);
    expect((await handoff(desk.cookie, "floor_stock")).status).toBe(403);
    expect((await handoff(general.cookie, "order_capture")).status).toBe(200); // view-only (the module hides amounts)
    expect((await handoff(general.cookie, "floor_stock")).status).toBe(403); // plant staff alone: not Floor Stock
    expect((await handoff(keeper.cookie, "order_capture")).status).toBe(403);
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

  it("the settings page lists the seven Order Capture kinds (two WhatsApp-bot alerts, reminders stopped); delivered, cancelled and note are bell only, none urgent", async () => {
    const list = (await settings(desk.cookie)).filter((s) => s.kind.startsWith("order_capture."));
    expect(list.map((s) => s.kind).sort()).toEqual(["order_capture.cancelled", "order_capture.delivered", "order_capture.feedback_low", "order_capture.handoff", "order_capture.new", "order_capture.note", "order_capture.reminder_failed"]);
    expect(list.filter((s) => s.bell_only).map((s) => s.kind).sort()).toEqual(["order_capture.cancelled", "order_capture.delivered", "order_capture.note"]);
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
