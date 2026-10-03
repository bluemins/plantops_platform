// Step 4: failed test -> batch on hold + alert; corrective note; release; approve; reject; WhatsApp outbox;
// daily reminder job. (CLAUDE.md: a failed test puts the batch ON HOLD, requires a corrective-action note,
// alerts the tenant_admin and blocks dispatch; a retest is a new entry and the failed one stays.)
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cron } from "@/app/api/cron/daily/route";
import { whatsappNumber } from "@/server/alerts";
import { addCorrectiveAction, approveBatch, CorrectiveInput, rejectBatch, RejectInput, releaseHold } from "@/server/approval";
import { createBatch, getBatch } from "@/server/batches";
import { correctEntry, createDailyEntry } from "@/server/entries";
import { listParameters, updateParameter } from "@/server/parameters";
import { reminderFor, runDaily } from "@/server/reminders";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused } from "./helpers";

let platform: FakePlatform;
let P: ReturnType<typeof plant>;
let tds: string;
let ph: string;
let n = 0;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const newBatch = () => createBatch(P.tech, { batch_no: `H-${++n}`, production_date: today() });
const test = (batchId: string, tdsValue: string, phValue = "7.2", at?: Date) =>
  createDailyEntry(P.tech, {
    batch_id: batchId,
    tested_at: at?.toISOString(),
    results: [
      { parameter_id: tds, value: tdsValue },
      { parameter_id: ph, value: phValue },
    ],
  });
const alertsFor = async (batchId: string) =>
  (await asOwner("select recipient_name, phone, status, error, message, kind from lab_records.alerts where batch_id = $1 order by recipient_name", [batchId])).rows;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  P = plant();
  const params = await listParameters(P.lead, "daily");
  tds = params.find((p) => p.code === "tds")!.id;
  ph = params.find((p) => p.code === "ph")!.id;
  await updateParameter(P.lead, tds, { limit_max: "500" });
  await updateParameter(P.lead, ph, { limit_min: "6.5", limit_max: "8.5" });
});
afterAll(() => platform.close());
beforeEach(() => {
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
  delete process.env.WHATSAPP_TEMPLATE;
});

describe("a failed test puts the batch on hold", () => {
  it("holds the batch, records why, and queues an alert to owners and lab leads", async () => {
    const b = await newBatch();
    await test(b.id, "620");
    const d = await getBatch(P.owner, b.id);
    expect(d.status).toBe("on_hold");
    expect(d.held_since).not.toBeNull();
    expect(d.events.map((e) => e.event)).toEqual(["created", "held"]);
    expect(d.events[1]).toMatchObject({ by_name: "System (failed test)", note: "TDS 620 mg/L (max 500)" });
    expect(d.check.failing).toEqual(["TDS 620 mg/L (max 500)"]);

    const alerts = await alertsFor(b.id);
    // owners + lab leads only (not the technician); no WhatsApp set up yet -> skipped, kept for the record
    expect(alerts.map((a) => [a.recipient_name, a.status, a.error])).toEqual([
      ["Priya", "skipped", "WhatsApp is not set up yet"],
      ["Ravi", "skipped", "No mobile number saved for this person"],
      ["Sujata", "skipped", "WhatsApp is not set up yet"],
    ]);
    expect(alerts[0]!.message).toMatch(/Batch H-\d+ ON HOLD – TDS 620 mg\/L \(max 500\)\. Dispatch is blocked/);
  });

  it("a second failure while on hold adds no new hold or alert; a passing test leaves a pending batch alone", async () => {
    const b = await newBatch();
    await test(b.id, "620");
    await test(b.id, "700");
    const d = await getBatch(P.owner, b.id);
    expect(d.events.filter((e) => e.event === "held")).toHaveLength(1);
    expect(await alertsFor(b.id)).toHaveLength(3);
    const ok = await newBatch();
    await test(ok.id, "300");
    expect((await getBatch(P.owner, ok.id)).status).toBe("pending");
  });

  it("if the platform can't say who to alert, that is recorded too", async () => {
    const saved = platform.contacts;
    platform.contacts = null;
    try {
      const b = await newBatch();
      await test(b.id, "620");
      expect((await alertsFor(b.id)).map((a) => [a.status, a.error])).toEqual([["failed", "Couldn't reach PlantOps to look up who to alert"]]);
    } finally {
      platform.contacts = saved;
    }
  });
});

