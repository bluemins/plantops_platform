// The PlantOps support view: every write is refused (at the proxy and in the server), every page support opens is
// logged, and the owner's "Support access" page lists them in words.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as supportEntry } from "@/app/sso/support/route";
import { proxy } from "@/proxy";
import { createCustomer, CustomerInput, updateCustomer } from "@/server/customers";
import { cancelOrder, changeOrder, deliverOrder, undoDelivered } from "@/server/handling";
import { kit } from "@/server/kit";
import { exportCsv } from "@/server/list";
import { createOrder, OrderInput } from "@/server/orders";
import { saveRates } from "@/server/rates";
import { requirePageUser } from "@/server/session";
import { describeView, listSupportViews } from "@/server/support";
import { confirmUpload, previewUpload } from "@/server/upload";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const READ_ONLY = { status: 403, message: "PlantOps support view is read-only" };
const line = { sku_id: SKUS[1]!.id, quantity: 1, rate: "90" };

describe("every write is refused for support", () => {
  it("at the proxy: no POST / PATCH / PUT / DELETE reaches a route", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3005/sso/support?code=abc"));
    const value = decodeURIComponent(/=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")![1]!);
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3005${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}`, "content-type": "application/json" } });
    const id = crypto.randomUUID();
    for (const [m, path] of [
      ["POST", "/api/orders"],
      ["POST", `/api/orders/${id}/change`],
      ["POST", `/api/orders/${id}/deliver`],
      ["POST", `/api/orders/${id}/cancel`],
      ["POST", `/api/orders/${id}/undo-delivered`],
      ["PUT", "/api/rates"],
      ["POST", "/api/customers"],
      ["PATCH", `/api/customers/${id}`],
      ["POST", "/api/customers/upload/preview"],
      ["POST", "/api/customers/upload/confirm"],
      ["DELETE", `/api/orders/${id}`],
    ]) {
      expect((await proxy(req(m!, path!))).status, `${m} ${path}`).toBe(403);
    }
    // reading still works
    expect((await proxy(req("GET", "/"))).status).toBe(200);
    expect((await proxy(req("GET", `/o/${id}`))).status).toBe(200);
  });

  it("in the server, whatever the proxy did", async () => {
    const p = plant();
    const o = await createOrder(p.desk, OrderInput.parse({ request_key: `support-${Date.now()}`, customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" }, lines: [line] }));
    const { customer } = await createCustomer(p.owner, CustomerInput.parse({ name: "Maa Tarini Store", phone: "9123456780", place: "Bargarh" }));
    const s = p.support;
    const expected = { status: "pending" as const, version: 1 };
    for (const attempt of [
      () => createOrder(s, OrderInput.parse({ request_key: "support-try-1", customer: { phone: "9000000001", name: "A b", place: "C d" }, lines: [line] })),
      () => changeOrder(s, o.id, { expected, lines: [line] }),
      () => deliverOrder(s, o.id, { expected }),
      () => cancelOrder(s, o.id, { expected, reason: "nope" }),
      () => undoDelivered(s, o.id, { expected: { status: "delivered", version: 1 }, reason: "nope" }),
      () => saveRates(s, { rates: [] }),
      () => createCustomer(s, CustomerInput.parse({ name: "X y", phone: "9000000002", place: "Z z" })),
      () => updateCustomer(s, customer.id, { active: false }),
      () => previewUpload(s, { file_name: "", rows: [{ line: 2, name: "A b", phone: "9000000003", place: "C d" }] }),
      () => confirmUpload(s, { file_name: "", rows: [{ line: 2, name: "A b", phone: "9000000003", place: "C d" }], fingerprint: "a".repeat(64) }),
      () => exportCsv(s),
    ]) {
      expect(await refused(attempt)).toEqual(READ_ONLY);
    }
  });
});

describe("support page views", () => {
  it("every page support opens is logged; the owner sees them in words, newest first", async () => {
    const p = plant();
    const o = await createOrder(p.desk, OrderInput.parse({ request_key: `support-view-${Date.now()}`, customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" }, lines: [line] }));
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: p.tenantId, super_admin_id: crypto.randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      for (const path of ["/", `/o/${o.id}`, "/rates", "/customers", "/changes"]) await requirePageUser(path);
      // a plant user's own pages are not logged
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: p.tenantId, user_id: p.owner.userId, display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["order_capture"], login_at: Date.now(), checked_at: Date.now() } } as never);
      await requirePageUser("/");
    } finally {
      spy.mockRestore();
    }
    const views = await listSupportViews(p.owner);
    expect(views.map((v) => v.what).sort()).toEqual(["Recent changes", "order O-0001", "the customer list", "the order list", "the rates"]);
    for (const u of [p.desk, p.support, p.staff]) expect((await refused(() => listSupportViews(u))).status).toBe(403);
    expect(await listSupportViews(plant().owner)).toEqual([]);
  });

  it("paths in words", () => {
    expect(describeView("/o/x")).toBe("order");
    expect(describeView("/customers/upload")).toBe("the customer list");
    expect(describeView("/?tab=delivered")).toBe("the order list");
  });
});
