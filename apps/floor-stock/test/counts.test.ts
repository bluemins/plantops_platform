// The daily count: once per day, today or yesterday only, pre-filled, locked on submit, corrections with a
// reason, append-only in the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { countForm, submitCount } from "@/server/counts";
import { updateItem, updateSection } from "@/server/setup";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, refused } from "./helpers";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

describe("one count per day, for today or yesterday", () => {
  it("the store keeper submits today's count; it is saved as version 1 by them", async () => {
    const p = await stockPlant();
    expect(await submitCount(p.keeper, fullCount(p, TODAY, { made: 50, box: 120, label: 5, roll: 3 }), at(TODAY))).toMatchObject({ date: TODAY, version: 1 });
    const form = await countForm(p.owner, TODAY);
    expect(form.current).toMatchObject({ version: 1, entered_by: "Atharv", reason: null });
    expect(form.lines).toHaveLength(4);
  });

  it("yesterday is allowed; the day before, a future date and tomorrow are not", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, addDays(TODAY, -1), { box: 1, label: 1, roll: 1 }), at(TODAY));
    for (const d of [addDays(TODAY, -2), addDays(TODAY, 1)]) {
      expect(await refused(() => submitCount(p.keeper, fullCount(p, d, { box: 1, label: 1, roll: 1 }), at(TODAY)))).toEqual({ status: 400, message: "A count can only be entered for today or yesterday" });
    }
  });

  it("a second count for the same day is refused (locked); it must be a correction", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    const r = await refused(() => submitCount(p.owner, fullCount(p, TODAY, { box: 2, label: 2, roll: 2 }), at(TODAY)));
    expect(r).toEqual({ status: 409, message: "This day was already counted by Atharv. Please reload the page to see it." });
  });

  it("two people submitting at the same moment: one wins, the other is told", async () => {
    const p = await stockPlant();
    const results = await Promise.allSettled([p.keeper, p.owner].map((u) => submitCount(u, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(409);
  });
});

describe("what must be in a count", () => {
  it("every item being counted needs a closing stock", async () => {
    const p = await stockPlant();
    const input = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 });
    input.lines = input.lines.filter((l) => l.item_id !== p.roll);
    expect((await refused(() => submitCount(p.keeper, input, at(TODAY)))).message).toBe('Please enter the closing stock of "Roll" (Consumable)');
  });

  it("switched-off items and sections are not counted any more", async () => {
    const p = await stockPlant();
    await updateItem(p.owner, p.roll, { status: "off" });
    const input = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 });
    expect((await refused(() => submitCount(p.keeper, input, at(TODAY)))).message).toBe("An item in this count is no longer counted. Please reload the page.");
    input.lines = input.lines.filter((l) => l.item_id !== p.roll);
    await submitCount(p.keeper, input, at(TODAY));
    await updateSection(p.owner, p.con, { status: "off" });
    expect((await countForm(p.keeper, addDays(TODAY, 1))).sections.map((s) => s.name)).toEqual(["Finished goods"]);
  });

  it("production only for finished goods; a second number only where the item has one", async () => {
    const p = await stockPlant();
    const a = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 });
    a.lines.push({ item_id: p.roll, kind: "production", qty: 1 });
    expect((await refused(() => submitCount(p.keeper, a, at(TODAY)))).message).toBe('"Roll" is not a finished good, so it has no production');
    const b = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 });
    b.lines[1] = { ...b.lines[1]!, item_id: p.roll }; // the label line (with its count) now says Roll
    b.lines.pop();
    expect((await refused(() => submitCount(p.keeper, b, at(TODAY)))).message).toBe('"Roll" has no second number');
  });

  it("several lines per item, each with a remark; numbered in order; at most 20", async () => {
    const p = await stockPlant();
    const input = fullCount(p, TODAY, { box: 2, label: 1, roll: 1 });
    input.lines.push({ item_id: p.box, kind: "stock", qty: 19, remark: " Hemex " });
    await submitCount(p.keeper, input, at(TODAY));
    const { rows } = await asOwner<{ line_no: number; qty: string; remark: string | null }>(
      "select l.line_no, l.qty, l.remark from floor_stock.count_lines l where l.tenant_id = $1 and l.item_id = $2 and l.kind = 'stock' order by line_no",
      [p.tenantId, p.box],
    );
    expect(rows).toEqual([{ line_no: 1, qty: "2.00", remark: null }, { line_no: 2, qty: "19.00", remark: "Hemex" }]);
    const many = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }, { expected_version: 1, reason: "too many" });
    for (let i = 0; i < 20; i++) many.lines.push({ item_id: p.roll, kind: "stock", qty: 1 });
    expect((await refused(() => submitCount(p.keeper, many, at(TODAY)))).message).toBe('"Roll" can have at most 20 lines');
  });

  it("names and units are copied into the count, so a renamed item reads the same on old days", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    await updateItem(p.owner, p.roll, { name: "Printer roll", unit: "pcs" });
    const { rows } = await asOwner("select item_name, unit from floor_stock.count_lines where item_id = $1", [p.roll]);
    expect(rows).toEqual([{ item_name: "Roll", unit: "roll" }]);
  });
});

