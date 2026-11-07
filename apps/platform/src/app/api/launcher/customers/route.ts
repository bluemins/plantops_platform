import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { reportsSummaryForUser } from "@/server/summary";

/** The owner's Customers card: customers, money due, Zoho contacts without a customer, fetched from Sales right now. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json(await reportsSummaryForUser(user, "customers"));
});
