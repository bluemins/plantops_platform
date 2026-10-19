// Owner notifications from Floor Stock (docs/notifications.md N1): one per saved count (low stock > check the count >
// corrected > saved), setup changes by staff (bell only), the 8 pm "count not done" reminder. Never for the owner's
// own actions, and a notification that can't be sent never breaks the count.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/days";
import { submitCount, type SavedCount } from "@/server/counts";
import { kit } from "@/server/kit";
import { countNotification, missingCountNotification, runEvening, setupNotification } from "@/server/notify";
import { createItem, createSection, reorderItems, updateItem } from "@/server/setup";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant } from "./helpers";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const YESTERDAY = addDays(TODAY, -1);

describe("one notification per saved count", () => {
  it("a store keeper's count: 'Stock count saved', opens the day page, not sent back to the store keeper", async () => {
    const p = await stockPlant();
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 3, roll: 4 }), at(TODAY));
    const n = countNotification(p.keeper, saved);
    expect(n).toMatchObject({
      kind: "floor_stock.count_saved",
      title: "Stock count saved",
      link: `/day/${TODAY}`,
      level: "push",
      dedupe_key: `count:${TODAY}:v1`,
      exclude_user_id: p.keeper.userId,
    });
    expect(n.body).toMatch(/^Atharv, 8 Oct, \d{1,2}:\d{2} [ap]m\.$/);
  });

  it("an item below its limit: the title says low stock and the body lists it", async () => {
    const p = await stockPlant();
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 3, roll: 1 }), at(TODAY));
    expect(saved.low_items).toEqual([{ item_id: p.roll, name: "Roll", qty: 1, min: 2 }]);
    const n = countNotification(p.keeper, saved);
    expect(n).toMatchObject({ kind: "floor_stock.low_stock", title: "Low stock: 1 item" });
    expect(n.body).toContain("Low: Roll 1 (limit 2).");
  });

  it("a correction says so with the reason, and repeats only NEWLY low items", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 3, roll: 1 }), at(TODAY));
    const again = await submitCount(p.keeper, fullCount(p, TODAY, { box: 6, label: 3, roll: 1 }, { expected_version: 1, reason: "missed one box" }), at(TODAY));
    expect(again.low_items).toEqual([]); // roll was already reported today
    expect(countNotification(p.keeper, again)).toMatchObject({ kind: "floor_stock.count_corrected", title: "Count corrected (v2)", dedupe_key: `count:${TODAY}:v2` });
    expect(countNotification(p.keeper, again).body).toBe("Corrected by Atharv (v2): missed one box.");

    await updateItem(p.owner, p.label, { min_level: 5 });
    const third = await submitCount(p.keeper, fullCount(p, TODAY, { box: 6, label: 2, roll: 1 }, { expected_version: 2, reason: "labels recounted" }), at(TODAY));
    expect(third.low_items.map((i) => i.name)).toEqual(["Label 1 L"]);
    expect(countNotification(p.keeper, third).title).toBe("Low stock: 1 item");
  });

  it("sold coming out negative against the day before: 'Check the count'", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, YESTERDAY, { box: 10, label: 3, roll: 4 }), at(TODAY));
    // 10 yesterday + 0 made, 15 today: 5 box more than possible
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { made: 0, box: 15, label: 3, roll: 4 }), at(TODAY));
    expect(saved.checks).toEqual([{ item_id: p.box, name: "Bluemins 1 L", unit: "box", extra: 5 }]);
    const n = countNotification(p.keeper, saved);
    expect(n).toMatchObject({ kind: "floor_stock.count_check", title: "Check the count: 1 item" });
    expect(n.body).toContain("Check: Bluemins 1 L (5 box more than possible).");
  });

  it("no check without a count the day before, and none when the numbers add up", async () => {
    const p = await stockPlant();
    expect((await submitCount(p.keeper, fullCount(p, YESTERDAY, { box: 10, label: 3, roll: 4 }), at(TODAY))).checks).toEqual([]);
    expect((await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 15, label: 3, roll: 4 }), at(TODAY))).checks).toEqual([]);
  });

  it("low stock wins the title when both happen; long lists are shortened", () => {
    const user = plant().keeper;
    const saved: SavedCount = {
      date: TODAY,
      version: 1,
      reason: null,
      entered_at: new Date(`${TODAY}T18:40:00+05:30`).toISOString(),
      low_stock_emails: 5,
      low_items: ["A", "B", "C", "D", "E"].map((name) => ({ item_id: name, name, qty: 1, min: 10 })),
      checks: [{ item_id: "Box", name: "Box", unit: "box", extra: 2 }],
    };
    const n = countNotification(user, saved);
    expect(n.title).toBe("Low stock: 5 items");
    expect(n.body).toBe("Atharv, 8 Oct, 6:40 pm. Low: A 1 (limit 10), B 1 (limit 10), C 1 (limit 10) + 2 more. Check: Box (2 box more than possible).");
    const long = countNotification(user, { ...saved, low_items: [{ item_id: "x", name: "x".repeat(400), qty: 1, min: 2 }] });
    expect(long.body!.length).toBeLessThanOrEqual(300);
  });

  it("the platform can't be reached: the count is saved anyway and the notification just isn't sent", async () => {
    const p = await stockPlant();
    platform.notifyStatus = 503;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const saved = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 3, roll: 4 }), at(TODAY));
      expect(saved.version).toBe(1);
      expect(await kit.notify(p.tenantId, countNotification(p.keeper, saved))).toBeNull();
    } finally {
      platform.notifyStatus = 201;
      log.mockRestore();
    }
  });

  it("sent through the module kit to the platform's inbox for that plant", async () => {
    const p = await stockPlant();
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 3, roll: 4 }), at(TODAY));
    expect(await kit.notify(p.tenantId, countNotification(p.keeper, saved))).toEqual({ recipients: 2, created: 2 });
    expect(platform.notifications.at(-1)).toMatchObject({ tenantId: p.tenantId, body: { title: "Stock count saved", exclude_user_id: p.keeper.userId } });
  });
});

