// App notifications from Document Store (docs/notifications.md N3): expiry stages (once per version and stage, also
// to the responsible person), "you are now responsible", new / renewed (bell only), storage 80% / 95%. Support can't
// write, so it never notifies; a platform that can't be reached never stops a save.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, renewDocument, setArchived, setResponsible, uploadFile } from "@/server/documents";
import { storageStepCrossed } from "@/server/notify";
import { queueReminders } from "@/server/reminders";
import { supportUser } from "@/server/session";
import { KEEPER_ID, OWNER_ID, startFakePlatform, type FakePlatform } from "./fake-platform";
import { inDays, PDF, plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifications.length = 0;
});

const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);
const ofKind = (tenantId: string, kind: string) => sent(tenantId).filter((b) => b.kind === kind);

async function addDoc(P: ReturnType<typeof plant>, name: string, expiresInDays: number | null, by = P.keeper, responsible = KEEPER_ID) {
  const f = await uploadFile(by, { data: PDF, name: `${name}.pdf` });
  return createDocument(by, { name, certificate_no: "C-1", expires_on: expiresInDays === null ? null : inDays(expiresInDays), authority: "FSSAI", support_contact: null, responsible_user_id: responsible, file_id: f.id } as never);
}

describe("expiry", () => {
  it("one notification per due document, to owners + ticked + the responsible person, once per stage", async () => {
    const P = plant();
    const d = await addDoc(P, "FSSAI licence", 7);
    platform.notifications.length = 0;
    await queueReminders(P.tenantId);
    const [n] = ofKind(P.tenantId, "document_store.expiry");
    expect(n).toMatchObject({
      title: "FSSAI licence: expires in 7 days",
      link: `/documents/${d.id}`,
      level: "push",
      dedupe_key: `expiry:${d.current.id}:d7`,
      also_user_ids: [KEEPER_ID],
    });
    expect(n!.body).toMatch(/^No\. C-1\. Expiry date .+\. Responsible: Priya\. Renew it in Document Store\.$/);
    await queueReminders(P.tenantId); // same stage tomorrow: nothing new
    expect(ofKind(P.tenantId, "document_store.expiry").length).toBe(1);
  });

  it("several due documents: one each; not due or no expiry: nothing", async () => {
    const P = plant();
    await addDoc(P, "BIS certificate", 1);
    await addDoc(P, "Pollution board consent", 30);
    await addDoc(P, "Trade licence", 200);
    await addDoc(P, "Partnership deed", null);
    platform.notifications.length = 0;
    await queueReminders(P.tenantId);
    expect(ofKind(P.tenantId, "document_store.expiry").map((n) => n.title).sort()).toEqual(["BIS certificate: expires in 1 day", "Pollution board consent: expires in 30 days"]);
  });

  it("a renewal starts afresh: its own stages are notified again", async () => {
    const P = plant();
    const d = await addDoc(P, "Lab accreditation", 5);
    await queueReminders(P.tenantId);
    const f = await uploadFile(P.keeper, { data: PDF, name: "new.pdf" });
    const r = await renewDocument(P.keeper, d.id, { file_id: f.id, expires_on: inDays(6), issued_on: inDays(0), certificate_no: null, remark: null, reason: "Renewed" } as never);
    platform.notifications.length = 0;
    await queueReminders(P.tenantId);
    expect(ofKind(P.tenantId, "document_store.expiry")).toEqual([expect.objectContaining({ dedupe_key: `expiry:${r.current.id}:d7` })]);
  });

  it("archived documents: nothing", async () => {
    const P = plant();
    const d = await addDoc(P, "Old licence", 3);
    await setArchived(P.owner, d.id, { archived: true } as never);
    platform.notifications.length = 0;
    await queueReminders(P.tenantId);
    expect(ofKind(P.tenantId, "document_store.expiry")).toEqual([]);
  });
});

