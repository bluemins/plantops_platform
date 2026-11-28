import { InvalidTokenError, verifyLookupRequest } from "@plantops/auth";
import { StockAnswers } from "@plantops/types";
import { kit } from "@/server/kit";
import { stockAnswers } from "@/server/stock-answers";

/** Sales' Plant answers S1–S4 + morning report (owner 2026-11-28): count status, not updated, Can make, days of stock. Only with a lookup ticket (scope stock_answers). */
export async function GET(req: Request) {
  const ticket = await verifyLookupRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys(), scope: "stock_answers" }).catch((e: unknown) => {
    if (e instanceof InvalidTokenError) return null;
    throw e;
  });
  if (!ticket) return Response.json({ error: "Not a valid PlantOps lookup ticket" }, { status: 401 });
  return Response.json(StockAnswers.parse(await stockAnswers(ticket.tenant_id)), { headers: { "cache-control": "no-store" } });
}
