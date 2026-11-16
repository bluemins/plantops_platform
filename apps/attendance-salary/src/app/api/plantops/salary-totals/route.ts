import { handle, json } from "@/server/http";
import { salaryTicket, salaryTotals } from "@/server/salary-totals";

/** Sales' Business charts: the plant's salary totals (?from=YYYY-MM-DD&to=…). Only with a platform lookup ticket. */
export const GET = handle(async (req) => {
  const t = await salaryTicket(req);
  const q = new URL(req.url).searchParams;
  return json(await salaryTotals(t.tenant_id, q.get("from") ?? "", q.get("to") ?? ""), { headers: { "cache-control": "no-store" } });
});
