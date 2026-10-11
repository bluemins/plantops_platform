// "Can make" with the database: owner-only Contents and Recipes, the checks on what may go into a recipe, the
// result on the day view (and so on the home page), corrections, Recent changes, and the database's own guards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitCount, type CountInput } from "@/server/counts";
import { ContentInput, RecipeInput, setContent, setRecipe } from "@/server/recipes";
import { createItem, createSection, listSetup, updateItem } from "@/server/setup";
import { dayView, recentChanges } from "@/server/views";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, plant, refused, stockUser } from "./helpers";
import { at, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const PACKET = { content_qty: 25000, content_measure: "g" as const, second_is_pieces: false, damage_pct: 0.01 };
const BUNDLE = { content_qty: 1000, content_measure: "pcs" as const, second_is_pieces: true, damage_pct: 0 };

/** The owner's example: BM 1L (linked product, 12 per box) and DM 1L (no product, case of 12) share Preform 18.5 g. */
async function canMakePlant() {
  const p = plant();
  const fin = await createSection(p.owner, { name: "Finished goods", kind: "finished" });
  const raw = await createSection(p.owner, { name: "Raw material", kind: "stock" });
  const bm = await createItem(p.owner, { section_id: fin.id, name: "BM 1L", unit: "box", sku_id: SKUS[0]!.id });
  const dm = await createItem(p.owner, { section_id: fin.id, name: "DM 1L", unit: "box" });
  const preform = await createItem(p.owner, { section_id: raw.id, name: "Preform 18.5 g", unit: "packet" });
  const cap = await createItem(p.owner, { section_id: raw.id, name: "Blue cap", unit: "box" });
  const label = await createItem(p.owner, { section_id: raw.id, name: "Label 1L", unit: "bundle", second_unit: "count" });
  const labelDm = await createItem(p.owner, { section_id: raw.id, name: "Label DM 1L", unit: "bundle", second_unit: "count" });
  return { ...p, fin: fin.id, raw: raw.id, bm: bm.id, dm: dm.id, preform: preform.id, cap: cap.id, label: label.id, labelDm: labelDm.id };
}
type CP = Awaited<ReturnType<typeof canMakePlant>>;

async function setUp(p: CP) {
  await setContent(p.owner, p.preform, PACKET);
  await setContent(p.owner, p.cap, { content_qty: 500, content_measure: "pcs", second_is_pieces: false, damage_pct: 0 });
  await setContent(p.owner, p.label, BUNDLE);
  await setContent(p.owner, p.labelDm, BUNDLE);
  const needs = (label: string) => ({ lines: [{ material_item_id: p.preform, qty: 18.5, measure: "g" as const }, { material_item_id: p.cap, qty: 1, measure: "pcs" as const }, { material_item_id: label, qty: 1, measure: "pcs" as const }] });
  await setRecipe(p.owner, p.bm, needs(p.label));
  await setRecipe(p.owner, p.dm, { ...needs(p.labelDm), case_size: 12 });
}

/** Tonight's example count: 3 packets of preform, 6 boxes of caps, labels 2 bundles + 300 and 1 bundle + 150. */
const count = (p: CP, extra: Partial<CountInput> = {}, preform = 3): CountInput => ({
  date: TODAY,
  expected_version: 0,
  lines: [
    { item_id: p.bm, kind: "stock", qty: 10 },
    { item_id: p.dm, kind: "stock", qty: 5 },
    { item_id: p.preform, kind: "stock", qty: preform },
    { item_id: p.cap, kind: "stock", qty: 6 },
    { item_id: p.label, kind: "stock", qty: 2, second_qty: 300 },
    { item_id: p.labelDm, kind: "stock", qty: 1, second_qty: 150 },
  ],
  ...extra,
});

describe("can make on the day view (and so the home page)", () => {
  it("the owner's example: BM 1L 191 box OR DM 1L 95 box, preform enough for 4,053 bottles", async () => {
    const p = await canMakePlant();
    await setUp(p);
    await submitCount(p.keeper, count(p), at(TODAY));
    const v = await dayView(p.keeper, TODAY);
    expect(v!.can_make).toHaveLength(1);
    const [g] = v!.can_make;
    expect(g!.products).toMatchObject([
      { name: "BM 1L", status: "ok", bottles: 2300, boxes: 191, per_box: 12, limiting: ["Label 1L"] },
      { name: "DM 1L", status: "ok", bottles: 1150, boxes: 95, per_box: 12, limiting: ["Label DM 1L"] },
    ]);
    expect(g!.shared.find((s) => s.material === "Preform 18.5 g")).toMatchObject({ total_bottles: 4053 });
  });

  it("follows a correction; the old version keeps its own numbers", async () => {
    const p = await canMakePlant();
    await setUp(p);
    await submitCount(p.keeper, count(p), at(TODAY));
    // fewer preform packets: now the preform runs out first for BM 1L (1 packet = 1,351 bottles)
    await submitCount(p.keeper, count(p, { expected_version: 1, reason: "recounted preform" }, 1), at(TODAY));
    expect((await dayView(p.owner, TODAY))!.can_make[0]!.products[0]).toMatchObject({ bottles: 1351, boxes: 112, limiting: ["Preform 18.5 g"] });
    expect((await dayView(p.owner, TODAY, 1))!.can_make[0]!.products[0]).toMatchObject({ bottles: 2300, boxes: 191 });
  });

  it("nothing shows until the owner sets a recipe", async () => {
    const p = await canMakePlant();
    await submitCount(p.keeper, count(p), at(TODAY));
    expect((await dayView(p.owner, TODAY))!.can_make).toEqual([]);
  });

  it("a material switched off and left out of the count: says which one can't be worked out", async () => {
    const p = await canMakePlant();
    await setUp(p);
    await updateItem(p.owner, p.labelDm, { status: "off" });
    const c = count(p);
    await submitCount(p.keeper, { ...c, lines: c.lines.filter((l) => l.item_id !== p.labelDm) }, at(TODAY));
    const [g] = (await dayView(p.owner, TODAY))!.can_make;
    expect(g!.products[1]).toMatchObject({ name: "DM 1L", status: "problem", problems: [{ kind: "not_counted", material: "Label DM 1L" }] });
  });

  it("taking a material out of a recipe switches its line off (never deleted) and the number follows", async () => {
    const p = await canMakePlant();
    await setUp(p);
    await setRecipe(p.owner, p.bm, { lines: [{ material_item_id: p.preform, qty: 18.5, measure: "g" }] });
    await submitCount(p.keeper, count(p), at(TODAY));
    const [g] = (await dayView(p.owner, TODAY))!.can_make;
    expect(g!.products[0]).toMatchObject({ name: "BM 1L", bottles: 4053, boxes: 337 });
    const rows = await asOwner<{ status: string }>(`select l.status from floor_stock.recipe_lines l join floor_stock.recipes r on r.id = l.recipe_id where r.product_item_id = $1 order by l.created_at`, [p.bm]);
    expect(rows.rows.map((r) => r.status)).toEqual(["active", "off", "off"]);
  });
});

describe("who may set it", () => {
  it("owner only: store keeper, plant staff, lab technician and support are refused", async () => {
    const p = await canMakePlant();
    const staff = stockUser(p.tenantId, ["plant_staff"]);
    for (const u of [p.keeper, staff, p.labTech, p.support]) {
      expect((await refused(() => setContent(u, p.preform, PACKET))).status).toBe(403);
      expect((await refused(() => setRecipe(u, p.bm, { lines: [] }))).status).toBe(403);
    }
  });

  it("everyone who opens Floor Stock sees the contents and recipes on Sections & items", async () => {
    const p = await canMakePlant();
    await setUp(p);
    const items = (await listSetup(p.keeper)).flatMap((s) => s.items);
    expect(items.find((i) => i.id === p.preform)).toMatchObject({ content: { qty: 25000, measure: "g", damage_pct: 0.01, second_is_pieces: false }, recipe: null });
    expect(items.find((i) => i.id === p.dm)!.recipe).toEqual({
      case_size: 12,
      lines: [
        { material_item_id: p.preform, qty: 18.5, measure: "g" },
        { material_item_id: p.cap, qty: 1, measure: "pcs" },
        { material_item_id: p.labelDm, qty: 1, measure: "pcs" },
      ],
    });
  });

  it("every change is in Recent changes, in plain words", async () => {
    const p = await canMakePlant();
    await setUp(p);
    await setContent(p.owner, p.preform, { ...PACKET, damage_pct: 0.02 });
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toContain("Contents of Preform 18.5 g: 1 packet = 25,000 g · damage 0.01% → 1 packet = 25,000 g · damage 0.02%");
    expect(texts).toContain("Recipe of BM 1L (1 bottle): none → 18.5 g Preform 18.5 g + 1 pcs Blue cap + 1 pcs Label 1L");
  });

  it("saving the same contents again changes nothing", async () => {
    const p = await canMakePlant();
    await setContent(p.owner, p.preform, PACKET);
    expect(await setContent(p.owner, p.preform, PACKET)).toEqual({ id: p.preform, changed: false });
  });
});

describe("what may go into a recipe", () => {
  it("a recipe belongs on a finished goods item; contents on a stock item", async () => {
    const p = await canMakePlant();
    expect((await refused(() => setRecipe(p.owner, p.preform, { lines: [] }))).message).toMatch(/finished goods item/);
    expect((await refused(() => setContent(p.owner, p.bm, PACKET))).message).toMatch(/not on finished goods/);
  });

  it("materials must be this plant's active stock items, each once", async () => {
    const p = await canMakePlant();
    const other = await canMakePlant();
    const pcs = (id: string) => ({ material_item_id: id, qty: 1, measure: "pcs" as const });
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [pcs(other.cap)] }))).message).toMatch(/not one of this plant's items/);
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [pcs(p.dm)] }))).message).toMatch(/finished goods item/);
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [pcs(p.cap), pcs(p.cap)] }))).message).toMatch(/only once/);
    await updateItem(p.owner, p.cap, { status: "off" });
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [pcs(p.cap)] }))).message).toMatch(/switched off/);
  });

  it("weight with weight, pieces with pieces", async () => {
    const p = await canMakePlant();
    // no contents yet: counted in single pieces
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [{ material_item_id: p.preform, qty: 18.5, measure: "g" }] }))).message).toMatch(/single pieces, so use pcs/);
    await setContent(p.owner, p.preform, PACKET);
    expect((await refused(() => setRecipe(p.owner, p.bm, { lines: [{ material_item_id: p.preform, qty: 1, measure: "pcs" }] }))).message).toMatch(/must be a weight too/);
    expect(await setRecipe(p.owner, p.bm, { lines: [{ material_item_id: p.preform, qty: 0.02, measure: "kg" }] })).toMatchObject({ lines: 1 });
    // a recipe uses it by weight, so its contents can't become pieces
    expect((await refused(() => setContent(p.owner, p.preform, { ...PACKET, content_measure: "pcs" }))).message).toMatch(/Change that recipe first/);
  });

  it("loose pieces only for an item with a second number, counted in pcs", async () => {
    const p = await canMakePlant();
    expect((await refused(() => setContent(p.owner, p.cap, { ...BUNDLE }))).message).toMatch(/no second number/);
    expect((await refused(() => setContent(p.owner, p.label, { ...BUNDLE, content_measure: "g" }))).message).toMatch(/only make sense/);
  });

  it("input rules: amounts above 0, at most 2 decimals, damage below 100 %", () => {
    expect(RecipeInput.safeParse({ lines: [{ material_item_id: crypto.randomUUID(), qty: 0.0185, measure: "kg" }] }).error?.issues[0]?.message).toMatch(/use g instead of kg/);
    expect(RecipeInput.safeParse({ lines: [{ material_item_id: crypto.randomUUID(), qty: 0, measure: "g" }] }).success).toBe(false);
    expect(ContentInput.safeParse({ ...PACKET, damage_pct: 100 }).success).toBe(false);
    expect(ContentInput.safeParse({ ...PACKET, damage_pct: 0.00001 }).success).toBe(false);
    expect(ContentInput.safeParse({ ...PACKET, content_measure: "lbs" }).success).toBe(false);
  });
});

