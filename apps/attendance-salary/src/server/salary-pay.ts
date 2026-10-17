// Ticking a month Paid, and undoing it (docs/SALARY_PHASE_PLAN.md rule 14, "Paid column"). Owner only. Paying saves
// the month's calculation as it stands (the frozen figures); from then on the worker's slip, the carry and the Salary
// tab use those, and any later change shows as "Changed after payment" and flows to the next month as an adjustment.
// Undo (with a reason) makes the month live again. Both are new rows: nothing is changed or deleted.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { NotificationInput } from "@plantops/types";
import { fmtDayLong, fmtMonth, istDay, monthDays, validDay, validMonth } from "@/lib/days";
import { paiseText } from "@/lib/salary";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { dbNow, lockPerson } from "./marks";
import { salaryPaidNotification } from "./notify";
import { freezeMonth, salaryMonths } from "./salary";
import { visibilityMap } from "./salary-slip";
import type { AtUser } from "./session";

const { salaryPayments, salaryPaymentUndos } = schema;
const shortDay = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");

/** The first day a month may be ticked Paid: its last day. */
export const payableFrom = (month: string) => monthDays(month).at(-1)!;

/** The person's payment for the month that is not undone, if any. */
async function livePayment(tx: AtTx, tenantId: string, personId: string, month: string) {
  const rows = await tx
    .select({ id: salaryPayments.id, by: salaryPayments.createdByName, paidOn: salaryPayments.paidOn })
    .from(salaryPayments)
    .where(and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.userId, personId), eq(salaryPayments.month, `${month}-01`)));
  if (rows.length === 0) return null;
  const undone = new Set((await tx.select({ id: salaryPaymentUndos.paymentId }).from(salaryPaymentUndos).where(and(eq(salaryPaymentUndos.tenantId, tenantId), inArray(salaryPaymentUndos.paymentId, rows.map((r) => r.id))))).map((u) => u.id));
  return rows.find((r) => !undone.has(r.id)) ?? null;
}

export const PayInput = z.object({
  user_id: z.uuid(),
  month: z.string().refine(validMonth, "Not a month"),
  paid_on: z.string().refine(validDay, "Not a date"),
  note: z
    .string()
    .nullish()
    .transform((s) => s?.trim() || null)
    .refine((s) => s === null || s.length <= 200, "The note is at most 200 characters"),
  /** the remaining the page showed (paise); a different figure now is 409 */
  expect_remaining: z.number().int(),
});

/** Owner: tick a person's month Paid, freezing its figures. Returns the notice for the worker (or null). */
export async function payMonth(user: AtUser, input: z.infer<typeof PayInput>): Promise<{ id: string; notice: NotificationInput | null }> {
  requireAccess(user, "salary_pay");
  const { month } = input;
  return withTenant(user.tenantId, async (tx) => {
    // one change at a time per person: a scan or fix for them waits until the payment is saved
    await lockPerson(tx, user.tenantId, input.user_id);
    const today = istDay(await dbNow(tx));
    if (month > today.slice(0, 7)) throw notFound();
    if (today < payableFrom(month)) throw badRequest(`${fmtMonth(month).split(" ")[0]} can be marked paid from ${shortDay(payableFrom(month))}`);
    if (input.paid_on > today) throw badRequest("The paid-on date is in the future");
    const already = await livePayment(tx, user.tenantId, input.user_id, month);
    if (already) throw conflict(`Already marked paid by ${already.by} on ${shortDay(already.paidOn)}`);

    const view = await salaryMonths(user, month, { personId: input.user_id });
    const person = view.people[0];
    const c = person?.current;
    if (!person || !c) throw notFound();
    const remaining = c.chain.live.remainingPaise;
    if (remaining !== input.expect_remaining) {
      throw conflict(`The figures changed since the page loaded (now ${paiseText(remaining)}). The page has been refreshed: check it and try again.`);
    }
    const paid = Math.max(0, remaining);
    const [row] = await tx
      .insert(salaryPayments)
      .values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: person.name.slice(0, 100),
        month: `${month}-01`,
        paidOn: input.paid_on,
        paidPaise: paid,
        remainingPaise: remaining,
        figures: freezeMonth(c) as unknown as Record<string, unknown>,
        note: input.note,
        createdBy: user.userId,
        createdByName: user.name.slice(0, 100),
      })
      .returning({ id: salaryPayments.id });
    await audit(tx, user, "salary.paid", row!.id, { person: person.name, month, paid, remaining, on: input.paid_on, note: input.note });
    const canSee = (await visibilityMap(tx, user.tenantId)).get(person.userId) ?? false;
    const notice = canSee && person.userId !== user.userId ? salaryPaidNotification(user, person.userId, month, row!.id) : null;
    return { id: row!.id, notice };
  });
}

export const UndoInput = z.object({
  payment_id: z.uuid(),
  reason: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(3, "Write a reason (at least 3 characters)").max(300, "The reason is at most 300 characters")),
});

/** Owner: undo a payment (once, with a reason). The month is live again; the worker stops seeing it. */
export async function undoPayment(user: AtUser, input: z.infer<typeof UndoInput>) {
  requireAccess(user, "salary_pay");
  return withTenant(user.tenantId, async (tx) => {
    const [p] = await tx.select().from(salaryPayments).where(and(eq(salaryPayments.tenantId, user.tenantId), eq(salaryPayments.id, input.payment_id)));
    if (!p) throw notFound();
    await lockPerson(tx, user.tenantId, p.userId);
    const [done] = await tx.select({ by: salaryPaymentUndos.createdByName }).from(salaryPaymentUndos).where(and(eq(salaryPaymentUndos.tenantId, user.tenantId), eq(salaryPaymentUndos.paymentId, p.id)));
    if (done) throw conflict(`Already undone by ${done.by}`);
    const [row] = await tx
      .insert(salaryPaymentUndos)
      .values({ tenantId: user.tenantId, paymentId: p.id, reason: input.reason, createdBy: user.userId, createdByName: user.name.slice(0, 100) })
      .returning({ id: salaryPaymentUndos.id });
    await audit(tx, user, "salary.unpaid", p.id, { person: p.userName, month: p.month.slice(0, 7), reason: input.reason });
    return { id: row!.id };
  });
}
