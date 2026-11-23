import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { accountsDeskSummaryForUser } from "@/server/summary";

/** The Accounts desk card: to bill / overdue / unpaid counts, fetched from Sales right now. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json(await accountsDeskSummaryForUser(user));
});
