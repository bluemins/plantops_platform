// Sales' Plant answers S1–S4 + the morning report ask Floor Stock for its stock facts (owner 2026-11-28, P4-a): only with
// a lookup ticket for scope stock_answers; counts only; the plant's own count; Floor Stock's own rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/plantops/stock-answers/route";
import { addDays } from "@/lib/days";
import { submitCount } from "@/server/counts";
import { setRecipe } from "@/server/recipes";
import { stockAnswers } from "@/server/stock-answers";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const ticket = (tenantId: string, scope = "stock_answers", aud: "floor_stock" | "order_capture" = "floor_stock") =>
  platform.sign({ purpose: "lookup", tenant_id: tenantId, from: "order_capture", scope }, aud, "60s");
const ask = async (token: string | null) => {
  const res = await GET(new Request("http://localhost:3002/api/plantops/stock-answers", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("stock answers for Plant answers", () => {
  it("refused without a ticket, with another scope or for another module; a plant with no count says so", async () => {
    const p = await stockPlant();
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await ticket(p.tenantId, "stock_levels"))).status).toBe(401);
    expect((await ask(await ticket(p.tenantId, "stock_answers", "order_capture"))).status).toBe(401);
    const r = await ask(await ticket(p.tenantId));
    expect(r.status).toBe(200);
    expect(r.body.last_counted_on).toBeNull();
    expect(r.body.days.map((d: { done: boolean }) => d.done)).toEqual([false, false]);
    expect(r.body.history.enough).toBe(false);
  });

  it("8 days of counts: who counted, Can make, days of stock (production × recipe), Sold-based days of stock", async () => {
    const p = await stockPlant();
    await setRecipe(p.owner, p.box, { case_size: 12, lines: [{ material_item_id: p.roll, qty: 1, measure: "pcs" }] });
    for (let i = 7; i >= 0; i--) {
      const date = addDays(TODAY, -i);
      await submitCount(p.keeper, fullCount(p, date, { made: 10, box: 50, label: 3, roll: 2000 - (8 - i) * 120 }), at(date));
    }
    const s = await stockAnswers(p.tenantId, at(TODAY));
    expect(s.count_day).toBe(TODAY);
    expect(s.days.map((d) => [d.date, d.done, d.by])).toEqual([
      [addDays(TODAY, -1), true, p.keeper.name],
      [TODAY, true, p.keeper.name],
    ]);
    expect(s.history).toEqual({ counted_days: 8, from: addDays(TODAY, -7), to: TODAY, enough: true });
    const box = s.products.find((x) => x.item_id === p.box)!;
    expect(box).toMatchObject({ closing: 50, sold_per_day: 10, days_of_stock: 5, why: "ok" });
    expect(box.can_make).toMatchObject({ state: "ok", boxes: Math.floor(1040 / 12), limiting: ["Roll"] });
    const roll = s.materials.find((m) => m.item_id === p.roll)!;
    expect(roll).toMatchObject({ closing: 1040, per_day: 120, days_left: 8.7, why: "ok" });
    expect(s.materials.find((m) => m.item_id === p.label)!.why).toBe("no_recipe");
    // another plant's counts never mix in
    const other = await stockPlant();
    expect((await stockAnswers(other.tenantId, at(TODAY))).last_counted_on).toBeNull();
  });
});
