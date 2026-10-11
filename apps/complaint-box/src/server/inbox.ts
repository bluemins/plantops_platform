// Reading complaints (docs/COMPLAINT_BOX_PHASE_PLAN.md "Complaint list" and "Follow-up and resolving"): the list with
// its filters and search, one complaint with its photos / video and history, and the owner's CSV export.
import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { formatRef } from "@/lib/phone";
import { can, requireAccess } from "./access";
import { schema, withTenant } from "./db";
import { notFound } from "./http";
import type { ComplaintStatus, EventKind, FileKind } from "./schema";
import { actorOf, type CbUser } from "./session";

const { auditLog, complaintEvents, complaints, files } = schema;

const DAY = 24 * 60 * 60 * 1000;
/** More than this many days open (or in progress) shows amber. */
export const AMBER_AFTER_DAYS = 3;

export const STATUS_TEXT: Record<ComplaintStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

// ---------- the list ----------
export type StatusFilter = "active" | ComplaintStatus | "all";
export interface ListFilters {
  /** default "active" = open + in progress */
  status?: StatusFilter;
  item?: string;
  /** India dates YYYY-MM-DD, by the day the complaint was logged */
  from?: string;
  to?: string;
  q?: string;
}

export interface ListRow {
  id: string;
  ref: string;
  status: ComplaintStatus;
  item_name: string;
  customer_name: string;
  phone: string;
  place: string;
  reported_by_name: string;
  created_at: string;
  status_changed_at: string;
  /** logged, or last reopened */
  opened_at: string;
  /** whole days since opened_at (null when resolved) */
  days_open: number | null;
  amber: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const istStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
/** "%" and "_" typed in the search box are taken literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The last time each complaint in the list was reopened (null = never). Written out in full: inside the subquery a
 * bare "id" would mean the event's own id, not the complaint's.
 */
const lastReopened = sql<string | null>`(select max(e.created_at) from complaint_box.complaint_events e where e.complaint_id = "complaints"."id" and e.kind = 'reopened')`;

export function daysOpen(status: ComplaintStatus, openedAt: Date, now = Date.now()) {
  if (status === "resolved") return { days_open: null, amber: false };
  const days = Math.max(0, Math.floor((now - openedAt.getTime()) / DAY));
  return { days_open: days, amber: days > AMBER_AFTER_DAYS };
}

/** The plant's complaints, newest first (at most 200), with the screen's filters and search. */
export async function listComplaints(user: CbUser, f: ListFilters = {}, now = Date.now()): Promise<ListRow[]> {
  requireAccess(user, "read");
  const where: SQL[] = [eq(complaints.tenantId, user.tenantId)];
  const status = f.status ?? "active";
  if (status === "active") where.push(inArray(complaints.status, ["open", "in_progress"]));
  else if (status !== "all") where.push(eq(complaints.status, status));
  if (f.item && /^[0-9a-f-]{36}$/i.test(f.item)) where.push(eq(complaints.itemId, f.item));
  if (f.from && YMD.test(f.from)) where.push(gte(complaints.createdAt, istStart(f.from)));
  if (f.to && YMD.test(f.to)) where.push(lt(complaints.createdAt, new Date(istStart(f.to).getTime() + DAY)));
  const q = f.q?.trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    const any: SQL[] = [sql`${complaints.customerName} ilike ${like}`, sql`${complaints.place} ilike ${like}`];
    const ref = /^(?:c-?)?0*(\d{1,9})$/i.exec(q);
    if (ref) any.push(eq(complaints.refNo, Number(ref[1])));
    const digits = q.replace(/[\s\-.()+]/g, "");
    if (/^\d{3,}$/.test(digits)) any.push(sql`${complaints.phone} like ${`%${digits.slice(-10)}%`}`);
    where.push(or(...any)!);
  }
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ c: complaints, reopened: lastReopened })
      .from(complaints)
      .where(and(...where))
      .orderBy(desc(complaints.createdAt), desc(complaints.refNo))
      .limit(200);
    return rows.map(({ c, reopened }) => {
      const openedAt = reopened ? new Date(reopened) : c.createdAt;
      return {
        id: c.id,
        ref: formatRef(c.refNo),
        status: c.status,
        item_name: c.itemName,
        customer_name: c.customerName,
        phone: c.phone,
        place: c.place,
        reported_by_name: c.reportedByName,
        created_at: c.createdAt.toISOString(),
        status_changed_at: c.statusChangedAt.toISOString(),
        opened_at: openedAt.toISOString(),
        ...daysOpen(c.status, openedAt, now),
      };
    });
  });
}

// ---------- one complaint ----------
export interface FileView {
  id: string;
  kind: FileKind;
}
export interface EventView {
  id: string;
  kind: EventKind;
  text: string | null;
  by: string;
  by_id: string;
  at: string;
  photos: FileView[];
}
export interface ComplaintDetail extends ListRow {
  phone_typed: string;
  batch_text: string | null;
  description: string;
  reported_by: string;
  photos: FileView[];
  video: FileView | null;
  history: EventView[];
  /** the buttons this user gets */
  can: { note: boolean; in_progress: boolean; resolve: boolean; reopen: boolean; add_files: boolean };
}

