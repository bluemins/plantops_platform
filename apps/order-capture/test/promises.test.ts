// Promise to pay (owner, 2026-11-23): states, call order, who may save, tenant isolation, append-only.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeskDue } from "@/lib/accounts-desk";
import { promiseStates, withPromises, type PromiseRow } from "@/lib/promises";
import { withTenant } from "@/server/db";
import { deskCustomerDues } from "@/server/accounts-desk";
import { makeBill } from "@/server/bill-make";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { istToday, receivePayment } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { addPromise, allPromises } from "@/server/promises";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, ocUser, plant, refused } from "./helpers";

const TODAY = "2026-11-23";
let n = 0;
const pr = (promised_on: string, created_on: string, amount: bigint | null = null): PromiseRow => ({ id: String(++n), customer_key: "c:a", promised_on, amount, note: null, by: "Anmol", created_on, created_at: `${created_on}T10:00:${String(n % 60).padStart(2, "0")}` });
const pay = (payment_date: string, amount: bigint) => ({ customer_key: "c:a", payment_date, amount });
const state = (p: PromiseRow, pays: ReturnType<typeof pay>[] = []) => promiseStates([p], pays, TODAY).history[0]!.state;

describe("promise states", () => {
  it("open, due today, broken", () => {
    expect(state(pr("2026-11-25", "2026-11-20"))).toBe("open");
    expect(state(pr(TODAY, "2026-11-20"))).toBe("due_today");
    expect(state(pr("2026-11-22", "2026-11-20"))).toBe("broken");
  });
  it("kept in time, paid late, a part payment is not enough", () => {
    expect(state(pr("2026-11-22", "2026-11-20", 1000n), [pay("2026-11-22", 1000n)])).toBe("kept");
    expect(state(pr("2026-11-21", "2026-11-20", 1000n), [pay("2026-11-22", 1000n)])).toBe("late");
    expect(state(pr("2026-11-22", "2026-11-20", 1000n), [pay("2026-11-21", 400n)])).toBe("broken");
  });
  it("a payment before the promise was noted does not count; no amount = any payment", () => {
    expect(state(pr("2026-11-22", "2026-11-20"), [pay("2026-11-19", 500n)])).toBe("broken");
    expect(state(pr("2026-11-22", "2026-11-20"), [pay("2026-11-21", 1n)])).toBe("kept");
  });
  it("a new date before the old day replaces it and is not counted against the customer", () => {
    const r = promiseStates([pr("2026-11-22", "2026-11-18"), pr("2026-11-28", "2026-11-21")], [], TODAY);
    expect(r.history.map((h) => h.state)).toEqual(["open", "replaced"]);
    expect(r.counted).toBe(0);
  });
  it("kept 1 of 2; a closed promise needs no attention", () => {
    const r = promiseStates([pr("2026-11-10", "2026-11-08"), pr("2026-11-20", "2026-11-15", 500n)], [pay("2026-11-09", 100n), pay("2026-11-20", 500n)], TODAY);
    expect([r.kept, r.counted, r.current]).toEqual([2, 2, null]);
  });
});

describe("call order", () => {
  const due = (key: string): DeskDue => ({ key, name: key, place: "", phone: null, href: "/", due: 100n, overdue: 100n, oldest_days: 1, last_paid: null, advance: 0n, salespeople: [] });
  it("broken, due today, no promise, promised later", () => {
    const p = (k: string, on: string) => ({ ...pr(on, "2026-11-20"), customer_key: k });
    const r = withPromises([due("later"), due("none"), due("today"), due("broke")], [p("later", "2026-11-30"), p("today", TODAY), p("broke", "2026-11-21")], [], TODAY);
    expect(r.map((x) => x.key)).toEqual(["broke", "today", "none", "later"]);
  });
});

describe("the table", () => {
  async function row(tenantId: string) {
    const c = await asOwner<{ id: string }>("insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ($1, 'Shop', '9000000099', '9000000099', 'Bargarh', $2, 'Test') returning id", [tenantId, randomUUID()]);
    const id = c.rows[0]!.id;
    await asOwner("insert into order_capture.payment_promises (tenant_id, customer_id, promised_on, created_by, created_by_name) values ($1, $2, '2026-11-30', $3, 'Test')", [tenantId, id, randomUUID()]);
  }
  it("a plant sees only its own promises", async () => {
    const a = plant();
    const b = plant();
    await row(a.tenantId);
    expect(await allPromises(a.tenantId)).toHaveLength(1);
    expect(await allPromises(b.tenantId)).toHaveLength(0);
  });
  it("the app login can't change or delete a promise", async () => {
    const a = plant();
    await row(a.tenantId);
    await expect(withTenant(a.tenantId, (tx) => tx.execute(sql`update order_capture.payment_promises set note = 'x'`))).rejects.toThrow();
    await expect(withTenant(a.tenantId, (tx) => tx.execute(sql`delete from order_capture.payment_promises`))).rejects.toThrow();
  });
});

describe("saving a promise", () => {
  let platform: FakePlatform;
  beforeAll(async () => {
    platform = await startFakePlatform();
    process.env.PLATFORM_URL = platform.url;
  });
  afterAll(() => platform.close());
  const a = plant();
  const other = plant();
  const acct = ocUser(a.tenantId, ["accounts"], "Anmol");
  const today = istToday();
  const inDays = (d: number) => new Date(Date.parse(today) + d * 86_400_000).toISOString().slice(0, 10);

  it("Accounts saves it; the rules and other roles are refused; a payment closes it; the bill is untouched", async () => {
    const o = await createOrder(a.desk, OrderInput.parse({ request_key: `promise-${Date.now()}`, customer: { phone: "9876501234", name: "Promise Shop", place: "Bargarh" }, lines: [{ sku_id: SKUS[1]!.id, quantity: 1, rate: "100" }] }));
    await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
    await makeBill(acct, { order_id: o.id });
    const before = (await deskCustomerDues(acct))[0]!;
    expect(before.due).toBe(10000n);
    const base = { customer_key: before.key, promised_on: inDays(3) };

    for (const u of [a.desk, a.staff, a.support]) expect((await refused(() => addPromise(u, base))).status).toBe(403);
    expect((await refused(() => addPromise(acct, { ...base, promised_on: inDays(-1) }))).status).toBe(400);
    expect((await refused(() => addPromise(acct, { ...base, promised_on: inDays(91) }))).status).toBe(400);
    expect((await refused(() => addPromise(acct, { ...base, promised_on: "2026-02-31" }))).status).toBe(400);
    expect((await refused(() => addPromise(acct, { ...base, amount: "100.01" }))).status).toBe(400);
    // another plant can't reach this customer
    expect((await refused(() => addPromise(ocUser(other.tenantId, ["accounts"]), base))).status).toBe(400);

    await addPromise(acct, { ...base, amount: "100", note: "after market day" });
    const after = (await deskCustomerDues(acct))[0]!;
    expect(after.due).toBe(10000n);
    expect(after.promises.current).toMatchObject({ state: "open", amount: 10000n, note: "after market day", by: "Anmol" });

    await receivePayment(acct, { customer_id: before.key.slice(2), amount: "100", payment_date: today, mode: "cash", bill_ids: [] });
    expect(await deskCustomerDues(acct)).toEqual([]);
    expect((await refused(() => addPromise(acct, base))).message).toBe("This customer doesn't owe anything now");
  });
});
