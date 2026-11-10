// Order flow check (src/lib/flow-check.ts, src/server/flow-check.ts): the lean analysis's order measures for any dates.
// Pure rules on made-up orders, then real orders: who may open it, and one plant never sees another's orders.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { checkDates, flowCheck, lookAlikePlaces, quantile, type CheckOrder } from "@/lib/flow-check";
import { ChangeInput, cancelOrder, changeOrder, DeliverInput, deliverOrder, ReasonInput } from "@/server/handling";
import { flowCheckReport, readCheckParams } from "@/server/flow-check";
import { createOrder, OrderInput } from "@/server/orders";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant, refused } from "./helpers";

const H = 3_600_000;
const at = (d: string, h: number) => Date.parse(`${d}T00:00:00+05:30`) + h * H;
let n = 0;
function o(x: Partial<CheckOrder> & { day?: string; hour?: number; outDay?: string | null; outHour?: number } = {}): CheckOrder {
  const { day = "2026-11-02", hour = 10, outDay = "2026-11-02", outHour = 18, ...rest } = x;
  n++;
  const status = rest.status ?? (outDay ? "delivered" : "pending");
  return {
    id: `o${n}`,
    ref_no: n,
    status,
    entered_at: at(day, hour),
    delivered_at: status === "delivered" && outDay ? at(outDay, outHour) : null,
    cancelled_at: null,
    entered: day,
    delivered: status === "delivered" ? outDay : null,
    entered_hour: hour,
    delivered_hour: status === "delivered" ? outHour : null,
    entered_by: "Dillip",
    delivered_by: status === "delivered" ? "Kedar" : null,
    customer_id: `c${n}`,
    customer_name: "Sri ram hotel",
    place: "Bijepur",
    total: 100_000n,
    changes: 0,
    changes_later: 0,
    undone: 0,
    cancel_reason: null,
    billed: false,
    ...rest,
  };
}

describe("dates", () => {
  it("last 7 / 14 / 30 days end today; previous month is whole; custom is put in order", () => {
    expect(checkDates("last_7", "2026-11-10")).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(checkDates("last_14", "2026-11-10")).toEqual({ from: "2026-10-28", to: "2026-11-10" });
    expect(checkDates("prev_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(checkDates("this_month", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(checkDates("custom", "2026-11-10", { from: "2026-11-08", to: "2026-11-02" })).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(checkDates("custom", "2026-11-10", { from: "junk" })).toEqual({ from: "2026-10-28", to: "2026-11-10" });
  });
  it("80 % quantile by nearest rank", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.8)).toBe(4);
    expect(quantile([], 0.8)).toBeNull();
  });
});

describe("the measures", () => {
  const now = at("2026-11-10", 12);
  const orders = [
    o({ hour: 9, outHour: 17 }), // same day, 8 h
    o({ day: "2026-11-02", outDay: "2026-11-03", outHour: 10, billed: true }), // next day, 24 h
    o({ day: "2026-11-02", outDay: "2026-11-07", outHour: 10, changes: 2, changes_later: 1 }), // 5 days, changed later
    o({ day: "2026-11-09", hour: 11, outDay: null }), // pending, 25 h now
    o({ day: "2026-11-05", hour: 8, outDay: null, total: 50_000n }), // pending, over 2 days
    o({ status: "cancelled", outDay: null, cancelled_at: at("2026-11-02", 10.5), cancel_reason: "typed twice" }), // quick cancel
    o({ status: "cancelled", outDay: null, cancelled_at: at("2026-11-04", 9), cancel_reason: "Shop closed" }),
    o({ day: "2026-10-20", outDay: null }), // pending from before the dates: only in "Pending now"
  ];
  const c = flowCheck(orders, "2026-11-01", "2026-11-10", now);

  it("counts, delivery speed and same / next day", () => {
    expect(c.orders).toEqual({ entered: 7, delivered: 3, pending: 2, cancelled: 2 });
    expect(c.speed).toMatchObject({ delivered: 3, medianHours: 24, sameDay: 1, nextDay: 1, later: 1, over4Days: 1 });
    expect(c.speed.longestHours).toBe(120);
    expect(c.sameNextPct).toBe(67);
    expect(c.deliveryDays).toBe(3);
  });
  it("pending now covers every pending order, oldest first; over 2 days is late", () => {
    expect(c.pendingNow.map((p) => p.entered)).toEqual(["2026-10-20", "2026-11-05", "2026-11-09"]);
    expect(c.pendingLate).toBe(2);
  });
  it("changes, bills, cancels and value leave cancelled orders out", () => {
    expect(c.changed).toEqual({ orders: 1, changes: 2, later: 1, pct: 20, undone: 0 });
    expect(c.billed).toEqual({ delivered: 3, billed: 1, pct: 33 });
    expect(c.cancels).toMatchObject({ total: 2, quick: 1, reasons: [{ name: "Shop closed", count: 1 }] });
    expect(c.value.total).toBe(450_000n);
    expect(c.value.median).toBe(100_000n);
  });
  it("hours, people and weeks", () => {
    expect(c.enteredHours).toEqual([1, 6, 0, 0, 0]);
    expect(c.deliveredHours).toEqual([0, 2, 0, 1, 0]);
    expect(c.enteredBy).toEqual([{ name: "Dillip", count: 7 }]);
    expect(c.weeks.map((w) => [w.from, w.to, w.entered])).toEqual([
      ["2026-11-01", "2026-11-01", 0],
      ["2026-11-02", "2026-11-08", 6],
      ["2026-11-09", "2026-11-10", 1],
    ]);
  });
  it("no orders: nothing divides by zero", () => {
    const e = flowCheck([], "2026-11-01", "2026-11-10", now);
    expect([e.sameNextPct, e.changed.pct, e.billed.pct, e.value.average, e.speed.medianHours]).toEqual([null, null, null, null, null]);
  });
});

