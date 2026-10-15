// The owner's Today board (mock-up "Owner · Today"): who is inside now, who came and left, who hasn't marked today,
// and who had no exit yesterday. Worked out from the marks with the same rules as the calendars (src/lib/sessions.ts).
import { addDays, istDay } from "@/lib/days";
import { workDays, type WorkDay } from "@/lib/sessions";
import { requireAccess } from "./access";
import { withTenant } from "./db";
import { loadMarks, staffList, type Person } from "./people";
import type { AtUser } from "./session";

export interface TodayBoard {
  today: string;
  yesterday: string;
  inside: (Person & { since: Date })[];
  cameLeft: (Person & { firstIn: Date | null; lastOut: Date | null; minutes: number })[];
  notMarked: Person[];
  noExitYesterday: (Person & { inAt: Date })[];
  /** the platform couldn't be reached: the list is the people who marked in the last 3 days */
  platformDown: boolean;
}

/** Owner (and PlantOps support, read-only). */
export async function todayBoard(user: AtUser, now: Date = new Date()): Promise<TodayBoard> {
  requireAccess(user, "see_everyone");
  const today = istDay(now);
  const yesterday = addDays(today, -1);
  const [staff, loaded] = await Promise.all([staffList(user), withTenant(user.tenantId, (tx) => loadMarks(tx, user.tenantId, yesterday, today))]);
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
      board.inside.push({ ...p, since: open.start.at });
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
