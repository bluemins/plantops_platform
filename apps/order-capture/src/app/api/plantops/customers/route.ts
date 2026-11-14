import { handle, json } from "@/server/http";
import { lookupCustomers, lookupTicket } from "@/server/plantops-lookup";

/** Attendance's field day: search the customer list (name / place / phone). Only with a platform lookup ticket. */
export const GET = handle(async (req) => {
  const t = await lookupTicket(req, "customers");
  return json(await lookupCustomers(t.tenant_id, new URL(req.url).searchParams.get("q") ?? ""), { headers: { "cache-control": "no-store" } });
});
