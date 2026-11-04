// The owner's calls numbers (docs/CALLS_PHASE_PLAN.md "Owner's numbers", mock-up screen 5). Read live, nothing stored.
// Owner and PlantOps support only (calls_numbers). Definitions, shown on the page too:
//   Calls    = rings (a missed call is one ring)                Missed = rings marked missed
//   Numbers  = different numbers that rang
//   Attended / Waiting = of those numbers, handled (an Attended covers its last ring in the period) or not yet,
//              so attended + waiting = numbers
//   New      = callers saved to the customer list from Calls
// Numbers on "Not an order number" are left out everywhere. Days are India days.
import { sql } from "drizzle-orm";
import { requireAccess } from "./access";
import { dayStart, istDay, LISTED, MISSED, numberText, RING } from "./calls-tab";
import { withTenant } from "./db";
import type { OcUser } from "./session";

export const MAX_DAYS = 92;
export type PeriodKey = "today" | "week" | "month" | "dates";
export interface Period {
  key: PeriodKey;
  /** India dates, both included */
  from: string;
  to: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Today / this week (Monday to today) / this month / picked dates (at most 92 days; anything wrong = today). */
export function periodFor(q: { p?: string; from?: string; to?: string }, now = new Date()): Period {
  const today = istDay(now);
  if (q.from && q.to && YMD.test(q.from) && YMD.test(q.to) && !Number.isNaN(Date.parse(q.from)) && !Number.isNaN(Date.parse(q.to))) {
    const span = daysBetween(q.from, q.to);
    if (span >= 0 && span < MAX_DAYS && q.to <= today) return { key: "dates", from: q.from, to: q.to };
  }
  if (q.p === "week") {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    return { key: "week", from: addDays(today, -weekday), to: today };
  }
  if (q.p === "month") return { key: "month", from: `${today.slice(0, 8)}01`, to: today };
  return { key: "today", from: today, to: today };
}

export type DayRow = {
  day: string;
  calls: number;
  missed: number;
  numbers: number;
  attended: number;
  new: number;
};
export interface CallsNumbers {
  period: Period;
  totals: Omit<DayRow, "day"> & { waiting: number };
  days: DayRow[];
  rang_most: { name: string; calls: number }[];
  attended_by: { name: string; numbers: number }[];
}

export async function callsNumbers(user: OcUser, period: Period): Promise<CallsNumbers> {
  requireAccess(user, "calls_numbers");
  const from = dayStart(period.from);
  const to = dayStart(addDays(period.to, 1));
  const t = user.tenantId;
  return withTenant(t, async (tx) => {
    // every ring of the period, with its India day and whether it was missed
    const rings = sql`select e.phone, e.created_at, (e.created_at at time zone 'Asia/Kolkata')::date::text as day, ${MISSED} as missed
      from order_capture.call_events e
     where e.tenant_id = ${t} and ${RING} and e.created_at >= ${from} and e.created_at < ${to} and e.phone not in ${LISTED}`;
    // a number counts as attended for a group when an Attended covers its last ring there
    const covered = (last: ReturnType<typeof sql>) =>
      sql`exists (select 1 from order_capture.call_attended a where a.tenant_id = ${t} and a.phone = g.phone and a.upto >= ${last})`;
    const news = sql`select (a.created_at at time zone 'Asia/Kolkata')::date::text as day, a.phone from order_capture.call_attended a
     where a.tenant_id = ${t} and a.outcome = 'new_customer' and a.created_at >= ${from} and a.created_at < ${to} and a.phone not in ${LISTED}`;

    const { rows: total } = await tx.execute<{ calls: number; missed: number; numbers: number; attended: number }>(sql`
      with r as (${rings}), g as (select phone, max(created_at) as last from r group by phone)
      select (select count(*)::int from r) as calls, (select count(*) filter (where missed)::int from r) as missed,
             (select count(*)::int from g) as numbers, (select count(*) filter (where ${covered(sql`g.last`)})::int from g) as attended`);
    const { rows: newTotal } = await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${news}) n`);
    const { rows: days } = await tx.execute<DayRow>(sql`
      with r as (${rings}),
           g as (select day, phone, max(created_at) as last from r group by day, phone),
           d as (select day, count(*)::int as numbers, count(*) filter (where ${covered(sql`g.last`)})::int as attended from g group by day),
           c as (select day, count(*)::int as calls, count(*) filter (where missed)::int as missed from r group by day),
           n as (select day, count(*)::int as new from (${news}) x group by day)
      select coalesce(c.day, n.day) as day, coalesce(c.calls, 0) as calls, coalesce(c.missed, 0) as missed,
             coalesce(d.numbers, 0) as numbers, coalesce(d.attended, 0) as attended, coalesce(n.new, 0) as new
        from c left join d on d.day = c.day full join n on n.day = c.day
       order by 1 desc`);
    const { rows: most } = await tx.execute<{ phone: string; calls: number; name: string | null; place: string | null }>(sql`
      with r as (${rings})
      select r.phone, count(*)::int as calls, c.name, c.place from r
        left join order_capture.customers c on c.tenant_id = ${t} and c.phone = r.phone
       group by r.phone, c.name, c.place order by calls desc, max(r.created_at) desc limit 10`);
    const { rows: by } = await tx.execute<{ name: string; numbers: number }>(sql`
      select a.attended_by_name as name, count(distinct a.phone)::int as numbers from order_capture.call_attended a
       where a.tenant_id = ${t} and a.created_at >= ${from} and a.created_at < ${to} and a.phone not in ${LISTED}
       group by a.attended_by_name order by numbers desc, name`);

    const tot = total[0] ?? { calls: 0, missed: 0, numbers: 0, attended: 0 };
    return {
      period,
      totals: { ...tot, waiting: tot.numbers - tot.attended, new: newTotal[0]?.n ?? 0 },
      days,
      rang_most: most.map((m) => ({ name: m.name ? `${m.name} · ${m.place}` : numberText(m.phone), calls: m.calls })),
      attended_by: by,
    };
  });
}
