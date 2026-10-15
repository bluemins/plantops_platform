// The IN / OUT rules (docs/ATTENDANCE_PHASE_PLAN.md "How a worker marks attendance"). Pure functions: the server
// decides with them, the scan screen shows what the server will do.

export type Kind = "in" | "out";

/** An IN with no OUT is still "inside" for this long; after it, the next mark is an IN again (owner, Phase 0). */
export const OPEN_IN_MS = 16 * 3600_000;
/** A second mark this soon after the last one is refused as a double tap (owner, Phase 0). */
export const DOUBLE_TAP_MS = 2 * 60_000;
/** A location rougher than this is refused (owner, Phase 0). */
export const MAX_ACCURACY_M = 500;

export interface LastMark {
  kind: Kind;
  at: Date;
}

/** OUT if the last valid mark is an IN less than 16 hours ago, otherwise IN. */
export function nextKind(last: LastMark | null, now: Date = new Date()): Kind {
  return last && last.kind === "in" && now.getTime() - last.at.getTime() < OPEN_IN_MS ? "out" : "in";
}

/** The last valid mark is less than 2 minutes old. */
export const isDoubleTap = (last: LastMark | null, now: Date = new Date()) => !!last && now.getTime() - last.at.getTime() < DOUBLE_TAP_MS;

/** "9:02", "18:30" in India time. */
export const fmtTime = (at: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at)).replace(/^0(\d)/, "$1");

/** The scan screen's state line: "You are OUT" or "IN since 9:02". */
export const stateText = (last: LastMark | null, now: Date = new Date()) => (nextKind(last, now) === "out" ? `IN since ${fmtTime(last!.at)}` : "You are OUT");
