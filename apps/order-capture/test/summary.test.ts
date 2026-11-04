// The launcher tile: "N pending" (info) / "No pending orders" (ok), "N pending over 2 days" (warn), "N new today" (ok).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordCall } from "@/server/calls";
import { attendCall, AttendInput, setIgnored } from "@/server/calls-tab";
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

// Phone calls (docs/CALLS_PHASE_PLAN.md "Launcher tiles"): the owner's calls badge replaces "N new today" once the
// plant has any call; Delivery staff get the desk view (waiting, calls today); Order desk and viewers unchanged.
describe("tile numbers with calls", () => {
  const ring = (tenantId: string, phone: string, ago = 60_000) =>
    recordCall({ id: randomUUID(), tenant_id: tenantId, sha256: "0".repeat(64), label: "Order phone" }, { phone, event: "incoming" }, new Date(Date.now() - ago));

  it("owner: N calls today · N waiting instead of N new today; Order desk and viewers keep N new today", async () => {
    const p = plant();
    await add(p, "9000000001");
    await ring(p.tenantId, "9861023456");
    await ring(p.tenantId, "9861011111");
    await attendCall(p.desk, AttendInput.parse({ phone: "9861011111", wrong_number: true }));
    expect(await summaryFor(p.tenantId, "owner")).toEqual({
      badges: [
        { text: "1 pending", tone: "info" },
        { text: "2 calls today · 1 waiting", tone: "warn" },
      ],
    });
    for (const view of ["staff", "viewer"] as const)
      expect(await summaryFor(p.tenantId, view)).toEqual({
        badges: [
          { text: "1 pending", tone: "info" },
          { text: "1 new today", tone: "ok" },
        ],
      });
  });

  it("owner with calls, nobody waiting: info; a plant that never had a call keeps N new today", async () => {
    const p = plant();
    await ring(p.tenantId, "9861023456", 2 * DAY); // an old call: the plant uses calls
    await attendCall(p.desk, AttendInput.parse({ phone: "9861023456", wrong_number: true }));
    expect((await summaryFor(p.tenantId, "owner")).badges).toEqual([
      { text: "No pending orders", tone: "ok" },
      { text: "0 calls today · 0 waiting", tone: "info" },
    ]);
    const q = plant();
    await add(q, "9000000001");
    expect((await summaryFor(q.tenantId, "owner")).badges.at(-1)).toEqual({ text: "1 new today", tone: "ok" });
  });

  it("Delivery staff (desk view): N waiting and calls today, never orders", async () => {
    const p = plant();
    await add(p, "9000000001");
    expect(await summaryFor(p.tenantId, "desk")).toEqual({ badges: [{ text: "Nobody waiting", tone: "ok" }, { text: "0 calls today", tone: "info" }] });
    await ring(p.tenantId, "9861023456");
    await ring(p.tenantId, "9861011111");
    await ring(p.tenantId, "9861022222", 2 * DAY);
    expect(await summaryFor(p.tenantId, "desk")).toEqual({ badges: [{ text: "3 waiting", tone: "warn" }, { text: "2 calls today", tone: "info" }] });
  });

  it("numbers on Not an order number are left out of the tiles", async () => {
    const p = plant();
    await ring(p.tenantId, "9861023456");
    await setIgnored(p.owner, { action: "add", phone: "9861023456", label: "Brother" });
    expect(await summaryFor(p.tenantId, "desk")).toEqual({ badges: [{ text: "Nobody waiting", tone: "ok" }, { text: "0 calls today", tone: "info" }] });
    expect((await summaryFor(p.tenantId, "owner")).badges).toEqual([{ text: "No pending orders", tone: "ok" }]);
  });
});