describe("pre-fill", () => {
  it("closing stock comes from the latest version of the last count; production starts empty", async () => {
    const p = await stockPlant();
    const d1 = addDays(TODAY, -3);
    await submitCount(p.keeper, fullCount(p, d1, { made: 10, box: 100, label: 5, roll: 3 }), at(d1));
    await submitCount(p.keeper, fullCount(p, d1, { made: 10, box: 90, label: 5, roll: 3 }, { expected_version: 1, reason: "box miscounted" }), at(d1));
    const form = await countForm(p.keeper, TODAY);
    expect(form).toMatchObject({ current: null, prefill_from: d1 });
    expect(form.lines.find((l) => l.item_id === p.box)).toMatchObject({ kind: "stock", qty: 90 });
    expect(form.lines.some((l) => l.kind === "production")).toBe(false);
    expect(form.lines.find((l) => l.item_id === p.label)).toMatchObject({ qty: 5, second_qty: 5000 });
  });

  it("a plant's first count starts empty", async () => {
    const p = await stockPlant();
    expect(await countForm(p.keeper, TODAY)).toMatchObject({ current: null, prefill_from: null, lines: [] });
  });
});

describe("corrections", () => {
  it("a correction is the next version, needs a reason, and the old version stays", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 10, label: 1, roll: 1 }), at(TODAY));
    const fix = fullCount(p, TODAY, { box: 12, label: 1, roll: 1 }, { expected_version: 1 });
    expect((await refused(() => submitCount(p.keeper, fix, at(TODAY)))).message).toBe("Please say why the count is being corrected (at least 3 characters)");
    expect((await refused(() => submitCount(p.keeper, { ...fix, reason: " ok " }, at(TODAY)))).status).toBe(400);
    expect(await submitCount(p.owner, { ...fix, reason: "2 boxes in hotel room" }, at(TODAY))).toMatchObject({ version: 2 });
    const { rows } = await asOwner<{ version: number; reason: string | null; entered_by_name: string }>(
      "select v.version, v.reason, v.entered_by_name from floor_stock.count_versions v join floor_stock.counts c on c.id = v.count_id where c.tenant_id = $1 order by version",
      [p.tenantId],
    );
    expect(rows).toEqual([{ version: 1, reason: null, entered_by_name: "Atharv" }, { version: 2, reason: "2 boxes in hotel room", entered_by_name: "Sujata" }]);
    expect((await countForm(p.keeper, TODAY)).lines.find((l) => l.item_id === p.box)?.qty).toBe(12);
  });

  it("a correction based on an old version is refused (someone corrected it meanwhile)", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 10, label: 1, roll: 1 }), at(TODAY));
    await submitCount(p.owner, fullCount(p, TODAY, { box: 11, label: 1, roll: 1 }, { expected_version: 1, reason: "first fix" }), at(TODAY));
    expect((await refused(() => submitCount(p.keeper, fullCount(p, TODAY, { box: 12, label: 1, roll: 1 }, { expected_version: 1, reason: "second fix" }), at(TODAY)))).status).toBe(409);
  });

  it("a correction may still hold an item switched off since the first version", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 10, label: 1, roll: 1 }), at(TODAY));
    await updateItem(p.owner, p.roll, { status: "off" });
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 10, label: 1, roll: 4 }, { expected_version: 1, reason: "roll recount" }), at(TODAY));
  });
});

describe("who may count", () => {
  it("support, staff without the role and other plants are refused", async () => {
    const p = await stockPlant();
    for (const u of [p.support, p.labTech]) expect((await refused(() => submitCount(u, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY)))).status).toBe(403);
    const other = await stockPlant();
    // plant B can't count plant A's items
    expect((await refused(() => submitCount(other.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY)))).status).toBe(400);
  });
});

describe("append-only, enforced by the database", () => {
  it("stock_app can't change or delete a saved count", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    for (const stmt of [
      "update floor_stock.count_lines set qty = 99",
      "delete from floor_stock.count_lines",
      "update floor_stock.count_versions set reason = 'x'",
      "delete from floor_stock.count_versions",
      "update floor_stock.counts set count_date = '2020-01-01'",
      "delete from floor_stock.counts",
      "update floor_stock.audit_log set action = 'x'",
      "delete from floor_stock.low_stock_alerts",
    ]) {
      expect(await dbError(asApp(p.tenantId, stmt)), stmt).toMatch(/permission denied/);
    }
  });

  it("the database itself refuses a correction without a reason, a second count per day and a negative number", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    const [{ id: countId }] = (await asOwner<{ id: string }>("select id from floor_stock.counts where tenant_id = $1", [p.tenantId])).rows as [{ id: string }];
    expect(await dbError(asApp(p.tenantId, `insert into floor_stock.count_versions (tenant_id, count_id, version, entered_by, entered_by_name) values ('${p.tenantId}', '${countId}', 2, gen_random_uuid(), 'x')`))).toMatch(/check/);
    expect(await dbError(asApp(p.tenantId, `insert into floor_stock.counts (tenant_id, count_date) values ('${p.tenantId}', '${TODAY}')`))).toMatch(/unique|duplicate/);
    const [{ id: vId }] = (await asOwner<{ id: string }>("select id from floor_stock.count_versions where tenant_id = $1", [p.tenantId])).rows as [{ id: string }];
    expect(await dbError(asApp(p.tenantId, `insert into floor_stock.count_lines (tenant_id, version_id, item_id, kind, line_no, item_name, unit, qty) values ('${p.tenantId}', '${vId}', '${p.roll}', 'stock', 5, 'Roll', 'roll', -1)`))).toMatch(/check/);
  });
});
