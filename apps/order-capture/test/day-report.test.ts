// Reports → Day report on real rows (src/server/day-report.ts; owner 2026-11-16): today's order, delivery, bill, payment
// and cash-book expense; the other modules' parts through lookup tickets (in / off / didn't answer); owner only (support
// reads); another plant sees none of it; the evening job notifies the plant's owners only, once a day.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantSku } from "@plantops/types";
import { POST as cron } from "@/app/api/cron/day-report/route";
import { makeBill } from "@/server/bill-make";
import { addEntry, cashLists, startCashBook } from "@/server/cash";
import { dayReport } from "@/server/day-report";
import { runDayReport } from "@/server/day-report-job";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { kit } from "@/server/kit";
import { ReceivePaymentInput, receivePayment } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { NOMAIL_OWNER_ID, OWNER_ID, SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Anmol");
const [b1l] = SKUS as [TenantSku];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const STOCK = { summary: "Counted 6:40 pm · 1 low", tone: "bad", rows: [{ label: "Low", value: "Caps 2 box (limit 5)", tone: "bad" }], attention: ["1 stock item low: Caps"] };

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  // delivered and billed (10 × ₹90 = ₹900), ₹400 received in cash; one more order still pending
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `day-${Date.now()}`,
    customer: { phone: "9876543210", name: "Sri ram hotel", place: "Bijepur" },
    lines: [{ sku_id: b1l.id, quantity: 10, rate: "90" }],
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  await makeBill(acct, { order_id: o.id });
  const customer = ((await asApp(a.tenantId, `select id from order_capture.customers where tenant_id = '${a.tenantId}' and phone = '9876543210'`)).rows[0] as { id: string }).id;
  await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: customer, amount: "400", payment_date: today, mode: "cash" }));
  await createOrder(a.desk, OrderInput.parse({
    request_key: `day2-${Date.now()}`,
    customer: { phone: "9876543211", name: "Maa Tarini", place: "Sason" },
    lines: [{ sku_id: b1l.id, quantity: 5, rate: "90" }],
  }));
  // cash book started yesterday; ₹160 diesel today, not closed yet
  await startCashBook(a.owner, { date: yesterday, counted: "5000" }, today);
  vi.spyOn(kit, "contacts").mockResolvedValue([]);
  const diesel = (await cashLists(a.owner)).categories.find((c) => c.name === "Diesel")!;
  await addEntry(acct, { kind: "expense", amount: "160", cash_date: today, category_id: diesel.id }, today);
  vi.restoreAllMocks();
  // Floor Stock answers; Attendance is on but fails; Complaint Box and Job applications are off for the plant
  platform.dayParts.set("floor_stock", STOCK);
  platform.dayParts.set("attendance_salary", 500);
});
afterAll(() => platform.close());

describe("Day report on real rows", () => {
  it("headline numbers, sections and Needs you for today", async () => {
    const r = await dayReport(a.owner, today);
    expect(r.isToday).toBe(true);
    expect(r.tiles.map((t) => t.value)).toEqual(["₹900", "₹400", "10 box", "₹500"]);
    expect(r.tiles[1]!.sub).toBe("Cash ₹400 · Online ₹0");
    const orders = r.sections.find((s) => s.id === "orders")!.part!;
    expect(orders.summary).toBe("2 new · 1 delivered · 1 pending");
    const bills = r.sections.find((s) => s.id === "bills")!.part!;
    expect(bills.rows.find((x) => x.label === "Bills made")!.value).toMatch(/^1 · ₹900 \(B-\d{4}\)$/);
    expect(bills.rows.find((x) => x.label === "Customers owe (end of day)")!.value).toBe("₹500");
    const cash = r.sections.find((s) => s.id === "cash")!.part!;
    expect(cash.summary).toBe("Not closed");
    expect(cash.rows).toContainEqual({ label: "  Diesel", value: "₹160" });
    // the other modules: Stock in, Attendance missing (shown, needs you), the two that are off left out
    expect(r.sections.map((s) => [s.id, s.state])).toEqual([["orders", "in"], ["bills", "in"], ["cash", "in"], ["purchases", "in"], ["floor_stock", "in"], ["attendance_salary", "unreachable"]]);
    expect(r.attention.map((x) => x.text)).toEqual(["Cash book not closed yet today", "1 stock item low: Caps", "Attendance didn't answer: its numbers are missing"]);
    // every ticket was for this plant and the day_report scope
    expect(platform.tickets.filter((t) => t.tenantId === a.tenantId).every((t) => t.scope === "day_report")).toBe(true);
  });

  it("an earlier day: nothing from today, the cash book's own state for that day", async () => {
    const r = await dayReport(a.owner, yesterday);
    expect(r.isToday).toBe(false);
    expect(r.tiles.map((t) => t.value).slice(0, 3)).toEqual(["₹0", "₹0", "0"]);
    expect(r.sections.find((s) => s.id === "cash")!.part!.summary).toMatch(/^Closed/);
  });

  it("owner only: Order desk and Accounts are refused, PlantOps support reads", async () => {
    expect((await refused(() => dayReport(a.desk, today))).status).toBe(403);
    expect((await refused(() => dayReport(acct, today))).status).toBe(403);
    expect((await dayReport(a.support, today)).tiles[0]!.value).toBe("₹900");
  });

  it("another plant sees none of it", async () => {
    const r = await dayReport(b.owner, today);
    expect(r.tiles.map((t) => t.value)).toEqual(["₹0", "₹0", "0", "₹0"]);
    expect(r.sections.find((s) => s.id === "orders")!.part!.summary).toBe("0 new · 0 delivered · 0 pending");
  });

  it("the evening job: one push to the plant's owners only (never ticked staff), the same key all day", async () => {
    platform.notifications.length = 0;
    const res = await runDayReport(new Date(), async () => [a.tenantId]);
    expect(res).toMatchObject({ date: today, plants: 1, skipped: [] });
    const n = platform.notifications.find((x) => x.tenantId === a.tenantId)!.body;
    expect(n).toMatchObject({ kind: "order_capture.day_report", level: "push", only_listed: true, dedupe_key: `day_report:${today}`, link: `/reports/day?d=${today}` });
    expect((n.also_user_ids as string[]).sort()).toEqual([OWNER_ID, NOMAIL_OWNER_ID].sort());
    expect(String(n.title)).toMatch(/^Day report · /);
    expect(String(n.body)).toBe("Sales ₹900 · Received ₹400 · Cash: not closed · 3 things need you");
  });

  it("the job is skipped for a plant when PlantOps can't list its owners", async () => {
    platform.notifications.length = 0;
    const saved = platform.contacts;
    platform.contacts = null;
    const res = await runDayReport(new Date(), async () => [b.tenantId]);
    platform.contacts = saved;
    expect(res.plants).toBe(0);
    expect(platform.notifications).toEqual([]);
  });

  it("the cron address needs the secret", async () => {
    const res = await cron(new Request("http://localhost/api/cron/day-report", { method: "POST", headers: { "x-cron-secret": "wrong" } }));
    expect(res.status).toBe(401);
  });
});
