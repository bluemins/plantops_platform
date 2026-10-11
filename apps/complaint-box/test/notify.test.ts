// Phase 6: Complaint Box's six notifications (texts, recipients, excluded actor, level, dedupe), the routes sending
// exactly one each, the still-open reminders of the daily job, the outbox, and the cron route's secret.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaint, ComplaintInput } from "@/server/complaints";
import { addNote, changeStatus } from "@/server/followup";
import { createItem } from "@/server/items";
import { kit } from "@/server/kit";
import {
  newNotification,
  runDaily,
  statusNotification,
  stillOpenNotification,
  stillOpenStep,
  storageNotification,
  storageStepCrossed,
  updatedNotification,
} from "@/server/notify";
import type { CbUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, JPEG, plant, sized } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const { POST: postComplaint } = await import("@/app/api/complaints/route");
const { POST: postStatus } = await import("@/app/api/complaints/[id]/status/route");
const { POST: postNote } = await import("@/app/api/complaints/[id]/notes/route");
const { POST: postFile } = await import("@/app/api/complaints/[id]/files/route");
const { POST: cron } = await import("@/app/api/cron/daily/route");

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifyStatus = 201;
});

const DAY = 24 * 60 * 60 * 1000;
const fields = { customer_name: "Ramesh", phone: "+91 98765 43210", place: "Kalinga Nagar", description: "Jar leaking from the cap, noticed this morning" };
async function setup() {
  const p = plant();
  const item = await createItem(p.owner, { name: "20 L jar" });
  return { p, item_id: item.id };
}
const sentFor = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);

