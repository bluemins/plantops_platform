// "Sections & items": the plant's own list and the approved rules for who may change what (2026-10-04).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate, createItem, createSection, listSetup, reorderItems, reorderSections, SectionInput, updateItem, updateSection } from "@/server/setup";
import { starterTemplate } from "@/lib/template";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

/** A plant with one stock section and one item, made by the owner. */
async function withItem(minLevel: number | null = null) {
  const p = plant();
  const section = await createSection(p.owner, { name: "Consumable", kind: "stock" });
  const item = await createItem(p.owner, { section_id: section.id, name: "Roll", unit: "roll", min_level: minLevel });
  return { ...p, sectionId: section.id, itemId: item.id };
}
const findItem = async (u: Parameters<typeof listSetup>[0], id: string) => (await listSetup(u)).flatMap((s) => s.items).find((i) => i.id === id)!;
const auditRows = (tenantId: string) => asOwner<{ action: string; actor: string; details: Record<string, unknown> }>("select action, actor, details from floor_stock.audit_log where tenant_id = $1 order by id", [tenantId]);

describe("sections: owner only", () => {
  it("the owner adds, renames, switches off and re-orders sections", async () => {
    const p = plant();
    const a = await createSection(p.owner, SectionInput.parse({ name: "  Raw material ", kind: "stock" })); // as the API reads it
    const b = await createSection(p.owner, { name: "Finished goods", kind: "finished" });
    expect((await listSetup(p.owner)).map((s) => [s.name, s.kind])).toEqual([["Raw material", "stock"], ["Finished goods", "finished"]]);
    await updateSection(p.owner, a.id, { name: "Hotel room" });
    await updateSection(p.owner, a.id, { status: "off" });
    await reorderSections(p.owner, { ids: [b.id, a.id] });
    expect((await listSetup(p.owner)).map((s) => [s.name, s.status])).toEqual([["Finished goods", "active"], ["Hotel room", "off"]]);
  });

  it("store keeper, support and staff without the role are refused", async () => {
    const p = plant();
    const { id } = await createSection(p.owner, { name: "Consumable", kind: "stock" });
    for (const u of [p.keeper, p.support, p.labTech]) {
      expect((await refused(() => createSection(u, { name: "New", kind: "stock" }))).status).toBe(403);
      expect((await refused(() => updateSection(u, id, { name: "Renamed" }))).status).toBe(403);
      expect((await refused(() => updateSection(u, id, { status: "off" }))).status).toBe(403);
      expect((await refused(() => reorderSections(u, { ids: [id] }))).status).toBe(403);
    }
    expect((await refused(() => applyTemplate(p.keeper))).status).toBe(403);
  });

  it("names are unique per plant (ignoring case and spaces); another plant may reuse them", async () => {
    const p = plant();
    await createSection(p.owner, { name: "Consumable", kind: "stock" });
    expect(await refused(() => createSection(p.owner, { name: " consumable", kind: "stock" }))).toEqual({ status: 409, message: "There is already a section with this name" });
    await createSection(plant().owner, { name: "Consumable", kind: "stock" });
  });

  it("re-ordering needs the full current list", async () => {
    const p = plant();
    const a = await createSection(p.owner, { name: "A", kind: "stock" });
    await createSection(p.owner, { name: "B", kind: "stock" });
    expect((await refused(() => reorderSections(p.owner, { ids: [a.id] }))).status).toBe(400);
  });
});

