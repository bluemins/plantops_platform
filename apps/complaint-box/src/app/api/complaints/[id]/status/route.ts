import { after } from "next/server";
import { changeStatus, StatusInput } from "@/server/followup";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { statusNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** In progress (owner or staff), Resolve / Reopen with a note (owner). 409 if someone changed it first. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const r = await changeStatus(user, uuidParam((await ctx.params).id), await readJson(req, StatusInput));
  const note = statusNotification(user, { complaint_id: r.complaint_id, ref: r.ref, event_id: r.event_id, kind: r.kind, text: r.text, reported_by: r.reported_by });
  if (note) after(() => kit.notify(user.tenantId, note));
  return json({ status: r.status, event_id: r.event_id });
});
