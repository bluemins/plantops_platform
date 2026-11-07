import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { reportsSummaryForUser } from "@/server/summary";

/** The Customers card: owner (customers, money due, Zoho contacts to match) or Marketing staff (no money), from Sales now. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json(await reportsSummaryForUser(user, "customers"));
});
