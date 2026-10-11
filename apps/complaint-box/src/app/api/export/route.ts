import { handle } from "@/server/http";
import { exportCsv } from "@/server/inbox";
import { requireApiUser } from "@/server/session";

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Owner: every complaint with its history as a CSV file (opens in Excel; formulas neutralised; audited). */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportCsv(user);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="complaints-${istDay()}.csv"`,
      "cache-control": "no-store",
    },
  });
});
