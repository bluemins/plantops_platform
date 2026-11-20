// Bill copy on purchase bills (owner, 2026-11-20; migration 0026). The owner or Accounts attach the vendor's bill (a PDF,
// or photos already shrunk on the phone) when recording it or later on its page, also on Zoho-imported bills. The owner,
// Accounts and PlantOps support (each view logged) see them; Store keepers never (the bill shows prices). A copy is never
// changed or deleted: a wrong file stays and the right one is added next to it.
import { and, eq, sql } from "drizzle-orm";
import { fileSha256, newStorageKey, sniffType } from "@plantops/module-kit/storage";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, HttpError, notFound } from "./http";
import type { OcUser } from "./session";
import { fileStorage, lockStorage, storageLimitBytes, storageUsedBytes } from "./storage";

const { purchaseBillFiles, purchaseBills, supportViews } = schema;

/** One file: a PDF up to 10 MB or a photo (shrunk on the phone first). */
export const MAX_COPY_BYTES = 10 * 1024 * 1024;
/** A safety cap per bill; the form sends one PDF or up to 3 photos at a time, more can be added later. */
export const MAX_COPIES_PER_BILL = 20;

const cleanName = (name: string | null | undefined) => {
  const n = (name ?? "").replace(/[\u0000-\u001f\u007f/\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return n || null;
};

/** Adds one copy to a purchase bill. Type checked by the file's own bytes; the plan's Sales storage limit. */
export async function addPurchaseBillCopy(user: OcUser, billId: string, data: Buffer, fileName?: string | null) {
  requireAccess(user, "purchase_enter");
  if (!data.length) throw badRequest("The file is empty");
  const type = sniffType(data);
  if (!type) throw new HttpError(415, "Only a PDF or a photo (JPG, PNG, WebP) can be added");
  if (data.length > MAX_COPY_BYTES) throw new HttpError(413, "A file can be at most 10 MB");
  const limit = await storageLimitBytes(user.tenantId);

  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select({ id: purchaseBills.id, number: purchaseBills.number, vendor: purchaseBills.vendorName, cancelled: purchaseBills.cancelledAt }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, user.tenantId), eq(purchaseBills.id, billId)));
    if (!b) throw notFound("Purchase bill not found");
    if (b.cancelled) throw conflict(`${b.number} is cancelled; a copy can't be added now`);

    // one upload per bill at a time, so two at once can't pass the cap together
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.bill_files'), hashtext(${billId}))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(purchaseBillFiles)
      .where(and(eq(purchaseBillFiles.tenantId, user.tenantId), eq(purchaseBillFiles.billId, billId)));
    if (n >= MAX_COPIES_PER_BILL) throw conflict(`${b.number} already has ${MAX_COPIES_PER_BILL} files`);

    if (limit !== null) {
      await lockStorage(tx, user.tenantId);
      if ((await storageUsedBytes(tx, user.tenantId)) + data.length > limit) throw new HttpError(413, "Storage full for your plan – ask PlantOps to extend it");
    }

    const key = newStorageKey(user.tenantId);
    const name = cleanName(fileName);
    // written inside the transaction: if the row fails, the stray file is never reachable (random key, no row)
    await fileStorage().put(key, data, type);
    const [row] = await tx
      .insert(purchaseBillFiles)
      .values({ tenantId: user.tenantId, billId, storageKey: key, fileName: name, contentType: type, sizeBytes: data.length, sha256: fileSha256(data), createdBy: user.userId, createdByName: user.name })
      .returning();
    await audit(tx, user, "purchase.bill_copy", billId, { number: b.number, vendor: b.vendor, file: name, type: type === "application/pdf" ? "PDF" : "photo", size: data.length });
    return { id: row!.id, size: row!.sizeBytes, content_type: type };
  });
}

export interface BillCopy {
  id: string;
  file_name: string | null;
  content_type: string;
  size: number;
  by: string;
  at: string;
}

/** A bill's copies, oldest first (for its page). The caller already checked purchases_view. */
export async function billCopies(tx: OcTx, tenantId: string, billId: string): Promise<BillCopy[]> {
  const rows = await tx
    .select()
    .from(purchaseBillFiles)
    .where(and(eq(purchaseBillFiles.tenantId, tenantId), eq(purchaseBillFiles.billId, billId)))
    .orderBy(purchaseBillFiles.createdAt);
  return rows.map((r) => ({ id: r.id, file_name: r.fileName, content_type: r.contentType, size: r.sizeBytes, by: r.createdByName, at: r.createdAt.toISOString() }));
}

/** A copy's bytes: owner, Accounts, PlantOps support (logged). Anyone else, or another plant's file: 404. */
export async function readPurchaseBillCopy(user: OcUser, fileId: string) {
  requireAccess(user, "purchases_view");
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx
      .select({ storageKey: purchaseBillFiles.storageKey, contentType: purchaseBillFiles.contentType, fileName: purchaseBillFiles.fileName })
      .from(purchaseBillFiles)
      .where(and(eq(purchaseBillFiles.tenantId, user.tenantId), eq(purchaseBillFiles.id, fileId)));
    if (!f) return null;
    if (user.isSupport) await tx.insert(supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/purchase-bill-files/${fileId}` });
    return f;
  });
  if (!row) throw notFound("File not found");
  return { contentType: row.contentType, fileName: row.fileName, data: await fileStorage().get(row.storageKey) };
}