describe("items: owner and store keeper, with owner-only parts", () => {
  it("a store keeper adds an item to any section and edits name, units and product", async () => {
    const p = await withItem();
    const fin = await createSection(p.owner, { name: "Finished goods", kind: "finished" });
    const { id } = await createItem(p.keeper, { section_id: fin.id, name: "Bluemins 1 L", unit: "box", sku_id: SKUS[0]!.id });
    await updateItem(p.keeper, p.itemId, { name: "Printer roll", unit: "pcs", second_unit: "metres", sku_id: SKUS[1]!.id });
    expect(await findItem(p.owner, p.itemId)).toMatchObject({ name: "Printer roll", unit: "pcs", second_unit: "metres", sku_id: SKUS[1]!.id, min_level: null });
    expect(await findItem(p.owner, id)).toMatchObject({ section_id: fin.id, sku_id: SKUS[0]!.id });
  });

  it("only the owner sets or changes a limit; the store keeper's whole save is refused", async () => {
    const p = await withItem();
    expect(await refused(() => createItem(p.keeper, { section_id: p.sectionId, name: "Tap", unit: "pcs", min_level: 5 }))).toEqual({ status: 403, message: "Only the plant owner can set a limit" });
    expect((await refused(() => updateItem(p.keeper, p.itemId, { name: "Roll 2", min_level: 3 }))).message).toBe("Only the plant owner can set or change a limit");
    expect((await findItem(p.owner, p.itemId)).name).toBe("Roll"); // nothing of the refused save was kept
    await updateItem(p.owner, p.itemId, { min_level: 2.5 });
    expect((await findItem(p.owner, p.itemId)).min_level).toBe(2.5);
    expect((await refused(() => updateItem(p.keeper, p.itemId, { min_level: null }))).status).toBe(403); // can't clear it either
    await updateItem(p.keeper, p.itemId, { name: "Roll", unit: "roll", min_level: 2.5 }); // unchanged limit sent back: fine
  });

  it("only the owner moves an item to another section", async () => {
    const p = await withItem();
    const other = await createSection(p.owner, { name: "Hotel room", kind: "stock" });
    expect((await refused(() => updateItem(p.keeper, p.itemId, { section_id: other.id }))).message).toBe("Only the plant owner can move an item to another section");
    await updateItem(p.keeper, p.itemId, { section_id: p.sectionId, name: "Roll" }); // its own section sent back: fine
    await updateItem(p.owner, p.itemId, { section_id: other.id });
    expect((await findItem(p.owner, p.itemId)).section_id).toBe(other.id);
  });

  it("a store keeper may switch off an item without a limit, never one with a limit", async () => {
    const free = await withItem();
    await updateItem(free.keeper, free.itemId, { status: "off" });
    await updateItem(free.keeper, free.itemId, { status: "active" });

    const limited = await withItem(10);
    expect((await refused(() => updateItem(limited.keeper, limited.itemId, { status: "off" }))).message).toBe("This item has a limit, so only the plant owner can switch it off");
    await updateItem(limited.owner, limited.itemId, { status: "off" });
    await updateItem(limited.keeper, limited.itemId, { status: "active" }); // switching back on is fine
    expect((await findItem(limited.owner, limited.itemId)).status).toBe("active");
  });

  it("renaming or moving keeps the limit", async () => {
    const p = await withItem(4);
    const other = await createSection(p.owner, { name: "Store", kind: "stock" });
    await updateItem(p.owner, p.itemId, { name: "Roll big", section_id: other.id });
    expect(await findItem(p.owner, p.itemId)).toMatchObject({ name: "Roll big", min_level: 4, section_id: other.id });
  });

  it("support and staff without the role can't add or edit items", async () => {
    const p = await withItem();
    for (const u of [p.support, p.labTech]) {
      expect((await refused(() => createItem(u, { section_id: p.sectionId, name: "X", unit: "pcs" }))).status).toBe(403);
      expect((await refused(() => updateItem(u, p.itemId, { name: "X" }))).status).toBe(403);
      expect((await refused(() => reorderItems(u, { section_id: p.sectionId, ids: [p.itemId] }))).status).toBe(403);
    }
  });

  it("checks: product must be the plant's own, section must be on, names unique per section, limits sensible", async () => {
    const p = await withItem();
    expect((await refused(() => createItem(p.owner, { section_id: p.sectionId, name: "X", unit: "pcs", sku_id: crypto.randomUUID() }))).message).toBe("That product is not one of this plant's products");
    expect((await refused(() => createItem(p.owner, { section_id: p.sectionId, name: "roll ", unit: "pcs" }))).status).toBe(409);
    const off = await createSection(p.owner, { name: "Old", kind: "stock" });
    await updateSection(p.owner, off.id, { status: "off" });
    expect((await refused(() => createItem(p.keeper, { section_id: off.id, name: "X", unit: "pcs" }))).status).toBe(400);
    expect((await refused(() => updateItem(p.owner, p.itemId, { section_id: off.id }))).status).toBe(400);
    expect((await refused(() => createItem(p.owner, { section_id: crypto.randomUUID(), name: "X", unit: "pcs" }))).status).toBe(404);
  });

  it("another plant's items and sections can't be seen or changed", async () => {
    const a = await withItem();
    const b = plant();
    expect(await listSetup(b.owner)).toEqual([]);
    expect((await refused(() => updateItem(b.owner, a.itemId, { name: "Hacked" }))).status).toBe(404);
    expect((await refused(() => updateSection(b.owner, a.sectionId, { name: "Hacked" }))).status).toBe(404);
    expect((await refused(() => createItem(b.owner, { section_id: a.sectionId, name: "X", unit: "pcs" }))).status).toBe(404);
  });

  it("re-orders the items of a section", async () => {
    const p = await withItem();
    const tap = await createItem(p.keeper, { section_id: p.sectionId, name: "Tap", unit: "pcs" });
    await reorderItems(p.keeper, { section_id: p.sectionId, ids: [tap.id, p.itemId] });
    expect((await listSetup(p.owner))[0]!.items.map((i) => i.name)).toEqual(["Tap", "Roll"]);
  });
});