describe("release and approve", () => {
  it("full story: hold -> note -> retest -> release -> approve; the failed test stays on record", async () => {
    const b = await newBatch();
    const failed = await test(b.id, "620", "7.2", new Date(Date.now() - 60_000));

    expect((await refused(() => approveBatch(P.owner, b.id))).message).toMatch(/on hold/);
    expect((await refused(() => releaseHold(P.owner, b.id, {}))).message).toMatch(/corrective-action note/);

    await addCorrectiveAction(P.tech, b.id, { note: "RO membrane flushed, prefilter replaced", entry_id: failed.id });
    expect((await refused(() => releaseHold(P.owner, b.id, {}))).message).toMatch(/Still failing: TDS 620/);

    await test(b.id, "410"); // retest: a NEW entry
    await releaseHold(P.owner, b.id, { note: "retest passed" });
    expect((await getBatch(P.owner, b.id)).status).toBe("pending");

    await approveBatch(P.lead, b.id);
    const d = await getBatch(P.owner, b.id);
    expect(d.status).toBe("approved");
    expect(d.events.map((e) => [e.event, e.by_name])).toEqual([
      ["created", "Atharv"],
      ["held", "System (failed test)"],
      ["released", "Sujata"],
      ["approved", "Priya"],
    ]);
    expect(d.entries.find((e) => e.id === failed.id)!.current).toMatchObject({ version: 1, verdict: "fail" }); // untouched
    expect(d.corrective[0]).toMatchObject({ note: "RO membrane flushed, prefilter replaced", by_name: "Atharv" });
  });

  it("a correction that fixes a typo doesn't release the hold by itself", async () => {
    const b = await newBatch();
    const e = await test(b.id, "620");
    await correctEntry(P.tech, e.id, { reason: "typed 620, meter showed 420", results: [{ parameter_id: tds, value: "420" }, { parameter_id: ph, value: "7.2" }] });
    const d = await getBatch(P.owner, b.id);
    expect(d.status).toBe("on_hold");
    expect(d.check.failing).toEqual([]);
    await addCorrectiveAction(P.lead, b.id, { note: "data entry mistake, value re-checked" });
    await releaseHold(P.lead, b.id, {});
    expect((await getBatch(P.owner, b.id)).status).toBe("pending");
  });

  it("approval needs at least one test and nothing failing; can't approve twice", async () => {
    const b = await newBatch();
    expect((await refused(() => approveBatch(P.owner, b.id))).message).toMatch(/at least one test/);
    await test(b.id, "300");
    await approveBatch(P.owner, b.id);
    expect((await refused(() => approveBatch(P.owner, b.id))).status).toBe(409);
  });

  it("a failure after approval puts the batch back on hold and says it was approved", async () => {
    const b = await newBatch();
    await test(b.id, "300");
    await approveBatch(P.owner, b.id);
    await test(b.id, "650");
    expect((await getBatch(P.owner, b.id)).status).toBe("on_hold");
    expect((await alertsFor(b.id))[0]!.message).toMatch(/ON HOLD \(was approved\)/);
  });

  it("a technician can write corrective notes but can't release, approve or reject", async () => {
    const b = await newBatch();
    await test(b.id, "620");
    await addCorrectiveAction(P.tech, b.id, { note: "flushed the line" });
    expect((await refused(() => releaseHold(P.tech, b.id, {}))).status).toBe(403);
    expect((await refused(() => approveBatch(P.tech, b.id))).status).toBe(403);
    expect((await refused(() => rejectBatch(P.tech, b.id, { reason: "discarded 2,000 L" }))).status).toBe(403);
    expect(CorrectiveInput.safeParse({ note: "ok" }).success).toBe(false); // the API refuses a too-short note (and so does the database)
  });
});

describe("reject", () => {
  it("closes an on-hold batch for good, with a reason; no more tests or approval", async () => {
    const b = await newBatch();
    await test(b.id, "620");
    expect(RejectInput.safeParse({ reason: "bad" }).success).toBe(false); // a real reason is required
    await rejectBatch(P.owner, b.id, { reason: "discarded 2,000 L" });
    const d = await getBatch(P.owner, b.id);
    expect(d.status).toBe("rejected");
    expect(d.events.at(-1)).toMatchObject({ event: "rejected", by_name: "Sujata", note: "discarded 2,000 L" });
    expect((await refused(() => test(b.id, "300"))).status).toBe(409);
    expect((await refused(() => approveBatch(P.owner, b.id))).status).toBe(409);
    expect((await alertsFor(b.id)).some((a) => a.kind === "batch_rejected")).toBe(true);
  });

  it("an approved batch can't be rejected", async () => {
    const b = await newBatch();
    await test(b.id, "300");
    await approveBatch(P.owner, b.id);
    expect((await refused(() => rejectBatch(P.owner, b.id, { reason: "changed my mind" }))).status).toBe(409);
  });
});

