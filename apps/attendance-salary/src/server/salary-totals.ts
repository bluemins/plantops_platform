// What Sales' Business charts may ask Attendance (docs/REPORTS_PHASE_PLAN.md section 9, release 2), server to server
// with a 60-second platform lookup ticket (scope salary_totals); there is no user session. Totals for the whole plant
// only, never a name or one person's pay (owner 2026-11-16):
//   * months: what each paid month cost (the frozen figures: earned + overtime + holiday work + TA + DA + expenses +
//     a later change carried in), months paid and not undone, by the salary month
//   * paid: salary paid out per day (the "Mark paid" amount, on its paid-on day; undone payments left out)
//   * advances: advances given per day, corrections and cash brought back taken off (they are negative rows)
// Nothing is stored.
import { sql } from "drizzle-orm";
import { verifyLookupRequest } from "@plantops/auth";
import type { LookupTicketPayload } from "@plantops/types";
import { withTenant } from "./db";
import { HttpError, badRequest } from "./http";
import { kit } from "./kit";

export async function salaryTicket(req: Request): Promise<LookupTicketPayload> {
  const t = await verifyLookupRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys(), scope: "salary_totals" }).catch(() => null);
  if (!t) throw new HttpError(401, "Not a valid PlantOps lookup ticket");
  return t;
}

export interface SalaryTotals {
  /** salary month (YYYY-MM) → cost in paise, paid months only */
  months: { month: string; cost_paise: number; people: number }[];
  /** day (YYYY-MM-DD) → salary paid out that day, paise */
  paid: { date: string; paise: number }[];
  /** day → advances given that day (less corrections / cash brought back), paise */
  advances: { date: string; paise: number }[];
  /** the newest salary month with a payment, or null */
  last_paid_month: string | null;
}

const okDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** The plant's salary totals from `from` to `to` (both YYYY-MM-DD; months are taken whole by their first day). */
export async function salaryTotals(tenantId: string, from: string, to: string): Promise<SalaryTotals> {
  if (!okDate(from) || !okDate(to) || from > to) throw badRequest("from and to must be dates, from ≤ to");
  return withTenant(tenantId, async (tx) => {
    const live = sql`p.tenant_id = ${tenantId} and not exists (select 1 from attendance_salary.salary_payment_undos u where u.tenant_id = p.tenant_id and u.payment_id = p.id)`;
    const months = await tx.execute<{ month: string; cost: string; people: number }>(sql`
      select to_char(p.month, 'YYYY-MM') as month, count(distinct p.user_id)::int as people,
             sum(coalesce((p.figures->'result'->>'earnedPaise')::bigint, 0) + coalesce((p.figures->'result'->>'otPayPaise')::bigint, 0)
               + coalesce((p.figures->'result'->>'holidayWorkPaise')::bigint, 0) + coalesce((p.figures->'result'->>'taPaise')::bigint, 0)
               + coalesce((p.figures->'result'->>'daPaise')::bigint, 0) + coalesce((p.figures->'result'->>'expensesPaise')::bigint, 0)
               + coalesce((p.figures->'result'->>'adjustmentPaise')::bigint, 0))::text as cost
        from attendance_salary.salary_payments p
       where ${live} and p.month between date_trunc('month', ${from}::date) and ${to}::date
       group by 1 order by 1`);
    const paid = await tx.execute<{ date: string; paise: string }>(sql`
      select p.paid_on::text as date, sum(p.paid_paise)::text as paise
        from attendance_salary.salary_payments p
       where ${live} and p.paid_on between ${from}::date and ${to}::date
       group by 1 order by 1`);
    const advances = await tx.execute<{ date: string; paise: string }>(sql`
      select on_date::text as date, sum(amount_paise)::text as paise
        from attendance_salary.salary_advances
       where tenant_id = ${tenantId} and on_date between ${from}::date and ${to}::date
       group by 1 having sum(amount_paise) <> 0 order by 1`);
    const last = await tx.execute<{ m: string | null }>(sql`
      select to_char(max(p.month), 'YYYY-MM') as m from attendance_salary.salary_payments p where ${live}`);
    return {
      months: months.rows.map((r) => ({ month: r.month, cost_paise: Number(r.cost), people: r.people })),
      paid: paid.rows.map((r) => ({ date: r.date, paise: Number(r.paise) })),
      advances: advances.rows.map((r) => ({ date: r.date, paise: Number(r.paise) })),
      last_paid_month: last.rows[0]?.m ?? null,
    };
  });
}
