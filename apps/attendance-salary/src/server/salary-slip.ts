// A worker's own salary (docs/SALARY_PHASE_PLAN.md "Worker: My salary"): ONLY when the owner ticked "Can see own
// salary" for them, ONLY months ticked Paid (and not undone), ONLY their own, and ONLY the frozen figures saved with
// the payment. Everything else is 404, so nothing hints that a salary page exists. The person is always the
// session's user: there is no way to ask for someone else's slip.
import { and, desc, eq, inArray } from "drizzle-orm";
import { validMonth } from "@/lib/days";
import type { FrozenMonth } from "@/lib/salary";
import { can, requireAccess } from "./access";
import { schema, withTenant, type AtTx } from "./db";
import { notFound } from "./http";
import { frozenOf } from "./salary";
import type { AtUser } from "./session";

const { salaryVisibility, salaryPayments, salaryPaymentUndos } = schema;

/** "Can see own salary" for everyone in the plant: the newest row per person wins, no row = off. */
export async function visibilityMap(tx: AtTx, tenantId: string): Promise<Map<string, boolean>> {
  const rows = await tx
    .selectDistinctOn([salaryVisibility.userId], { userId: salaryVisibility.userId, canSee: salaryVisibility.canSee })
    .from(salaryVisibility)
    .where(eq(salaryVisibility.tenantId, tenantId))
    .orderBy(salaryVisibility.userId, desc(salaryVisibility.createdAt), desc(salaryVisibility.id));
  return new Map(rows.map((r) => [r.userId, r.canSee]));
}

/** May this person see their own salary at all? (Plant staff + the owner's tick.) */
export async function canSeeOwnSalary(user: AtUser): Promise<boolean> {
  if (!can(user, "see_own_salary")) return false;
  return withTenant(user.tenantId, async (tx) => (await visibilityMap(tx, user.tenantId)).get(user.userId) ?? false);
}

export interface MyPayment {
  month: string;
  paidOn: string;
  paidPaise: number;
  remainingPaise: number;
  byName: string;
  note: string | null;
  figures: FrozenMonth;
}

/** The person's own paid months (not undone), newest month first; 404 without permission. */
export async function myPayments(user: AtUser): Promise<MyPayment[]> {
  requireAccess(user, "see_own_salary");
  if (!(await canSeeOwnSalary(user))) throw notFound();
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(salaryPayments)
      .where(and(eq(salaryPayments.tenantId, user.tenantId), eq(salaryPayments.userId, user.userId)))
      .orderBy(desc(salaryPayments.month), desc(salaryPayments.createdAt));
    const undone = new Set(
      rows.length
        ? (await tx.select({ id: salaryPaymentUndos.paymentId }).from(salaryPaymentUndos).where(and(eq(salaryPaymentUndos.tenantId, user.tenantId), inArray(salaryPaymentUndos.paymentId, rows.map((r) => r.id))))).map((u) => u.id)
        : [],
    );
    const seen = new Set<string>();
    const out: MyPayment[] = [];
    for (const r of rows) {
      const month = r.month.slice(0, 7);
      const figures = frozenOf(r.figures);
      if (undone.has(r.id) || seen.has(month) || !figures) continue;
      seen.add(month);
      out.push({ month, paidOn: r.paidOn, paidPaise: r.paidPaise, remainingPaise: r.remainingPaise, byName: r.createdByName, note: r.note, figures });
    }
    return out;
  });
}

/** One paid month's slip, from its frozen figures. 404 in every other case. */
export async function mySlip(user: AtUser, month: string): Promise<MyPayment> {
  if (!validMonth(month)) throw notFound();
  const slip = (await myPayments(user)).find((p) => p.month === month);
  if (!slip) throw notFound();
  return slip;
}
