import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { reportsSummaryForUser } from "@/server/summary";

/** The owner's Reports card: last month's sales, fetched from Order Capture right now. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json(await reportsSummaryForUser(user));
});
