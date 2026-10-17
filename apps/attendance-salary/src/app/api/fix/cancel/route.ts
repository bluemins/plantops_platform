import { cancelFix, CancelInput } from "@/server/fixes";
import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { requireApiUser } from "@/server/session";

/** Owner or Office staff (never their own): cancel a wrong mark, with a reason. Once per mark; 409 if the person's day changed since the page loaded. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { notice, ownerNotice, ...answer } = await cancelFix(user, await readJson(req, CancelInput));
  if (notice) after(() => kit.notify(user.tenantId, notice)); // "your attendance was changed", to the worker, after the answer
  if (ownerNotice) after(() => kit.notify(user.tenantId, ownerNotice)); // Office staff's fix: the owners' bell
  return json(answer, { status: 201 });
});
