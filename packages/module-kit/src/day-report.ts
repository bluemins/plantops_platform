// Sales' Day report (owner only, owner 2026-11-16): each module answers one day's counts at
// GET /api/plantops/day-report?date=YYYY-MM-DD, server to server, only with a 60-second platform lookup ticket
// (scope day_report, from Sales). There is no user session; nothing is stored. The module writes its own wording.
import { InvalidTokenError, verifyLookupRequest, type KeySource } from "@plantops/auth";
import { DayReportPart, type ModuleId } from "@plantops/types";

export const istDate = (at: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The route handler. `build(tenantId, date, now)` answers the part; a bad / missing ticket is 401, a date that isn't a
 * real day up to today (India) is 400. The answer is checked against DayReportPart before it goes out.
 */
export function dayReportRoute(kit: { moduleId: ModuleId; keys: () => KeySource }, build: (tenantId: string, date: string, now: Date) => Promise<DayReportPart>) {
  return async function GET(req: Request) {
    const ticket = await verifyLookupRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys(), scope: "day_report" }).catch((e: unknown) => {
      if (e instanceof InvalidTokenError) return null;
      throw e;
    });
    if (!ticket) return Response.json({ error: "Not a valid PlantOps lookup ticket" }, { status: 401 });
    const date = new URL(req.url).searchParams.get("date") ?? "";
    const now = new Date();
    if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date > istDate(now)) return Response.json({ error: "date must be a day up to today" }, { status: 400 });
    const part = DayReportPart.parse(await build(ticket.tenant_id, date, now));
    return Response.json(part, { headers: { "cache-control": "no-store" } });
  };
}

/** Text helpers for the parts: cut to the schema's limits, "1 claim" / "2 claims". */
export const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The end of an India day ("YYYY-MM-DD" 23:59:59 IST), or `now` when that is earlier (today). */
export function endOfDay(date: string, now: Date) {
  const end = new Date(`${date}T23:59:59+05:30`);
  return end < now ? end : now;
}