describe("look-alike places", () => {
  it("finds spellings one letter apart or differing only in case / spaces", () => {
    const p = (name: string) => ({ name, count: 1 });
    expect(lookAlikePlaces([p("Bijepur"), p("bijepur"), p("Dungripali"), p("Dunguripali"), p("Ghens"), p("Ghnes"), p("Barpali"), p("Sohela")])).toEqual([
      ["Bijepur", "bijepur"],
      ["Dungripali", "Dunguripali"],
      ["Ghens", "Ghnes"],
    ]);
  });
});

describe("on real orders", () => {
  let platform: FakePlatform;
  const a = plant();
  const b = plant();
  const [b1l] = SKUS as [TenantSku];
  let k = 0;
  const order = (p: ReturnType<typeof plant>, phone: string, place: string) =>
    createOrder(p.desk, OrderInput.parse({
      request_key: `check-${Date.now()}-${++k}`,
      customer: { phone, name: "Check shop", place },
      lines: [{ sku_id: b1l.id, quantity: 10, rate: "80" }],
    }));

  beforeAll(async () => {
    platform = await startFakePlatform();
    process.env.PLATFORM_URL = platform.url;
    const one = await order(a, "9222222221", "Bijepur");
    await changeOrder(a.desk, one.id, ChangeInput.parse({ expected: { status: "pending", version: 1 }, lines: [{ sku_id: b1l.id, quantity: 8, rate: "80" }] }));
    await deliverOrder(a.desk, one.id, DeliverInput.parse({ expected: { status: "pending", version: 2 }, invoice_no: "INV-1" }));
    const two = await order(a, "9222222222", "Barpali");
    await cancelOrder(a.owner, two.id, ReasonInput.parse({ expected: { status: "pending", version: 1 }, reason: "typed twice" }));
    await order(a, "9222222223", "Barpali");
    await order(b, "9222222224", "Sohela"); // the other plant
  });
  afterAll(() => platform.close());

  it("reads the plant's orders with their changes, cancels and invoice no.", async () => {
    const c = await flowCheckReport(a.owner, readCheckParams({ period: "last_7" }));
    expect(c.orders).toEqual({ entered: 3, delivered: 1, pending: 1, cancelled: 1 });
    expect(c.changed).toMatchObject({ orders: 1, changes: 1, later: 0 });
    expect(c.billed).toMatchObject({ delivered: 1, billed: 1 });
    expect(c.cancels).toMatchObject({ total: 1, quick: 1 });
    expect(c.speed.sameDay).toBe(1);
    expect(c.enteredBy).toEqual([{ name: "Atharv", count: 3 }]);
    expect(c.places.map((p) => p.name).sort()).toEqual(["Barpali", "Bijepur"]);
  });
  it("another plant's orders never show", async () => {
    const c = await flowCheckReport(b.owner, readCheckParams({}));
    expect(c.orders.entered).toBe(1);
    expect(c.pendingNow.map((p) => p.place)).toEqual(["Sohela"]);
  });
  it("owner and support only", async () => {
    expect((await flowCheckReport(a.support, readCheckParams({}))).orders.entered).toBe(3);
    for (const u of [a.desk, a.staff, a.keeper]) expect((await refused(() => flowCheckReport(u, readCheckParams({})))).status).toBe(403);
  });
});
