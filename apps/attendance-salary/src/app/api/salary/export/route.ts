import { istMonth } from "@/lib/days";
import { handle } from "@/server/http";
import { salaryCsv } from "@/server/salary-tab";
import { requireApiUser } from "@/server/session";

/** Owner: the month's salary CSV (?month=2026-10; this month if missing). Audited. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const month = new URL(req.url).searchParams.get("month") || istMonth();
  const body = await salaryCsv(user, month);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="salary-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
});
