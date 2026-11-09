// Drop Phase 4 on the database and the routes: the owner's polls (publish, close once, results, CSV), what a shop sees,
// answering once with poll points decided when saved (week rule, 30-day order rule, points off), poll points in the
// Points tab, plant isolation, support read-only, set-once refusals.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { resetRateLimits } from "@plantops/module-kit/http";
import { GET as pointsRoute } from "@/app/api/app/v1/points/route";
import { POST as answerRoute } from "@/app/api/app/v1/polls/[id]/answer/route";
import { GET as pollsRoute } from "@/app/api/app/v1/polls/route";
import { recentChanges } from "@/server/audit";
import { createCustomer } from "@/server/customers";
import { tokenHash } from "@/server/drop/login";
import { setDrop, SetDropInput } from "@/server/drop/manage";
import { PointsSettingsInput, savePointsSettings } from "@/server/drop/points";
import { closePoll, createPoll, PollInput, pollCsv, pollDetail, pollsPage } from "@/server/drop/polls";
import { saveRates } from "@/server/rates";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, plant, refused } from "./helpers";

const sku = (name: string, ml: number) => ({ id: randomUUID(), name, sku_code: null, volume_ml: ml, units_per_pack: 12, pack_type: "case", status: "active" }) as TenantSku;
const b1 = sku("Bluemins 1L Water Bottle", 1000);
const m1 = sku("Mr.Charge 1 Litre Deionised Water", 1000);

let platform: FakePlatform;
const plants: string[] = [];
const IST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const daysFrom = (n: number) => IST(new Date(Date.now() + n * 86_400_000));
const today = () => daysFrom(0);

function configure() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
}
beforeAll(async () => {
  platform = await startFakePlatform();
  platform.skus = [b1, m1];
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
});
afterAll(async () => {
  await platform.close();
  for (const k of ["DROP_APPS", "DROP_CODE_SECRET"]) delete process.env[k];
});
beforeEach(() => {
  resetRateLimits();
  configure();
});

let n = 0;
/** A plant with points on (start 40 days ago) and its Rates brands; shops are added with shop(). */
async function pollPlant(pointsOn = true) {
  const p = plant();
  plants.push(p.tenantId);
  configure();
  await saveRates(p.owner, { rates: [{ sku_id: m1.id, unit: "box", default_rate: "", brand: "Mr.Charge" }] });
  if (pointsOn)
    await savePointsSettings(
      p.owner,
      PointsSettingsInput.parse({ effective_from: today(), start_date: daysFrom(-40), rupees_per_point: "20", late_days: 5, poll_points: 10, redeem_months: [7], rewards: [] }),
    );
  return { ...p, app: `app-${plants.length - 1}` };
}

/** A switched-on shop with a session; `boxes` = a Bluemins bill 10 days ago; `delivered` = an order delivered 5 days ago. */
async function shop(p: Awaited<ReturnType<typeof pollPlant>>, o: { boxes?: number; delivered?: boolean; phone?: string } = {}) {
  const t = p.tenantId;
  const phone = o.phone ?? `98610${String(++n).padStart(5, "0")}`;
  const c = (await createCustomer(p.owner, { name: `Shop ${n}`, phone, place: n % 2 ? "Bijepur" : "Bargarh" })).customer;
  await setDrop(p.owner, c.id, SetDropInput.parse({ enabled: true }));
  if (o.delivered)
    await asOwner(
      `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, status, total, entered_by, entered_by_name, delivered_at, delivered_by, delivered_by_name, status_changed_at)
       values ($1, ${1000 + n}, $2, $3, 'Shop name', $4, 'Bijepur', 'delivered', 0, gen_random_uuid(), 'Atharv', now() - interval '5 days', gen_random_uuid(), 'Atharv', now() - interval '5 days')`,
      [t, `k-${randomUUID()}`, c.id, phone],
    );
  if (o.boxes) {
    const [b] = (await asOwner<{ id: string }>(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, sub_total, total, created_by, created_by_name)
      values ($1, 'plantops', $2, $3, $4, $5, 'Shop name', 100, 100, gen_random_uuid(), 'Sujata') returning id`, [t, `B-${2000 + n}`, 2000 + n, daysFrom(-10), c.id])).rows;
    await asOwner(`insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, line_total) values ($1, $2, 1, $3, $4, $5, 1, $5)`, [t, b!.id, b1.id, b1.name, o.boxes]);
  }
  const token = `dpt_${randomBytes(32).toString("base64url")}`;
  await asOwner(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ($1, $2, $3, $4, now() + interval '90 days')`, [t, c.id, phone, tokenHash(token)]);
  return { ...c, token };
}