export async function getComplaint(user: CbUser, id: string, now = Date.now()): Promise<ComplaintDetail> {
  requireAccess(user, "read");
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select().from(complaints).where(and(eq(complaints.tenantId, user.tenantId), eq(complaints.id, id)));
    if (!c) throw notFound("Complaint not found");
    const evs = await tx.select().from(complaintEvents).where(and(eq(complaintEvents.tenantId, user.tenantId), eq(complaintEvents.complaintId, id))).orderBy(asc(complaintEvents.createdAt), asc(complaintEvents.id));
    const fs = await tx.select({ id: files.id, kind: files.kind, eventId: files.eventId }).from(files).where(and(eq(files.tenantId, user.tenantId), eq(files.complaintId, id))).orderBy(asc(files.uploadedAt));
    const reopened = evs.filter((e) => e.kind === "reopened").at(-1)?.createdAt;
    const openedAt = reopened ?? c.createdAt;
    const own = fs.filter((f) => !f.eventId);
    return {
      id: c.id,
      ref: formatRef(c.refNo),
      status: c.status,
      item_name: c.itemName,
      customer_name: c.customerName,
      phone: c.phone,
      phone_typed: c.phoneTyped,
      place: c.place,
      batch_text: c.batchText,
      description: c.description,
      reported_by: c.reportedBy,
      reported_by_name: c.reportedByName,
      created_at: c.createdAt.toISOString(),
      status_changed_at: c.statusChangedAt.toISOString(),
      opened_at: openedAt.toISOString(),
      ...daysOpen(c.status, openedAt, now),
      photos: own.filter((f) => f.kind === "photo").map((f) => ({ id: f.id, kind: f.kind })),
      video: own.filter((f) => f.kind === "video").map((f) => ({ id: f.id, kind: f.kind }))[0] ?? null,
      history: evs.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        by: e.createdByName,
        by_id: e.createdBy,
        at: e.createdAt.toISOString(),
        photos: fs.filter((f) => f.eventId === e.id).map((f) => ({ id: f.id, kind: f.kind })),
      })),
      can: {
        note: can(user, "note"),
        in_progress: can(user, "in_progress") && c.status === "open",
        resolve: can(user, "resolve") && c.status !== "resolved",
        reopen: can(user, "reopen") && c.status === "resolved",
        add_files: can(user, "log") && (user.isOwner || c.reportedBy === user.userId) && now - c.createdAt.getTime() <= DAY,
      },
    };
  });
}

// ---------- the owner's CSV ----------
const EVENT_TEXT: Record<EventKind, string> = { in_progress: "set it In progress", resolved: "resolved it", reopened: "reopened it", note: "added a note" };

/** One line of history in words: "2026-10-03 15:00 Sujata resolved it: Jar replaced". */
export const historyLine = (e: { kind: EventKind; text: string | null; by: string; at: Date | string }) =>
  `${csvTime(e.at)} ${e.by} ${EVENT_TEXT[e.kind]}${e.text ? `: ${e.text}` : ""}`;

/** Every complaint, one row each with its whole history (oldest first). Owner only; audited. */
export async function exportCsv(user: CbUser) {
  requireAccess(user, "export");
  return withTenant(user.tenantId, async (tx) => {
    const cs = await tx.select().from(complaints).where(eq(complaints.tenantId, user.tenantId)).orderBy(asc(complaints.refNo));
    const evs = await tx.select().from(complaintEvents).where(eq(complaintEvents.tenantId, user.tenantId)).orderBy(asc(complaintEvents.createdAt), asc(complaintEvents.id));
    const fs = await tx.select({ complaintId: files.complaintId, kind: files.kind }).from(files).where(eq(files.tenantId, user.tenantId));
    await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action: "export.csv", details: { by: user.name, complaints: cs.length } });
    return csv([
      ["Reference", "Logged at", "Logged by", "Customer", "Mobile (as typed)", "Mobile", "Place", "Item", "Batch / date", "Description", "Status", "Status changed at", "Photos (incl. notes)", "Video", "History"],
      ...cs.map((c) => [
        formatRef(c.refNo),
        csvTime(c.createdAt),
        c.reportedByName,
        c.customerName,
        c.phoneTyped,
        c.phone,
        c.place,
        c.itemName,
        c.batchText ?? "",
        c.description,
        STATUS_TEXT[c.status],
        csvTime(c.statusChangedAt),
        fs.filter((f) => f.complaintId === c.id && f.kind === "photo").length,
        fs.some((f) => f.complaintId === c.id && f.kind === "video") ? "yes" : "no",
        evs
          .filter((e) => e.complaintId === c.id)
          .map((e) => historyLine({ kind: e.kind, text: e.text, by: e.createdByName, at: e.createdAt }))
          .join("\n"),
      ]),
    ]);
  });
}
