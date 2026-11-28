import { InvalidTokenError, verifyLookupRequest } from "@plantops/auth";
import { StockLevels } from "@plantops/types";
import { kit } from "@/server/kit";
import { stockLevels } from "@/server/stock-levels";

/** Sales' Plant answers O1 (owner 2026-11-28): the last count's finished-goods stock. Only with a lookup ticket (scope stock_levels). */
export async function GET(req: Request) {
  const ticket = await verifyLookupRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys(), scope: "stock_levels" }).catch((e: unknown) => {
    if (e instanceof InvalidTokenError) return null;
    throw e;
  });
  if (!ticket) return Response.json({ error: "Not a valid PlantOps lookup ticket" }, { status: 401 });
  return Response.json(StockLevels.parse(await stockLevels(ticket.tenant_id)), { headers: { "cache-control": "no-store" } });
}
