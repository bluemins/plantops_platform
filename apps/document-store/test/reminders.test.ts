// Expiry reminders: stages (30 / 7 / 1 days before, on expiry, weekly after), once per stage, a renewal
// starts afresh, owners + the responsible person, one email per person per day, missing email / no email
// service / mail server failure are all recorded on the row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as cron } from "@/app/api/cron/daily/route";
import { createDocument, getDocument, listDocuments, renewDocument, setArchived, uploadFile } from "@/server/documents";
import type { Mailer } from "@/server/mail";
import { deliverReminders, queueReminders, runDaily } from "@/server/reminders";
import { reminderStage } from "@/lib/expiry";
import { KEEPER_ID, NOMAIL_ID, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, inDays, PDF, plant } from "./helpers";

let platform: FakePlatform;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

/** A mailer that records what it would send (or fails on purpose). */
function fakeMailer(fail = false) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    configured: true,
    async send(to, subject, text) {
      if (fail) return { ok: false, error: "Email failed: 535 authentication failed" };
      sent.push({ to, subject, text });
      return { ok: true };
    },
  };
  return { mailer, sent };
}

async function addDoc(P: ReturnType<typeof plant>, name: string, expiresInDays: number | null, responsible = KEEPER_ID) {
  const f = await uploadFile(P.keeper, { data: PDF, name: `${name}.pdf` });
  return createDocument(P.keeper, {
    name,
    certificate_no: "C-1",
    expires_on: expiresInDays === null ? null : inDays(expiresInDays),
    authority: "Authority X",
    support_contact: "Office, 0674-000",
    responsible_user_id: responsible,
    file_id: f.id,
  } as never);
}
const rowsFor = async (documentId: string) =>
  (await asOwner("select stage, recipient_name, email, status, error from document_store.reminders where document_id = $1 order by created_at, recipient_name", [documentId])).rows;

describe("which reminder stage applies today", () => {
  it.each([
    [31, null],
    [30, "d30"],
    [8, "d30"],
    [7, "d7"],
    [2, "d7"],
    [1, "d1"],
    [0, "d0"],
    [-1, "d0"], // the first run after expiry (missed day / added late) still sends the expiry mail
    [-6, "d0"],
    [-7, "expired_w1"],
    [-13, "expired_w1"],
    [-14, "expired_w2"],
  ])("%s days left -> %s", (days, stage) => {
    expect(reminderStage(inDays(days))).toBe(stage);
  });
  it("no expiry -> no reminders", () => expect(reminderStage(null)).toBeNull());
});

