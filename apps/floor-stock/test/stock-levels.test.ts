// Sales' Plant answers O1 asks Floor Stock for the last count's stock (owner 2026-11-28): only with a lookup ticket for
// scope stock_levels; finished goods linked to a PlantOps product only; the newest count's latest version; another
// plant's count never mixes in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/stock-levels/route";
import { addDays } from "@/lib/days";
import { submitCount } from "@/server/counts";
import { createItem } from "@/server/setup";
import { startFakePlatform, SKUS, type FakePlatform } from "./fake-platform";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const ticket = (tenantId: string, scope = "stock_levels", aud: "floor_stock" | "order_capture" = "floor_stock") =>
  platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, aud, "60s");
const ask = async (token: string | null) => {
  const res = await GET(new Request("http://localhost:3002/api/plantops/stock-levels", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("stock levels for Plant answers", () => {
  it("refused without a ticket, with another scope or for another module; no count yet = empty", async () => {
    const p = await stockPlant();
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await ticket(p.tenantId, "day_report"))).status).toBe(401);
    expect((await ask(await ticket(p.tenantId, "stock_levels", "order_capture"))).status).toBe(401);
    expect(await ask(await ticket(p.tenantId))).toEqual({ status: 200, body: { counted_on: null, counted_at: null, items: [] } });
  });

  it("the newest count's closing stock of finished goods linked to a product; materials and unlinked items left out", async () => {
    const p = await stockPlant();
    const linked = await createItem(p.owner, { section_id: p.fin, name: "Bluemins 500 ml", unit: "box", sku_id: SKUS[1]!.id });
    const day = (date: string, box: number, half: number) => ({
      ...fullCount(p, date, { made: 10, box, label: 3, roll: 3 }),
      lines: [...fullCount(p, date, { made: 10, box, label: 3, roll: 3 }).lines, { item_id: linked.id, kind: "stock" as const, qty: half }],
    });
    await submitCount(p.keeper, day(addDays(TODAY, -1), 50, 30), at(addDays(TODAY, -1)));
    await submitCount(p.keeper, day(TODAY, 40, 12), at(TODAY));
    const r = await ask(await ticket(p.tenantId));
    expect(r.status).toBe(200);
    expect(r.body.counted_on).toBe(TODAY);
    expect(r.body.items).toEqual([{ sku_id: SKUS[1]!.id, name: "Bluemins 500 ml", unit: "box", closing: 12 }]);
    const other = await stockPlant();
    expect((await ask(await ticket(other.tenantId))).body.items).toEqual([]);
  });
});
