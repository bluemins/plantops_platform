import { handle, json, readJson, uuidParam } from "@/server/http";
import { FieldLocationInput, lookupTicket, saveFieldLocation } from "@/server/plantops-lookup";

type Ctx = { params: Promise<{ id: string }> };

/** Attendance's field day: a visit saves the shop's location (once per visit). Only with a platform lookup ticket. */
export const POST = handle(async (req, ctx: Ctx) => {
  const t = await lookupTicket(req, "customer_location");
  const id = uuidParam((await ctx.params).id);
  return json(await saveFieldLocation(t.tenant_id, id, await readJson(req, FieldLocationInput)));
});
