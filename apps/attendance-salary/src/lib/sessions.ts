// Turning a person's marks into worked time (docs/ATTENDANCE_PHASE_PLAN.md "Rules for working it out"). One pure
// function, used for the worker's calendar, the owner's views and the month CSV. Nothing it works out is stored.
//
// - Cancelled marks are left out of the pairing (they stay in the day's list, crossed out with the owner's reason).
// - Valid marks in time order; an IN followed by an OUT within 16 hours is one block.
// - A block belongs to the India date it STARTED, so a night shift past midnight is one block on the first day.
// - No exit (0 hours until the owner fixes it): an IN followed by another IN, an OUT 16 hours or more later, or no OUT
//   16 hours later. An IN under 16 hours old with no OUT yet is still open ("inside"), not no exit.
// - No entry: an OUT with no open IN before it; shown on its own date, never counted.
// - Day total = the complete blocks that started that day. "changed" = the owner added or cancelled a mark that day.
import { istDay } from "./days";
import { OPEN_IN_MS, type Kind } from "./punch";

export interface Mark {
  id: string;
  kind: Kind;
  at: Date;
  source: "scan" | "owner";
  reason: string | null;
  byName: string;
  distanceM: number | null;
}

export interface Cancel {
  punchId: string;
  reason: string;
  byName: string;
  at: Date;
}

export type BlockStatus = "done" | "no_exit" | "open";

export interface Block {
  start: Mark;
  end: Mark | null;
  status: BlockStatus;
  /** complete blocks only; no exit and open count 0 */
  minutes: number;
  /** ends on a later India date (a night shift) */
  nextDay: boolean;
}

export type Entry =
  | { type: "block"; at: Date; block: Block }
  | { type: "no_entry"; at: Date; mark: Mark }
  | { type: "cancelled"; at: Date; mark: Mark; cancel: Cancel };

export interface WorkDay {
  date: string;
  minutes: number;
  blocks: Block[];
  /** everything for the day page, in time order */
  entries: Entry[];
  noExit: boolean;
  noEntry: boolean;
  open: boolean;
  changed: boolean;
}

export const emptyDay = (date: string): WorkDay => ({ date, minutes: 0, blocks: [], entries: [], noExit: false, noEntry: false, open: false, changed: false });

/** All of a person's days that have something on them, keyed by India date. */
export function workDays(marks: Mark[], cancels: Cancel[], now: Date = new Date()): Map<string, WorkDay> {
  const days = new Map<string, WorkDay>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = emptyDay(date)));
    return d;
  };
  const cancelOf = new Map(cancels.map((c) => [c.punchId, c]));

  const addBlock = (start: Mark, end: Mark | null, status: BlockStatus) => {
    const date = istDay(start.at);
    const minutes = status === "done" ? Math.round((end!.at.getTime() - start.at.getTime()) / 60_000) : 0;
    const block: Block = { start, end, status, minutes, nextDay: !!end && istDay(end.at) !== date };
    const d = day(date);
    d.blocks.push(block);
    d.entries.push({ type: "block", at: start.at, block });
    d.minutes += minutes;
    if (status === "no_exit") d.noExit = true;
    if (status === "open") d.open = true;
    if (start.source === "owner" || end?.source === "owner") d.changed = true;
  };

  const valid = marks.filter((m) => !cancelOf.has(m.id)).sort((a, b) => a.at.getTime() - b.at.getTime());
  let openIn: Mark | null = null;
  for (const m of valid) {
    if (m.kind === "in") {
      if (openIn) addBlock(openIn, null, "no_exit"); // IN after IN: the first had no exit
      openIn = m;
      continue;
    }
    if (openIn && m.at.getTime() - openIn.at.getTime() < OPEN_IN_MS) {
      addBlock(openIn, m, "done");
      openIn = null;
      continue;
    }
    if (openIn) addBlock(openIn, null, "no_exit"); // the OUT came 16 h or more later: too late to close it
    openIn = null;
    const d = day(istDay(m.at)); // OUT without an IN before it: no entry
    d.entries.push({ type: "no_entry", at: m.at, mark: m });
    d.noEntry = true;
    if (m.source === "owner") d.changed = true;
  }
  if (openIn) addBlock(openIn, null, now.getTime() - openIn.at.getTime() < OPEN_IN_MS ? "open" : "no_exit");

  for (const m of marks) {
    const c = cancelOf.get(m.id);
    if (!c) continue;
    const d = day(istDay(m.at));
    d.entries.push({ type: "cancelled", at: m.at, mark: m, cancel: c });
    d.changed = true;
  }
  for (const d of days.values()) d.entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  return days;
}