describe("queueing and sending", () => {
  it("owners + the responsible person; a person without email is recorded as skipped; sent once", async () => {
    const P = plant();
    const d = await addDoc(P, "FSSAI licence", 7);
    const { mailer, sent } = fakeMailer();
    expect(await queueReminders(P.tenantId)).toBe(3);
    await deliverReminders(P.tenantId, mailer);
    expect((await rowsFor(d.id)).map((r) => [r.stage, r.recipient_name, r.status, r.error])).toEqual([
      ["d7", "Priya", "sent", null],
      ["d7", "Ravi", "skipped", "No email saved for this person"],
      ["d7", "Sujata", "sent", null],
    ]);
    expect(sent.map((m) => m.to).sort()).toEqual(["priya@plant.example", "sujata@plant.example"]);
    expect(sent[0]!.subject).toMatch(/1 document to renew/);
    expect(sent[0]!.text).toMatch(/FSSAI licence \(No\. C-1\) – Expires in 7 days/);
    expect(sent[0]!.text).toMatch(/Contact for renewal: Office, 0674-000/);
    // the same day again: nothing new
    expect(await queueReminders(P.tenantId)).toBe(0);
  });

  it("one email per person per day lists all their documents", async () => {
    const P = plant();
    await addDoc(P, "Fire NOC", 30);
    await addDoc(P, "Trade licence", 1);
    const { mailer, sent } = fakeMailer();
    await queueReminders(P.tenantId);
    await deliverReminders(P.tenantId, mailer);
    const toSujata = sent.filter((m) => m.to === "sujata@plant.example");
    expect(toSujata).toHaveLength(1);
    expect(toSujata[0]!.subject).toMatch(/2 documents to renew/);
    expect(toSujata[0]!.text).toMatch(/Fire NOC/);
    expect(toSujata[0]!.text).toMatch(/Trade licence/);
  });

  it("the next stage sends again; a renewal starts a fresh schedule", async () => {
    const P = plant();
    const d = await addDoc(P, "BIS licence", 10);
    await queueReminders(P.tenantId); // d30 today
    await queueReminders(P.tenantId, inDays(4)); // 6 days left -> d7
    expect((await rowsFor(d.id)).filter((r) => r.recipient_name === "Sujata").map((r) => r.stage)).toEqual(["d30", "d7"]);
    const f = await uploadFile(P.keeper, { data: PDF, name: "new.pdf" });
    await renewDocument(P.keeper, d.id, { file_id: f.id, expires_on: inDays(15), issued_on: null, certificate_no: null, remark: null, reason: "Renewed" });
    expect(await queueReminders(P.tenantId)).toBe(3); // new version: d30 again
  });

  it("archived and no-expiry documents get no reminders", async () => {
    const P = plant();
    const a = await addDoc(P, "Old licence", 3);
    await setArchived(P.keeper, a.id, { archived: true });
    await addDoc(P, "Company PAN", null);
    expect(await queueReminders(P.tenantId)).toBe(0);
  });

  it("someone no longer an owner/keeper stays responsible on paper but is skipped", async () => {
    const P = plant();
    const d = await addDoc(P, "Weights & measures", 5, NOMAIL_ID);
    const saved = platform.contacts;
    platform.contacts = saved!.filter((c) => c.user_id !== NOMAIL_ID);
    try {
      await queueReminders(P.tenantId, inDays(1)); // fresh day so the contacts cache doesn't matter
    } finally {
      platform.contacts = saved;
    }
    expect((await rowsFor(d.id)).find((r) => r.recipient_name === "Ravi")).toBeTruthy();
  });

  it("no email service yet: kept as 'not set up'; a mail server failure: kept with its reason", async () => {
    const P = plant();
    const d = await addDoc(P, "Pollution consent", 7);
    await queueReminders(P.tenantId);
    await deliverReminders(P.tenantId, { configured: false, send: async () => ({ ok: false, error: "x" }) });
    expect((await rowsFor(d.id)).filter((r) => r.email).map((r) => [r.status, r.error])).toEqual([
      ["skipped", "Email is not set up yet"],
      ["skipped", "Email is not set up yet"],
    ]);
    const Q = plant();
    const e = await addDoc(Q, "Lab accreditation", 1);
    await queueReminders(Q.tenantId);
    await deliverReminders(Q.tenantId, fakeMailer(true).mailer);
    expect((await rowsFor(e.id)).filter((r) => r.email).every((r) => r.status === "failed" && /535/.test(r.error))).toBe(true);
  });

  it("each row in the table shows its last reminder", async () => {
    const P = plant();
    const d = await addDoc(P, "Trade licence", 0);
    await queueReminders(P.tenantId);
    await deliverReminders(P.tenantId, fakeMailer().mailer);
    const row = (await listDocuments(P.owner)).find((x) => x.id === d.id)!;
    expect(row.last_reminder).toMatchObject({ stage: "d0", status: "sent" });
    expect((await getDocument(P.owner, d.id)).reminders).toHaveLength(3);
  });
});

describe("daily job endpoint", () => {
  it("needs CRON_SECRET; runs every plant", async () => {
    const call = (secret?: string) => cron(new Request("http://localhost/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("x")).status).toBe(503);
    process.env.CRON_SECRET = "a-long-cron-secret-for-tests";
    expect((await call("wrong-secret-of-same-length!")).status).toBe(401);
    const ok = await call("a-long-cron-secret-for-tests");
    expect(ok.status).toBe(200);
    expect((await ok.json()).plants).toBeGreaterThan(0);
    expect((await runDaily(new Date(), fakeMailer().mailer)).plants).toBeGreaterThan(0);
  });
});
