// Customer upload (owner only): the browser reads the CSV and sends the rows of the three chosen columns as JSON;
// the file itself is never stored. Preview saves nothing. Confirm works the preview out again inside ONE
// transaction and saves only if it is still exactly what the owner saw (same fingerprint); otherwise 409. The
// database's one-customer-per-phone index is the final guard against a number added at the same moment.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { classifyUpload, planCounts, UPLOAD_MAX_ROWS, type ExistingCustomer, type UploadPlan } from "@/lib/upload";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { conflict } from "./http";
import type { OcUser } from "./session";

const { customers } = schema;

const Cell = z.string().max(1000);
export const UploadInput = z.object({
  file_name: z.string().trim().max(200).default(""),
  rows: z
    .array(z.object({ line: z.number().int().min(1).max(1_000_000), name: Cell, phone: Cell, place: Cell }))
    .min(1, "The file has no rows")
    .max(UPLOAD_MAX_ROWS, `A file can have at most ${UPLOAD_MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`),
});
export const ConfirmInput = UploadInput.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });

export type UploadPreview = UploadPlan & { counts: ReturnType<typeof planCounts>; fingerprint: string };

async function existing(tx: OcTx, tenantId: string): Promise<ExistingCustomer[]> {
  return tx.select({ id: customers.id, name: customers.name, phone: customers.phone, place: customers.place, active: customers.active }).from(customers).where(eq(customers.tenantId, tenantId));
}

/** What confirm would do, as one hash: any change in the list or the file since the preview changes it. */
export function fingerprint(plan: UploadPlan) {
  const what = {
    added: plan.added.map((a) => [a.phone, a.name, a.place]),
    updated: plan.updated.map((u) => [u.id, u.from.name, u.from.place, u.from.active, u.to.name, u.to.place]),
  };
  return createHash("sha256").update(JSON.stringify(what)).digest("hex");
}

const withPrint = (plan: UploadPlan): UploadPreview => ({ ...plan, counts: planCounts(plan), fingerprint: fingerprint(plan) });

/** The preview: nothing is saved. */
export async function previewUpload(user: OcUser, input: z.infer<typeof UploadInput>): Promise<UploadPreview> {
  requireAccess(user, "customer_upload");
  return withTenant(user.tenantId, async (tx) => withPrint(classifyUpload(input.rows, await existing(tx, user.tenantId))));
}

const STALE = "The customer list changed since the preview. Please check the preview again.";

/** Save what the preview showed: new customers added, changed ones updated (and switched back on). */
export async function confirmUpload(user: OcUser, input: z.infer<typeof ConfirmInput>) {
  requireAccess(user, "customer_upload");
  try {
    return await withTenant(user.tenantId, async (tx) => {
      // one upload at a time per plant, so two confirms can't both pass the fingerprint check
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.customer_upload'), hashtext(${user.tenantId}))`);
      const plan = classifyUpload(input.rows, await existing(tx, user.tenantId));
      if (fingerprint(plan) !== input.fingerprint) throw conflict(STALE);
      if (plan.added.length) {
        await tx.insert(customers).values(
          plan.added.map((a) => ({ tenantId: user.tenantId, name: a.name, phoneTyped: a.phoneTyped, phone: a.phone, place: a.place, createdBy: user.userId, createdByName: user.name })),
        );
      }
      for (const u of plan.updated) {
        await tx
          .update(customers)
          .set({ name: u.to.name, place: u.to.place, active: true, updatedAt: new Date() })
          .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, u.id)));
      }
      const counts = planCounts(plan);
      await audit(tx, user, "customers.upload", null, {
        file: input.file_name || null,
        added: counts.added,
        updated: counts.updated,
        unchanged: counts.unchanged,
        rejected: counts.rejected,
        updates: plan.updated.slice(0, 500).map((u) => ({ phone: u.phone, from: u.from, to: u.to })),
      });
      return counts;
    });
  } catch (err) {
    // a number added by someone else between our check and our insert
    if (((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) === "23505") throw conflict(STALE);
    throw err;
  }
}
