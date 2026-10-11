// Phase 3: the item list. Owner-only changes, names, product links, order, the starter list, what the "log a
// complaint" form may offer, complaint counts, plant isolation, Recent changes, and one route through handle().
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as postItem } from "@/app/api/items/route";
import { describeChange } from "@/lib/changes";
import { starterItems } from "@/lib/starter";
import { withTenant } from "@/server/db";
import { applyStarter, createItem, itemForComplaint, listItems, pickableItems, recentChanges, reorderItems, starterFor, updateItem, ItemInput, ItemPatch } from "@/server/items";
import { kit } from "@/server/kit";
import { startFakePlatform, SKUS, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const names = async (p: ReturnType<typeof plant>) => (await listItems(p.owner)).map((i) => `${i.name}${i.status === "off" ? " (off)" : ""}`);
const auditActions = async (tenantId: string) =>
  (await asOwner<{ action: string }>("select action from complaint_box.audit_log where tenant_id = $1 order by id", [tenantId])).rows.map((r) => r.action);

/** A complaint about `itemId`, inserted as the app (Phase 4 will do this through the form). */
let ref = 0;
const complaintAbout = (tenantId: string, itemId: string, status = "open") =>
  asApp(
    tenantId,
    `insert into complaint_box.complaints (tenant_id, ref_no, customer_name, phone_typed, phone, place, item_id, item_name, description, reported_by, reported_by_name, status)
     values ('${tenantId}', ${++ref}, 'Ramesh', '9876543210', '9876543210', 'Kalinga Nagar', '${itemId}', 'x', 'Leaking from the cap', gen_random_uuid(), 'Atharv', '${status}')`,
  );

describe("owner manages the list", () => {
  const p = plant();

  it("add, rename, re-order, switch off and on; each change is audited", async () => {
    const jar = await createItem(p.owner, { name: "20L jar" });
    const disp = await createItem(p.owner, { name: "Dispenser" });
    expect(await names(p)).toEqual(["20L jar", "Dispenser"]);
    expect((await updateItem(p.owner, jar.id, { name: "20 L jar" })).changed).toBe(true);
    expect((await updateItem(p.owner, jar.id, { name: "20 L jar" })).changed).toBe(false); // nothing to save
    await reorderItems(p.owner, { ids: [disp.id, jar.id] });
    expect(await names(p)).toEqual(["Dispenser", "20 L jar"]);
    await updateItem(p.owner, disp.id, { status: "off" });
    expect(await names(p)).toEqual(["Dispenser (off)", "20 L jar"]);
    await updateItem(p.owner, disp.id, { status: "active" });
    expect(await auditActions(p.tenantId)).toEqual(["item.add", "item.add", "item.update", "item.reorder", "item.update", "item.update"]);
  });

  it("nobody else may change it: complaint desk, plant staff, store keeper, support", async () => {
    const it0 = await createItem(p.owner, { name: "Cap" });
    for (const [who, msg] of [
      [p.desk, "Only the plant owner can do this"],
      [p.staff, "Only the plant owner can do this"],
      [p.keeper, "You don't have access to Complaint Box"],
      [p.support, "PlantOps support view is read-only"],
    ] as const) {
      expect(await refused(() => createItem(who, { name: "X" })), who.name).toEqual({ status: 403, message: msg });
      expect((await refused(() => updateItem(who, it0.id, { status: "off" }))).status).toBe(403);
      expect((await refused(() => reorderItems(who, { ids: [it0.id] }))).status).toBe(403);
      expect((await refused(() => applyStarter(who, { keys: ["other"] }))).status).toBe(403);
    }
  });

  it("support sees the list read-only; staff don't see the item list page at all", async () => {
    expect((await listItems(p.support)).length).toBeGreaterThan(0);
    expect((await refused(() => listItems(p.desk))).status).toBe(403);
    expect((await refused(() => listItems(p.staff))).status).toBe(403);
  });
});

describe("names", () => {
  const p = plant();

  it("1-60 characters, trimmed", () => {
    expect(ItemInput.safeParse({ name: "   " }).success).toBe(false);
    expect(ItemInput.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(ItemInput.parse({ name: "  Jar  " }).name).toBe("Jar");
  });

  it("unique among active items (ignoring case and spaces); a switched-off name can be used again", async () => {
    const a = await createItem(p.owner, { name: "Dispenser" });
    expect(await refused(() => createItem(p.owner, { name: " dispenser " }))).toEqual({ status: 409, message: "There is already an item with this name" });
    const b = await createItem(p.owner, { name: "Tap" });
    expect((await refused(() => updateItem(p.owner, b.id, { name: "DISPENSER" }))).status).toBe(409);
    await updateItem(p.owner, a.id, { status: "off" });
    const again = await createItem(p.owner, { name: "Dispenser" });
    expect(again.name).toBe("Dispenser");
    // switching the old one back on would make two active "Dispenser"s
    expect(await refused(() => updateItem(p.owner, a.id, { status: "active" }))).toEqual({ status: 409, message: "There is already an item with this name" });
  });
});

describe("product link", () => {
  const p = plant();

  it("one of the plant's PlantOps products; an unknown product is refused", async () => {
    const linked = await createItem(p.owner, { name: "Bluemins 1 L", sku_id: SKUS[0]!.id });
    expect((await listItems(p.owner)).find((i) => i.id === linked.id)?.sku_id).toBe(SKUS[0]!.id);
    expect(await refused(() => createItem(p.owner, { name: "Odd", sku_id: randomUUID() }))).toEqual({ status: 400, message: "That product is not one of this plant's PlantOps products" });
  });

  it("can't be changed later: an edit with a product link is refused as invalid input", () => {
    expect(ItemPatch.safeParse({ sku_id: SKUS[1]!.id }).success).toBe(false);
  });
});

describe("re-order", () => {
  const p = plant();

  it("needs exactly the plant's items", async () => {
    const a = await createItem(p.owner, { name: "A" });
    const b = await createItem(p.owner, { name: "B" });
    const msg = { status: 400, message: "The list has changed. Please reload the page." };
    expect(await refused(() => reorderItems(p.owner, { ids: [a.id] }))).toEqual(msg);
    expect(await refused(() => reorderItems(p.owner, { ids: [a.id, b.id, randomUUID()] }))).toEqual(msg);
    expect(await refused(() => reorderItems(p.owner, { ids: [a.id, a.id] }))).toEqual(msg);
    await reorderItems(p.owner, { ids: [b.id, a.id] });
    expect(await names(p)).toEqual(["B", "A"]);
  });
});

describe("starter list", () => {
  it("the plant's active products (inactive left out), then Dispenser, Delivery, Other", () => {
    expect(starterItems(SKUS).map((s) => [s.name, s.sku_id !== null])).toEqual([
      ["Bluemins (1 L × 12)", true],
      ["Bluemins (500 ml × 24)", true],
      ["Jar (20 L)", true],
      ["Dispenser", false],
      ["Delivery", false],
      ["Other", false],
    ]);
    expect(starterItems([]).map((s) => s.key)).toEqual(["dispenser", "delivery", "other"]);
  });

  it("creates only the ticked entries, once; unknown keys are refused", async () => {
    const p = plant();
    const offered = await starterFor(p.owner);
    expect(await refused(() => applyStarter(p.owner, { keys: ["other", "made-up"] }))).toEqual({ status: 400, message: "The starter list has changed. Please reload the page." });
    const keys = offered.filter((o) => o.key !== "delivery").map((o) => o.key);
    expect(await applyStarter(p.owner, { keys })).toEqual({ items: 5 });
    expect(await names(p)).toEqual(["Bluemins (1 L × 12)", "Bluemins (500 ml × 24)", "Jar (20 L)", "Dispenser", "Other"]);
    expect((await listItems(p.owner)).filter((i) => i.sku_id).length).toBe(3);
    expect(await refused(() => applyStarter(p.owner, { keys: ["delivery"] }))).toEqual({ status: 409, message: "This plant already has items" });
    expect((await recentChanges(p.owner))[0]?.text).toBe("Created the starter list (5 items)");
  });

  it("two taps at once create the list only once", async () => {
    const p = plant();
    const results = await Promise.allSettled([applyStarter(p.owner, { keys: ["other"] }), applyStarter(p.owner, { keys: ["other"] })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await names(p)).toEqual(["Other"]);
  });

  it("is refused once the plant has any item, even one added by hand", async () => {
    const p = plant();
    await createItem(p.owner, { name: "Jar" });
    expect((await refused(() => applyStarter(p.owner, { keys: ["other"] }))).status).toBe(409);
  });
});

describe("what the 'log a complaint' form may offer", () => {
  const p = plant();

  it("switched-off items are not offered, and a save naming one is refused", async () => {
    const jar = await createItem(p.owner, { name: "Jar" });
    const old = await createItem(p.owner, { name: "Old cap" });
    await updateItem(p.owner, old.id, { status: "off" });
    expect((await pickableItems(p.desk)).map((i) => i.name)).toEqual(["Jar"]);
    expect((await pickableItems(p.staff)).map((i) => i.name)).toEqual(["Jar"]);
    expect((await refused(() => pickableItems(p.support))).status).toBe(403);
    expect((await withTenant(p.tenantId, (tx) => itemForComplaint(tx, p.tenantId, jar.id))).name).toBe("Jar");
    expect(await refused(() => withTenant(p.tenantId, (tx) => itemForComplaint(tx, p.tenantId, old.id)))).toEqual({
      status: 400,
      message: '"Old cap" is no longer in the item list. Please choose another item.',
    });
  });

  it("another plant's item is refused", async () => {
    const other = plant();
    const theirs = await createItem(other.owner, { name: "Jar" });
    expect(await refused(() => withTenant(p.tenantId, (tx) => itemForComplaint(tx, p.tenantId, theirs.id)))).toEqual({ status: 400, message: "Please choose an item from the list" });
  });
});

describe("complaint count per item", () => {
  it("counts every status, only this plant's complaints; a switched-off item keeps its count", async () => {
    const p = plant();
    const jar = await createItem(p.owner, { name: "Jar" });
    const tap = await createItem(p.owner, { name: "Tap" });
    await createItem(p.owner, { name: "Cap" });
    await complaintAbout(p.tenantId, jar.id, "open");
    await complaintAbout(p.tenantId, jar.id, "in_progress");
    await complaintAbout(p.tenantId, jar.id, "resolved");
    await complaintAbout(p.tenantId, tap.id);
    const other = plant();
    const theirJar = await createItem(other.owner, { name: "Jar" });
    await complaintAbout(other.tenantId, theirJar.id);
    await updateItem(p.owner, tap.id, { status: "off" });
    expect((await listItems(p.owner)).map((i) => [i.name, i.complaint_count])).toEqual([
      ["Jar", 3],
      ["Tap", 1],
      ["Cap", 0],
    ]);
  });
});

describe("plant isolation", () => {
  it("plant B never sees or changes plant A's items", async () => {
    const a = plant();
    const b = plant();
    const mine = await createItem(a.owner, { name: "Secret jar" });
    expect(await names(b)).toEqual([]);
    expect(await refused(() => updateItem(b.owner, mine.id, { name: "Hacked" }))).toEqual({ status: 404, message: "Item not found" });
    expect((await refused(() => reorderItems(b.owner, { ids: [mine.id] }))).status).toBe(400);
    expect(await recentChanges(b.owner)).toEqual([]);
    expect(await names(a)).toEqual(["Secret jar"]);
  });
});

describe("Recent changes", () => {
  it("plain sentences, newest first, for the owner and support; complaint desk refused", async () => {
    const p = plant();
    const jar = await createItem(p.owner, { name: "20L jar", sku_id: SKUS[2]!.id });
    await updateItem(p.owner, jar.id, { name: "20 L jar", status: "off" });
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toEqual(["Item 20 L jar: renamed from 20L jar, switched off", "Added item 20L jar (linked to Jar (20 L))"]);
    expect((await recentChanges(p.support)).map((c) => c.text)).toEqual(texts);
    expect((await recentChanges(p.owner))[0]?.by).toBe("Sujata");
    expect((await refused(() => recentChanges(p.desk))).status).toBe(403);
  });

  it("describes re-order and switch on", () => {
    expect(describeChange("item.reorder", {})).toBe("Changed the order of the items");
    expect(describeChange("item.update", { name: "Tap", changes: { status: { from: "off", to: "active" } } })).toBe("Item Tap: switched on");
  });
});

describe("POST /api/items", () => {
  const call = () => postItem(new Request("http://localhost:3004/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Jar" }) }), undefined as never);

  it("no session → 401; support → 403; owner → 201", async () => {
    const p = plant();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue(null);
      expect((await call()).status).toBe(401);
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: p.tenantId, super_admin_id: randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      const sup = await call();
      expect(sup.status).toBe(403);
      expect(await sup.json()).toEqual({ error: "PlantOps support view is read-only" });
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: p.tenantId, user_id: randomUUID(), display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never);
      expect((await call()).status).toBe(201);
      expect(await names(p)).toEqual(["Jar"]);
    } finally {
      spy.mockRestore();
    }
  });
});