describe("setup changed by staff (bell only)", () => {
  it("store keeper adds, edits and re-orders items: the owner hears about it at bell level", async () => {
    const p = await stockPlant();
    const added = await createItem(p.keeper, { section_id: p.con, name: "Ring 20 L", unit: "pcs" });
    const n = setupNotification(p.keeper, { action: "add", name: added.name, section: added.section })!;
    expect(n).toMatchObject({ kind: "floor_stock.setup_changed", title: "Setup changed", level: "bell", link: "/setup", body: 'Atharv added item "Ring 20 L" in Consumable' });

    const renamed = await updateItem(p.keeper, added.id, { name: "Ring 20L", unit: "piece" });
    expect(setupNotification(p.keeper, { action: "update", ...renamed })!.body).toBe('Atharv renamed it to "Ring 20L", changed the unit: "Ring 20 L"');

    const off = await updateItem(p.keeper, added.id, { status: "off" });
    expect(setupNotification(p.keeper, { action: "update", ...off })!.body).toBe('Atharv switched it off: "Ring 20L"');

    const order = await reorderItems(p.keeper, { section_id: p.con, ids: [p.roll, p.label, added.id] });
    expect(setupNotification(p.keeper, { action: "reorder", section: order.section })!.body).toBe("Atharv changed the order of the items in Consumable");
  });

  it("each change is its own notification (never swallowed as a repeat)", () => {
    const p = plant();
    const a = setupNotification(p.keeper, { action: "reorder", section: "Consumable" })!;
    const b = setupNotification(p.keeper, { action: "reorder", section: "Consumable" })!;
    expect(a.dedupe_key).not.toBe(b.dedupe_key);
  });

  it("nothing for the owner's own changes, for support, or for a save that changed nothing", () => {
    const p = plant();
    expect(setupNotification(p.owner, { action: "add", name: "x", section: "y" })).toBeNull();
    expect(setupNotification(p.support, { action: "reorder", section: "y" })).toBeNull();
    expect(setupNotification(p.keeper, { action: "update", name: "x", before: "x", fields: [] })).toBeNull();
  });
});

describe("8 pm reminder: count not done", () => {
  const evening = new Date(`${TODAY}T20:00:00+05:30`);
  const remindersFor = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId && n.body.kind === "floor_stock.count_missing");

  it("a plant with items and no count today gets it once per day (same key on every run)", async () => {
    const p = await stockPlant();
    await runEvening(evening);
    await runEvening(evening);
    const sent = remindersFor(p.tenantId);
    expect(sent.length).toBe(2); // the module may ask twice; the platform stores it once (dedupe key)
    expect(sent[0]!.body).toMatchObject({
      title: "Today's stock count is not done yet",
      link: "/count",
      level: "push",
      dedupe_key: `missing:${TODAY}`,
      body: "Sample Aqua: today's production and closing stock (8 Oct) have not been entered.",
    });
    expect(sent[0]!.body.exclude_user_id ?? null).toBeNull();
  });

  it("counted today: nothing; yesterday's count doesn't count for today", async () => {
    const done = await stockPlant();
    await submitCount(done.keeper, fullCount(done, TODAY, { box: 5, label: 3, roll: 4 }), at(TODAY));
    const onlyYesterday = await stockPlant();
    await submitCount(onlyYesterday.keeper, fullCount(onlyYesterday, YESTERDAY, { box: 5, label: 3, roll: 4 }), at(TODAY));
    await runEvening(evening);
    expect(remindersFor(done.tenantId)).toEqual([]);
    expect(remindersFor(onlyYesterday.tenantId).length).toBe(1);
  });

  it("a plant with no items set up, or with Floor Stock switched off, is skipped quietly", async () => {
    const empty = plant();
    await createSection(empty.owner, { name: "Finished goods", kind: "finished" });
    const off = await stockPlant();
    platform.enabled.set(off.tenantId, ["lab_records"]);
    const log = vi.spyOn(console, "error");
    await runEvening(evening);
    expect(remindersFor(empty.tenantId)).toEqual([]);
    expect(remindersFor(off.tenantId)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("the text", () => {
    expect(missingCountNotification("SAMPLEAQUA", "2026-10-11").body).toBe("SAMPLEAQUA: today's production and closing stock (11 Oct) have not been entered.");
  });
});
