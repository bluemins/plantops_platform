// Phase 5: following a complaint up. Status rules per role, the required texts (a quick pick alone is enough), 409
// when someone changed it first, event + status in one transaction, notes in any status with their photos, history
// order, and the owner's CSV.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as exportRoute } from "@/app/api/export/route";
import { POST as statusRoute } from "@/app/api/complaints/[id]/status/route";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { uploadComplaintFile } from "@/server/files";
import { addNote, changeStatus, NoteInput, QUICK_PICKS, StatusInput } from "@/server/followup";
import { exportCsv, getComplaint } from "@/server/inbox";
import { createItem, recentChanges } from "@/server/items";
import { kit } from "@/server/kit";
import type { CbUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, cbUser, JPEG, MP4, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

type P = ReturnType<typeof plant>;
async function setup(over: Record<string, string> = {}) {
  const p = plant();
  const item = await createItem(p.owner, { name: "20 L jar" });
  const c = await createComplaint(p.desk, ComplaintInput.parse({ customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap", item_id: item.id, ...over }));
  return { p, c };
}
const status = async (id: string) => (await asOwner<{ status: string }>("select status from complaint_box.complaints where id = $1", [id])).rows[0]!.status;
const events = async (id: string) => (await asOwner<{ kind: string; text: string | null }>("select kind, text from complaint_box.complaint_events where complaint_id = $1 order by created_at, id", [id])).rows;

describe("status rules per role", () => {
  it("staff (complaint desk) set In progress; only the owner resolves and reopens", async () => {
    const { p, c } = await setup();
    expect(await refused(() => changeStatus(p.desk, c.id, { to: "resolved", expected: "open", text: "Replaced" }))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect((await changeStatus(p.staff, c.id, { to: "in_progress", expected: "open" })).status).toBe("in_progress");
    expect((await refused(() => changeStatus(p.staff, c.id, { to: "resolved", expected: "in_progress", text: "Replaced" }))).status).toBe(403);
    expect((await changeStatus(p.owner, c.id, { to: "resolved", expected: "in_progress", text: "Replaced" })).status).toBe("resolved");
    expect((await refused(() => changeStatus(p.desk, c.id, { to: "open", expected: "resolved", text: "Called again" }))).status).toBe(403);
    expect((await changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "Called again" })).status).toBe("open");
    expect(await status(c.id)).toBe("open");
  });

  it("support and a store keeper can't change anything", async () => {
    const { p, c } = await setup();
    expect(await refused(() => changeStatus(p.support, c.id, { to: "in_progress", expected: "open" }))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => changeStatus(p.keeper, c.id, { to: "in_progress", expected: "open" }))).status).toBe(403);
    expect((await refused(() => addNote(p.support, c.id, { text: "x" }))).status).toBe(403);
    expect(await status(c.id)).toBe("open");
  });

  it.each([
    ["open", "open", "This complaint is already open"],
    ["in_progress", "in_progress", "This complaint is already in progress"],
    ["resolved", "resolved", "This complaint is already resolved"],
    ["in_progress", "open", "This complaint is already open"],
    ["resolved", "in_progress", "A resolved complaint can only be reopened"],
  ] as const)("%s -> %s is not a possible change", async (expected, to, message) => {
    const { p, c } = await setup();
    expect(await refused(() => changeStatus(p.owner, c.id, { to, expected, text: "Something" }))).toEqual({ status: 400, message });
  });

  it("from Open straight to Resolved is fine for the owner", async () => {
    const { p, c } = await setup();
    expect((await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Not valid" })).status).toBe("resolved");
  });
});

describe("required texts", () => {
  it("resolve and reopen need at least 3 characters; a quick pick alone is enough", async () => {
    const { p, c } = await setup();
    for (const text of [undefined, "", "  ", "ok"]) {
      expect(await refused(() => changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text }))).toEqual({ status: 400, message: "Please write how it was resolved (at least 3 characters)" });
    }
    expect(QUICK_PICKS).toEqual(["Replaced", "Refund given", "Not valid", "Entered by mistake"]);
    for (const pick of QUICK_PICKS) {
      const x = await setup();
      expect((await changeStatus(x.p.owner, x.c.id, { to: "resolved", expected: "open", text: pick })).status).toBe("resolved");
      expect((await events(x.c.id)).at(-1)).toEqual({ kind: "resolved", text: pick });
    }
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced. Customer happy" });
    expect(await refused(() => changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "no" }))).toEqual({ status: 400, message: "Please write why it is reopened (at least 3 characters)" });
  });

  it("a note needs text; In progress doesn't", async () => {
    expect(NoteInput.safeParse({ text: "  " }).success).toBe(false);
    expect(NoteInput.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
    expect(StatusInput.safeParse({ to: "in_progress", expected: "open" }).success).toBe(true);
    expect(StatusInput.safeParse({ to: "closed", expected: "open" }).success).toBe(false);
  });
});

