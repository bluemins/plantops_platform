// App notifications from Lab Records (docs/notifications.md N2): ON HOLD, Form 3/4 FAIL, ready for approval,
// approved / rejected (also to the batch's technicians), result corrected (bell only), the morning reminder and the
// 8 pm "no tests today". The platform picks the people; the WhatsApp outbox keeps working alongside. Support
// sessions can't write, so they never send anything.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addCorrectiveAction, approveBatch, rejectBatch, releaseHold } from "@/server/approval";
import { createBatch } from "@/server/batches";
import { correctEntry, createDailyEntry, createEntry } from "@/server/entries";
import { noTestsNotification, runEvening } from "@/server/notify";
import { listParameters, updateParameter } from "@/server/parameters";
import { runDaily } from "@/server/reminders";
import { kit } from "@/server/kit";
import { supportUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused } from "./helpers";

let platform: FakePlatform;
let P: ReturnType<typeof plant>;
let tds: string;
let ph: string;
let n = 0;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
/** Today at a given India time (the evening job's clock). */
const istAt = (hhmm: string) => new Date(`${today()}T${hhmm}:00+05:30`);
const newBatch = (p = P) => createBatch(p.tech, { batch_no: `N-${++n}`, production_date: today() });
const test = (batchId: string, tdsValue: string, user = P.tech) =>
  createDailyEntry(user, { batch_id: batchId, results: [{ parameter_id: tds, value: tdsValue }, { parameter_id: ph, value: "7.2" }] });
const sent = (tenantId = P.tenantId) => platform.notifications.filter((x) => x.tenantId === tenantId).map((x) => x.body);
const kinds = (tenantId = P.tenantId) => sent(tenantId).map((b) => b.kind);

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
  platform.notifications.length = 0;
});

describe("hold, ready, approve / reject", () => {
  it("a failed test: 'Batch X ON HOLD' with the reason, not sent back to who entered it; once per hold", async () => {
    const b = await newBatch();
    const failing = await test(b.id, "620");
    const [hold] = sent();
    expect(hold).toMatchObject({
      kind: "lab_records.batch_held",
      title: `Batch ${b.batch_no} ON HOLD`,
      link: `/batches/${b.id}`,
      level: "push",
      dedupe_key: `held:${b.id}:${failing.id}`,
      exclude_user_id: P.tech.userId,
    });
    expect(hold!.body).toMatch(/^TDS 620 mg\/L \(max 500\)\. Dispatch is blocked until it is released\. Entered by Atharv\.$/);
    await test(b.id, "700"); // already on hold: nothing new
    expect(kinds()).toEqual(["lab_records.batch_held"]);
  });

  it("a passing test on a pending batch: 'ready for approval' (same key every time, so the platform keeps one)", async () => {
    const b = await newBatch();
    await test(b.id, "300");
    await test(b.id, "310");
    const ready = sent().filter((x) => x.kind === "lab_records.batch_ready");
    expect(ready.length).toBe(2);
    expect(new Set(ready.map((r) => r.dedupe_key))).toEqual(new Set([`ready:${b.id}:0`]));
    expect(ready[0]).toMatchObject({ title: `Batch ${b.batch_no} ready for approval`, body: "1 test on record, nothing failing. Approve it in Lab Records." });
  });

  it("a released hold is ready again (a new round)", async () => {
    const b = await newBatch();
    await test(b.id, "620");
    await addCorrectiveAction(P.tech, b.id, { note: "RO membrane flushed and checked" });
    await test(b.id, "300");
    platform.notifications.length = 0;
    await releaseHold(P.lead, b.id, {});
    expect(sent()).toEqual([expect.objectContaining({ kind: "lab_records.batch_ready", dedupe_key: `ready:${b.id}:1`, exclude_user_id: P.lead.userId })]);
  });

  it("approved: the technicians who tested the batch hear it too (but not whoever approved)", async () => {
    const b = await newBatch();
    await test(b.id, "300");
    await test(b.id, "310", P.lead);
    platform.notifications.length = 0;
    await approveBatch(P.owner, b.id);
    const [d] = sent();
    expect(d).toMatchObject({ kind: "lab_records.batch_approved", title: `Batch ${b.batch_no} approved`, body: "Approved by Sujata.", exclude_user_id: P.owner.userId });
    expect((d!.also_user_ids as string[]).sort()).toEqual([P.tech.userId, P.lead.userId].sort());
  });

  it("rejected: with the reason, also to the technicians; the approver is left out of also_user_ids", async () => {
    const b = await newBatch();
    await test(b.id, "620", P.lead);
    platform.notifications.length = 0;
    await rejectBatch(P.lead, b.id, { reason: "Discarded 2,000 L" });
    const d = sent().find((x) => x.kind === "lab_records.batch_rejected")!;
    expect(d).toMatchObject({ title: `Batch ${b.batch_no} rejected`, body: "Rejected by Priya: Discarded 2,000 L", also_user_ids: [] });
  });
});

