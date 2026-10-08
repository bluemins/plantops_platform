// The owner views: a day compared with the day before, item history, Recent changes, CSV and the WhatsApp text.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { addDays } from "@/lib/days";
import { whatsappText } from "@/lib/whatsapp";
import { proxy } from "@/proxy";
import { submitCount } from "@/server/counts";
import { updateItem, updateSection } from "@/server/setup";
import { countHistory, dayView, exportCsv, itemHistory, recentChanges } from "@/server/views";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, refused } from "./helpers";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const Y = addDays(TODAY, -1);
const row = (view: Awaited<ReturnType<typeof dayView>>, name: string) => view!.sections.flatMap((s) => s.rows).find((r) => r.name === name)!;

describe("a day compared with the day before", () => {
  it("Sold for finished goods, Used / received for the rest, low against the owner's limit", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, Y, { box: 100, label: 5, roll: 3 }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 50, box: 120, label: 8, roll: 1.5 }), at(TODAY));
    const v = await dayView(p.owner, TODAY);
    expect(v).toMatchObject({ date: TODAY, previous_date: Y, previous_counted: true });
    expect(row(v, "Bluemins 1 L")).toMatchObject({ production_total: 50, closing: 120, previous: 100, comparison: { kind: "sold", value: 30 }, low: false });
    expect(row(v, "Label 1 L")).toMatchObject({ closing: 8, second_total: 8000, comparison: { kind: "received", value: 3 } });
    expect(row(v, "Roll")).toMatchObject({ comparison: { kind: "used", value: 1.5 }, low: true, min_level: 2 });
    expect(v!.low.map((r) => r.name)).toEqual(["Roll"]);
  });

  it("no count the day before: nothing compared", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, addDays(TODAY, -2), { box: 100, label: 5, roll: 3 }), at(addDays(TODAY, -2)));
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 90, label: 5, roll: 3 }), at(TODAY));
    const v = await dayView(p.owner, TODAY);
    expect(v!.previous_counted).toBe(false);
    expect(row(v, "Roll").comparison).toEqual({ kind: "no_previous_count" });
  });

  it("the day an item's unit changes it is not compared", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, Y, { box: 10, label: 5, roll: 3 }), at(TODAY));
    await updateItem(p.keeper, p.roll, { unit: "pcs" });
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 10, label: 5, roll: 30 }), at(TODAY));
    expect(row(await dayView(p.owner, TODAY), "Roll").comparison).toEqual({ kind: "unit_changed", from: "roll", to: "pcs" });
  });

  it("shows the latest version, or an older one on request; the comparison uses the day before's latest", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, Y, { box: 100, label: 5, roll: 3 }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, Y, { box: 110, label: 5, roll: 3 }, { expected_version: 1, reason: "recount" }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 100, label: 5, roll: 3 }), at(TODAY));
    expect(row(await dayView(p.owner, TODAY), "Bluemins 1 L").comparison).toEqual({ kind: "sold", value: 10 });
    const old = await dayView(p.owner, Y, 1);
    expect(old!.shown.version).toBe(1);
    expect(old!.versions).toHaveLength(2);
    expect(row(old, "Bluemins 1 L").closing).toBe(100);
    expect((await refused(() => dayView(p.owner, Y, 7))).status).toBe(404);
    expect(await dayView(p.owner, addDays(TODAY, -5))).toBeNull();
  });

  it("the store keeper and support may look; staff without the role and other plants see nothing", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    expect(await dayView(p.keeper, TODAY)).not.toBeNull();
    expect(await dayView(p.support, TODAY)).not.toBeNull();
    expect((await refused(() => dayView(p.labTech, TODAY))).status).toBe(403);
    expect(await dayView((await stockPlant()).owner, TODAY)).toBeNull();
  });
});

