// Logging a complaint (docs/COMPLAINT_BOX_PHASE_PLAN.md "Logging a complaint"). Saving locks it: details are never
// edited afterwards (the database allows only the status to change). Plant, reporter and time always come from the
// session and the database - never from what the browser sends.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { formatRef, normalisePhone } from "@/lib/phone";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import { badRequest } from "./http";
import { itemForComplaint } from "./items";
import type { CbUser } from "./session";

const { complaints } = schema;

const text = (min: number, max: number, what: string) =>
  z
    .string()
    .trim()
    .min(min, min <= 1 ? `Please enter ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} needs at least ${min} characters`)
    .max(max, `At most ${max} characters`);

/** What the form sends. Unknown fields (tenant_id, reported_by, ref_no, status ...) are dropped. */
export const ComplaintInput = z.object({
  customer_name: text(2, 100, "the customer's name"),
  phone: z.string().trim().min(1, "Please enter the customer's mobile number").max(30, "At most 30 characters"),
  place: text(2, 200, "the place"),
  item_id: z.uuid("Please choose an item"),
  batch_text: z
    .string()
    .trim()
    .max(60, "At most 60 characters")
    .nullish()
    .transform((v) => (v ? v : null)),
  description: text(10, 2000, "the description"),
});
export type ComplaintInput = z.infer<typeof ComplaintInput>;

/** Saves a new complaint and returns its id and per-plant reference (C-0001 ...). */
export async function createComplaint(user: CbUser, input: ComplaintInput) {
  requireAccess(user, "log");
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Please enter the customer's 10-digit mobile number");
  return withTenant(user.tenantId, async (tx) => {
    const item = await itemForComplaint(tx, user.tenantId, input.item_id);
    // one save per plant at a time, so two phones saving together never get the same number
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('complaint_box.ref'), hashtext(${user.tenantId}))`);
    const [{ next } = { next: 1 }] = await tx.select({ next: sql<number>`coalesce(max(${complaints.refNo}), 0)::int + 1` }).from(complaints).where(sql`${complaints.tenantId} = ${user.tenantId}`);
    const [row] = await tx
      .insert(complaints)
      .values({
        tenantId: user.tenantId,
        refNo: next,
        customerName: input.customer_name,
        phoneTyped: input.phone,
        phone,
        place: input.place,
        itemId: item.id,
        itemName: item.name,
        batchText: input.batch_text,
        description: input.description,
        reportedBy: user.userId,
        reportedByName: user.name,
      })
      .returning({ id: complaints.id, refNo: complaints.refNo });
    // the screen gets id + ref; the rest is for the "new complaint" notification
    return { id: row!.id, ref: formatRef(row!.refNo), item_name: item.name, customer_name: input.customer_name, place: input.place, description: input.description };
  });
}