describe("you are now responsible", () => {
  it("goes only to that person (only_listed), with who chose them", async () => {
    const P = plant();
    const d = await addDoc(P, "FSSAI licence", 90, P.owner, KEEPER_ID);
    const [n] = ofKind(P.tenantId, "document_store.responsible");
    expect(n).toMatchObject({ title: "You are responsible for FSSAI licence", only_listed: true, also_user_ids: [KEEPER_ID], link: `/documents/${d.id}`, level: "push" });
    expect(n!.body).toMatch(/^Sujata made you responsible for renewing it \(valid until .+\)\. You will get its expiry reminders\.$/);
  });

  it("changing the responsible person tells the new one; choosing yourself sends nothing", async () => {
    const P = plant();
    const d = await addDoc(P, "BIS certificate", 90); // the keeper chose themselves
    expect(ofKind(P.tenantId, "document_store.responsible")).toEqual([]);
    await setResponsible(P.keeper, d.id, { responsible_user_id: OWNER_ID });
    expect(ofKind(P.tenantId, "document_store.responsible")).toEqual([expect.objectContaining({ also_user_ids: [OWNER_ID] })]);
  });
});

describe("new and renewed documents (bell only)", () => {
  it("added: bell, the person who added it left out", async () => {
    const P = plant();
    const d = await addDoc(P, "Trade licence", 200);
    expect(ofKind(P.tenantId, "document_store.added")).toEqual([
      expect.objectContaining({ title: "New document: Trade licence", level: "bell", exclude_user_id: KEEPER_ID, dedupe_key: `added:${d.id}` }),
    ]);
    expect(ofKind(P.tenantId, "document_store.added")[0]!.body).toMatch(/^Valid until .+\. Added by Priya\.$/);
  });

  it("renewed: bell, keyed to the new version", async () => {
    const P = plant();
    const d = await addDoc(P, "FSSAI licence", 10);
    const f = await uploadFile(P.keeper, { data: PDF, name: "renewed.pdf" });
    const r = await renewDocument(P.owner, d.id, { file_id: f.id, expires_on: inDays(375), issued_on: inDays(0), certificate_no: null, remark: null, reason: "Renewed" } as never);
    expect(ofKind(P.tenantId, "document_store.renewed")).toEqual([
      expect.objectContaining({ title: "Renewed: FSSAI licence", level: "bell", exclude_user_id: OWNER_ID, dedupe_key: `renewed:${r.current.id}` }),
    ]);
  });
});

describe("storage near the plan limit", () => {
  it("crossing 80% and 95% notifies once each (no limit: never)", async () => {
    const P = plant();
    platform.storageMb[P.tenantId] = 1; // 1 MB plan
    const chunk = (kb: number) => Buffer.concat([PDF, Buffer.alloc(kb * 1024 - PDF.length, 32)]);
    await uploadFile(P.keeper, { data: chunk(700), name: "a.pdf" }); // ~68%: nothing
    expect(ofKind(P.tenantId, "document_store.storage")).toEqual([]);
    await uploadFile(P.keeper, { data: chunk(150), name: "b.pdf" }); // ~83%
    expect(ofKind(P.tenantId, "document_store.storage")).toEqual([expect.objectContaining({ title: "Document storage 80% full", dedupe_key: "storage:80:1", level: "push" })]);
    await uploadFile(P.keeper, { data: chunk(10), name: "c.pdf" }); // still under 95%: nothing new
    await uploadFile(P.keeper, { data: chunk(140), name: "d.pdf" }); // ~98%
    expect(ofKind(P.tenantId, "document_store.storage").map((n) => n.dedupe_key)).toEqual(["storage:80:1", "storage:95:1"]);
  });

  it("the threshold rule", () => {
    expect(storageStepCrossed(70, 85, 100)).toBe(80);
    expect(storageStepCrossed(70, 99, 100)).toBe(95); // both at once: the higher one
    expect(storageStepCrossed(85, 90, 100)).toBeNull();
    expect(storageStepCrossed(10, 99, null)).toBeNull();
  });
});

describe("safety", () => {
  it("PlantOps support can't upload or add, so it never notifies", async () => {
    const P = plant();
    const support = supportUser(P.tenantId, randomUUID());
    expect((await refused(() => uploadFile(support, { data: PDF, name: "x.pdf" }))).status).toBe(403);
    expect(sent(P.tenantId)).toEqual([]);
  });

  it("the platform can't be reached: the document is still saved", async () => {
    const P = plant();
    platform.notifyStatus = 503;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const d = await addDoc(P, "FSSAI licence", 7, P.owner);
      expect(d.current.name).toBe("FSSAI licence");
      expect(await queueReminders(P.tenantId)).toBeGreaterThan(0);
    } finally {
      platform.notifyStatus = 201;
      log.mockRestore();
    }
  });
});
