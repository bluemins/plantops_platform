import { after } from "next/server";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { newNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Log a complaint (owner, complaint desk, plant staff). Plant and reporter come from the session, never the body. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const saved = await createComplaint(user, await readJson(req, ComplaintInput));
  after(() => kit.notify(user.tenantId, newNotification(user, saved)));
  return json({ id: saved.id, ref: saved.ref }, { status: 201 });
});