describe("the database's own guards", () => {
  it("plant B sees none of plant A's contents or recipes and cannot write into them", async () => {
    const a = await canMakePlant();
    await setUp(a);
    const b = plant();
    for (const t of ["material_contents", "recipes", "recipe_lines"]) {
      expect((await asApp(b.tenantId, `select * from floor_stock.${t} where tenant_id = '${a.tenantId}'`)).rows).toEqual([]);
      expect((await asApp(b.tenantId, `update floor_stock.${t} set updated_by_name = 'x' where tenant_id = '${a.tenantId}'`)).rowCount).toBe(0);
    }
    expect(await dbError(asApp(b.tenantId, `insert into floor_stock.recipes (tenant_id, product_item_id, created_by, created_by_name, updated_by, updated_by_name) values ('${a.tenantId}', '${a.bm}', gen_random_uuid(), 'x', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
  });

  it("the app login can't delete anything, nor point a recipe at another plant's item", async () => {
    const a = await canMakePlant();
    await setUp(a);
    for (const t of ["material_contents", "recipes", "recipe_lines"]) {
      expect(await dbError(asApp(a.tenantId, `delete from floor_stock.${t}`))).toMatch(/permission denied/);
    }
    const b = await canMakePlant();
    expect(await dbError(asApp(a.tenantId, `insert into floor_stock.material_contents (tenant_id, item_id, content_qty, content_measure, updated_by, updated_by_name) values ('${a.tenantId}', '${b.cap}', 1, 'pcs', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(a.tenantId, `update floor_stock.recipes set product_item_id = gen_random_uuid()`))).toMatch(/permission denied/);
  });
});
