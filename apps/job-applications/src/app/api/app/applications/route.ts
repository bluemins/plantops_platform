import { after } from "next/server";
import { AddInput, addApplicant } from "@/server/add";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { newApplicationNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** "+ Add applicant" (owner, HR desk): someone who phoned or walked in. Resume pages follow, one file per request. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const added = await addApplicant(user, await readJson(req, AddInput));
  // the others hear about it (not whoever added it); never blocks the answer
  if (added.saved) after(() => kit.notify(user.tenantId, { ...newApplicationNotification(added.saved!), exclude_user_id: user.userId }));
  return json({ id: added.id, ref: added.ref }, { status: 201 });
});
