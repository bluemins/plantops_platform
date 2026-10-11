// Phase 7: the PlantOps support view. Every write is refused (at the proxy and in the server), every page and file
// support opens is logged, and the owner's "Support access" page lists them in words.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as supportEntry } from "@/app/sso/support/route";
import { proxy } from "@/proxy";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { readComplaintFile, uploadComplaintFile } from "@/server/files";
import { addNote, changeStatus } from "@/server/followup";
import { exportCsv } from "@/server/inbox";
import { applyStarter, createItem, reorderItems, updateItem } from "@/server/items";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { describeView, listSupportViews } from "@/server/support";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { JPEG, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const fields = { customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap" };
const READ_ONLY = { status: 403, message: "PlantOps support view is read-only" };

describe("every write is refused for support", () => {
  it("at the proxy: no POST / PATCH / PUT / DELETE reaches a route", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3004/sso/support?code=abc"));
    const value = decodeURIComponent(/plantops_complaint_box_support=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")![1]!);
    const req = (method: string, path: string) => new NextRequest(`http://localhost:3004${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    const id = randomUUID();
    for (const [m, path] of [
      ["POST", "/api/complaints"],
      ["POST", `/api/complaints/${id}/files`],
      ["POST", `/api/complaints/${id}/notes`],
      ["POST", `/api/complaints/${id}/status`],
      ["POST", "/api/items"],
      ["PATCH", `/api/items/${id}`],
      ["POST", "/api/items/order"],
      ["POST", "/api/items/starter"],
      ["DELETE", `/api/items/${id}`],
      ["PUT", "/api/items/order"],
    ]) {
      expect((await proxy(req(m!, path!))).status, `${m} ${path}`).toBe(403);
    }
    for (const path of ["/", `/c/${id}`, "/items", "/changes"]) expect((await proxy(req("GET", path))).status, path).toBe(200);
  });

  it("in the server too, for every write (if a request ever got past the proxy)", async () => {
    const p = plant();
    const item = await createItem(p.owner, { name: "Jar" });
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id: item.id }));
    const s = p.support;
    const writes: [string, () => Promise<unknown>][] = [
      ["log a complaint", () => createComplaint(s, ComplaintInput.parse({ ...fields, item_id: item.id }))],
      ["add a photo", () => uploadComplaintFile(s, c.id, JPEG)],
      ["add a note", () => addNote(s, c.id, { text: "x" })],
      ["set in progress", () => changeStatus(s, c.id, { to: "in_progress", expected: "open" })],
      ["resolve", () => changeStatus(s, c.id, { to: "resolved", expected: "open", text: "Replaced" })],
      ["add an item", () => createItem(s, { name: "X" })],
      ["rename an item", () => updateItem(s, item.id, { name: "Y" })],
      ["re-order items", () => reorderItems(s, { ids: [item.id] })],
      ["starter list", () => applyStarter(s, { keys: ["other"] })],
    ];
    for (const [what, fn] of writes) expect(await refused(fn), what).toEqual(READ_ONLY);
    expect((await refused(() => exportCsv(s))).status).toBe(403);
    expect((await refused(() => listSupportViews(s))).status).toBe(403);
  });
});

describe("what support opened is logged for the owner", () => {
  it("pages and files; a plant user's views are not; the owner sees them in words", async () => {
    const p = plant();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id: (await createItem(p.owner, { name: "Jar" })).id }));
    const f = await uploadComplaintFile(p.desk, c.id, JPEG);
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: p.tenantId, super_admin_id: p.support.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never);
      for (const path of ["/", `/c/${c.id}`, "/items", "/changes"]) await requirePageUser(path);
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: p.tenantId, user_id: p.owner.userId, display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never);
      await requirePageUser("/");
      await requirePageUser(`/c/${c.id}`);
    } finally {
      spy.mockRestore();
    }
    await readComplaintFile(p.support, f.id);
    await readComplaintFile(p.owner, f.id);
    const views = (await listSupportViews(p.owner)).map((v) => v.what);
    expect(views.sort()).toEqual(["Recent changes", "a photo or video", "complaint C-0001", "the complaint list", "the item list"].sort());
    expect((await refused(() => listSupportViews(p.desk))).status).toBe(403);
    expect(await listSupportViews(plant().owner)).toEqual([]); // another plant sees none of them
  });

  it("describes each kind of page", () => {
    expect(describeView("/")).toBe("the complaint list");
    expect(describeView("/?status=all&q=ram")).toBe("the complaint list");
    expect(describeView("/c/00000000-0000-0000-0000-000000000000", new Map([["00000000-0000-0000-0000-000000000000", "C-0007"]]))).toBe("complaint C-0007");
    expect(describeView(`/files/${randomUUID()}`)).toBe("a photo or video");
  });
});
