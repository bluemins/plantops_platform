// Low-stock email: owners only, once per item per day, newly low items from a correction, one email per owner,
// waits while email isn't set up, retried by the daily job and given up after RETRY_DAYS.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Mailer } from "@plantops/module-kit/mail";
import { POST as cron } from "@/app/api/cron/daily/route";
import { addDays } from "@/lib/days";
import { lowStockEmail, runDaily, sendPending } from "@/server/alerts";
import { submitCount } from "@/server/counts";
import { createItem, updateItem } from "@/server/setup";
import { NOMAIL_OWNER_ID, OWNER_ID, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner } from "./helpers";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  delete process.env.CRON_SECRET;
});

/** A mailer that records what it would send; `fail` makes every send fail. */
function fakeMailer(opts: { fail?: boolean; configured?: boolean } = {}) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    configured: opts.configured ?? true,
    send: async (to, subject, text) => {
      if (opts.fail || opts.configured === false) return { ok: false, error: opts.fail ? "Email failed: provider down" : "Email is not set up yet" };
      sent.push({ to, subject, text });
      return { ok: true };
    },
  };
  return { mailer, sent };
}
const alerts = (tenantId: string) =>
  asOwner<{ item_name: string; recipient_user_id: string; status: string; error: string | null; qty: string }>(
    "select item_name, recipient_user_id, status, error, qty from floor_stock.low_stock_alerts where tenant_id = $1 order by item_name, recipient_name",
    [tenantId],
  ).then((r) => r.rows);

describe("queued on submit", () => {
  it("items below the limit are queued for each owner; no email address = skipped; store keepers never", async () => {
    const p = await stockPlant();
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY));
    expect(saved.low_stock_emails).toBe(2);
    expect((await alerts(p.tenantId)).map((a) => [a.item_name, a.recipient_user_id, a.status])).toEqual([
      ["Roll", NOMAIL_OWNER_ID, "skipped"],
      ["Roll", OWNER_ID, "pending"],
    ]);
  });

  it("at or above the limit, or no limit: nothing", async () => {
    const p = await stockPlant();
    expect((await submitCount(p.keeper, fullCount(p, TODAY, { box: 0, label: 0, roll: 2 }), at(TODAY))).low_stock_emails).toBe(0);
  });

  it("once per item per day: a correction adds only newly low items", async () => {
    const p = await stockPlant();
    await updateItem(p.owner, p.label, { min_level: 3 });
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 5, roll: 1 }), at(TODAY));
    const fix = await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 0.5 }, { expected_version: 1, reason: "recount" }), at(TODAY));
    expect(fix.low_stock_emails).toBe(2); // label (both owners); roll was already queued
    expect((await alerts(p.tenantId)).filter((a) => a.recipient_user_id === OWNER_ID).map((a) => [a.item_name, a.qty])).toEqual([
      ["Label 1 L", "1.00"],
      ["Roll", "1.00"], // the first time it was seen low
    ]);
    // the next day it is emailed again
    const tomorrow = addDays(TODAY, 1);
    expect((await submitCount(p.keeper, fullCount(p, tomorrow, { box: 5, label: 1, roll: 1 }), at(tomorrow))).low_stock_emails).toBe(4);
  });

  it("platform unreachable: the count is still saved, no email queued", async () => {
    const p = await stockPlant();
    platform.contacts = null;
    try {
      expect(await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY))).toMatchObject({ version: 1, low_stock_emails: 0 });
    } finally {
      platform.contacts = (await import("./fake-platform")).CONTACTS;
    }
  });
});

describe("sending", () => {
  it("one email per owner with every queued item; then marked sent and never sent again", async () => {
    const p = await stockPlant();
    const tap = await createItem(p.owner, { section_id: p.con, name: "Tap", unit: "pcs", min_level: 10 });
    const input = fullCount(p, TODAY, { box: 5, label: 1, roll: 1 });
    input.lines.push({ item_id: tap.id, kind: "stock", qty: 4 });
    await submitCount(p.keeper, input, at(TODAY));
    const { mailer, sent } = fakeMailer();
    expect(await sendPending(p.tenantId, mailer)).toEqual({ sent: 2, waiting: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "sujata@plant.example", subject: "Low stock at Sample Aqua: 2 items below the limit" });
    expect(sent[0]!.text).toContain("- Roll: 1 (limit 2)");
    expect(sent[0]!.text).toContain("- Tap: 4 (limit 10)");
    expect(await sendPending(p.tenantId, mailer)).toEqual({ sent: 0, waiting: 0, failed: 0 });
    expect((await alerts(p.tenantId)).map((a) => a.status).sort()).toEqual(["sent", "sent", "skipped", "skipped"]);
  });

  it("email not set up yet: stays pending, sent once it is", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY));
    expect(await sendPending(p.tenantId, fakeMailer({ configured: false }).mailer)).toEqual({ sent: 0, waiting: 1, failed: 0 });
    expect((await alerts(p.tenantId)).find((a) => a.recipient_user_id === OWNER_ID)).toMatchObject({ status: "pending", error: "Email is not set up yet" });
    const { mailer, sent } = fakeMailer();
    await sendPending(p.tenantId, mailer);
    expect(sent).toHaveLength(1);
  });

  it("a failed send is retried, then given up after 7 days", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY));
    const down = fakeMailer({ fail: true }).mailer;
    expect(await sendPending(p.tenantId, down)).toEqual({ sent: 0, waiting: 1, failed: 0 });
    expect(await sendPending(p.tenantId, down, new Date(Date.now() + 8 * 86_400_000))).toEqual({ sent: 0, waiting: 0, failed: 1 });
    expect((await alerts(p.tenantId)).find((a) => a.recipient_user_id === OWNER_ID)).toMatchObject({ status: "failed", error: "Email failed: provider down" });
  });

  it("the daily job sends for every plant with emails waiting", async () => {
    const a = await stockPlant();
    const b = await stockPlant();
    for (const p of [a, b]) await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY));
    const { mailer, sent } = fakeMailer();
    const r = await runDaily(mailer);
    expect(r.sent).toBeGreaterThanOrEqual(2);
    expect(r.errors).toBe(0);
    expect(sent.filter((s) => s.to === "sujata@plant.example").length).toBeGreaterThanOrEqual(2);
    for (const p of [a, b]) expect((await alerts(p.tenantId)).find((x) => x.recipient_user_id === OWNER_ID)?.status).toBe("sent");
  });

  it("the email text lists items by day and links to the count", () => {
    const m = lowStockEmail("Sample Aqua", [{ countDate: TODAY, itemName: "Roll", qty: "1.50", minLevel: "2.00" }], "https://stock.example/day/2026-10-08");
    expect(m.subject).toBe("Low stock at Sample Aqua: 1 item below the limit");
    expect(m.text).toContain("Count of 8 Oct 2026:\n- Roll: 1.5 (limit 2)");
    expect(m.text).toContain("Open Floor Stock: https://stock.example/day/2026-10-08");
  });
});

describe("daily job endpoint", () => {
  const call = (secret?: string) => cron(new Request("http://x/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
  it("is off without CRON_SECRET and refuses a wrong secret", async () => {
    expect((await call("x")).status).toBe(503);
    process.env.CRON_SECRET = "the-right-secret";
    expect((await call()).status).toBe(401);
    expect((await call("the-wrong-secre")).status).toBe(401);
  });
});
