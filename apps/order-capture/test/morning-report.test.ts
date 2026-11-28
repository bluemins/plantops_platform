// Plant answers Phase 5 (owner 2026-11-28): the 8:30 morning report. The rules (levels, caps, fill-down, at most 7,
// "nothing urgent"), the saved report (once per plant per day, a second run adds nothing), the owners-only
// notification, Useful / Not useful (owner only, latest counts), support read-only, and the copy (no ₹, no phones,
// no staff names).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { leakIn } from "@/lib/answers/copy";
import type { Facts } from "@/lib/answers/facts";
import { MAX_ACTIONS, morningCopy, morningSummary, rankRules } from "@/lib/answers/rank";
import { createOrder, OrderInput } from "@/server/orders";
import { markAction, morningPage } from "@/server/morning-report";
import { runMorningReport } from "@/server/morning-report-job";
import { OWNER_ID, NOMAIL_OWNER_ID, SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, plant, refused } from "./helpers";

// ---------- the rules (pure) ----------

const rows = (n: number, make: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => make(i)) as Facts["rows"];
const full = {
  S3: { totals: { day: "2026-11-28", done: "Done", by: "Bindu", at: "7:42 pm", not_updated: 2 }, rows: rows(2, (i) => ({ material: ["D Blue cap", "BM 1L label"][i] })) },
  S1: { totals: {}, rows: rows(3, (i) => ({ product: `P${i}`, make: 10 - i, needed: 20, in_stock: 10 + i, unit: "box", can_make: i === 1 ? 4 : 100, short_material: i === 1 ? "2L cap" : null })) },
  S2: { totals: {}, rows: rows(2, (i) => ({ material: `M${i}`, days_left: i + 2, on_hand: "8,400 pcs" })) },
  O1: { totals: {}, rows: rows(3, (i) => ({ ref: `O-00${i}`, customer: `Shop ${i}`, place: "Khurda", days: 3, stock: i === 2 ? "Short: x" : "Stock there", href: `/o/${i}` })) },
  M2: { totals: {}, rows: rows(3, (i) => ({ customer: `Debtor ${i} 9876543210`, place: null, bill_numbers: "B-1, B-2", oldest_days: 50, due: 845_000n, phone: "9876543210", href: "/customers/x" })) },
  O2: { totals: {}, rows: rows(1, () => ({ customer: "Late Shop", place: "Jatni", usual_gap: 6, since_last: 12 })) },
} satisfies Record<string, Facts>;

describe("priority rules (section 3)", () => {
  it("levels in order, each up to its cap, at most 7; the rest counted as left out", () => {
    const r = rankRules(full);
    expect(r.actions.map((a) => [a.level, a.cardId])).toEqual([[1, "S3"], [2, "S1"], [2, "S1"], [3, "S2"], [4, "O1"], [4, "O1"], [5, "M2"]]);
    expect(r.actions).toHaveLength(MAX_ACTIONS);
    expect(r.leftOut).toEqual([{ cardId: "S1", count: 1 }, { cardId: "S2", count: 1 }, { cardId: "M2", count: 2 }, { cardId: "O2", count: 1 }]);
    expect(r.actions[0]!.text).toBe("Last night's count (28 Nov, Bindu, 7:42 pm) did not update 2 materials: D Blue cap, BM 1L label. Ask for a correction.");
    expect(r.actions[0]!.share).not.toMatch(/Bindu/);
    expect(r.actions[2]!.text).toBe("Make 9 box P1: 20 box pending, 11 in stock. Material for only 4 box: 2L cap runs out first.");
    expect(r.actions[4]!.href).toBe("/o/0");
  });
  it("an empty level gives its places to the next; S2 counts only 3 days or fewer", () => {
    const r = rankRules({ S2: full.S2, M2: full.M2, O2: full.O2 });
    expect(r.actions.map((a) => a.cardId)).toEqual(["S2", "M2", "M2", "O2"]);
    expect(r.actions[0]!.text).toBe("M0 runs out in about 2 days at this rate (8,400 pcs left).");
  });
  it("money shows on the screen only; the shared text has no ₹ and no phone number", () => {
    const m2 = rankRules({ M2: full.M2 }).actions[0]!;
    expect(m2.text).toMatch(/₹8,450/);
    expect(m2.share).toBe("Call Debtor 0 xxxxxx3210: 2 bills over 30 days, oldest 50 days late.");
    for (const a of rankRules(full).actions) expect(leakIn(a.share), a.share).toBeNull();
  });
  it("nothing to do: 'Nothing urgent today'", () => {
    const r = rankRules({ S3: { totals: { day: "2026-11-28", done: "Done", not_updated: 0 }, rows: [] }, S1: { totals: {}, rows: [] } });
    expect(r.actions).toEqual([]);
    expect(morningSummary(r).title).toBe("Morning report: nothing urgent today");
    expect(morningCopy("29 Nov 2026", [])).toBe("*Morning report, 29 Nov 2026*\nNothing urgent today.");
  });
});

// ---------- on real rows ----------

let platform: FakePlatform;
const a = plant();
const b = plant();
const [b1l] = SKUS as [TenantSku];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const before = process.env.PLANT_ANSWERS_PLANTS;