const poll = (p: { owner: Parameters<typeof createPoll>[0] }, over: Partial<Record<string, unknown>> = {}) =>
  createPoll(p.owner, PollInput.parse({ question: "Which size sells most?", choices: ["1L", "500ml", "250ml"], other_allowed: true, brands: ["Bluemins"], opens_on: today(), closes_on: daysFrom(6), ...over }));

const headers = (app: string, token: string) => ({ "content-type": "application/json", "x-drop-app": app, authorization: `Bearer ${token}`, "x-forwarded-for": "10.0.0.1" });
async function list(app: string, token: string) {
  const res = await pollsRoute(new Request("http://localhost:3005/api/app/v1/polls", { headers: headers(app, token) }));
  return { status: res.status, body: await res.json() };
}
async function answer(app: string, token: string, pollId: string, body: unknown) {
  const res = await answerRoute(new Request(`http://localhost:3005/api/app/v1/polls/${pollId}/answer`, { method: "POST", headers: headers(app, token), body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

describe("Drop polls", () => {
  it("owner publishes; the rules for a poll; Order desk can't", async () => {
    const p = await pollPlant();
    expect((await refused(() => poll({ owner: p.desk }))).status).toBe(403);
    expect((await refused(() => poll(p, { opens_on: daysFrom(-1) }))).status).toBe(400);
    expect((await refused(() => poll(p, { closes_on: daysFrom(-1) }))).status).toBe(400);
    expect((await refused(() => poll(p, { choices: ["1L", "1l"] }))).status).toBe(400);
    expect((await refused(() => poll(p, { brands: ["Acme"] }))).status).toBe(400);
    expect(() => PollInput.parse({ question: "Q?", choices: ["one"], other_allowed: false, brands: ["Bluemins"], opens_on: today(), closes_on: today() })).toThrow();
    const { id } = await poll(p, { brands: ["bluemins", "Mr.Charge"] });
    const page = await pollsPage(p.owner);
    expect(page.polls).toEqual([expect.objectContaining({ id, state: "open", answers: 0, brands: ["Bluemins", "Mr.Charge"] })]);
    expect(page.brands).toEqual(["Bluemins", "Mr.Charge"]);
    expect((await recentChanges(p.owner)).some((c) => c.text.includes("Drop poll published"))).toBe(true);
  });

  it("a shop sees open, unanswered polls of its brands only", async () => {
    const p = await pollPlant();
    const s = await shop(p, { delivered: true });
    const open = await poll(p);
    await poll(p, { question: "Mr.Charge shops only?", brands: ["Mr.Charge"] });
    await poll(p, { question: "Opens tomorrow?", opens_on: daysFrom(1) });
    const closed = await poll(p, { question: "Closed early?" });
    await closePoll(p.owner, closed.id);
    const r = await list(p.app, s.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ points_each: 10, this_week: { counted: false }, answered: { count: 0, points: 0 } });
    expect(r.body.polls).toEqual([{ id: open.id, question: "Which size sells most?", choices: ["1L", "500ml", "250ml"], other_allowed: true, closes_at: expect.any(String) }]);
    expect(JSON.stringify(r.body)).not.toMatch(/answers|counts|Sujata/);
  });

  it("answering once: 10 points for the week's first, then 0; Other needs text; poll points reach the Points tab", async () => {
    const p = await pollPlant();
    const s = await shop(p, { delivered: true });
    const a = await poll(p);
    const b = await poll(p, { question: "Do you run out of stock?", choices: ["Often", "Sometimes", "Never"], other_allowed: false });
    expect((await answer(p.app, s.token, b.id, { choice: -1, other: "x" })).status).toBe(400);
    expect((await answer(p.app, s.token, b.id, { choice: 3 })).status).toBe(400);
    expect((await answer(p.app, s.token, a.id, { choice: -1 })).status).toBe(400);
    const first = await answer(p.app, s.token, a.id, { choice: 0 });
    expect(first).toEqual({ status: 201, body: { points: 10, reason: "counted", message: "Thank you! +10 points." } });
    expect((await answer(p.app, s.token, a.id, { choice: 1 })).status).toBe(409);
    const second = await answer(p.app, s.token, b.id, { choice: 2 });
    expect(second.body).toMatchObject({ points: 0, reason: "week_used" });
    expect((await list(p.app, s.token)).body).toMatchObject({ polls: [], this_week: { counted: true }, answered: { count: 2, points: 10 } });
    const pts = await (await pointsRoute(new Request("http://localhost:3005/api/app/v1/points", { headers: headers(p.app, s.token) }))).json();
    expect(pts.balance).toBe(10);
    expect(pts.record[0]).toMatchObject({ month: today().slice(0, 7), polls: 10 });
  });

  it("no points without an order delivered in the last 30 days, or while points are off", async () => {
    const p = await pollPlant();
    const s = await shop(p);
    const a = await poll(p);
    expect((await answer(p.app, s.token, a.id, { choice: 0 })).body).toMatchObject({ points: 0, reason: "no_recent_order", message: expect.stringMatching(/30 days/) });
    const q = await pollPlant(false);
    const t = await shop(q, { delivered: true });
    const b = await poll(q);
    expect((await list(q.app, t.token)).body.points_each).toBe(0);
    expect((await answer(q.app, t.token, b.id, { choice: 1 })).body).toMatchObject({ points: 0, reason: "points_off" });
  });

  it("another plant's poll is not found; a closed poll can't be answered; closed once", async () => {
    const p = await pollPlant();
    const q = await pollPlant();
    const s = await shop(p, { delivered: true });
    const theirs = await poll(q);
    expect((await answer(p.app, s.token, theirs.id, { choice: 0 })).status).toBe(404);
    const a = await poll(p);
    await closePoll(p.owner, a.id);
    expect((await answer(p.app, s.token, a.id, { choice: 0 })).status).toBe(409);
    expect((await refused(() => closePoll(p.owner, a.id))).status).toBe(409);
    expect((await refused(() => closePoll(p.support, a.id))).status).toBe(403);
    expect(await dbError(asApp(p.tenantId, `update order_capture.polls set closed_early_at = now(), closed_early_by_name = 'X' where id = '${a.id}'`))).toMatch(/only once/);
  });

  it("results by place and buying size, and the CSV with each shop's real boxes (formulas neutralised)", async () => {
    const p = await pollPlant();
    const big = await shop(p, { delivered: true, boxes: 60 });
    const mid = await shop(p, { delivered: true, boxes: 12 });
    const small = await shop(p, { delivered: true });
    const a = await poll(p);
    await answer(p.app, big.token, a.id, { choice: 0 });
    await answer(p.app, mid.token, a.id, { choice: 0 });
    await answer(p.app, small.token, a.id, { choice: -1, other: "=HYPERLINK(\"x\")" });
    const d = await pollDetail(p.support, a.id);
    expect(d.results).toMatchObject({ labels: ["1L", "500ml", "250ml", "Other"], total: 3, counts: [2, 0, 0, 1], others: ['=HYPERLINK("x")'] });
    expect(d.results.by_size).toEqual([
      { size: "small", total: 1, counts: [0, 0, 0, 1] },
      { size: "medium", total: 1, counts: [1, 0, 0, 0] },
      { size: "large", total: 1, counts: [1, 0, 0, 0] },
    ]);
    expect(d.results.by_place.map((x) => x.place).sort()).toEqual(["Bargarh", "Bijepur"]);
    expect((await refused(() => pollCsv(p.support, a.id))).status).toBe(403);
    const { body } = await pollCsv(p.owner, a.id);
    const lines = body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^Shop,Place,Phone,Answer,Other text,Points,Answered at,Buying size,Boxes .*,Bluemins 1L Water Bottle$/);
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.startsWith(big.name))).toMatch(/,1L,,10,.*Large \(50\+ boxes\),60,60$/);
    expect(body).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