describe("history", () => {
  it("by date, newest first, with corrections counted", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, Y, { box: 1, label: 1, roll: 1 }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    await submitCount(p.owner, fullCount(p, TODAY, { box: 2, label: 1, roll: 1 }, { expected_version: 1, reason: "recount" }), at(TODAY));
    expect((await countHistory(p.keeper)).map((h) => [h.date, h.versions, h.latest.entered_by])).toEqual([[TODAY, 2, "Sujata"], [Y, 1, "Atharv"]]);
  });

  it("by item: each day with Sold against the day before; a gap breaks the comparison", async () => {
    const p = await stockPlant();
    const d = (n: number) => addDays(TODAY, n);
    await submitCount(p.keeper, fullCount(p, d(-3), { box: 100, label: 1, roll: 1 }), at(d(-3)));
    await submitCount(p.keeper, fullCount(p, d(-1), { made: 20, box: 90, label: 1, roll: 1 }), at(d(-1)));
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 10, box: 85, label: 1, roll: 1 }), at(TODAY));
    const h = await itemHistory(p.owner, p.box);
    expect(h.item).toMatchObject({ name: "Bluemins 1 L", finished: true });
    expect(h.days.map((x) => [x.date, x.production, x.closing, x.comparison])).toEqual([
      [TODAY, 10, 85, { kind: "sold", value: 15 }],
      [d(-1), 20, 90, { kind: "no_previous_count" }],
      [d(-3), null, 100, { kind: "no_previous_count" }],
    ]);
    expect((await refused(async () => itemHistory((await stockPlant()).owner, p.box))).status).toBe(404);
  });
});

describe("Recent changes", () => {
  it("lists setup changes and corrections in plain words, newest first: owner and support only", async () => {
    const p = await stockPlant();
    await updateItem(p.owner, p.roll, { min_level: 5, name: "Printer roll" });
    await updateSection(p.owner, p.con, { name: "Consumables" });
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 2, label: 1, roll: 1 }, { expected_version: 1, reason: "box recount" }), at(TODAY));
    const list = await recentChanges(p.owner);
    expect(list.slice(0, 3).map((c) => c.text)).toEqual([
      "Corrected the count of 8 Oct 2026 (version 2): box recount",
      "Section Consumables: renamed from Consumable",
      "Item Printer roll: name Roll → Printer roll, limit 2 → 5",
    ]);
    expect(list.at(-1)!.text).toBe("Added section Finished goods (finished goods)");
    expect(list[0]!.by).toBe("Atharv");
    expect(await recentChanges(p.support)).toHaveLength(list.length);
    expect((await refused(() => recentChanges(p.keeper))).status).toBe(403);
  });
});

describe("owner's CSV", () => {
  it("every version, one row per line; owner only; formulas neutralised; the export is recorded", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 1, label: 1, roll: 1 }, {}), at(TODAY));
    const fix = fullCount(p, TODAY, { box: 1, label: 1, roll: 1 }, { expected_version: 1, reason: "=HYPERLINK(\"x\")" });
    fix.lines[0] = { ...fix.lines[0]!, remark: "+cmd" };
    await submitCount(p.keeper, fix, at(TODAY));
    const text = await exportCsv(p.owner);
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toContain("Date,Version,Latest version,Entered by");
    expect(lines).toHaveLength(1 + 4 + 3); // header, first count (production + 3 closing), correction (3 closing)
    expect(text).toContain(`'=HYPERLINK(""x"")`);
    expect(text).toContain("'+cmd");
    expect(lines[1]).toMatch(/^﻿?2026-10-08,1,no,Atharv,/);
    expect((await refused(() => exportCsv(p.keeper))).status).toBe(403);
    expect((await refused(() => exportCsv(p.support))).status).toBe(403);
    expect((await asOwner("select action from floor_stock.audit_log where tenant_id = $1 and action = 'export.csv'", [p.tenantId])).rowCount).toBe(1);
  });

  it("the route needs a session", async () => {
    expect((await proxy(new NextRequest("http://localhost:3002/api/export"))).status).toBe(401);
  });
});

describe("WhatsApp text", () => {
  it("production first, then each section; several lines joined; second number and remarks kept", async () => {
    const p = await stockPlant();
    const input = fullCount(p, TODAY, { made: 50, box: 2, label: 5, roll: 1 });
    input.lines.push({ item_id: p.box, kind: "stock", qty: 19, remark: "Hemex" });
    await submitCount(p.keeper, input, at(TODAY));
    const v = (await dayView(p.owner, TODAY))!;
    expect(whatsappText("Sample Aqua", TODAY, v.sections)).toBe(
      [
        "*Sample Aqua*",
        "*Stock 8 Oct 2026*",
        "",
        "*Today production*",
        "Bluemins 1 L: 50 box",
        "",
        "*Finished goods*",
        "Bluemins 1 L: 2 box + 19 box (Hemex)",
        "",
        "*Consumable*",
        "Label 1 L: 5 bundle (5000 count)",
        "Roll: 1 roll",
      ].join("\n"),
    );
  });
});
