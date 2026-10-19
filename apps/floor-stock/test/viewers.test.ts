// Stock viewers (v0.27.0, owner 2026-10-19): read-only, and only the sections the owner picks for each of them. The
// filter is on the server: day page, item history, the item list, "Can make" and their own alerts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AlertContact } from "@plantops/types";
import { CountInput, submitCount } from "@/server/counts";
import { viewerCountNotifications } from "@/server/notify";
import { setRecipe } from "@/server/recipes";
import { createItem, listSetup } from "@/server/setup";
import { summaryFor } from "@/server/summary";
import { dayView, homeStatus, itemHistory, recentChanges } from "@/server/views";
import { listViewers, setViewerSections } from "@/server/viewers";
import { CONTACTS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, dbError, refused, stockUser } from "./helpers";
import { at, fullCount, stockPlant, TODAY, type P } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

/** A plant with two Stock viewers (Ravi, Mina) known to the (fake) platform. */
async function viewerPlant() {
  const p = await stockPlant();
  const ravi = stockUser(p.tenantId, ["stock_viewer"], "Ravi");
  const mina = stockUser(p.tenantId, ["stock_viewer"], "Mina");
  const contact = (u: typeof ravi): AlertContact => ({ user_id: u.userId, display_name: u.name, phone: null, email: null, roles: ["stock_viewer"] });
  platform.contacts = [...CONTACTS, contact(ravi), contact(mina)];
  return { ...p, ravi, mina };
}
type VP = Awaited<ReturnType<typeof viewerPlant>>;
const names = (view: Awaited<ReturnType<typeof dayView>>) => view!.sections.flatMap((s) => s.rows.map((r) => r.name));
/** Roll (consumable, limit 2) is low: 1 roll. */
const lowCount = (p: P): CountInput => fullCount(p, TODAY, { made: 5, box: 10, label: 3, roll: 1 });

describe("the session", () => {
  it("a Stock viewer is a viewer, never a counter; a store keeper who is also a viewer is a store keeper", () => {
    const p = { tenantId: randomUUID() };
    expect(stockUser(p.tenantId, ["stock_viewer"])).toMatchObject({ isViewer: true, canCount: false, isOwner: false });
    expect(stockUser(p.tenantId, ["stock_viewer", "store_keeper"])).toMatchObject({ isViewer: false, canCount: true });
  });
});

describe("the owner picks the sections", () => {
  let p: VP;
  beforeAll(async () => {
    p = await viewerPlant();
  });

  it("lists the plant's Stock viewers with their sections; owner only", async () => {
    expect(await listViewers(p.owner)).toEqual([
      { user_id: p.ravi.userId, name: "Ravi", section_ids: [] },
      { user_id: p.mina.userId, name: "Mina", section_ids: [] },
    ]);
    for (const u of [p.keeper, p.ravi, p.support]) expect((await refused(() => listViewers(u))).status).toBe(403);
  });

  it("sets, changes and audits; only the owner; only this plant's viewers and sections", async () => {
    expect(await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con] })).toMatchObject({ section_ids: [p.con], changed: true });
    expect(await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con, p.fin] })).toMatchObject({ changed: true });
    expect(await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con] })).toMatchObject({ section_ids: [p.con], changed: true });
    expect(await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con] })).toMatchObject({ changed: false });
    expect((await listViewers(p.owner))![0]!.section_ids).toEqual([p.con]);

    for (const u of [p.keeper, p.ravi, p.support]) expect((await refused(() => setViewerSections(u, p.ravi.userId, { section_ids: [] }))).status).toBe(403);
    expect((await refused(() => setViewerSections(p.owner, p.keeper.userId, { section_ids: [] }))).status).toBe(404); // not a viewer
    expect((await refused(() => setViewerSections(p.owner, p.ravi.userId, { section_ids: [randomUUID()] }))).status).toBe(400);

    const changes = await recentChanges(p.owner);
    expect(changes[0]!.text).toBe("Stock viewer Ravi sees: Finished goods, Consumable → Consumable");
  });

  it("the database never lets the app delete a row, and keeps plants apart", async () => {
    expect(await dbError(asApp(p.tenantId, "delete from floor_stock.viewer_sections"))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, "update floor_stock.viewer_sections set user_id = gen_random_uuid()"))).toMatch(/permission denied/);
    const other = await asApp(randomUUID(), "select count(*)::int as n from floor_stock.viewer_sections");
    expect(other.rows[0]).toEqual({ n: 0 });
  });
});

