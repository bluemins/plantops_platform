// The Today board (mock-up "Owner · Today"; docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 5): who is inside now, who came
// and left, who hasn't marked today, and who had no exit yesterday. Worked out from the marks with the same rules as the
// calendars (src/lib/sessions.ts). The same board feeds the launcher tile and the morning "not marked" alert, so they
// always agree.
import { addDays, istDay } from "@/lib/days";
import { workDays, type WorkDay } from "@/lib/sessions";
import { requireAccess } from "./access";
import { withTenant } from "./db";
import { activeEmployees, loadMarks, type Person } from "./people";
import type { AtUser } from "./session";

export interface TodayBoard {
  today: string;
  yesterday: string;
  /** `by`: who marked them in from the office ("Mark for someone"), else null */
  inside: (Person & { since: Date; by: string | null })[];
  cameLeft: (Person & { firstIn: Date | null; lastOut: Date | null; minutes: number })[];
  notMarked: Person[];
  noExitYesterday: (Person & { inAt: Date })[];
  /** the platform couldn't be reached: the list is the people who marked in the last 3 days */
  platformDown: boolean;
}

/** Owner, Office staff, Supervisor (read-only on screen) and PlantOps support. */
export async function todayBoard(user: AtUser, now: Date = new Date()): Promise<TodayBoard> {
  requireAccess(user, "see_today");
  return boardFor(user.tenantId, now);
}

/** The board without an access check: for the launcher tile and the morning job (they show no names to anyone else). */
export async function boardFor(tenantId: string, now: Date = new Date()): Promise<TodayBoard> {
  const today = istDay(now);
  const yesterday = addDays(today, -1);
  const [staff, loaded] = await Promise.all([activeEmployees(tenantId), withTenant(tenantId, (tx) => loadMarks(tx, tenantId, yesterday, today))]);
  // the people: active Plant staff; if the platform is down, whoever marked in the window
  const people: Person[] = staff.platformDown ? [...loaded.entries()].map(([userId, l]) => ({ userId, name: l.name })).sort((a, b) => a.name.localeCompare(b.name)) : staff.active;

  const board: TodayBoard = { today, yesterday, inside: [], cameLeft: [], notMarked: [], noExitYesterday: [], platformDown: staff.platformDown };
  for (const p of people) {
    const l = loaded.get(p.userId);
    const days = l ? workDays(l.marks, l.cancels, now) : new Map<string, WorkDay>();
    const open = [...days.values()].flatMap((d) => d.blocks).find((b) => b.status === "open");
    const t = days.get(today);
    const y = days.get(yesterday);
    const noExit = y?.blocks.find((b) => b.status === "no_exit");
    if (noExit) board.noExitYesterday.push({ ...p, inAt: noExit.start.at });
    if (open) {
      board.inside.push({ ...p, since: open.start.at, by: open.start.source === "desk" ? open.start.byName : null });
      continue;
    }
    if (t && t.entries.some((e) => e.type !== "cancelled")) {
      const done = t.blocks.filter((b) => b.status === "done");
      board.cameLeft.push({
        ...p,
        firstIn: t.blocks[0]?.start.at ?? null,
        lastOut: done.length ? done.reduce((a, b) => (b.end!.at > a ? b.end!.at : a), done[0]!.end!.at) : null,
        minutes: t.minutes,
      });
      continue;
    }
    board.notMarked.push(p);
  }
  board.inside.sort((a, b) => a.since.getTime() - b.since.getTime());
  return board;
}
