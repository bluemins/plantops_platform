import { csv } from "@plantops/module-kit/csv";
import { handle } from "@/server/http";
import { billsCsvRows } from "@/server/ledger";
import { requireApiUser } from "@/server/session";

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Owner: every bill as a CSV file (formulas neutralised). */
export const GET = handle(async () => {
  const user = await requireApiUser();
  return new Response(csv(await billsCsvRows(user)), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="bills-${istDay()}.csv"`, "cache-control": "no-store" },
  });
});
