// One person's month and day, worked out from their marks when the page opens (src/lib/sessions.ts). Who may look is
// decided here, in one place: your own attendance needs `see_own`; anyone else's needs `see_everyone` (the owner,
// PlantOps support). Everything else is 404, so a worker can't even learn whether another person exists.
import { addDays, addMonths, dayStart, istDay, istMonth, monthDays, validDay, validMonth } from "@/lib/days";
import { emptyDay, workDays, type WorkDay } from "@/lib/sessions";
import { can } from "./access";
import { withTenant } from "./db";
import { notFound } from "./http";
import { knownPerson, loadMarks } from "./people";
import type { AtUser } from "./session";

/** May `user` see `personId`'s attendance? Otherwise 404 (never "forbidden": that would confirm the person exists). */
function mayView(user: AtUser, personId: string) {
  if (personId === user.userId ? can(user, "see_own") || can(user, "see_everyone") : can(user, "see_everyone")) return;
  throw notFound("Not found");
}

/** The person's days between two India dates; for someone else, they must be a known person in this plant (or 404). */
async function loadDays(user: AtUser, personId: string, fromDate: string, toDate: string) {
  const known = personId === user.userId ? null : await knownPerson(user, personId);
  const loaded = await withTenant(user.tenantId, (tx) => loadMarks(tx, user.tenantId, fromDate, toDate, personId));
  const p = loaded.get(personId);
  return { days: workDays(p?.marks ?? [], p?.cancels ?? [], new Date()), name: known?.name ?? p?.name ?? null };
}

export interface MonthView {
  month: string;
  today: string;
  days: WorkDay[];
  prev: string;
  /** null when this is the current month (no arrow into the future) */
  next: string | null;
  /** the name copied on the person's marks (null if they have none in this window) */
  name: string | null;
}

/** One person's month (this month if `month` is empty). Future months and bad input: 404. */
export async function monthFor(user: AtUser, personId: string, month?: string | null): Promise<MonthView> {
  mayView(user, personId);
  const thisMonth = istMonth();
  const m = month || thisMonth;
  if (!validMonth(m) || m > thisMonth) throw notFound("Not found");
  const dates = monthDays(m);
  const { days, name } = await loadDays(user, personId, dates[0]!, dates.at(-1)!);
  return { month: m, today: istDay(), days: dates.map((d) => days.get(d) ?? emptyDay(d)), prev: addMonths(m, -1), next: m === thisMonth ? null : addMonths(m, 1), name };
}

export interface DayView {
  day: WorkDay;
  today: string;
  name: string | null;
}

/** One person's day. A bad or future date: 404. */
export async function dayFor(user: AtUser, personId: string, date: string): Promise<DayView> {
  mayView(user, personId);
  const today = istDay();
  if (!validDay(date) || date > today) throw notFound("Not found");
  const { days, name } = await loadDays(user, personId, date, date);
  return { day: days.get(date) ?? emptyDay(date), today, name };
}
