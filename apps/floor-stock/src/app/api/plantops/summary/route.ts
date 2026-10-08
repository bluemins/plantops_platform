import { verifySummaryRequest } from "@plantops/auth";
import { kit } from "@/server/kit";
import { summaryFor } from "@/server/summary";

/** Only the platform can call this: it sends a 60-second ticket signed with its key, for one plant. */
export async function GET(req: Request) {
  const ask = await verifySummaryRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys() }).catch(() => null);
  if (!ask) return Response.json({ error: "Not a valid platform request" }, { status: 401 });
  return Response.json(await summaryFor(ask.tenant_id, ask.view), { headers: { "cache-control": "no-store" } });
}