const stock = (unit: string) => ({
  count_day: today,
  days: [
    { date: yesterday, done: true, counted_at: `${yesterday}T14:12:00.000Z`, by: "Bindu", corrections: 0, not_updated: [{ name: "D Blue cap", unit: "pcs", closing: 12_500, expected: 8_400, also: [] }] },
    { date: today, done: false, counted_at: null, by: null, corrections: 0, not_updated: [] },
  ],
  last_counted_on: yesterday,
  history: { counted_days: 20, from: "2026-11-01", to: yesterday, enough: true },
  products: [{ sku_id: b1l.id, item_id: "00000000-0000-4000-8000-000000000001", name: "Bluemins 1 L", unit, closing: 50, can_make: { state: "ok", boxes: 100, bottles: 1200, limiting: [], problems: [] }, sold_per_day: 10, days_of_stock: 5, why: "ok" }],
  materials: [],
});

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.PLANT_ANSWERS_PLANTS = `${a.tenantId},${b.tenantId}`;
  const late = await createOrder(a.desk, OrderInput.parse({ request_key: `mr-${Date.now()}`, customer: { phone: "9876543211", name: "Maa Tarini", place: "Sason" }, lines: [{ sku_id: b1l.id, quantity: 5, rate: "90" }] }));
  await asOwner(`update order_capture.orders set created_at = now() - interval '3 days' where id = $1`, [late.id]);
  const unit = ((await asApp(a.tenantId, `select unit from order_capture.order_lines where tenant_id = '${a.tenantId}' and order_id = '${late.id}'`)).rows[0] as { unit: string }).unit;
  platform.stockAnswers.set(a.tenantId, stock(unit));
  platform.stockLevels.set(a.tenantId, { counted_on: yesterday, counted_at: `${yesterday}T14:12:00.000Z`, items: [{ sku_id: b1l.id, name: "Bluemins 1 L", unit, closing: 50 }] });
  // plant b: Floor Stock off (not listed), nothing else
});
afterAll(async () => {
  await platform.close();
  if (before === undefined) delete process.env.PLANT_ANSWERS_PLANTS;
  else process.env.PLANT_ANSWERS_PLANTS = before;
});

describe("the 8:30 job", () => {
  it("saves one report per plant per day and notifies the owners only; a second run adds nothing", async () => {
    const first = await runMorningReport(new Date(), async () => [a.tenantId, b.tenantId]);
    expect(first).toMatchObject({ date: today, made: 2, sent: 2, skipped: [] });
    const again = await runMorningReport(new Date(), async () => [a.tenantId, b.tenantId]);
    expect(again.made).toBe(0);
    const saved = await asOwner(`select tenant_id, jsonb_array_length(actions)::int as n from order_capture.morning_reports where report_date = $1 and tenant_id in ($2, $3)`, [today, a.tenantId, b.tenantId]);
    expect(saved.rows).toHaveLength(2);
    const sent = platform.notifications.filter((x) => x.tenantId === a.tenantId && x.body.kind === "order_capture.morning_report");
    expect(sent[0]!.body).toMatchObject({ dedupe_key: `morning_report:${today}`, only_listed: true, also_user_ids: [OWNER_ID, NOMAIL_OWNER_ID], level: "push", link: `/reports/answers/morning?d=${today}` });
    expect(new Set(sent.map((x) => x.body.dedupe_key)).size).toBe(1);
    expect(leakIn(String(sent[0]!.body.body))).toBeNull();
  });

  it("plant a: last night's count first, then the order with stock ready", async () => {
    const p = await morningPage(a.owner);
    expect(p.report!.actions.map((x) => x.cardId)).toEqual(["S3", "O1"]);
    expect(p.report!.actions[1]!.text).toMatch(/Maa Tarini \(Sason\): waiting 3 days, stock is ready/);
    expect(p.copy).toMatch(/^\*Morning report, .*\n1\. Last night's count/);
    expect(p.copy).not.toMatch(/Bindu|₹/);
  });

  it("plant b: Floor Stock off is said, never 'nothing to do'", async () => {
    const p = await morningPage(b.owner);
    expect(p.report!.missing).toContain("Floor Stock is not switched on for this plant, so stock is not checked.");
    expect(p.report!.actions).toEqual([]);
  });
});

describe("Useful / Not useful (P5-d)", () => {
  it("owner only; the latest tap counts; an action not in the report is refused", async () => {
    await markAction(a.owner, { date: today, action_no: 1, mark: "useful" });
    await markAction(a.owner, { date: today, action_no: 1, mark: "not_useful" });
    await markAction(a.owner, { date: today, action_no: 2, mark: "useful" });
    expect((await morningPage(a.owner)).marks).toEqual({ 1: "not_useful", 2: "useful" });
    expect((await refused(() => markAction(a.owner, { date: today, action_no: 3, mark: "useful" }))).status).toBe(400);
    expect((await refused(() => markAction(a.support, { date: today, action_no: 1, mark: "useful" }))).status).toBe(403);
    expect((await refused(() => markAction(a.desk, { date: today, action_no: 1, mark: "useful" }))).status).toBe(403);
    expect((await refused(() => markAction(a.owner, { date: "2020-01-01", action_no: 1, mark: "useful" }))).status).toBe(404);
  });
  it("support reads the report with no Copy and no buttons; other roles are refused", async () => {
    const p = await morningPage(a.support);
    expect(p.report!.actions).toHaveLength(2);
    expect(p.copy).toBeNull();
    expect(p.canMark).toBe(false);
    expect((await refused(() => morningPage(a.desk))).status).toBe(403);
  });
  it("another plant never sees this plant's report or taps", async () => {
    const p = await morningPage(b.owner);
    expect(p.marks).toEqual({});
    expect((await asApp(b.tenantId, `select count(*)::int as n from order_capture.morning_report_marks where tenant_id = '${a.tenantId}'`)).rows[0]).toEqual({ n: 0 });
  });
});