describe("two people at once", () => {
  it("the second change (still expecting Open) gets 409 naming who changed it; nothing half-written", async () => {
    const { p, c } = await setup();
    const owner2 = cbUser(p.tenantId, ["tenant_admin"], "Ravi");
    await changeStatus(owner2, c.id, { to: "in_progress", expected: "open" });
    expect(await refused(() => changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" }))).toEqual({
      status: 409,
      message: "This complaint was just changed by Ravi. Please reload.",
    });
    expect(await events(c.id)).toEqual([{ kind: "in_progress", text: null }]);
    expect(await status(c.id)).toBe("in_progress");
  });

  it("two owners resolving at the very same moment: one wins, one gets 409, one history row", async () => {
    const { p, c } = await setup();
    const owner2 = cbUser(p.tenantId, ["tenant_admin"], "Ravi");
    const results = await Promise.allSettled([
      changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" }),
      changeStatus(owner2, c.id, { to: "resolved", expected: "open", text: "Refund given" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(409);
    expect((await events(c.id)).filter((e) => e.kind === "resolved")).toHaveLength(1);
  });

  it("the history row and the status are saved together: if the row fails, the status stays", async () => {
    const { p, c } = await setup();
    // 2001 characters slips past the form check here, so the database refuses the history row
    await expect(changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "x".repeat(2001) })).rejects.toThrow();
    expect(await status(c.id)).toBe("open");
    expect(await events(c.id)).toEqual([]);
  });

  it("the route answers 409 with the plain message", async () => {
    const { p, c } = await setup();
    await changeStatus(p.owner, c.id, { to: "in_progress", expected: "open" });
    const spy = vi.spyOn(kit, "currentSession").mockResolvedValue({ kind: "user", session: { tenant_id: p.tenantId, user_id: p.desk.userId, display_name: "Atharv", roles: ["complaint_desk"], enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never);
    try {
      const res = await statusRoute(new Request(`http://localhost:3004/api/complaints/${c.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: "in_progress", expected: "open" }) }), { params: Promise.resolve({ id: c.id }) });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This complaint was just changed by Sujata. Please reload." });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("notes", () => {
  it("can be added in any status, by owner and staff, with up to 5 photos each", async () => {
    const { p, c } = await setup();
    const n1 = await addNote(p.desk, c.id, { text: "Called the customer" });
    for (let i = 0; i < 5; i++) await uploadComplaintFile(p.desk, c.id, JPEG, { noteId: n1.id });
    expect(await refused(() => uploadComplaintFile(p.desk, c.id, JPEG, { noteId: n1.id }))).toEqual({ status: 409, message: "This note already has 5 photos" });
    await changeStatus(p.staff, c.id, { to: "in_progress", expected: "open" });
    await addNote(p.staff, c.id, { text: "Replacement jar sent" });
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "in_progress", text: "Replaced" });
    const n3 = await addNote(p.owner, c.id, { text: "Customer confirmed by phone" });
    await uploadComplaintFile(p.owner, c.id, JPEG, { noteId: n3.id });
    expect((await events(c.id)).map((e) => e.kind)).toEqual(["note", "in_progress", "note", "resolved", "note"]);
  });

  it("note photos: only the note's author, within 24 hours, photos only, the right complaint", async () => {
    const { p, c } = await setup();
    const n = await addNote(p.desk, c.id, { text: "Photo of the cap" });
    expect(await refused(() => uploadComplaintFile(p.owner, c.id, JPEG, { noteId: n.id }))).toEqual({ status: 403, message: "Only the person who wrote this note can add its photos" });
    expect(await refused(() => uploadComplaintFile(p.desk, c.id, MP4, { noteId: n.id }))).toEqual({ status: 415, message: "A note can have photos only, not a video" });
    expect((await refused(() => uploadComplaintFile(p.desk, c.id, JPEG, { noteId: n.id, now: Date.now() + 25 * 60 * 60 * 1000 }))).status).toBe(403);
    const other = await setup();
    expect(await refused(() => uploadComplaintFile(p.desk, other.c.id, JPEG, { noteId: n.id }))).toEqual({ status: 404, message: "Complaint not found" });
    const sameplant = await createComplaint(p.desk, ComplaintInput.parse({ customer_name: "Sita", phone: "7000012345", place: "Patia", description: "Tap broken on arrival", item_id: (await createItem(p.owner, { name: "Tap" })).id }));
    expect(await refused(() => uploadComplaintFile(p.desk, sameplant.id, JPEG, { noteId: n.id }))).toEqual({ status: 404, message: "Note not found" });
    expect((await refused(() => uploadComplaintFile(p.desk, c.id, JPEG, { noteId: randomUUID() }))).status).toBe(404);
  });

  it("another plant's complaint can't get a note", async () => {
    const a = await setup();
    const b = await setup();
    expect(await refused(() => addNote(b.p.owner, a.c.id, { text: "Hi" }))).toEqual({ status: 404, message: "Complaint not found" });
  });
});

describe("the complaint page", () => {
  it("history oldest first, with names, texts and each note's own photos; buttons by role and status", async () => {
    const { p, c } = await setup();
    await uploadComplaintFile(p.desk, c.id, JPEG);
    await uploadComplaintFile(p.desk, c.id, MP4);
    const n = await addNote(p.desk, c.id, { text: "Called the customer" });
    await uploadComplaintFile(p.desk, c.id, JPEG, { noteId: n.id });
    await changeStatus(p.staff, c.id, { to: "in_progress", expected: "open" });
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "in_progress", text: "Replaced" });

    const view = await getComplaint(p.owner, c.id);
    expect(view.history.map((e) => [e.kind, e.by, e.text, e.photos.length])).toEqual([
      ["note", "Atharv", "Called the customer", 1],
      ["in_progress", "Kedar", null, 0],
      ["resolved", "Sujata", "Replaced", 0],
    ]);
    expect([view.photos.length, Boolean(view.video)]).toEqual([1, true]);
    expect(view.can).toMatchObject({ note: true, in_progress: false, resolve: false, reopen: true });
    expect((await getComplaint(p.desk, c.id)).can).toMatchObject({ note: true, in_progress: false, resolve: false, reopen: false, add_files: true });
    expect((await getComplaint(p.staff, c.id)).can.add_files).toBe(false);
    expect((await getComplaint(p.support, c.id)).can).toEqual({ note: false, in_progress: false, resolve: false, reopen: false, add_files: false });
    expect((await refused(() => getComplaint(plant().owner, c.id))).status).toBe(404);
  });
});

describe("the owner's CSV", () => {
  it("one row per complaint with its history; formulas neutralised; audited and in Recent changes", async () => {
    const { p, c } = await setup({ customer_name: '=HYPERLINK("http://evil","x")' });
    await addNote(p.desk, c.id, { text: "+cmd|' /C calc'!A0" });
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" });
    const text = await exportCsv(p.owner);
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Reference,Logged at,Logged by,Customer,Mobile (as typed),Mobile,Place,Item,Batch / date,Description,Status,Status changed at,Photos (incl. notes),Video,History");
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).toContain("C-0001,");
    expect(text).toContain("Atharv added a note: +cmd");
    expect(text).toContain("Sujata resolved it: Replaced");
    expect(text).not.toMatch(/,=HYPERLINK/);
    expect((await recentChanges(p.owner))[0]?.text).toBe("Exported the complaints (CSV, 1 complaint)");
  });

  it("owner only: staff and support are refused; the route sends a file", async () => {
    const { p } = await setup();
    for (const u of [p.desk, p.staff, p.support]) expect((await refused(() => exportCsv(u))).status).toBe(403);
    const as = (u: CbUser) =>
      vi.spyOn(kit, "currentSession").mockResolvedValue({ kind: "user", session: { tenant_id: u.tenantId, user_id: u.userId, display_name: u.name, roles: u.roles, enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never);
    const spy = as(p.owner);
    try {
      const res = await exportRoute(new Request("http://localhost:3004/api/export"), undefined as never);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="complaints-\d{4}-\d{2}-\d{2}\.csv"$/);
      spy.mockRestore();
      as(p.desk);
      expect((await exportRoute(new Request("http://localhost:3004/api/export"), undefined as never)).status).toBe(403);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
