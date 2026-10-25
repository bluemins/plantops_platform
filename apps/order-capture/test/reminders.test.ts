// WhatsApp Step 4 (docs/WHATSAPP_BUILD_PLAN.md section 9): consent to reorder reminders (append-only, newest answer
// wins, the same answer twice writes nothing), the staff tick, the bot's consent call (sources, START only after a
// STOP, unknown numbers), the context answer, and the reminder job: sent once 15 India days after a delivery with the
// approved template, every skip reason, the 30 % holdout drawn once, the caps, the catch-up window, a Twilio refusal
// stopping the pilot and telling the owners, the thank-you sender leaving reminders alone, the pilot page, the cron
// route, and plant isolation.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";
import type { TenantSku } from "@plantops/types";
import { recentChanges } from "@/server/audit";
import { hashBotKey } from "@/server/bot";
import { latestConsent, recordConsent } from "@/server/consent";
import { listCustomers, updateCustomer } from "@/server/customers";
import { withTenant } from "@/server/db";
import { linesText, reminderPilot, remindPlant, runReminders } from "@/server/reminders";
import { sendPending } from "@/server/thanks";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, plant, refused } from "./helpers";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));

const { POST: consentRoute } = await import("@/app/api/bot/v1/consent/route");
const { POST: contextRoute } = await import("@/app/api/bot/v1/context/route");
const { POST: cronRoute } = await import("@/app/api/cron/reminders/route");

const PV1 = { id: randomUUID(), name: "Bluemins 1L", sku_code: "PV_BM_1", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" };
const FROM = "whatsapp:+919000000001";
const THANKS = "HX" + "a".repeat(32);
const REMINDER = "HX" + "b".repeat(32);
const START = "2026-11-01";
const NOW = new Date("2026-11-20T05:00:00Z"); // 10:30 IST on 20 Nov: deliveries of 5 Nov are due
const DUE_DAY = "2026-11-05";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
});
afterAll(async () => {
  await platform.close();
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) delete process.env[k];
});
beforeEach(() => {
  platform.skus = [...SKUS, PV1] as TenantSku[];
  platform.notifications.length = 0;
  resetRateLimits();
  process.env.ORDER_REMINDERS = "on";
  process.env.REMINDER_PILOT_START = START;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ["ORDER_REMINDERS", "REMINDER_PILOT_START", "REMINDER_PILOT_CUSTOMERS", "REMINDER_BUDGET_PAISE", "REMINDER_COST_PAISE", "TWILIO_WHATSAPP_SENDERS", "ORDER_BOT_KEYS"])
    delete process.env[k];
});

/** A plant whose Twilio entry has the thank-you and (unless told not to) the reminder template. */
function remPlant(reminder = true) {
  const p = plant();
  const all = JSON.parse(process.env.TWILIO_WHATSAPP_SENDERS ?? "{}") as Record<string, unknown>;
  all[p.tenantId] = { from: FROM, content_sid: THANKS, ...(reminder ? { reminder_content_sid: REMINDER } : {}) };
  process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify(all);
  return p;
}

const STAFF = randomUUID();
async function customer(tenantId: string, phone = "9876543210", name = "Sri Ram Hotel", active = true) {
  const r = await asApp(
    tenantId,
    `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, active, created_by, created_by_name)
     values ('${tenantId}', '${name}', '${phone}', '${phone}', 'Bijepur', ${active}, '${STAFF}', 'Atharv') returning id`,
  );
  return (r.rows[0] as { id: string }).id;
}
const grant = (tenantId: string, customerId: string) =>
  withTenant(tenantId, (tx) => recordConsent(tx, tenantId, customerId, { status: "granted", source: "bot_after_order", by: { userId: STAFF, name: "WhatsApp" } }));

