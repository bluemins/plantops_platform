// Following a complaint up (docs/COMPLAINT_BOX_PHASE_PLAN.md "Follow-up and resolving"):
//   * notes, by anyone who works in Complaint Box, in any status
//   * Open -> In progress (owner or staff); Open / In progress -> Resolved and Resolved -> Open (owner only, with text)
//   * every change is a history row written in the SAME transaction as the status, and states the status it
//     expects, so two people acting at once get "This complaint was just changed by ..." (409)
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { formatRef } from "@/lib/phone";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { ComplaintStatus, EventKind } from "./schema";
import type { CbUser } from "./session";

const { complaintEvents, complaints } = schema;

/** The owner's quick picks on the Resolve sheet: ordinary note text, nothing special on the server. */
export const QUICK_PICKS = ["Replaced", "Refund given", "Not valid", "Entered by mistake"] as const;

export const NoteInput = z.object({ text: z.string().trim().min(1, "Please write the note").max(2000, "At most 2000 characters") });

const Status = z.enum(["open", "in_progress", "resolved"]);
export const StatusInput = z.object({
  /** "open" from Resolved = reopen */
  to: Status,
  /** the status the person saw; if it changed since, the answer is 409 */
  expected: Status,
  text: z.string().trim().max(2000, "At most 2000 characters").optional(),
});

/** Adds a note (any status). Returns the history row's id, so its photos can be uploaded to it. */
export async function addNote(user: CbUser, complaintId: string, input: z.infer<typeof NoteInput>) {
  requireAccess(user, "note");
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select({ id: complaints.id, refNo: complaints.refNo }).from(complaints).where(and(eq(complaints.tenantId, user.tenantId), eq(complaints.id, complaintId)));
    if (!c) throw notFound("Complaint not found");
    const [e] = await tx
      .insert(complaintEvents)
      .values({ tenantId: user.tenantId, complaintId, kind: "note", text: input.text, createdBy: user.userId, createdByName: user.name })
      .returning({ id: complaintEvents.id });
    return { id: e!.id, complaint_id: complaintId, ref: formatRef(c.refNo), text: input.text };
  });
}

const MOVES: Record<`${ComplaintStatus}->${ComplaintStatus}`, { kind: EventKind; action: "in_progress" | "resolve" | "reopen"; needsText: string | null } | undefined> = {
  "open->in_progress": { kind: "in_progress", action: "in_progress", needsText: null },
  "open->resolved": { kind: "resolved", action: "resolve", needsText: "Please write how it was resolved (at least 3 characters)" },
  "in_progress->resolved": { kind: "resolved", action: "resolve", needsText: "Please write how it was resolved (at least 3 characters)" },
  "resolved->open": { kind: "reopened", action: "reopen", needsText: "Please write why it is reopened (at least 3 characters)" },
  "open->open": undefined,
  "in_progress->in_progress": undefined,
  "resolved->resolved": undefined,
  "in_progress->open": undefined,
  "resolved->in_progress": undefined,
};

const NOT_ALLOWED: Record<ComplaintStatus, string> = {
  open: "This complaint is already open",
  in_progress: "This complaint is already in progress",
  resolved: "This complaint is already resolved",
};

/** Moves a complaint to another status, with its history row, in one transaction. */
export async function changeStatus(user: CbUser, complaintId: string, input: z.infer<typeof StatusInput>) {
  const move = MOVES[`${input.expected}->${input.to}`];
  if (!move) {
    if (input.expected === "resolved" && input.to === "in_progress") throw badRequest("A resolved complaint can only be reopened");
    throw badRequest(NOT_ALLOWED[input.to] ?? "That change is not possible");
  }
  requireAccess(user, move.action);
  const text = input.text?.trim() || null;
  if (move.needsText && (text?.length ?? 0) < 3) throw badRequest(move.needsText);

  return withTenant(user.tenantId, async (tx) => {
    // lock the complaint: a second person changing it at the same moment waits, then sees the new status
    const [c] = await tx.select().from(complaints).where(and(eq(complaints.tenantId, user.tenantId), eq(complaints.id, complaintId))).for("update");
    if (!c) throw notFound("Complaint not found");
    if (c.status !== input.expected) {
      const [last] = await tx.select({ by: complaintEvents.createdByName }).from(complaintEvents).where(eq(complaintEvents.complaintId, complaintId)).orderBy(desc(complaintEvents.createdAt)).limit(1);
      throw conflict(`This complaint was just changed by ${last?.by ?? "someone else"}. Please reload.`);
    }
    const [e] = await tx
      .insert(complaintEvents)
      .values({ tenantId: user.tenantId, complaintId, kind: move.kind, text, createdBy: user.userId, createdByName: user.name })
      .returning({ id: complaintEvents.id });
    await tx.update(complaints).set({ status: input.to, statusChangedAt: sql`now()` }).where(and(eq(complaints.tenantId, user.tenantId), eq(complaints.id, complaintId)));
    return { status: input.to, event_id: e!.id, complaint_id: complaintId, ref: formatRef(c.refNo), kind: move.kind as "in_progress" | "resolved" | "reopened", text, reported_by: c.reportedBy };
  });
}
