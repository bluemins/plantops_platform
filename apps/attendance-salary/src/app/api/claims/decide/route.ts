import { after } from "next/server";
import { decideClaim, DecideInput } from "@/server/claims";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { claimDecidedNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Owner: approve / not approve a waiting claim, or cancel an approved one (409 if it changed meanwhile). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { id, claim, decision, reason } = await decideClaim(user, await readJson(req, DecideInput));
  // to that worker only, after the answer; never for an owner's own claim
  if (claim.userId !== user.userId) after(() => kit.notify(user.tenantId, claimDecidedNotification(user, claim, decision, reason, id)));
  return json({ id, decision }, { status: 201 });
});
