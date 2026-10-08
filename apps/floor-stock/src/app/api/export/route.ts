import { istDay } from "@/lib/days";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { exportCsv } from "@/server/views";

/** Owner: every version of every count as a CSV file (opens in Excel; formulas neutralised). */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportCsv(user);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="floor-stock-${istDay()}.csv"`,
      "cache-control": "no-store",
    },
  });
});
