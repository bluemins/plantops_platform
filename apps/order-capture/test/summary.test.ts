// The launcher tile: "N pending" (info) / "No pending orders" (ok), "N pending over 2 days" (warn), "N new today" (ok).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelOrder, deliverOrder } from "@/server/handling";
import { createOrder, OrderInput } from "@/server/orders";
import { summaryFor } from "@/server/summary";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const DAY = 24 * 60 * 60 * 1000;
let k = 0;
const add = (p: ReturnType<typeof plant>, phone: string) =>
  createOrder(p.desk, OrderInput.parse({ request_key: `summary-${Date.now()}-${++k}`, customer: { phone, name: "Shop", place: "Bargarh" }, lines: [{ sku_id: SKUS[1]!.id, quantity: 1, rate: "90" }] }));
const enteredAgo = (id: string, ms: number) => asOwner("update order_capture.orders set created_at = now() - make_interval(secs => $2) where id = $1", [id, ms / 1000]);

describe("tile numbers", () => {
  it("an empty plant: No pending orders", async () => {
    expect(await summaryFor(plant().tenantId, "owner")).toEqual({ badges: [{ text: "No pending orders", tone: "ok" }] });
  });

  it("a mixed plant: 3 pending (one 3 days old), one delivered, one cancelled", async () => {
    const p = plant();
    const old = await add(p, "9000000001");
    await add(p, "9000000002");
    await add(p, "9000000003");
    const done = await add(p, "9000000004");
    const gone = await add(p, "9000000005");
    await enteredAgo(old.id, 3 * DAY);
    await deliverOrder(p.desk, done.id, { expected: { status: "pending", version: 1 } });
    await cancelOrder(p.desk, gone.id, { expected: { status: "pending", version: 1 }, reason: "changed mind" });
    expect(await summaryFor(p.tenantId, "staff")).toEqual({
      badges: [
        { text: "3 pending", tone: "info" },
        { text: "1 pending over 2 days", tone: "warn" },
        { text: "4 new today", tone: "ok" },
      ],
    });
  });

  it("the 2-day boundary is the amber cards' (1 day 23 h 59 min: not yet; 2 days: yes)", async () => {
    const p = plant();
    const a = await add(p, "9000000001");
    const b = await add(p, "9000000002");
    await enteredAgo(a.id, 2 * DAY - 60_000);
    await enteredAgo(b.id, 2 * DAY + 1_000);
    const { badges } = await summaryFor(p.tenantId, "owner");
    expect(badges.find((x) => x.tone === "warn")).toEqual({ text: "1 pending over 2 days", tone: "warn" });
  });

  it("each plant counts only its own orders", async () => {
    const a = plant();
    await add(a, "9000000001");
    expect(await summaryFor(plant().tenantId, "owner")).toEqual({ badges: [{ text: "No pending orders", tone: "ok" }] });
    expect((await summaryFor(a.tenantId, "owner")).badges[0]).toEqual({ text: "1 pending", tone: "info" });
  });
});