let ref = 0;
/** An order (delivered on `day` at noon IST unless another status), with its lines. */
async function order(tenantId: string, customerId: string, o: { day?: string; status?: "pending" | "delivered" | "cancelled"; createdAt?: string; lines?: [string, number][] } = {}) {
  const status = o.status ?? "delivered";
  const delivered = status === "delivered";
  const at = `${o.day ?? DUE_DAY}T06:30:00Z`;
  const r = await asApp(
    tenantId,
    `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, status, total,
       entered_by, entered_by_name, created_at, delivered_at, delivered_by, delivered_by_name)
     select '${tenantId}', ${++ref}, 'key-${randomUUID()}', c.id, c.name, c.phone, c.place, '${status}', 0, '${STAFF}', 'Atharv',
       '${o.createdAt ?? at}', ${delivered ? `'${at}'` : "null"}, ${delivered ? `'${STAFF}'` : "null"}, ${delivered ? "'Atharv'" : "null"}
       from order_capture.customers c where c.id = '${customerId}' returning id`,
  );
  const id = (r.rows[0] as { id: string }).id;
  for (const [i, [name, q]] of (o.lines ?? [["Bluemins 1L (1 L × 12)", 5]]).entries())
    await asApp(tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
      values ('${tenantId}', '${id}', 1, ${i + 1}, '${randomUUID()}', '${name}', 'box', ${q}, 0, 0)`);
  return id;
}

/** A fake Twilio send: records the calls, answers ok (or what `answer` says). */
function fakeSend(answer: () => { ok: true; sid: string } | { ok: false; retry: boolean; error: string } = () => ({ ok: true, sid: "SM" + "0".repeat(32) })) {
  const calls: { contentSid: string; from: string; phone: string; variables: Record<string, string> }[] = [];
  const send = async (sender: { from: string; contentSid: string }, phone: string, variables: Record<string, string>) => {
    calls.push({ contentSid: sender.contentSid, from: sender.from, phone, variables });
    return answer();
  };
  return { calls, send };
}
const REMIND = () => 50; // 50 ≥ 30: the "remind" group
const HOLD = () => 10; // below 30: the holdout
const reminderRows = async (tenantId: string) =>
  (
    await asOwner<{ order_id: string; status: string; skip_reason: string | null; error: string | null }>(
      "select order_id, status, skip_reason, error from order_capture.customer_messages where tenant_id = $1 and kind = 'reorder_reminder' order by created_at",
      [tenantId],
    )
  ).rows;

describe("consent (append-only, newest answer wins)", () => {
  it("granted twice writes one row; a stop without a yes writes nothing; a decline is kept each time", async () => {
    const p = plant();
    const c = await customer(p.tenantId);
    const by = { userId: STAFF, name: "WhatsApp" };
    const rec = (status: "granted" | "declined" | "withdrawn") => withTenant(p.tenantId, (tx) => recordConsent(tx, p.tenantId, c, { status, source: "bot_after_order", by }));
    expect(await rec("withdrawn")).toBe(false);
    expect(await rec("declined")).toBe(true);
    expect(await rec("declined")).toBe(true);
    expect(await rec("granted")).toBe(true);
    expect(await rec("granted")).toBe(false);
    expect((await withTenant(p.tenantId, (tx) => latestConsent(tx, p.tenantId, c)))?.status).toBe("granted");
    const n = (await asOwner("select count(*)::int as n from order_capture.customer_consents where tenant_id = $1", [p.tenantId])).rows[0]!.n;
    expect(n).toBe(3);
  });
});

describe("staff tick 'Agreed to WhatsApp reminders'", () => {
  it("owner and Order desk tick / untick: a consent row (staff_phone), a Recent changes line, shown in the list", async () => {
    const p = plant();
    const c = await customer(p.tenantId);
    expect((await updateCustomer(p.desk, c, { reminders: true })).reminders).toBe("granted");
    expect((await updateCustomer(p.desk, c, { reminders: true })).reminders).toBe("granted"); // nothing new
    expect((await listCustomers(p.owner)).customers[0]!.reminders).toBe("granted");
    expect((await updateCustomer(p.owner, c, { reminders: false })).reminders).toBe("withdrawn");
    const rows = (await asOwner("select status, source, created_by_name from order_capture.customer_consents where tenant_id = $1 order by created_at", [p.tenantId])).rows;
    expect(rows).toEqual([
      { status: "granted", source: "staff_phone", created_by_name: "Atharv" },
      { status: "withdrawn", source: "staff_phone", created_by_name: "Sujata" },
    ]);
    expect((await recentChanges(p.owner)).map((ch) => ch.text)).toEqual([
      "Customer Sri Ram Hotel (98765 43210): WhatsApp reminders stopped",
      "Customer Sri Ram Hotel (98765 43210): agreed to WhatsApp reminders (on the phone)",
    ]);
  });

  it("plant staff and PlantOps support can't tick", async () => {
    const p = plant();
    const c = await customer(p.tenantId);
    expect((await refused(() => updateCustomer(p.staff, c, { reminders: true }))).status).toBe(403);
    expect((await refused(() => updateCustomer(p.support, c, { reminders: true }))).status).toBe(403);
  });
});

describe("the bot's consent call (contract 4.8)", () => {
  function botPlant() {
    const p = plant();
    const key = `ocb_${randomBytes(32).toString("base64url")}`;
    process.env.ORDER_BOT_KEYS = JSON.stringify([{ id: randomUUID(), tenant_id: p.tenantId, sha256: hashBotKey(key), label: "Test bot", products: ["PV_BM_1"] }]);
    return { ...p, key };
  }
  const call = (route: (r: Request) => Promise<Response>, key: string, body: unknown) =>
    route(new Request("http://localhost:3005/api/bot/v1/x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) }));
  const consent = async (key: string, body: Record<string, unknown>) => {
    const res = await call(consentRoute, key, { phone: "9876543210", ...body });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("yes after an order → granted (context says so, with the day); STOP → withdrawn; START → granted again", async () => {
    const b = botPlant();
    await customer(b.tenantId);
    expect((await consent(b.key, { status: "granted", source: "bot_after_order", message_sid: "SM1" })).body).toEqual({ recorded: true, reason: null, reminders: "granted" });
    const ctx = (await (await call(contextRoute, b.key, { phone: "9876543210" })).json()) as { reminders: string; reminders_on: string };
    expect(ctx.reminders).toBe("granted");
    expect(ctx.reminders_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await consent(b.key, { status: "withdrawn", source: "whatsapp_stop" })).body).toMatchObject({ recorded: true, reminders: "withdrawn" });
    expect((await consent(b.key, { status: "withdrawn", source: "reminder_button" })).body).toMatchObject({ recorded: false, reminders: "withdrawn" });
    expect((await consent(b.key, { status: "granted", source: "whatsapp_start" })).body).toMatchObject({ recorded: true, reminders: "granted" });
    const audit = (await asOwner("select details from order_capture.audit_log where tenant_id = $1 and action = 'bot.consent'", [b.tenantId])).rows;
    expect(audit).toHaveLength(4);
    expect(JSON.stringify(audit)).not.toContain("9876543210");
  });

  it("START never makes a first yes, nor undoes a staff untick; a no is kept", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    expect((await consent(b.key, { status: "granted", source: "whatsapp_start" })).body).toMatchObject({ recorded: false, reason: "nothing_to_restart", reminders: null });
    expect((await consent(b.key, { status: "declined", source: "bot_after_order" })).body).toMatchObject({ recorded: true, reminders: "declined" });
    await updateCustomer(b.owner, c, { reminders: true });
    await updateCustomer(b.owner, c, { reminders: false });
    expect((await consent(b.key, { status: "granted", source: "whatsapp_start" })).body).toMatchObject({ recorded: false, reason: "nothing_to_restart" });
  });

  it("an unknown number records nothing; a switched-off customer can stop but not say yes; a source can only give its answers", async () => {
    const b = botPlant();
    expect((await consent(b.key, { status: "withdrawn", source: "whatsapp_stop", phone: "9123456789" })).body).toEqual({ recorded: false, reason: "not_found", reminders: null });
    await customer(b.tenantId, "9000000001", "Closed Shop", false);
    expect((await consent(b.key, { status: "granted", source: "bot_after_order", phone: "9000000001" })).body).toMatchObject({ recorded: false, reason: "switched_off" });
    for (const bad of [
      { status: "granted", source: "whatsapp_stop" },
      { status: "withdrawn", source: "bot_after_order" },
      { status: "granted", source: "staff_phone" },
      { status: "granted", source: "bot_after_order", tenant_id: randomUUID() },
    ])
      expect((await consent(b.key, bad)).status).toBe(400);
  });
});

describe("the reminder job", () => {
  it("sends once, 15 India days after the delivery, with the approved template and the last order's lines", async () => {
    const p = remPlant();
    const c = await customer(p.tenantId);
    await grant(p.tenantId, c);
    const o = await order(p.tenantId, c, { lines: [["Bluemins 1L (1 L × 12)", 5], ["Bluemins 500ml (500 ml × 24)", 2]] });
    const f = fakeSend();
    const run = await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW });
    expect(run).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(f.calls).toEqual([{ contentSid: REMINDER, from: FROM, phone: "9876543210", variables: { "1": "Sri Ram Hotel", "2": "5 box Bluemins 1L, 2 box Bluemins 500ml" } }]);
    expect(await reminderRows(p.tenantId)).toEqual([{ order_id: o, status: "sent", skip_reason: null, error: null }]);
    // again the same day, or the next (still in the catch-up window): nothing more
    expect((await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW })).due).toBe(0);
    expect((await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: new Date("2026-11-21T05:00:00Z") })).due).toBe(0);
    expect(f.calls).toHaveLength(1);
  });

  it("the window: 14 days is too early, 17 days catches up, 18 days and before the pilot start are left alone", async () => {
    const p = remPlant();
    const c = await customer(p.tenantId);
    await grant(p.tenantId, c);
    await order(p.tenantId, c, { day: "2026-11-06" }); // 14 days
    const late = await order(p.tenantId, c, { day: "2026-11-03" }); // 17 days
    await order(p.tenantId, c, { day: "2026-11-02" }); // 18 days
    await order(p.tenantId, c, { day: "2026-10-30" }); // before the start
    const f = fakeSend();
    await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW });
    const rows = await reminderRows(p.tenantId);
    expect(rows.map((r) => r.order_id)).toEqual([late]);
  });

  it("every skip reason is kept: no consent, switched off, newer order, holdout (drawn once), recent reminder", async () => {
    const p = remPlant();
    const noConsent = await customer(p.tenantId, "9000000001", "Asha Store");
    const off = await customer(p.tenantId, "9000000002", "Bina Store", false);
    const reordered = await customer(p.tenantId, "9000000003", "Chandu");
    const held = await customer(p.tenantId, "9000000004", "Dipak");
    for (const c of [off, reordered, held]) await grant(p.tenantId, c);
    await order(p.tenantId, noConsent);
    await order(p.tenantId, off);
    await order(p.tenantId, reordered);
    await order(p.tenantId, reordered, { status: "pending", createdAt: "2026-11-10T06:00:00Z" });
    await order(p.tenantId, held);
    const f = fakeSend();
    await remindPlant(p.tenantId, START, { send: f.send, random: HOLD, now: NOW });
    expect(f.calls).toHaveLength(0);
    expect((await reminderRows(p.tenantId)).map((r) => r.skip_reason).sort()).toEqual(["customer_off", "holdout", "newer_order", "no_consent"]);
    // the holdout is for good: a later due order of the same customer is held back too, even with a "remind" draw
    await order(p.tenantId, held, { day: "2026-11-06" });
    await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: new Date("2026-11-21T05:00:00Z") });
    expect(f.calls).toHaveLength(0);
    const groups = (await asOwner("select grp from order_capture.reminder_groups where tenant_id = $1", [p.tenantId])).rows;
    expect(groups).toEqual([{ grp: "holdout" }]);
  });

  it("a reminder in the last 14 days: the next due one is skipped", async () => {
    const p = remPlant();
    const c = await customer(p.tenantId);
    await grant(p.tenantId, c);
    await order(p.tenantId, c, { day: "2026-11-04", createdAt: "2026-11-01T06:00:00Z" });
    await order(p.tenantId, c, { day: "2026-11-05", createdAt: "2026-11-01T06:00:00Z" });
    const f = fakeSend();
    await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW });
    expect((await reminderRows(p.tenantId)).map((r) => r.status + ":" + (r.skip_reason ?? ""))).toEqual(["sent:", "skipped:recent_reminder"]);
  });

  it("caps: pilot full (customers), budget, pilot over", async () => {
    process.env.REMINDER_PILOT_CUSTOMERS = "1";
    const p = remPlant();
    const [c1, c2] = [await customer(p.tenantId, "9000000001", "Asha Store"), await customer(p.tenantId, "9000000002", "Bina Store")];
    for (const c of [c1, c2]) await grant(p.tenantId, c);
    await order(p.tenantId, c1);
    await order(p.tenantId, c2);
    await remindPlant(p.tenantId, START, { send: fakeSend().send, random: REMIND, now: NOW });
    expect((await reminderRows(p.tenantId)).map((r) => r.skip_reason)).toEqual([null, "pilot_full"]);

    delete process.env.REMINDER_PILOT_CUSTOMERS;
    process.env.REMINDER_COST_PAISE = "100";
    process.env.REMINDER_BUDGET_PAISE = "100";
    const q = remPlant();
    const [d1, d2] = [await customer(q.tenantId, "9000000001", "Asha Store"), await customer(q.tenantId, "9000000002", "Bina Store")];
    for (const c of [d1, d2]) await grant(q.tenantId, c);
    await order(q.tenantId, d1);
    await order(q.tenantId, d2);
    await remindPlant(q.tenantId, START, { send: fakeSend().send, random: REMIND, now: NOW });
    expect((await reminderRows(q.tenantId)).map((r) => r.skip_reason)).toEqual([null, "budget"]);

    const r = remPlant();
    const e = await customer(r.tenantId);
    await grant(r.tenantId, e);
    await order(r.tenantId, e, { day: "2027-01-01" });
    await remindPlant(r.tenantId, START, { send: fakeSend().send, random: REMIND, now: new Date("2027-01-16T05:00:00Z") });
    expect((await reminderRows(r.tenantId)).map((x) => x.skip_reason)).toEqual(["pilot_ended"]);
  });

  it("a Twilio refusal: failed, the rest of the run stops, the owners are told, and later runs stay stopped", async () => {
    const p = remPlant();
    const [c1, c2] = [await customer(p.tenantId, "9000000001", "Asha Store"), await customer(p.tenantId, "9000000002", "Bina Store")];
    for (const c of [c1, c2]) await grant(p.tenantId, c);
    await order(p.tenantId, c1);
    await order(p.tenantId, c2);
    const f = fakeSend(() => ({ ok: false, retry: false, error: "Twilio said 400 (63016): template not approved" }));
    const run = await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW });
    expect(run).toMatchObject({ sent: 0, failed: 1, stopped: expect.stringContaining("63016") });
    expect(f.calls).toHaveLength(1);
    await vi.waitFor(() => expect(platform.notifications.map((n) => n.body.kind)).toEqual(["order_capture.reminder_failed"]));
    const again = await remindPlant(p.tenantId, START, { send: fakeSend().send, random: REMIND, now: NOW });
    expect(again.stopped).toContain("63016");
    expect(again.due).toBe(0);
  });

  it("Twilio unreachable: that one failed (not retried), the others still go", async () => {
    const p = remPlant();
    const [c1, c2] = [await customer(p.tenantId, "9000000001", "Asha Store"), await customer(p.tenantId, "9000000002", "Bina Store")];
    for (const c of [c1, c2]) await grant(p.tenantId, c);
    await order(p.tenantId, c1);
    await order(p.tenantId, c2);
    let n = 0;
    const f = fakeSend(() => (n++ === 0 ? { ok: false, retry: true, error: "Twilio unreachable: timeout" } : { ok: true, sid: "SM" + "1".repeat(32) }));
    expect(await remindPlant(p.tenantId, START, { send: f.send, random: REMIND, now: NOW })).toMatchObject({ sent: 1, failed: 1 });
  });

  it("off: ORDER_REMINDERS not on, no start date, or no reminder template for the plant", async () => {
    const p = remPlant(false);
    const c = await customer(p.tenantId);
    await grant(p.tenantId, c);
    await order(p.tenantId, c);
    expect((await remindPlant(p.tenantId, START, { send: fakeSend().send, now: NOW })).stopped).toBe("no reminder template set for this plant");
    process.env.ORDER_REMINDERS = "off";
    expect(await runReminders({ send: fakeSend().send, now: NOW })).toEqual({ on: false });
    process.env.ORDER_REMINDERS = "on";
    delete process.env.REMINDER_PILOT_START;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runReminders({ now: NOW })).toMatchObject({ on: false });
    expect(await reminderRows(p.tenantId)).toEqual([]);
  });

  it("runReminders works through each plant with consents; plant isolation", async () => {
    const a = remPlant();
    const b = remPlant();
    const ca = await customer(a.tenantId);
    const cb = await customer(b.tenantId);
    await grant(a.tenantId, ca);
    await order(a.tenantId, ca);
    await order(b.tenantId, cb); // plant B: no consent
    const f = fakeSend();
    const res = await runReminders({ send: f.send, random: REMIND, now: NOW });
    expect(res.on).toBe(true);
    expect(f.calls.map((x) => x.phone)).toEqual(["9876543210"]);
    expect(await reminderRows(b.tenantId)).toEqual([]); // B has no consents at all, so it isn't even listed
  });

  it("the thank-you sender never sends a reminder row", async () => {
    const p = remPlant();
    const c = await customer(p.tenantId);
    const o = await order(p.tenantId, c);
    await asApp(p.tenantId, `insert into order_capture.customer_messages (tenant_id, order_id, kind, to_phone, requested_by, requested_by_name)
      values ('${p.tenantId}', '${o}', 'reorder_reminder', '9876543210', '${STAFF}', 'Reminder job')`);
    const sent: unknown[] = [];
    expect(await sendPending(p.tenantId, async () => (sent.push(1), { ok: true, sid: "SMx" }))).toEqual({ sent: 0, processed: 0 });
  });

  it("linesText leaves out the pack part", () => {
    expect(linesText([{ quantity: 5, unit: "box", productName: "Bluemins 1L (1 L × 12)" }, { quantity: 1, unit: "jar", productName: "Jar 20L" }])).toBe("5 box Bluemins 1L, 1 jar Jar 20L");
  });
});

describe("the Reminder pilot page and the cron route", () => {
  it("counts per group: sent vs held back, who ordered again within 7 / 14 days, opt-outs; owner and support only", async () => {
    const p = remPlant();
    const [c1, c2] = [await customer(p.tenantId, "9000000001", "Asha Store"), await customer(p.tenantId, "9000000002", "Bina Store")];
    for (const c of [c1, c2]) await grant(p.tenantId, c);
    await order(p.tenantId, c1);
    await remindPlant(p.tenantId, START, { send: fakeSend().send, random: REMIND, now: NOW });
    await order(p.tenantId, c2);
    await remindPlant(p.tenantId, START, { send: fakeSend().send, random: HOLD, now: NOW });
    // A ordered again 3 days after the reminder
    await order(p.tenantId, c1, { status: "pending", createdAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await withTenant(p.tenantId, (tx) => recordConsent(tx, p.tenantId, c2, { status: "withdrawn", source: "whatsapp_stop", by: { userId: STAFF, name: "WhatsApp" } }));

    const v = await reminderPilot(p.owner);
    expect(v).toMatchObject({ on: true, start: START, end: "2026-12-26", template: true, problem: null, agreed: 1, groups: { remind: 1, holdout: 1 }, due: 2, sent: 1, skipped: { holdout: 1 }, opt_outs: 1, refused: null });
    expect(v.reordered).toEqual({ remind: { base: 1, d7: 1, d14: 1 }, holdout: { base: 1, d7: 0, d14: 0 } });
    expect((await reminderPilot(p.support)).sent).toBe(1);
    expect((await refused(() => reminderPilot(p.desk))).status).toBe(403);
  });

  it("the cron route needs CRON_SECRET", async () => {
    process.env.CRON_SECRET = "s".repeat(32);
    try {
      const res = await cronRoute(new Request("http://localhost/api/cron/reminders", { method: "POST", headers: { "x-cron-secret": "wrong" } }));
      expect(res.status).toBe(401);
      process.env.ORDER_REMINDERS = "off";
      const ok = await cronRoute(new Request("http://localhost/api/cron/reminders", { method: "POST", headers: { "x-cron-secret": "s".repeat(32) } }));
      expect(await ok.json()).toEqual({ on: false });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