describe("WhatsApp delivery", () => {
  let wa: Server;
  let received: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  let answer = 200;

  beforeAll(async () => {
    wa = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", auth: req.headers.authorization ?? "", body: JSON.parse(raw) });
        res.writeHead(answer, { "content-type": "application/json" });
        res.end(JSON.stringify(answer === 200 ? { messages: [{ id: "wamid.1" }] } : { error: { message: "Template not approved" } }));
      });
    });
    await new Promise<void>((r) => wa.listen(0, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => wa.close(() => r())));

  const configure = () => {
    process.env.WHATSAPP_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_ID = "12345";
    process.env.WHATSAPP_TEMPLATE = "plantops_lab_alert";
    process.env.WHATSAPP_API_URL = `http://127.0.0.1:${(wa.address() as { port: number }).port}`;
  };

  it("sends the approved template to each owner / lab lead with a number, and marks it sent", async () => {
    configure();
    received = [];
    answer = 200;
    const b = await newBatch();
    await test(b.id, "620");
    expect(received.map((r) => r.body.to).sort()).toEqual(["919876500000", "919876543210"]);
    expect(received[0]!.url).toBe("/12345/messages");
    expect(received[0]!.auth).toBe("Bearer test-token");
    expect(received[0]!.body).toMatchObject({ messaging_product: "whatsapp", type: "template", template: { name: "plantops_lab_alert", language: { code: "en" } } });
    expect((await alertsFor(b.id)).map((a) => a.status)).toEqual(["sent", "skipped", "sent"]);
  });

  it("a refusal from WhatsApp is kept with its reason", async () => {
    configure();
    answer = 400;
    const b = await newBatch();
    await test(b.id, "620");
    const failed = (await alertsFor(b.id)).filter((a) => a.status === "failed");
    expect(failed).toHaveLength(2);
    expect(failed[0]!.error).toMatch(/WhatsApp said 400: Template not approved/);
  });

  it.each([
    ["+91 98765 43210", "919876543210"],
    ["09876543210", "919876543210"],
    ["9876543210", "919876543210"],
    ["12345", null],
    [null, null],
  ])("number %s -> %s", (input, out) => {
    expect(whatsappNumber(input)).toBe(out);
  });
});

describe("daily reminder job", () => {
  it("lists batches on hold for more than a day, once per day", async () => {
    const R = plant();
    const rTds = (await listParameters(R.lead, "daily")).find((p) => p.code === "tds")!.id;
    await updateParameter(R.lead, rTds, { limit_max: "500" });
    const b = await createBatch(R.tech, { batch_no: "OLD-1", production_date: today() });
    await createDailyEntry(R.tech, { batch_id: b.id, results: [{ parameter_id: rTds, value: "900" }] });
    expect(await reminderFor(R.tenantId)).toBeNull(); // on hold, but not for a day yet
    await asOwner("update lab_records.batches set held_since = now() - interval '3 days' where id = $1", [b.id]);
    expect(await reminderFor(R.tenantId)).toMatch(/1 batch on hold for more than a day: OLD-1 \(3 days\)/);
    await runDaily();
    const sent = await asOwner("select count(*)::int as n from lab_records.alerts where tenant_id = $1 and kind = 'daily_reminder'", [R.tenantId]);
    expect(sent.rows[0]!.n).toBeGreaterThan(0);
    expect(await reminderFor(R.tenantId)).toBeNull(); // already reminded today
  });

  it("from the 25th it also says Form 1 isn't recorded yet this month", async () => {
    const R = plant();
    await listParameters(R.lead); // plant starts using Lab Records
    const the26th = new Date("2026-10-26T03:00:00Z");
    expect(await reminderFor(R.tenantId, the26th)).toMatch(/Form 1 \(monthly testing\) is not recorded yet this month/);
    expect(await reminderFor(R.tenantId, new Date("2026-10-10T03:00:00Z"))).toBeNull();
  });

  it("the scheduler endpoint needs CRON_SECRET", async () => {
    const call = (secret?: string) => cron(new Request("http://localhost/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("x")).status).toBe(503);
    process.env.CRON_SECRET = "a-long-cron-secret-for-tests";
    expect((await call()).status).toBe(401);
    expect((await call("wrong-secret-of-same-length!")).status).toBe(401);
    const ok = await call("a-long-cron-secret-for-tests");
    expect(ok.status).toBe(200);
    expect((await ok.json()).plants).toBeGreaterThan(0);
  });
});
