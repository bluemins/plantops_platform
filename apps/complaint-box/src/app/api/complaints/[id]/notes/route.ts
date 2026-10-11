import { after } from "next/server";
import { addNote, NoteInput } from "@/server/followup";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { updatedNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Add a note to a complaint, in any status (owner, complaint desk, plant staff). Its photos are uploaded next. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const n = await addNote(user, uuidParam((await ctx.params).id), await readJson(req, NoteInput));
  after(() => kit.notify(user.tenantId, updatedNotification(user, { complaint_id: n.complaint_id, ref: n.ref, event_id: n.id, note: n.text })));
  return json({ id: n.id }, { status: 201 });
});
