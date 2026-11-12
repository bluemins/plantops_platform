// The cash book → Attendance link (docs/CASHBOOK_PHASE_PLAN.md section 9, C4; owner 2026-11-12). Staff cash given as an
// "Advance against salary" is sent to Attendance as an advance; cash brought back for one ("Took back") as a correction
// of it; a cancelled cash-book advance as a correction of what is left. Each send is a row in attendance_sends:
// waiting → sent (Attendance saved it) or refused (Attendance said no, with its plain reason; "Send again" after the fix).
// Attendance can't be reached / answers 5xx → it stays waiting and the daily job tries again. Attendance stores the
// cash book's number, so a second send of the same thing is never saved twice.
// Settings on order-capture: ATTEND_CASHBOOK_KEYS {"<plant>": "atc_…"} and ATTEND_URL. A plant without a key: nothing is
// sent (the cash book works as before).
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { NotificationInput } from "@plantops/types";
import { paise, signedMoney } from "@/lib/cash";
import { requireAccess } from "./access";
import { orderDb, schema, withTenant, type OcTx } from "./db";
import { env } from "./env";
import { badRequest, notFound } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { attendanceSends: sends, cashEntries } = schema;

// ---------- settings ----------
let parsedFrom: string | null = null;
let parsed: Record<string, string> = {};
let parseProblem: string | null = null;
function keys(): Record<string, string> {
  const raw = env.attendCashbookKeys;
  if (raw === parsedFrom) return parsed;
  parsedFrom = raw;
  parsed = {};
  parseProblem = null;
  if (!raw.trim()) return parsed;
  try {
    parsed = z.record(z.uuid(), z.string().regex(/^atc_[A-Za-z0-9_-]{43}$/)).parse(JSON.parse(raw));
  } catch (err) {
    parseProblem = "ATTEND_CASHBOOK_KEYS is not valid, so cash book advances are not sent to Attendance";
    console.error(`[order-capture] ${parseProblem}:`, (err as Error).message);
  }
  if (Object.keys(parsed).length && !env.attendUrl) parseProblem = "ATTEND_CASHBOOK_KEYS is set but ATTEND_URL is empty, so advances can't reach Attendance";
  return parsed;
}

/** What is wrong with the link's settings (for /health); null = fine or not set. */
export function attendanceLinkProblem(): string | null {
  keys();
  return parseProblem;
}

/** Whether this plant's cash book sends advances to Attendance. */
export const linkOn = (tenantId: string) => Boolean(keys()[tenantId] && env.attendUrl);

// ---------- one call ----------
export type CallResult = { kind: "ok"; id: string | null } | { kind: "refused"; message: string } | { kind: "retry"; message: string };

/** POST to Attendance (5 s). 4xx with a reason = refused; unreachable, 5xx, 401 (a key problem) and 429 = try later. */
export async function callAttendance(tenantId: string, body: Record<string, unknown>): Promise<CallResult> {
  const key = keys()[tenantId];
  if (!key || !env.attendUrl) return { kind: "retry", message: "The Attendance link isn't set up for this plant" };
  let res: Response;
  try {
    res = await fetch(`${env.attendUrl}/api/cashbook/v1/advances`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { kind: "retry", message: "Attendance can't be reached right now" };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string | null; error?: string };
  if (res.ok) return { kind: "ok", id: data.id ?? null };
  if (res.status === 401) return { kind: "retry", message: "Attendance didn't accept the cash book key (ask PlantOps to check ATTEND_CASHBOOK_KEYS)" };
  if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: "retry", message: data.error ?? `Attendance answered ${res.status}` };
  return { kind: "refused", message: (data.error ?? `Attendance answered ${res.status}`).slice(0, 300) };
}

// ---------- the rows ----------
export interface SendStatus {
  status: "waiting" | "sent" | "refused";
  message: string | null;
}

export async function queueSend(tx: OcTx, t: string, entryId: string, action: "advance" | "return" | "cancel", sourceRef: string, payload: Record<string, unknown>) {
  const [row] = await tx.insert(sends).values({ tenantId: t, cashEntryId: entryId, action, sourceRef, payload: { action, source_ref: sourceRef, ...payload } }).returning({ id: sends.id });
  return row!.id;
}

/** The advance / return send of each entry (cancel sends are not shown on the entry). */
export async function statusOf(tx: OcTx, t: string, entryIds: string[]): Promise<Map<string, SendStatus>> {
  if (!entryIds.length) return new Map();
  const rows = await tx.select().from(sends).where(and(eq(sends.tenantId, t), inArray(sends.cashEntryId, entryIds), inArray(sends.action, ["advance", "return"]))).orderBy(asc(sends.createdAt));
  return new Map(rows.map((r) => [r.cashEntryId, { status: r.status, message: r.lastError }]));
}

