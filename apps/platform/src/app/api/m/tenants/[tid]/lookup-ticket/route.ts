import { LookupTicketRequest } from "@plantops/types";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { issueLookupTicket } from "@/server/lookup";

type Ctx = { params: Promise<{ tid: string }> };

/** Server-to-server: a 60-second ticket for one module to ask another (only the pairs in LOOKUPS, both switched on). */
export const POST = handle(async (req, ctx: Ctx) => {
  const tenantId = uuidParam((await ctx.params).tid);
  return json(await issueLookupTicket(req, tenantId, await readJson(req, LookupTicketRequest)));
});
