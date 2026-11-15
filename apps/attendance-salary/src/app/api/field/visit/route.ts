import { addVisit, sendShopLocation } from "@/server/field";
import { VisitInput } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/**
 * A shop visited. The visit is saved first; then, when ticked, the shop's location goes to Sales and the answer says
 * whether it was taken ("not_saved" = show "Try again" on that visit).
 */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const v = await addVisit(user, await readJson(req, VisitInput));
  const location = v.save_location ? await sendShopLocation(user, v.id) : null;
  return json({ ...v, location }, { status: 201 });
});