describe("corrections, forms, reminders", () => {
  it("a correction is bell only, with the reason", async () => {
    const b = await newBatch();
    const e = await test(b.id, "300");
    platform.notifications.length = 0;
    await correctEntry(P.tech, e.id, { reason: "typing mistake", results: [{ parameter_id: tds, value: "301" }, { parameter_id: ph, value: "7.2" }] });
    expect(sent()).toEqual([
      expect.objectContaining({ kind: "lab_records.entry_corrected", level: "bell", title: "Result corrected (v2)", body: `Daily test on batch ${b.batch_no}, by Atharv: typing mistake`, dedupe_key: `corrected:${e.id}:v2` }),
    ]);
  });

  it("a correction that turns a test into a FAIL sends the ON HOLD notification only", async () => {
    const b = await newBatch();
    const e = await test(b.id, "300");
    platform.notifications.length = 0;
    await correctEntry(P.tech, e.id, { reason: "wrong value typed", results: [{ parameter_id: tds, value: "650" }, { parameter_id: ph, value: "7.2" }] });
    expect(kinds()).toEqual(["lab_records.batch_held"]);
  });

  it("Form 3 FAIL (no batch) is a push notification", async () => {
    const e = await createEntry(P.tech, { form: "form3", data: { source_of_water: "Borewell 2", lab_name: "SGS", sample_sent_on: today(), outcome: "fail" } });
    expect(sent()).toEqual([
      expect.objectContaining({ kind: "lab_records.form_failed", title: "Form 3 · Source water: FAIL", body: "Borewell 2. Recorded by Atharv. Please check.", link: `/entries/${e.id}`, level: "push" }),
    ]);
  });

  it("the morning reminder goes to the app as well as WhatsApp (once a day)", async () => {
    const Q = plant();
    const qTds = (await listParameters(Q.lead, "daily")).find((p) => p.code === "tds")!.id;
    await updateParameter(Q.lead, qTds, { limit_max: "500" });
    const b = await createBatch(Q.tech, { batch_no: `Q-${++n}`, production_date: today() });
    await createDailyEntry(Q.tech, { batch_id: b.id, results: [{ parameter_id: qTds, value: "900" }] });
    await asOwner("update lab_records.batches set held_since = now() - interval '30 hours' where id = $1", [b.id]);
    await runDaily();
    const reminder = sent(Q.tenantId).find((x) => x.kind === "lab_records.daily_reminder")!;
    expect(reminder.title).toBe("Lab Records reminder");
    expect(reminder.body).toMatch(new RegExp(`^1 batch on hold for more than a day: ${b.batch_no}`));
    await runDaily();
    expect(sent(Q.tenantId).filter((x) => x.kind === "lab_records.daily_reminder").length).toBe(1);
  });
});

describe("8 pm: no lab tests entered today", () => {
  it("a plant without a daily test today is reminded; a plant that tested is not", async () => {
    const quiet = plant();
    await listParameters(quiet.lead, "daily"); // sets up its checks, so it uses Lab Records
    await runEvening(istAt("20:30"));
    expect(sent(quiet.tenantId)).toEqual([expect.objectContaining({ kind: "lab_records.no_tests_today", title: "No lab tests entered today", link: "/tests/new" })]);
    const b = await newBatch();
    await test(b.id, "300");
    platform.notifications.length = 0;
    await runEvening(istAt("20:30"));
    expect(kinds(P.tenantId)).not.toContain("lab_records.no_tests_today");
  });

  it("Lab Records switched off for the plant: skipped quietly", async () => {
    const off = plant();
    await listParameters(off.lead, "daily");
    platform.enabled[off.tenantId] = ["floor_stock"];
    const log = vi.spyOn(console, "error");
    await runEvening(istAt("20:30"));
    expect(sent(off.tenantId)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("from 8 pm only: the hourly runs before that send nothing; later runs repeat the same key", async () => {
    const late = plant();
    await listParameters(late.lead, "daily");
    await runEvening(istAt("19:30"));
    expect(sent(late.tenantId)).toEqual([]);
    await runEvening(istAt("20:30"));
    await runEvening(istAt("21:30"));
    const got = sent(late.tenantId);
    expect(got.length).toBe(2); // the platform stores it once (same dedupe key)
    expect(new Set(got.map((g) => g.dedupe_key)).size).toBe(1);
  });

  it("the text", () => {
    expect(noTestsNotification("SAMPLEAQUA", "2026-10-11").body).toBe("SAMPLEAQUA: no daily test has been recorded for 11 Oct.");
  });
});

describe("safety", () => {
  it("PlantOps support can't save, approve or reject, so it never sends a notification", async () => {
    const support = supportUser(P.tenantId, randomUUID());
    const b = await newBatch();
    platform.notifications.length = 0;
    expect((await refused(() => test(b.id, "620", support))).status).toBe(403);
    expect((await refused(() => approveBatch(support, b.id))).status).toBe(403);
    expect((await refused(() => rejectBatch(support, b.id, { reason: "not allowed here" }))).status).toBe(403);
    expect(sent()).toEqual([]);
  });

  it("the platform can't be reached: the test is still saved and the batch still held", async () => {
    platform.notifyStatus = 503;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const b = await newBatch();
      const e = await test(b.id, "620");
      expect(e.current.verdict).toBe("fail");
      const { rows } = await asOwner<{ status: string }>("select status from lab_records.batches where id = $1", [b.id]);
      expect(rows[0]!.status).toBe("on_hold");
      // the ON HOLD notification waits in the outbox and goes out with the next job (N4)
      const waiting = await asOwner<{ kind: string }>("select input->>'kind' as kind from lab_records.notification_outbox where tenant_id = $1 and sent_at is null", [P.tenantId]);
      expect(waiting.rows.map((r) => r.kind)).toContain("lab_records.batch_held");
      platform.notifyStatus = 201;
      platform.notifications.length = 0;
      await kit.retryOutbox();
      expect(kinds()).toContain("lab_records.batch_held");
    } finally {
      platform.notifyStatus = 201;
      log.mockRestore();
    }
  });
});