describe("what a viewer sees", () => {
  let p: VP;
  beforeAll(async () => {
    p = await viewerPlant();
    await setRecipe(p.owner, p.box, { lines: [{ material_item_id: p.label, qty: 1, measure: "pcs" }] });
    await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con] });
    await setViewerSections(p.owner, p.mina.userId, { section_ids: [p.fin] });
    await submitCount(p.keeper, lowCount(p), at(TODAY));
  });

  it("the day page: only their sections and their low items", async () => {
    const ravi = await dayView(p.ravi, TODAY);
    expect(names(ravi)).toEqual(["Label 1 L", "Roll"]);
    expect(ravi!.low.map((r) => r.name)).toEqual(["Roll"]);
    const mina = await dayView(p.mina, TODAY);
    expect(names(mina)).toEqual(["Bluemins 1 L"]);
    expect(mina!.low).toEqual([]);
    expect(names(await dayView(p.owner, TODAY))).toEqual(["Bluemins 1 L", "Label 1 L", "Roll"]);
  });

  it("'Can make' only when every section the recipe uses is theirs", async () => {
    expect((await dayView(p.owner, TODAY))!.can_make).toHaveLength(1);
    expect((await dayView(p.mina, TODAY))!.can_make).toEqual([]); // the label's section isn't hers
    expect((await dayView(p.ravi, TODAY))!.can_make).toEqual([]); // the product's section isn't his
    await setViewerSections(p.owner, p.mina.userId, { section_ids: [p.fin, p.con] });
    expect((await dayView(p.mina, TODAY))!.can_make).toHaveLength(1);
    await setViewerSections(p.owner, p.mina.userId, { section_ids: [p.fin] });
  });

  it("item history and the item list: other sections are not found", async () => {
    expect((await itemHistory(p.ravi, p.roll)).days).toHaveLength(1);
    expect((await refused(() => itemHistory(p.ravi, p.box))).status).toBe(404);
    expect((await listSetup(p.ravi)).map((s) => s.name)).toEqual(["Consumable"]);
    expect(await homeStatus(p.ravi, at(TODAY))).toMatchObject({ todayCount: { version: 1 } });
  });

  it("no sections picked: nothing", async () => {
    const nobody = stockUser(p.tenantId, ["stock_viewer"], "New");
    expect(names(await dayView(nobody, TODAY))).toEqual([]);
    expect(await listSetup(nobody)).toEqual([]);
  });

  it("can't count, add items, see Recent changes or open another plant", async () => {
    expect((await refused(() => submitCount(p.ravi, { ...lowCount(p), expected_version: 1, reason: "test" }, at(TODAY)))).status).toBe(403);
    expect((await refused(() => createItem(p.ravi, { section_id: p.con, name: "Tape", unit: "roll" }))).status).toBe(403);
    expect((await refused(() => recentChanges(p.ravi))).status).toBe(403);
    expect(await dayView(stockUser(randomUUID(), ["stock_viewer"]), TODAY)).toBeNull();
  });

  it("their tile shows only whether today is counted", async () => {
    expect((await summaryFor(p.tenantId, "viewer", at(TODAY))).badges).toEqual([{ text: expect.stringMatching(/^Counted /), tone: "ok" }]);
    expect((await summaryFor(p.tenantId, "owner", at(TODAY))).badges.length).toBeGreaterThan(1);
  });
});

describe("their alerts", () => {
  it("one version per viewer with only their items, sent only if the owner ticked them; the main one leaves viewers out", async () => {
    const p = await viewerPlant();
    await setViewerSections(p.owner, p.ravi.userId, { section_ids: [p.con] });
    await setViewerSections(p.owner, p.mina.userId, { section_ids: [p.fin] });
    const saved = await submitCount(p.keeper, lowCount(p), at(TODAY));
    const list = await viewerCountNotifications(p.keeper, saved);
    const ravi = list.find((n) => n.also_user_ids?.[0] === p.ravi.userId)!;
    const mina = list.find((n) => n.also_user_ids?.[0] === p.mina.userId)!;
    expect(ravi).toMatchObject({ kind: "floor_stock.low_stock", title: "Low stock: 1 item", only_listed: true, if_ticked: true, dedupe_key: `count:${TODAY}:v1:${p.ravi.userId}` });
    expect(ravi.body).toContain("Roll 1 (limit 2)");
    expect(mina).toMatchObject({ kind: "floor_stock.count_saved", title: "Stock count saved" });
    expect(mina.body).not.toContain("Roll");
    expect(ravi.no_viewers).toBeUndefined();
  });

  it("viewers with no sections picked get no version", async () => {
    const p = await viewerPlant();
    expect(await viewerCountNotifications(p.keeper, await submitCount(p.keeper, lowCount(p), at(TODAY)))).toEqual([]);
  });
});
