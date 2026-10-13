import { handle } from "@/server/http";
import { exportCsv } from "@/server/list";
import { requireApiUser } from "@/server/session";

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Owner: every order, one row per line of its current version, as a CSV file (formulas neutralised; audited). */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportCsv(user);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders-${istDay()}.csv"`,
      "cache-control": "no-store",
    },
  });
});