/** Marks a not-yet-sent advance / return as never needed (its entry was cancelled first). */
export async function dropUnsent(tx: OcTx, t: string, entryId: string) {
  await tx
    .update(sends)
    .set({ status: "refused", lastError: "Cancelled in the cash book before it reached Attendance", updatedAt: new Date() })
    .where(and(eq(sends.tenantId, t), eq(sends.cashEntryId, entryId), eq(sends.status, "waiting"), inArray(sends.action, ["advance", "return"])));
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function failedNotice(ref: string, person: string, amount: string, cashDate: string, message: string, byId: string): NotificationInput {
  return {
    kind: "order_capture.cash_advance_failed",
    title: `Advance ${signedMoney(paise(amount))} to ${person} not in Attendance`.slice(0, 80),
    body: `${ref}: ${message}. Fix it, then tap Send again on the cash book.`.slice(0, 300),
    link: `/cash?d=${cashDate}`,
    level: "bell",
    dedupe_key: `cash_advance_failed:${ref}`,
    exclude_user_id: byId,
  };
}

/** Sends one waiting row now. Returns its status after the try. Never throws for Attendance's answers. */
export async function deliver(tenantId: string, sendId: string): Promise<SendStatus> {
  const t = tenantId;
  const row = await withTenant(t, async (tx) => (await tx.select().from(sends).where(and(eq(sends.tenantId, t), eq(sends.id, sendId))))[0]);
  if (!row) throw notFound();
  if (row.status !== "waiting") return { status: row.status, message: row.lastError };
  // a cancel of an advance that never reached Attendance: nothing there to correct
  if (row.action === "cancel") {
    const [adv] = await withTenant(t, (tx) => tx.select().from(sends).where(and(eq(sends.tenantId, t), eq(sends.cashEntryId, row.cashEntryId), eq(sends.action, "advance"))));
    if (!adv || adv.status !== "sent") {
      await withTenant(t, (tx) => tx.update(sends).set({ status: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(sends.tenantId, t), eq(sends.id, row.id))));
      return { status: "sent", message: null };
    }
  }
  const r = await callAttendance(t, row.payload);
  const now = new Date();
  const set =
    r.kind === "ok"
      ? { status: "sent" as const, sentAt: now, attendanceId: r.id, lastError: null }
      : r.kind === "refused"
        ? { status: "refused" as const, lastError: r.message }
        : { status: "waiting" as const, lastError: r.message.slice(0, 300) };
  await withTenant(t, (tx) => tx.update(sends).set({ ...set, attempts: sql`${sends.attempts} + 1`, updatedAt: now }).where(and(eq(sends.tenantId, t), eq(sends.id, row.id))));
  if (r.kind === "refused" && row.action !== "cancel") {
    const [e] = await withTenant(t, (tx) => tx.select().from(cashEntries).where(and(eq(cashEntries.tenantId, t), eq(cashEntries.id, row.cashEntryId))));
    if (e) void kit.notify(t, failedNotice(row.sourceRef.split("/")[0]!, e.personName ?? "staff", e.amount, e.cashDate, r.message, e.createdBy));
  }
  return { status: set.status, message: set.lastError };
}

/** Before saving cash brought back for an advance: would Attendance take it? (refused → the cash book saves nothing) */
export async function checkReturn(tenantId: string, body: Record<string, unknown>) {
  const r = await callAttendance(tenantId, { ...body, check: true });
  if (r.kind === "refused") throw badRequest(r.message);
  if (r.kind === "retry") throw badRequest(`${r.message}. Try again in a minute; nothing was saved.`);
}

/** Owner, Accounts: send a refused or waiting advance / return again (after setting the salary, say). */
export async function sendAgain(user: OcUser, entryId: string): Promise<SendStatus> {
  requireAccess(user, "cash_enter");
  const t = user.tenantId;
  const row = await withTenant(t, async (tx) => {
    const [e] = await tx.select().from(cashEntries).where(and(eq(cashEntries.tenantId, t), eq(cashEntries.id, entryId)));
    if (!e) throw notFound("Entry not found");
    if (e.cancelledAt) throw badRequest("This entry is cancelled");
    const [s] = await tx.select().from(sends).where(and(eq(sends.tenantId, t), eq(sends.cashEntryId, entryId), inArray(sends.action, ["advance", "return"]))).orderBy(desc(sends.createdAt)).limit(1);
    if (!s) throw badRequest("This entry isn't sent to Attendance");
    if (s.status === "sent") return s;
    await tx.update(sends).set({ status: "waiting", updatedAt: new Date() }).where(and(eq(sends.tenantId, t), eq(sends.id, s.id)));
    return s;
  });
  if (row.status === "sent") return { status: "sent", message: null };
  return deliver(t, row.id);
}

/** Daily job: every waiting send, oldest first, up to 30 tries each. */
export async function retrySends() {
  const { rows } = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.attendance_send_tenants() t`);
  let sent = 0;
  let refused = 0;
  let waiting = 0;
  for (const { id: t } of rows) {
    const list = await withTenant(t, (tx) => tx.select({ id: sends.id }).from(sends).where(and(eq(sends.tenantId, t), eq(sends.status, "waiting"), lt(sends.attempts, 30))).orderBy(asc(sends.createdAt)).limit(200));
    for (const s of list) {
      const r = await deliver(t, s.id);
      if (r.status === "sent") sent++;
      else if (r.status === "refused") refused++;
      else waiting++;
    }
  }
  return { sent, refused, waiting };
}