/** Calls a route as `user` (the routes read the session themselves). */
async function as<T>(user: CbUser, fn: () => Promise<T>) {
  const spy = vi.spyOn(kit, "currentSession").mockResolvedValue(
    user.isSupport
      ? ({ kind: "support", support: { tenant_id: user.tenantId, super_admin_id: user.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: user.tenantId, user_id: user.userId, display_name: user.name, roles: user.roles, enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}
const jsonReq = (path: string, body: unknown) => new Request(`http://localhost:3004${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("the six notifications", () => {
  it("new complaint: owners + ticked, not whoever logged it, push, no phone number in it", async () => {
    const { p, item_id } = await setup();
    const saved = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const n = newNotification(p.desk, saved);
    expect(n).toEqual({
      kind: "complaint_box.new",
      title: "New complaint C-0001: 20 L jar",
      body: "Ramesh, Kalinga Nagar. Jar leaking from the cap, noticed this morning (by Atharv)",
      link: `/c/${saved.id}`,
      level: "push",
      dedupe_key: `new:${saved.id}`,
      exclude_user_id: p.desk.userId,
    });
    expect(JSON.stringify(n)).not.toMatch(/98765|43210/);
    const long = newNotification(p.desk, { ...saved, item_name: "x".repeat(100), description: "y".repeat(2000) });
    expect(long.title.length).toBeLessThanOrEqual(80);
    expect(long.body!.length).toBeLessThanOrEqual(300);
  });

  it("resolved: only to whoever logged it; nothing when the owner resolves their own complaint", async () => {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const r = await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Jar replaced" });
    expect(statusNotification(p.owner, r)).toEqual({
      kind: "complaint_box.resolved",
      title: "C-0001 resolved",
      body: "Jar replaced",
      link: `/c/${c.id}`,
      level: "push",
      dedupe_key: `resolved:${c.id}:${r.event_id}`,
      exclude_user_id: p.owner.userId,
      also_user_ids: [p.desk.userId],
      only_listed: true,
    });
    const own = await createComplaint(p.owner, ComplaintInput.parse({ ...fields, item_id }));
    expect(statusNotification(p.owner, await changeStatus(p.owner, own.id, { to: "resolved", expected: "open", text: "Not valid" }))).toBeNull();
  });

  it("reopened: owners + ticked + whoever logged it, push", async () => {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" });
    const r = await changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "Customer called again" });
    const n = statusNotification(p.owner, r)!;
    expect(n).toMatchObject({ kind: "complaint_box.reopened", title: "C-0001 reopened", body: "Customer called again", level: "push", dedupe_key: `reopened:${c.id}:${r.event_id}`, also_user_ids: [p.desk.userId], exclude_user_id: p.owner.userId });
    expect(n.only_listed).toBeUndefined();
  });

  it("note added / set in progress: bell only, not to whoever did it, one per history row", async () => {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const note = await addNote(p.staff, c.id, { text: "Called the customer" });
    expect(updatedNotification(p.staff, { complaint_id: c.id, ref: note.ref, event_id: note.id, note: note.text })).toEqual({
      kind: "complaint_box.updated",
      title: "Kedar added a note on C-0001",
      body: "Called the customer",
      link: `/c/${c.id}`,
      level: "bell",
      dedupe_key: `updated:${c.id}:${note.id}`,
      exclude_user_id: p.staff.userId,
    });
    const r = await changeStatus(p.desk, c.id, { to: "in_progress", expected: "open" });
    expect(statusNotification(p.desk, r)).toMatchObject({ kind: "complaint_box.updated", title: "Atharv set C-0001 in progress", level: "bell", dedupe_key: `updated:${c.id}:${r.event_id}`, exclude_user_id: p.desk.userId });
  });

  it("storage: at 80% and 95% of the plan, once each; the key carries the plan's size", () => {
    const MB = 1024 * 1024;
    expect(storageStepCrossed(70 * MB, 79 * MB, 100 * MB)).toBeNull();
    expect(storageStepCrossed(79 * MB, 81 * MB, 100 * MB)).toBe(80);
    expect(storageStepCrossed(81 * MB, 90 * MB, 100 * MB)).toBeNull();
    expect(storageStepCrossed(90 * MB, 96 * MB, 100 * MB)).toBe(95);
    expect(storageStepCrossed(70 * MB, 99 * MB, 100 * MB)).toBe(95); // both at once: the higher one
    expect(storageStepCrossed(0, 99 * MB, null)).toBeNull();
    expect(storageNotification(80, 820 * MB, 1000 * MB)).toEqual({
      kind: "complaint_box.storage",
      title: "Complaint Box storage 80% used",
      body: "820 MB of 1,000 MB used. Ask PlantOps for more space before photo uploads stop.",
      link: "/",
      level: "push",
      dedupe_key: "storage:80:1000",
    });
  });
});

describe("the routes send exactly one notification, after answering", () => {
  it("logging, a note, in progress, resolve, reopen", async () => {
    const { p, item_id } = await setup();
    const res = await as(p.desk, () => postComplaint(jsonReq("/api/complaints", { ...fields, item_id }), undefined as never));
    const answer = (await res.json()) as { id: string; ref: string };
    expect(answer).toEqual({ id: expect.any(String), ref: "C-0001" }); // nothing extra goes to the browser
    await settle();
    const cid = answer.id;
    const ctx = { params: Promise.resolve({ id: cid }) };
    await as(p.staff, () => postNote(jsonReq(`/api/complaints/${cid}/notes`, { text: "Called" }), ctx));
    await as(p.desk, () => postStatus(jsonReq(`/api/complaints/${cid}/status`, { to: "in_progress", expected: "open" }), ctx));
    await as(p.owner, () => postStatus(jsonReq(`/api/complaints/${cid}/status`, { to: "resolved", expected: "in_progress", text: "Replaced" }), ctx));
    await as(p.owner, () => postStatus(jsonReq(`/api/complaints/${cid}/status`, { to: "open", expected: "resolved", text: "Called again" }), ctx));
    await settle();
    expect(sentFor(p.tenantId).map((n) => [n.kind, n.level, n.exclude_user_id])).toEqual([
      ["complaint_box.new", "push", p.desk.userId],
      ["complaint_box.updated", "bell", p.staff.userId],
      ["complaint_box.updated", "bell", p.desk.userId],
      ["complaint_box.resolved", "push", p.owner.userId],
      ["complaint_box.reopened", "push", p.owner.userId],
    ]);
  });

  it("refused or read-only actions send nothing", async () => {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const ctx = { params: Promise.resolve({ id: c.id }) };
    expect((await as(p.support, () => postNote(jsonReq(`/api/complaints/${c.id}/notes`, { text: "x" }), ctx))).status).toBe(403);
    expect((await as(p.desk, () => postStatus(jsonReq(`/api/complaints/${c.id}/status`, { to: "resolved", expected: "open", text: "Replaced" }), ctx))).status).toBe(403);
    expect((await as(p.owner, () => postStatus(jsonReq(`/api/complaints/${c.id}/status`, { to: "in_progress", expected: "in_progress" }), ctx))).status).toBe(400);
    expect((await as(p.support, () => postComplaint(jsonReq("/api/complaints", { ...fields, item_id }), undefined as never))).status).toBe(403);
    await settle();
    expect(sentFor(p.tenantId)).toEqual([]);
  });

  it("an upload passing 80% of the plan's storage warns once", async () => {
    const { p, item_id } = await setup();
    platform.limits.set(p.tenantId, { complaint_box: { storage_mb: 1 } });
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const ctx = { params: Promise.resolve({ id: c.id }) };
    const up = (bytes: number) => as(p.desk, () => postFile(new Request(`http://localhost:3004/api/complaints/${c.id}/files`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: sized(JPEG, bytes) }), ctx));
    expect((await up(700 * 1024)).status).toBe(201); // 68%
    await settle();
    expect(sentFor(p.tenantId)).toEqual([]);
    expect((await up(150 * 1024)).status).toBe(201); // 83%
    await settle();
    expect(sentFor(p.tenantId).map((n) => [n.kind, n.dedupe_key])).toEqual([["complaint_box.storage", "storage:80:1"]]);
  });
});

describe("still-open reminders (daily job)", () => {
  it("steps: none before day 3, then day 3, 10, 17 (the latest one reached)", () => {
    expect([0, 2, 3, 4, 9, 10, 16, 17, 30].map(stillOpenStep)).toEqual([null, null, 3, 3, 3, 10, 10, 17, 24]);
  });

  async function openPlant() {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    return { p, c };
  }
  const reminders = (tenantId: string) => sentFor(tenantId).filter((n) => n.kind === "complaint_box.still_open");
  const run = (days: number) => runDaily(new Date(Date.now() + days * DAY + 60_000));

  it("day 2 nothing; day 3 the first; day 9 the same key again; day 10 the next", async () => {
    const { p, c } = await openPlant();
    await run(2);
    expect(reminders(p.tenantId)).toEqual([]);
    await run(3);
    expect(reminders(p.tenantId)).toEqual([
      expect.objectContaining({ title: "C-0001 open for 3 days", body: "20 L jar, Ramesh. Last update: none yet", link: `/c/${c.id}`, level: "push", dedupe_key: `open:${c.id}:logged:d3` }),
    ]);
    await run(9);
    await run(10);
    expect(reminders(p.tenantId).map((n) => n.dedupe_key)).toEqual([`open:${c.id}:logged:d3`, `open:${c.id}:logged:d3`, `open:${c.id}:logged:d10`]);
    // the title says how long it has really been open (the key keeps the step, so day 9 adds nothing new)
    expect(reminders(p.tenantId).map((n) => n.title)).toEqual(["C-0001 open for 3 days", "C-0001 open for 9 days", "C-0001 open for 10 days"]);
    // the platform stores a dedupe key once per person, so the repeated day-3 key adds nothing there
  });

  it("the last update is shown; resolved complaints aren't reminded; a reopen starts a new series", async () => {
    const { p, c } = await openPlant();
    await addNote(p.desk, c.id, { text: "Called the customer, jar on the way" });
    await asOwner("update complaint_box.complaints set created_at = now() - interval '4 days' where id = $1", [c.id]);
    await runDaily();
    expect(reminders(p.tenantId).at(-1)?.body).toBe("20 L jar, Ramesh. Last update: Atharv: Called the customer, jar on the way");
    await changeStatus(p.owner, c.id, { to: "resolved", expected: "open", text: "Replaced" });
    const before = reminders(p.tenantId).length;
    await run(30);
    expect(reminders(p.tenantId)).toHaveLength(before);
    const r = await changeStatus(p.owner, c.id, { to: "open", expected: "resolved", text: "Customer called again" });
    await run(1);
    expect(reminders(p.tenantId)).toHaveLength(before);
    await run(3);
    expect(reminders(p.tenantId).at(-1)?.dedupe_key).toBe(`open:${c.id}:${r.event_id}:d3`);
  });

  it("a plant that switched Complaint Box off is skipped quietly", async () => {
    const { p } = await openPlant();
    platform.enabled.set(p.tenantId, ["floor_stock"]);
    const res = await run(5);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
    expect(reminders(p.tenantId)).toEqual([]);
  });

  it("the text for a long-open complaint", () => {
    expect(stillOpenNotification({ id: "x", ref_no: 42, item_name: "Dispenser", customer_name: "Sita", opened_at: new Date(), reopened_event_id: "e1", last_update: "Atharv set In progress" }, 10)).toMatchObject({
      title: "C-0042 open for 10 days",
      body: "Dispenser, Sita. Last update: Atharv set In progress",
      dedupe_key: "open:x:e1:d10",
    });
  });
});

describe("outbox", () => {
  it("platform down (503): kept and sent by the next daily run; a refusal (400) is not kept", async () => {
    const { p, item_id } = await setup();
    const c = await createComplaint(p.desk, ComplaintInput.parse({ ...fields, item_id }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      platform.notifyStatus = 503;
      expect(await kit.notify(p.tenantId, newNotification(p.desk, c))).toBeNull();
      platform.notifyStatus = 400;
      expect(await kit.notify(p.tenantId, { ...newNotification(p.desk, c), dedupe_key: `refused:${randomUUID()}` })).toBeNull();
      const kept = await asOwner<{ dedupe: string }>("select input->>'dedupe_key' as dedupe from complaint_box.notification_outbox where tenant_id = $1", [p.tenantId]);
      expect(kept.rows).toEqual([{ dedupe: `new:${c.id}` }]);
      platform.notifyStatus = 201;
      const res = await runDaily();
      expect(res.outbox.sent).toBeGreaterThanOrEqual(1);
      expect(sentFor(p.tenantId).map((n) => n.dedupe_key)).toContain(`new:${c.id}`);
      expect((await asOwner("select sent_at is not null as sent from complaint_box.notification_outbox where tenant_id = $1", [p.tenantId])).rows).toEqual([{ sent: true }]);
    } finally {
      log.mockRestore();
    }
  });
});

describe("the cron route", () => {
  const call = (secret?: string) => cron(new Request("http://localhost:3004/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));

  it("needs the CRON_SECRET; off (503) when none is set", async () => {
    const before = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await call("anything")).status).toBe(503);
      process.env.CRON_SECRET = "complaint-cron-test-secret";
      expect((await call()).status).toBe(401);
      expect((await call("wrong")).status).toBe(401);
      const ok = await call("complaint-cron-test-secret");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ plants: expect.any(Number), reminded: expect.any(Number), outbox: { sent: expect.any(Number) } });
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
    }
  });
});
