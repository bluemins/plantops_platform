// Documents, files, renewals and corrections; append-only history (also at database level); who may do
// what; plant isolation; the plan's storage limit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  correctDocument,
  createDocument,
  getDocument,
  listDocuments,
  readFile,
  renewDocument,
  setArchived,
  setResponsible,
  uploadFile,
} from "@/server/documents";
import { exportDocumentBundle, exportDocuments } from "@/server/export";
import { supportUser } from "@/server/session";
import { expiryStatus } from "@/lib/expiry";
import { KEEPER_ID, NOMAIL_ID, OWNER_ID, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, inDays, JPEG, PDF, plant, PNG, refused, WEBP } from "./helpers";

let platform: FakePlatform;
let P: ReturnType<typeof plant>;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  P = plant();
});
afterAll(() => platform.close());

const upload = (user = P.keeper, data: Buffer = PDF, name = "licence.pdf") => uploadFile(user, { data, name });
const addDoc = async (over: Record<string, unknown> = {}, user = P.keeper) => {
  const f = await upload(user);
  return createDocument(user, {
    name: "FSSAI licence",
    certificate_no: "10019022008123",
    issued_on: inDays(-300),
    expires_on: inDays(20),
    authority: "FSSAI, Bhubaneswar",
    support_contact: "Food Safety Officer, 0674-2390000",
    remark: null,
    responsible_user_id: KEEPER_ID,
    file_id: f.id,
    ...over,
  } as never);
};

describe("files", () => {
  it.each([
    ["PDF", PDF, "application/pdf"],
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ])("accepts %s, recognised by its content", async (_n, data, type) => {
    const f = await upload(P.keeper, data as Buffer, "anything.bin");
    expect(f).toMatchObject({ content_type: type, size_bytes: (data as Buffer).length, uploaded_by_name: "Priya" });
    const back = await readFile(P.owner, f.id);
    expect(back.data.equals(data as Buffer)).toBe(true);
  });

  it.each([
    ["SVG (can carry scripts)", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["a program renamed .pdf", Buffer.from("MZ\x90\x00\x03 this is an exe")],
    ["an empty file", Buffer.alloc(0)],
  ])("refuses %s", async (_n, data) => {
    expect([400, 415]).toContain((await refused(() => upload(P.keeper, data, "evil.pdf"))).status);
  });

  it("refuses a file over 10 MB", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await refused(() => upload(P.keeper, big))).status).toBe(413);
  });

  it("keeps a safe version of the original name", async () => {
    const f = await upload(P.keeper, PDF, 'bad/..\\"name\r\n.pdf');
    expect(f.original_name).not.toMatch(/[\\/"\r\n]/);
  });

  it("refuses an upload over the plan's storage limit", async () => {
    const S = plant();
    platform.storageMb[S.tenantId] = 1;
    await upload(S.keeper, Buffer.concat([PDF, Buffer.alloc(700 * 1024)]));
    const r = await refused(() => upload(S.keeper, Buffer.concat([PDF, Buffer.alloc(400 * 1024)])));
    expect(r).toMatchObject({ status: 413, message: expect.stringMatching(/Storage full/) });
  });

  it("another plant can't read our file (404), and a store keeper / support can't upload", async () => {
    const f = await upload();
    expect((await refused(() => readFile(plant().owner, f.id))).status).toBe(404);
    expect((await refused(() => upload(P.storeKeeper))).status).toBe(403);
    expect((await refused(() => upload(supportUser(P.tenantId, OWNER_ID)))).status).toBe(403);
  });

  it("downloads a ZIP with the manifest and every original version file; only the owner can export it", async () => {
    expect((await refused(() => exportDocumentBundle(P.keeper))).status).toBe(403);
    const d = await addDoc({ name: "ZIP export test" });
    const next = await upload(P.keeper, PNG, "renewed.png");
    await renewDocument(P.keeper, d.id, { file_id: next.id, expires_on: inDays(370), issued_on: inDays(0), certificate_no: "ZIP-2", remark: null, reason: "Renewed" });

    const { stream, files } = await exportDocumentBundle(P.owner);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const zip = Buffer.concat(chunks);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);

    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(end).toBeGreaterThan(0);
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
      expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
      const method = zip.readUInt16LE(offset + 10);
      const compressedSize = zip.readUInt32LE(offset + 20);
      const nameLength = zip.readUInt16LE(offset + 28);
      const extraLength = zip.readUInt16LE(offset + 30);
      const commentLength = zip.readUInt16LE(offset + 32);
      const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
      const local = zip.readUInt32LE(offset + 42);
      const localNameLength = zip.readUInt16LE(local + 26);
      const localExtraLength = zip.readUInt16LE(local + 28);
      const start = local + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      entries.set(name, method === 0 ? compressed : inflateRawSync(compressed));
      offset += 46 + nameLength + extraLength + commentLength;
    }

    expect(files).toBe(2);
    expect(entries.get("documents.csv")?.toString()).toContain("ZIP export test");
    expect([...entries.values()].some((data) => data.equals(PDF))).toBe(true);
    expect([...entries.values()].some((data) => data.equals(PNG))).toBe(true);
    const audit = await asOwner<{ details: { files: number } }>(
      "select details from document_store.audit_log where tenant_id = $1 and action = 'export.documents_bundle' order by at desc limit 1",
      [P.tenantId],
    );
    expect(audit.rows[0]?.details.files).toBeGreaterThanOrEqual(2);
  });
});

