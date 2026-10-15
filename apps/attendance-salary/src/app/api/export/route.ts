import { istMonth } from "@/lib/days";
import { monthCsv } from "@/server/export";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: the month CSV (?month=2026-10; this month if missing). Audited. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const month = new URL(req.url).searchParams.get("month") || istMonth();
  const body = await monthCsv(user, month);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
});
