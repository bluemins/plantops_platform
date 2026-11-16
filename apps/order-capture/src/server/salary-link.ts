// Salary for the Business charts (docs/REPORTS_PHASE_PLAN.md section 9, release 2): Attendance's totals per month and
// per day, through a 60-second platform lookup ticket (scope salary_totals). Totals only, never a name. The answer is
// never stored; when Attendance is off or doesn't answer, the charts say salary is missing (never ₹0).
import { fetchLookupTicket } from "@plantops/auth";
import { z } from "zod";
import { kit } from "./kit";

const SalaryTotals = z.object({
  months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), cost_paise: z.number().int(), people: z.number().int() })),
  paid: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paise: z.number().int() })),
  advances: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paise: z.number().int() })),
  last_paid_month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
});
export type SalaryTotals = z.infer<typeof SalaryTotals>;

/** "in" = the totals; "off" = Attendance isn't switched on for the plant; "unreachable" = no answer in time. */
export type SalaryAnswer = { state: "in"; totals: SalaryTotals } | { state: "off" | "unreachable" };

export async function fetchSalaryTotals(tenantId: string, from: string, to: string): Promise<SalaryAnswer> {
  try {
    const t = await fetchLookupTicket(kit.creds(), tenantId, "attendance_salary", "salary_totals");
    if (!t) return { state: "off" };
    const res = await fetch(new URL(`/api/plantops/salary-totals?from=${from}&to=${to}`, t.url), {
      headers: { authorization: `Bearer ${t.ticket}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { state: "unreachable" };
    return { state: "in", totals: SalaryTotals.parse(await res.json()) };
  } catch {
    return { state: "unreachable" };
  }
}
