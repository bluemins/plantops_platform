// Notifications N4 in Floor Stock: the owner's evening reminder hour (5-11 pm or off; default 8 pm), and the outbox
// that keeps a notification when the platform can't be reached and sends it again later.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { kit } from "@/server/kit";
import { runEvening } from "@/server/notify";
import { getSettings, setSettings, SettingsInput } from "@/server/settings";
import { recentChanges } from "@/server/views";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, refused } from "./helpers";
import { stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifications.length = 0;
  platform.notifyStatus = 201;
});

const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00+05:30`);
const reminders = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId && n.body.kind === "floor_stock.count_missing");

describe("evening reminder hour", () => {
  it("default 8 pm: nothing at 7 pm, sent at 8 pm, the same key at 9 pm (stored once)", async () => {
    const p = await stockPlant();
    expect((await getSettings(p.owner)).count_reminder).toBe("20:00");
    await runEvening(at("19:30"));
    expect(reminders(p.tenantId)).toEqual([]);
    await runEvening(at("20:30"));
    await runEvening(at("21:30"));
    expect(reminders(p.tenantId).map((n) => n.body.dedupe_key)).toEqual([`missing:${TODAY}`, `missing:${TODAY}`]);
  });

  it("set to 6 pm: sent at 6 pm; set to off: never", async () => {
    const early = await stockPlant();
    await setSettings(early.owner, { count_reminder: "18:00" });
    const off = await stockPlant();
    await setSettings(off.owner, { count_reminder: "off" });
    await runEvening(at("18:30"));
    await runEvening(at("23:30"));
    expect(reminders(early.tenantId).length).toBeGreaterThan(0);
    expect(reminders(off.tenantId)).toEqual([]);
  });

  it("only the owner may change it; the change shows in Recent changes", async () => {
    const p = await stockPlant();
    expect((await refused(() => setSettings(p.keeper, { count_reminder: "18:00" }))).status).toBe(403);
    expect((await refused(() => setSettings(p.support, { count_reminder: "18:00" }))).status).toBe(403);
    await setSettings(p.owner, { count_reminder: "21:00" });
    expect((await getSettings(p.keeper)).count_reminder).toBe("21:00");
    expect((await recentChanges(p.owner))[0]!.text).toBe("Evening reminder changed from 8 pm to 9 pm");
  });

  it("only whole hours from 5 pm to 11 pm, or off", () => {
    expect(SettingsInput.safeParse({ count_reminder: "16:00" }).success).toBe(false);
    expect(SettingsInput.safeParse({ count_reminder: "20:30" }).success).toBe(false);
    expect(SettingsInput.safeParse({ count_reminder: "23:00" }).success).toBe(true);
  });
});

describe("outbox: nothing lost when the platform is briefly down", () => {
  const event = (key: string) => ({ kind: "floor_stock.count_saved", title: "Stock count saved", body: "Atharv", link: "/day/2026-10-08", dedupe_key: key });
  const rows = (tenantId: string) => asOwner<{ attempts: number; sent_at: Date | null; given_up_at: Date | null }>("select attempts, sent_at, given_up_at from floor_stock.notification_outbox where tenant_id = $1", [tenantId]).then((r) => r.rows);

  it("platform down (5xx): kept; the next job sends it and marks it sent", async () => {
    const p = await stockPlant();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    platform.notifyStatus = 503;
    expect(await kit.notify(p.tenantId, event("count:2026-10-08:v1"))).toBeNull();
    log.mockRestore();
    expect(await rows(p.tenantId)).toEqual([{ attempts: 0, sent_at: null, given_up_at: null }]);
    platform.notifyStatus = 201;
    const r = await kit.retryOutbox();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(platform.notifications.filter((n) => n.tenantId === p.tenantId).map((n) => n.body.dedupe_key)).toEqual(["count:2026-10-08:v1"]);
    expect((await rows(p.tenantId))[0]!.sent_at).not.toBeNull();
  });

  it("a refusal (4xx) is not kept: it would never succeed", async () => {
    const p = await stockPlant();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    platform.notifyStatus = 403;
    expect(await kit.notify(p.tenantId, event("refused"))).toBeNull();
    log.mockRestore();
    expect(await rows(p.tenantId)).toEqual([]);
  });

  it("a retry that fails again counts up; too old -> given up", async () => {
    const p = await stockPlant();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    platform.notifyStatus = 503;
    await kit.notify(p.tenantId, event("again"));
    await kit.retryOutbox();
    expect((await rows(p.tenantId))[0]).toMatchObject({ attempts: 1, given_up_at: null });
    await asOwner("update floor_stock.notification_outbox set created_at = now() - interval '4 days' where tenant_id = $1", [p.tenantId]);
    await kit.retryOutbox();
    log.mockRestore();
    expect((await rows(p.tenantId))[0]!.given_up_at).not.toBeNull();
  });

  it("each plant sees only its own outbox, and the app can't delete it", async () => {
    const p = await stockPlant();
    const q = await stockPlant();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    platform.notifyStatus = 503;
    await kit.notify(p.tenantId, event("mine"));
    log.mockRestore();
    expect((await asApp(q.tenantId, "select count(*)::int as n from floor_stock.notification_outbox")).rows[0]).toEqual({ n: 0 });
    expect(await dbError(asApp(p.tenantId, "delete from floor_stock.notification_outbox"))).toMatch(/permission denied/);
  });
});
