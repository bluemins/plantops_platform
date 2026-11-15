import { handle, json, readJson } from "@/server/http";
import { lookupTicket, savedVisitLocations, VisitCheckInput } from "@/server/plantops-lookup";

/** Attendance's field day: which visits saved a shop location (read-only). Only with a `customer_location` ticket. */
export const POST = handle(async (req) => {
  const t = await lookupTicket(req, "customer_location");
  return json(await savedVisitLocations(t.tenant_id, (await readJson(req, VisitCheckInput)).visit_ids));
});