describe("audit: every setup change is recorded with who did it", () => {
  it("adds, edits (with before/after) and refusals that changed nothing", async () => {
    const p = await withItem();
    await updateItem(p.owner, p.itemId, { unit: "pcs", min_level: 3 });
    await updateItem(p.owner, p.itemId, { unit: "pcs" }); // no change: no audit row
    await refused(() => updateItem(p.keeper, p.itemId, { min_level: 1 }));
    const rows = (await auditRows(p.tenantId)).rows;
    expect(rows.map((r) => r.action)).toEqual(["section.add", "item.add", "item.update"]);
    expect(rows[2]).toMatchObject({ actor: `user:${p.owner.userId}`, details: { by: "Sujata", changes: { unit: { from: "roll", to: "pcs" }, min_level: { from: null, to: 3 } } } });
  });
});

describe("the database itself: nothing is ever deleted", () => {
  it("stock_app cannot delete sections or items, or change who created them", async () => {
    const p = await withItem();
    expect(await dbError(asApp(p.tenantId, `delete from floor_stock.items where id = '${p.itemId}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, `delete from floor_stock.sections where id = '${p.sectionId}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, `update floor_stock.sections set kind = 'finished' where id = '${p.sectionId}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, `update floor_stock.items set created_by_name = 'x' where id = '${p.itemId}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(p.tenantId, `delete from floor_stock.audit_log`))).toMatch(/permission denied/);
  });
});

describe("starter list", () => {
  it("is generic: finished goods, bottles and labels come from the plant's active products", () => {
    const t = starterTemplate(SKUS);
    expect(t.map((s) => [s.name, s.kind])).toEqual([["Finished goods", "finished"], ["Raw material", "stock"], ["Consumable", "stock"], ["Returnable items", "stock"]]);
    expect(t[0]!.items.map((i) => [i.name, i.unit])).toEqual([["Bluemins 1 L", "box"], ["Bluemins 500 ml", "box"], ["Jar 20 L", "jar"]]);
    expect(t[1]!.items.map((i) => i.name)).toEqual(["Empty bottles Bluemins 1 L", "Empty bottles Bluemins 500 ml"]); // no jar, no inactive product
    expect(t[2]!.items.find((i) => i.name === "Label Bluemins 1 L")).toMatchObject({ unit: "bundle", second_unit: "count", sku_id: SKUS[0]!.id });
    expect(t[3]!.items[0]).toEqual({ name: "20 L jar", unit: "good", second_unit: "damaged" });
  });

  it("a product name that already says its size isn't repeated", () => {
    const named = [{ ...SKUS[0]!, name: "SampleAqua1L" }, { ...SKUS[1]!, name: "SampleAqua  500ml" }];
    expect(starterTemplate(named)[0]!.items.map((i) => i.name)).toEqual(["SampleAqua1L", "SampleAqua 500ml"]);
  });

  it("repeated product names stay unique", () => {
    const twin = { ...SKUS[0]!, id: crypto.randomUUID(), sku_code: "B1L-NEW" };
    expect(starterTemplate([SKUS[0]!, twin])[0]!.items.map((i) => i.name)).toEqual(["Bluemins 1 L", "Bluemins 1 L B1L-NEW"]);
  });

  it("the owner creates it once, on a plant with no sections; then edits it like any list", async () => {
    const p = plant();
    expect(await applyTemplate(p.owner)).toMatchObject({ sections: 4, products: 4 });
    const list = await listSetup(p.owner);
    expect(list.map((s) => s.name)).toEqual(["Finished goods", "Raw material", "Consumable", "Returnable items"]);
    expect(list[0]!.items.every((i) => i.sku_id && i.min_level === null)).toBe(true);
    expect((await refused(() => applyTemplate(p.owner))).status).toBe(409);
    const other = plant();
    await createSection(other.owner, { name: "Mine", kind: "stock" });
    expect((await refused(() => applyTemplate(other.owner))).status).toBe(409);
    expect((await auditRows(p.tenantId)).rows.map((r) => r.action)).toEqual(["setup.template"]);
  });

  it("two clicks at once create the list only once", async () => {
    const p = plant();
    const results = await Promise.allSettled([applyTemplate(p.owner), applyTemplate(p.owner)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await listSetup(p.owner)).toHaveLength(4);
  });
});
