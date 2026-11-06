import { csv } from "@plantops/module-kit/csv";
import { badRequest, handle, uuidParam } from "@/server/http";
import { statementCsvRows } from "@/server/ledger";
import { requireApiUser } from "@/server/session";

/** A customer's (?c=) or an unmatched Zoho contact's (?z=) statement as CSV, for a date range (owner, Order desk, support). */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const u = new URL(req.url);
  const c = u.searchParams.get("c");
  const z = u.searchParams.get("z");
  if (!c && !z) throw badRequest("Which customer?");
  const party = c ? { kind: "customer" as const, id: uuidParam(c) } : { kind: "contact" as const, id: uuidParam(z!) };
  const rows = await statementCsvRows(user, party, { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined });
  return new Response(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="statement.csv"', "cache-control": "no-store" },
  });
});
