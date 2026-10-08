// Documents: the plant's licences and certificates. History is APPEND-ONLY (like Lab Records):
//   * adding a document creates version 1 (kind "initial") with its file;
//   * a renewal is a new version with a new file and expiry; a correction is a new version with a reason;
//   * files are never replaced or deleted; earlier versions and their files stay viewable.
// The database enforces it: doc_app has no UPDATE on versions/files and no DELETE anywhere.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { expiryStatus, todayIst, type ExpiryKind } from "@/lib/expiry";
import { schema, withTenant, type DocTx } from "./db";
import { badRequest, conflict, HttpError, notFound } from "./http";
import { kit } from "./kit";
import { actorOf, requireManage, type DocUser } from "./session";
import { fileSha256, fileStorage, MAX_FILE_BYTES, newStorageKey, sniffType } from "./storage";

const { auditLog, documents, documentVersions, files, reminders } = schema;

async function audit(tx: DocTx, user: DocUser, action: string, target: string, details: Record<string, unknown> = {}) {
  await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details });
}

// ---------- files ----------

export type FileView = { id: string; original_name: string; content_type: string; size_bytes: number; uploaded_by_name: string; uploaded_at: string };
const fileView = (f: typeof files.$inferSelect): FileView => ({
  id: f.id,
  original_name: f.originalName,
  content_type: f.contentType,
  size_bytes: f.sizeBytes,
  uploaded_by_name: f.uploadedByName,
  uploaded_at: f.uploadedAt.toISOString(),
});

/** The plan's storage limit in bytes (super_admin sets MB; blank = unlimited). */
async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.document_store?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

