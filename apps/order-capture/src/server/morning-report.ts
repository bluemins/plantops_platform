// Plant answers Phase 5 (owner 2026-11-28; docs/MORNING_REPORT_PHASE_PLAN.md): the 8:30 am morning report. The cards
// the rules read are worked out as the owner would see them, the rules (src/lib/answers/rank.ts) pick at most 7 actions,
// and the result is saved once per plant per day (Sales migration 0029: SELECT + INSERT only), so the page shows what was
// sent and the owner's Useful / Not useful taps point at it. Never changes a bill, order, payment or count.
import { sql } from "drizzle-orm";
import { cardById } from "@/lib/answers/cards";
import type { Facts } from "@/lib/answers/facts";
import { morningCopy, morningSummary, rankRules, shortDate, type Action, type RankInput } from "@/lib/answers/rank";
import { WORDING_VERSION } from "@/lib/answers/word";
import { can, requireAccess } from "./access";
import { answersOn, RULES_VERSION, runCard } from "./answers";
import { withTenant } from "./db";
import { reader } from "./day-report";
import { badRequest, forbidden, notFound } from "./http";
import { istToday } from "./cash";
import type { OcUser } from "./session";

/** the cards the rules read, in the table's order */
export const MORNING_CARDS = ["S3", "S1", "S2", "O1", "M2", "O2"] as const;
/** how many earlier mornings the page lists */
export const PAST_DAYS = 14;

export type Mark = "useful" | "not_useful";
export interface MorningReport {
  id: string;
  date: string;
  actions: Action[];
  missing: string[];
  summary: string;
  preparedBy: { by: "rules"; rules: number; wording: number };
  createdAt: string;
}

/** money is whole paise (bigint): stored as text in the saved facts */
const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/** Work out today's report for a plant (nothing saved). Each card that fails is said, never treated as nothing to do. */
export async function buildMorning(tenantId: string, today: string) {
  const user = reader(tenantId);
  const input: RankInput = {};
  const facts: Record<string, Facts> = {};
  const missing: string[] = [];
  for (const id of MORNING_CARDS) {
    try {
      const r = await runCard(user, id, today);
      input[id] = r.facts;
      facts[id] = r.facts;
      for (const m of r.missing) if (!missing.includes(m)) missing.push(m);
    } catch (e) {
      console.error(`[morning] ${id} failed`, tenantId, e);
      missing.push(`"${cardById(id)!.title}" could not be worked out this morning.`);
    }
  }
  const ranked = rankRules(input);
  return { ranked, facts, missing, summary: morningSummary(ranked) };
}

/** Save today's report once (a second run adds nothing). Returns the saved one and whether this call made it. */
export async function saveMorning(tenantId: string, now = new Date()): Promise<{ created: boolean; report: MorningReport }> {
  const today = istToday(now);
  const existing = await reportOn(tenantId, today);
  if (existing) return { created: false, report: existing };
  const b = await buildMorning(tenantId, today);
  const prepared = { by: "rules" as const, rules: RULES_VERSION, wording: WORDING_VERSION };
  const ins = await withTenant(tenantId, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into order_capture.morning_reports (tenant_id, report_date, actions, facts, missing, summary, prepared_by)
      values (${tenantId}, ${today}::date, ${toJson(b.ranked.actions)}::jsonb, ${toJson({ cards: b.facts, left_out: b.ranked.leftOut })}::jsonb,
              ${toJson(b.missing)}::jsonb, ${b.summary.title.slice(0, 300)}, ${toJson(prepared)}::jsonb)
      on conflict (tenant_id, report_date) do nothing
      returning id`),
  );
  const report = (await reportOn(tenantId, today))!;
  return { created: ins.rows.length > 0, report };
}

type Raw = { id: string; date: string; actions: Action[]; missing: string[]; summary: string; prepared_by: MorningReport["preparedBy"]; created_at: Date };
const fromRaw = (r: Raw): MorningReport => ({ id: r.id, date: r.date, actions: r.actions, missing: r.missing, summary: r.summary, preparedBy: r.prepared_by, createdAt: new Date(r.created_at).toISOString() });

async function reportOn(tenantId: string, date: string): Promise<MorningReport | null> {
  const r = await withTenant(tenantId, (tx) =>
    tx.execute<Raw>(sql`
      select id, report_date::text as date, actions, missing, summary, prepared_by, created_at
        from order_capture.morning_reports where tenant_id = ${tenantId} and report_date = ${date}::date`),
  );
  return r.rows[0] ? fromRaw(r.rows[0]) : null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The page: a saved report (today if no date), this person's latest tap per action, the earlier mornings. */
export async function morningPage(user: OcUser, date?: string) {
  if (!answersOn(user.tenantId)) throw notFound();
  requireAccess(user, "answers");
  const day = date && YMD.test(date) ? date : istToday();
  const report = await reportOn(user.tenantId, day);
  return withTenant(user.tenantId, async (tx) => {
    const marks = report
      ? await tx.execute<{ action_no: number; mark: Mark }>(sql`
          select distinct on (action_no) action_no, mark from order_capture.morning_report_marks
           where tenant_id = ${user.tenantId} and report_id = ${report.id} and user_id = ${user.userId}
           order by action_no, created_at desc, id desc`)
      : { rows: [] };
    const past = await tx.execute<{ date: string; actions: number; useful: number }>(sql`
      select r.report_date::text as date, jsonb_array_length(r.actions)::int as actions,
             (select count(*)::int from (
                select distinct on (m.user_id, m.action_no) m.mark from order_capture.morning_report_marks m
                 where m.tenant_id = r.tenant_id and m.report_id = r.id order by m.user_id, m.action_no, m.created_at desc, m.id desc) x
               where x.mark = 'useful') as useful
        from order_capture.morning_reports r
       where r.tenant_id = ${user.tenantId} and r.report_date < ${day}::date
       order by r.report_date desc limit ${PAST_DAYS}`);
    return {
      day,
      report,
      marks: Object.fromEntries(marks.rows.map((m) => [m.action_no, m.mark])) as Record<number, Mark>,
      past: past.rows,
      copy: report && can(user, "answers_copy") ? morningCopy(shortDate(report.date), report.actions) : null,
      canMark: can(user, "answers_copy") && !user.isSupport,
    };
  });
}

/** Useful / Not useful on one action (owner only; P5-d). A new row each time: the latest counts. */
export async function markAction(user: OcUser, input: { date: unknown; action_no: unknown; mark: unknown }) {
  if (!answersOn(user.tenantId)) throw notFound();
  if (user.isSupport || !can(user, "answers_copy")) throw forbidden("Only the plant owner marks the morning report");
  const date = typeof input.date === "string" && YMD.test(input.date) ? input.date : null;
  const no = Number(input.action_no);
  const mark = input.mark === "useful" || input.mark === "not_useful" ? input.mark : null;
  if (!date || !Number.isInteger(no) || !mark) throw badRequest("Give the day, the action number and useful or not_useful");
  const report = await reportOn(user.tenantId, date);
  if (!report) throw notFound("No morning report that day");
  if (no < 1 || no > report.actions.length) throw badRequest("That action is not in the report");
  await withTenant(user.tenantId, (tx) =>
    tx.execute(sql`
      insert into order_capture.morning_report_marks (tenant_id, report_id, action_no, mark, user_id, user_name)
      values (${user.tenantId}, ${report.id}, ${no}, ${mark}, ${user.userId}, ${user.name.slice(0, 100)})`),
  );
  return { ok: true, action_no: no, mark };
}