describe("adding a document", () => {
  it("saves version 1 with the six attributes, its file and the responsible person", async () => {
    const d = await addDoc();
    expect(d).toMatchObject({ status: "active", responsible_name: "Priya", created_by_name: "Priya" });
    expect(d.current).toMatchObject({
      version: 1,
      kind: "initial",
      name: "FSSAI licence",
      certificate_no: "10019022008123",
      expires_on: inDays(20),
      authority: "FSSAI, Bhubaneswar",
      support_contact: "Food Safety Officer, 0674-2390000",
      file: { content_type: "application/pdf" },
    });
    expect(d.expiry).toEqual({ kind: "soon", days: 20, text: "Expires in 20 days" });
  });

  it("refuses: responsible person who isn't an owner/keeper, a missing file, expiry before issue, a store keeper", async () => {
    const f = await upload();
    const base = { name: "X", responsible_user_id: KEEPER_ID, file_id: f.id } as never;
    expect((await refused(() => createDocument(P.keeper, { ...(base as object), responsible_user_id: crypto.randomUUID() } as never))).message).toMatch(/owner or a document keeper/);
    expect((await refused(() => createDocument(P.keeper, { ...(base as object), file_id: crypto.randomUUID() } as never))).message).toMatch(/Upload the file/);
    expect((await refused(() => createDocument(P.keeper, { ...(base as object), issued_on: inDays(-1), expires_on: inDays(-5) } as never))).status).toBe(400);
    expect((await refused(() => createDocument(P.storeKeeper, base))).status).toBe(403);
  });

  it("the owner can add documents too", async () => {
    expect((await addDoc({ name: "BIS licence", responsible_user_id: OWNER_ID }, P.owner)).responsible_name).toBe("Sujata");
  });
});