export async function storageUsed(tx: DocTx, tenantId: string) {
  const [row] = await tx.select({ n: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` }).from(files).where(eq(files.tenantId, tenantId));
  return Number(row?.n ?? 0);
}

/** Saves an uploaded file (PDF / JPEG / PNG / WebP, ≤ 10 MB, within the plan's storage). Returns its record. */
export async function uploadFile(user: DocUser, input: { data: Buffer; name: string }): Promise<FileView> {
  requireManage(user);
  if (!input.data.length) throw badRequest("The file is empty");
  if (input.data.length > MAX_FILE_BYTES) throw new HttpError(413, "Files can be at most 10 MB");
  const type = sniffType(input.data);
  if (!type) throw new HttpError(415, "Only PDF files and photos (JPG, PNG, WebP) can be uploaded");
  const name = (input.name || "document").replace(/[\\/\r\n\t"]/g, "_").slice(0, 200);
  const limit = await storageLimitBytes(user.tenantId);

  return withTenant(user.tenantId, async (tx) => {
    if (limit !== null && (await storageUsed(tx, user.tenantId)) + input.data.length > limit) {
      throw new HttpError(413, "Storage full for your plan – ask PlantOps to extend it");
    }
    const key = newStorageKey(user.tenantId);
    await fileStorage().put(key, input.data, type);
    const [row] = await tx
      .insert(files)
      .values({ tenantId: user.tenantId, storageKey: key, originalName: name, contentType: type, sizeBytes: input.data.length, sha256: fileSha256(input.data), uploadedBy: user.userId, uploadedByName: user.name })
      .returning();
    return fileView(row!);
  });
}

/** A file's bytes, only for the viewer's own plant (row-level security), for viewing or downloading. */
export async function readFile(user: DocUser, fileId: string) {
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx.select().from(files).where(and(eq(files.tenantId, user.tenantId), eq(files.id, fileId)));
    return f;
  });
  if (!row) throw notFound("File not found");
  return { file: fileView(row), data: await fileStorage().get(row.storageKey) };
}

// ---------- reading ----------

export type VersionView = {
  id: string;
  version: number;
  kind: "initial" | "renewal" | "correction";
  name: string;
  certificate_no: string | null;
  issued_on: string | null;
  expires_on: string | null;
  authority: string | null;
  support_contact: string | null;
  remark: string | null;
  reason: string | null;
  file: FileView;
  entered_by_name: string;
  entered_at: string;
};
export type ReminderView = { stage: string; recipient_name: string; email: string | null; status: string; error: string | null; created_at: string; sent_at: string | null };
export type DocumentRow = {
  id: string;
  status: "active" | "archived";
  responsible_user_id: string;
  responsible_name: string;
  current: VersionView;
  expiry: { kind: ExpiryKind; days: number | null; text: string };
  last_reminder: ReminderView | null;
};
export type DocumentDetail = DocumentRow & { created_by_name: string; created_at: string; versions: VersionView[]; reminders: ReminderView[] };

async function loadVersions(tx: DocTx, tenantId: string, documentIds: string[]) {
  if (!documentIds.length) return [];
  const rows = await tx
    .select({ v: documentVersions, f: files })
    .from(documentVersions)
    .innerJoin(files, eq(files.id, documentVersions.fileId))
    .where(and(eq(documentVersions.tenantId, tenantId), inArray(documentVersions.documentId, documentIds)))
    .orderBy(asc(documentVersions.version));
  return rows.map(({ v, f }) => ({
    documentId: v.documentId,
    view: {
      id: v.id,
      version: v.version,
      kind: v.kind,
      name: v.name,
      certificate_no: v.certificateNo,
      issued_on: v.issuedOn,
      expires_on: v.expiresOn,
      authority: v.authority,
      support_contact: v.supportContact,
      remark: v.remark,
      reason: v.reason,
      file: fileView(f),
      entered_by_name: v.enteredByName,
      entered_at: v.enteredAt.toISOString(),
    } satisfies VersionView,
  }));
}

const reminderView = (r: typeof reminders.$inferSelect): ReminderView => ({
  stage: r.stage,
  recipient_name: r.recipientName,
  email: r.email,
  status: r.status,
  error: r.error,
  created_at: r.createdAt.toISOString(),
  sent_at: r.sentAt?.toISOString() ?? null,
});

async function loadRows(tx: DocTx, tenantId: string, ids?: string[]): Promise<(DocumentRow & { versions: VersionView[]; doc: typeof documents.$inferSelect })[]> {
  const docs = await tx
    .select()
    .from(documents)
    .where(ids ? and(eq(documents.tenantId, tenantId), inArray(documents.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])) : eq(documents.tenantId, tenantId));
  const versions = await loadVersions(tx, tenantId, docs.map((d) => d.id));
  const lastReminders = docs.length
    ? await tx.execute<{ document_id: string; id: string }>(sql`
        select distinct on (document_id) document_id, id from document_store.reminders
         where tenant_id = ${tenantId} and document_id in (${sql.join(docs.map((d) => sql`${d.id}::uuid`), sql`, `)})
         order by document_id, created_at desc, recipient_name`)
    : { rows: [] };
  const reminderRows = lastReminders.rows.length
    ? await tx.select().from(reminders).where(inArray(reminders.id, lastReminders.rows.map((r) => r.id)))
    : [];
  const today = todayIst();
  return docs.map((d) => {
    const vs = versions.filter((v) => v.documentId === d.id).map((v) => v.view);
    const current = vs[vs.length - 1]!;
    const last = reminderRows.find((r) => r.documentId === d.id);
    return {
      doc: d,
      id: d.id,
      status: d.status,
      responsible_user_id: d.responsibleUserId,
      responsible_name: d.responsibleName,
      current,
      versions: vs,
      expiry: expiryStatus(current.expires_on, today),
      last_reminder: last ? reminderView(last) : null,
    };
  });
}

export const ListInput = z.object({
  filter: z.enum(["all", "soon", "expired", "none", "archived"]).default("all").catch("all"),
  q: z.string().trim().max(80).optional().catch(undefined),
});

/** The documents table: active ones (or archived), filtered, soonest expiry first, then by name. */
export async function listDocuments(user: DocUser, input: z.infer<typeof ListInput> = { filter: "all" }): Promise<DocumentRow[]> {
  const rows = await withTenant(user.tenantId, (tx) => loadRows(tx, user.tenantId));
  const q = input.q?.toLowerCase();
  return rows
    .filter((r) => (input.filter === "archived" ? r.status === "archived" : r.status === "active"))
    .filter((r) => {
      if (input.filter === "soon") return r.expiry.kind === "soon" || r.expiry.kind === "today";
      if (input.filter === "expired") return r.expiry.kind === "expired";
      if (input.filter === "none") return r.expiry.kind === "none";
      return true;
    })
    .filter((r) => !q || [r.current.name, r.current.certificate_no, r.current.authority].some((s) => s?.toLowerCase().includes(q)))
    .sort((a, b) => (a.current.expires_on ?? "9999") .localeCompare(b.current.expires_on ?? "9999") || a.current.name.localeCompare(b.current.name))
    .map(({ doc: _d, versions: _v, ...row }) => row);
}

export async function getDocument(user: DocUser, id: string): Promise<DocumentDetail> {
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await loadRows(tx, user.tenantId, [id]);
    if (!row) throw notFound("Document not found");
    const log = await tx.select().from(reminders).where(and(eq(reminders.tenantId, user.tenantId), eq(reminders.documentId, id))).orderBy(desc(reminders.createdAt), asc(reminders.recipientName));
    const { doc, ...rest } = row;
    return { ...rest, created_by_name: doc.createdByName, created_at: doc.createdAt.toISOString(), reminders: log.map(reminderView) };
  });
}

/** Who can be responsible: the plant's owners, document keepers and plant staff (from the platform), with their email. */
export async function responsibleChoices(user: DocUser) {
  const contacts = (await kit.contacts(user.tenantId)) ?? [];
  return contacts.filter((c) => c.roles.some((r) => r === "tenant_admin" || r === "document_keeper" || r === "plant_staff")).map((c) => ({ user_id: c.user_id, name: c.display_name, email: c.email ?? null }));
}

// ---------- writing ----------

const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const day = z.iso.date("Use a date like 2026-10-04").nullable().optional().transform((v) => v ?? null);

export const DocumentInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  certificate_no: text(80),
  issued_on: day,
  expires_on: day,
  authority: text(160),
  support_contact: text(300),
  remark: text(500),
  responsible_user_id: z.uuid("Choose who is responsible"),
  file_id: z.uuid("Upload the file"),
});
export const RenewInput = z.object({
  certificate_no: text(80),
  issued_on: day,
  expires_on: day,
  remark: text(500),
  file_id: z.uuid("Upload the new certificate"),
  reason: z.string().trim().min(3).max(500).default("Renewed"),
});
export const CorrectInput = DocumentInput.omit({ responsible_user_id: true, file_id: true }).extend({
  file_id: z.uuid().optional(),
  reason: z.string().trim().min(3, "Say what you are correcting").max(500),
});
export const ResponsibleInput = z.object({ responsible_user_id: z.uuid() });
export const ArchiveInput = z.object({ archived: z.boolean() });

function checkDates(issued: string | null, expires: string | null) {
  if (issued && issued > todayIst()) throw badRequest("The issue date can't be in the future");
  if (issued && expires && issued > expires) throw badRequest("The expiry date can't be before the issue date");
}

async function requireFile(tx: DocTx, tenantId: string, fileId: string) {
  const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, fileId)));
  if (!f) throw badRequest("Upload the file again (it wasn't found)");
}

async function chooseResponsible(user: DocUser, userId: string) {
  const choice = (await responsibleChoices(user)).find((c) => c.user_id === userId);
  if (!choice) throw badRequest("The responsible person must be an owner or a document keeper of this plant");
  return choice;
}

async function insertVersion(tx: DocTx, user: DocUser, documentId: string, version: number, v: Omit<typeof documentVersions.$inferInsert, "tenantId" | "documentId" | "version" | "enteredBy" | "enteredByName">) {
  try {
    const [row] = await tx
      .insert(documentVersions)
      .values({ ...v, tenantId: user.tenantId, documentId, version, enteredBy: user.userId, enteredByName: user.name })
      .returning();
    return row!;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23505") throw conflict("Someone else just changed this document. Please reload and check it again.");
    throw err;
  }
}

/** A new document, version 1, with its file and responsible person. */
export async function createDocument(user: DocUser, input: z.infer<typeof DocumentInput>) {
  requireManage(user);
  checkDates(input.issued_on, input.expires_on);
  const responsible = await chooseResponsible(user, input.responsible_user_id);
  const id = await withTenant(user.tenantId, async (tx) => {
    await requireFile(tx, user.tenantId, input.file_id);
    const [doc] = await tx
      .insert(documents)
      .values({ tenantId: user.tenantId, responsibleUserId: responsible.user_id, responsibleName: responsible.name, createdBy: user.userId, createdByName: user.name })
      .returning();
    await insertVersion(tx, user, doc!.id, 1, {
      kind: "initial",
      name: input.name,
      certificateNo: input.certificate_no,
      issuedOn: input.issued_on,
      expiresOn: input.expires_on,
      authority: input.authority,
      supportContact: input.support_contact,
      remark: input.remark,
      fileId: input.file_id,
    });
    await audit(tx, user, "document.created", doc!.id, { name: input.name });
    return doc!.id;
  });
  return getDocument(user, id);
}

async function current(tx: DocTx, tenantId: string, documentId: string) {
  const [row] = await loadRows(tx, tenantId, [documentId]);
  if (!row) throw notFound("Document not found");
  return row;
}

/** Renewal: a new version with the new file, certificate no. and expiry. Its reminders start afresh. */
export async function renewDocument(user: DocUser, documentId: string, input: z.infer<typeof RenewInput>) {
  requireManage(user);
  checkDates(input.issued_on, input.expires_on);
  await withTenant(user.tenantId, async (tx) => {
    const row = await current(tx, user.tenantId, documentId);
    if (row.status === "archived") throw conflict("This document is archived. Restore it first.");
    await requireFile(tx, user.tenantId, input.file_id);
    const c = row.current;
    await insertVersion(tx, user, documentId, c.version + 1, {
      kind: "renewal",
      name: c.name,
      certificateNo: input.certificate_no ?? c.certificate_no,
      issuedOn: input.issued_on,
      expiresOn: input.expires_on,
      authority: c.authority,
      supportContact: c.support_contact,
      remark: input.remark,
      fileId: input.file_id,
      reason: input.reason,
    });
    await audit(tx, user, "document.renewed", documentId, { name: c.name, expires_on: input.expires_on });
  });
  return getDocument(user, documentId);
}

/** Correction of the details (typing mistake, wrong date…): a new version with a reason; the file is kept unless replaced. */
export async function correctDocument(user: DocUser, documentId: string, input: z.infer<typeof CorrectInput>) {
  requireManage(user);
  checkDates(input.issued_on, input.expires_on);
  await withTenant(user.tenantId, async (tx) => {
    const row = await current(tx, user.tenantId, documentId);
    const c = row.current;
    if (input.file_id) await requireFile(tx, user.tenantId, input.file_id);
    const next = {
      name: input.name,
      certificate_no: input.certificate_no,
      issued_on: input.issued_on,
      expires_on: input.expires_on,
      authority: input.authority,
      support_contact: input.support_contact,
      remark: input.remark,
      file_id: input.file_id ?? c.file.id,
    };
    const before = { name: c.name, certificate_no: c.certificate_no, issued_on: c.issued_on, expires_on: c.expires_on, authority: c.authority, support_contact: c.support_contact, remark: c.remark, file_id: c.file.id };
    if (JSON.stringify(next) === JSON.stringify(before)) throw badRequest("Nothing was changed");
    await insertVersion(tx, user, documentId, c.version + 1, {
      kind: "correction",
      name: next.name,
      certificateNo: next.certificate_no,
      issuedOn: next.issued_on,
      expiresOn: next.expires_on,
      authority: next.authority,
      supportContact: next.support_contact,
      remark: next.remark,
      fileId: next.file_id,
      reason: input.reason,
    });
    await audit(tx, user, "document.corrected", documentId, { before, after: next, reason: input.reason });
  });
  return getDocument(user, documentId);
}

export async function setResponsible(user: DocUser, documentId: string, input: z.infer<typeof ResponsibleInput>) {
  requireManage(user);
  const responsible = await chooseResponsible(user, input.responsible_user_id);
  await withTenant(user.tenantId, async (tx) => {
    const row = await current(tx, user.tenantId, documentId);
    await tx
      .update(documents)
      .set({ responsibleUserId: responsible.user_id, responsibleName: responsible.name, updatedAt: new Date() })
      .where(and(eq(documents.tenantId, user.tenantId), eq(documents.id, documentId)));
    await audit(tx, user, "document.responsible", documentId, { from: row.responsible_name, to: responsible.name });
  });
  return getDocument(user, documentId);
}

/** Archive (no longer needed: no reminders, hidden from the main table) or restore. Nothing is deleted. */
export async function setArchived(user: DocUser, documentId: string, input: z.infer<typeof ArchiveInput>) {
  requireManage(user);
  await withTenant(user.tenantId, async (tx) => {
    await current(tx, user.tenantId, documentId);
    await tx
      .update(documents)
      .set({ status: input.archived ? "archived" : "active", updatedAt: new Date() })
      .where(and(eq(documents.tenantId, user.tenantId), eq(documents.id, documentId)));
    await audit(tx, user, input.archived ? "document.archived" : "document.restored", documentId);
  });
  return getDocument(user, documentId);
}
