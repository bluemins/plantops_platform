import { after } from "next/server";
import { ClaimInput, sendClaim } from "@/server/claims";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { claimNewNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** A worker sends a field-duty or expense claim for themselves. The owners hear about it (not for an owner's own). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { id, approved, claim } = await sendClaim(user, await readJson(req, ClaimInput));
  if (!approved) after(() => kit.notify(user.tenantId, claimNewNotification(user, claim)));
  return json({ id, approved }, { status: 201 });
});