describe("renewals and corrections keep history", () => {
  it("a renewal is version 2 with the new file and expiry; version 1 and its file stay", async () => {
    const d = await addDoc({ expires_on: inDays(5) });
    const newFile = await upload(P.keeper, PNG, "renewed.png");
    const r = await renewDocument(P.keeper, d.id, { file_id: newFile.id, expires_on: inDays(370), issued_on: inDays(0), certificate_no: "NEW-2027", remark: null, reason: "Renewed" });
    expect(r.versions.map((v) => [v.version, v.kind, v.expires_on])).toEqual([
      [1, "initial", inDays(5)],
      [2, "renewal", inDays(370)],
    ]);
    expect(r.current).toMatchObject({ certificate_no: "NEW-2027", name: "FSSAI licence", authority: "FSSAI, Bhubaneswar", file: { id: newFile.id } });
    expect(r.expiry.kind).toBe("valid");
    expect((await readFile(P.owner, r.versions[0]!.file.id)).file.content_type).toBe("application/pdf"); // the old file still opens
  });

  it("a correction needs a reason and a real change; the file is kept unless replaced", async () => {
    const d = await addDoc();
    const c = d.current;
    const fixed = await correctDocument(P.owner, d.id, {
      name: c.name,
      certificate_no: "10019022008124",
      issued_on: c.issued_on,
      expires_on: c.expires_on,
      authority: c.authority,
      support_contact: c.support_contact,
      remark: null,
      reason: "certificate no. typed wrong",
    });
    expect(fixed.current).toMatchObject({ version: 2, kind: "correction", certificate_no: "10019022008124", reason: "certificate no. typed wrong", file: { id: c.file.id } });
    expect(fixed.versions[0]!.certificate_no).toBe("10019022008123");
    const same = { name: fixed.current.name, certificate_no: fixed.current.certificate_no, issued_on: fixed.current.issued_on, expires_on: fixed.current.expires_on, authority: fixed.current.authority, support_contact: fixed.current.support_contact, remark: null, reason: "again" };
    expect((await refused(() => correctDocument(P.owner, d.id, same))).message).toMatch(/Nothing was changed/);
  });

  it("the database refuses a renewal without a reason, even if the app forgot to check", async () => {
    const d = await addDoc();
    const msg = await dbError(
      asApp(P.tenantId, `insert into document_store.document_versions (tenant_id, document_id, version, kind, name, file_id, entered_by, entered_by_name)
                         values ('${P.tenantId}', '${d.id}', 2, 'renewal', 'x', '${d.current.file.id}', '${KEEPER_ID}', 'x')`),
    );
    expect(msg).toMatch(/check constraint/);
  });

  it("an archived document can't be renewed until restored; archive and restore are audited", async () => {
    const d = await addDoc();
    await setArchived(P.keeper, d.id, { archived: true });
    const f = await upload();
    expect((await refused(() => renewDocument(P.keeper, d.id, { file_id: f.id, expires_on: inDays(400), issued_on: null, certificate_no: null, remark: null, reason: "Renewed" }))).status).toBe(409);
    expect((await listDocuments(P.owner, { filter: "archived" })).map((x) => x.id)).toContain(d.id);
    expect((await listDocuments(P.owner, { filter: "all" })).map((x) => x.id)).not.toContain(d.id);
    await setArchived(P.keeper, d.id, { archived: false });
    const audit = await asOwner("select action from document_store.audit_log where target = $1 order by id", [d.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["document.created", "document.archived", "document.restored"]);
  });

  it("changing the responsible person: only to an owner or document keeper", async () => {
    const d = await addDoc();
    expect((await setResponsible(P.owner, d.id, { responsible_user_id: NOMAIL_ID })).responsible_name).toBe("Ravi");
    expect((await refused(() => setResponsible(P.owner, d.id, { responsible_user_id: crypto.randomUUID() }))).status).toBe(400);
  });
});

describe("append-only at the database level (doc_app login)", () => {
  it.each([
    ["change a version", "update document_store.document_versions set expires_on = '2099-01-01'"],
    ["delete a version", "delete from document_store.document_versions"],
    ["swap a file", "update document_store.files set storage_key = 'x'"],
    ["delete a file record", "delete from document_store.files"],
    ["delete a document", "delete from document_store.documents"],
    ["rewrite who created it", "update document_store.documents set created_by_name = 'x'"],
    ["remove reminder history", "delete from document_store.reminders"],
    ["change who a reminder went to", "update document_store.reminders set email = 'x@y.z'"],
    ["edit the audit log", "delete from document_store.audit_log"],
    ["hide support views", "delete from document_store.support_views"],
  ])("refused: %s", async (_n, statement) => {
    expect(await dbError(asApp(P.tenantId, statement))).toMatch(/permission denied/);
  });
});

describe("plant isolation", () => {
  it("plant B lists nothing of ours and can't open our document", async () => {
    const d = await addDoc({ name: "Pollution board consent" });
    const B = plant();
    expect((await listDocuments(B.owner)).map((x) => x.id)).not.toContain(d.id);
    expect((await refused(() => getDocument(B.owner, d.id))).status).toBe(404);
    const seen = await asApp(B.tenantId, `select count(*)::int as n from document_store.documents where tenant_id = '${P.tenantId}'`);
    expect(seen.rows[0]).toEqual({ n: 0 });
  });

  it("can't write another plant's rows", async () => {
    const B = plant();
    const msg = await dbError(
      asApp(B.tenantId, `insert into document_store.documents (tenant_id, responsible_user_id, responsible_name, created_by, created_by_name)
                         values ('${P.tenantId}', '${KEEPER_ID}', 'x', '${KEEPER_ID}', 'x')`),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("every Document Store table has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ relname: string; force: boolean; has_tenant: boolean }>(`
      select c.relname, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'document_store' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'document_store' and c.relkind = 'r' and c.relname <> 'schema_migrations'`);
    expect(rows.length).toBe(6);
    for (const r of rows) expect({ t: r.relname, force: r.force, tenant: r.has_tenant }).toEqual({ t: r.relname, force: true, tenant: true });
  });
});

describe("the table", () => {
  it("filters by expiry and searches; soonest expiry first", async () => {
    const T = plant();
    const mk = async (name: string, expires: string | null, authority = "Govt") => {
      const f = await upload(T.keeper);
      return createDocument(T.keeper, { name, expires_on: expires, authority, responsible_user_id: KEEPER_ID, file_id: f.id } as never);
    };
    await mk("Fire NOC", inDays(200));
    await mk("NABL accreditation", inDays(10), "NABL");
    await mk("Trade licence", inDays(-3));
    await mk("Company PAN", null);
    expect((await listDocuments(T.owner)).map((d) => d.current.name)).toEqual(["Trade licence", "NABL accreditation", "Fire NOC", "Company PAN"]);
    expect((await listDocuments(T.owner, { filter: "soon" })).map((d) => d.current.name)).toEqual(["NABL accreditation"]);
    expect((await listDocuments(T.owner, { filter: "expired" })).map((d) => d.expiry.text)).toEqual(["Expired 3 days ago"]);
    expect((await listDocuments(T.owner, { filter: "none" })).map((d) => d.current.name)).toEqual(["Company PAN"]);
    expect((await listDocuments(T.owner, { filter: "all", q: "nabl" })).map((d) => d.current.name)).toEqual(["NABL accreditation"]);
  });

  it.each([
    [null, "none", "No expiry"],
    [31, "valid", "Valid"],
    [30, "soon", "Expires in 30 days"],
    [1, "soon", "Expires in 1 day"],
    [0, "today", "Expires today"],
    [-1, "expired", "Expired 1 day ago"],
  ])("expiry in %s days -> %s", (days, kind, text) => {
    expect(expiryStatus(days === null ? null : inDays(days as number))).toMatchObject({ kind, text });
  });
});

describe("owner's export", () => {
  it("only the owner; every version of every document, archived included", async () => {
    expect((await refused(() => exportDocuments(P.keeper))).status).toBe(403);
    const csv = await exportDocuments(P.owner);
    expect(csv.startsWith("﻿document_id,status,version,kind,name")).toBe(true);
    expect(csv).toMatch(/,2,renewal,FSSAI licence,NEW-2027,/);
    expect(csv).toMatch(/,archived,|,active,/);
  });
});
