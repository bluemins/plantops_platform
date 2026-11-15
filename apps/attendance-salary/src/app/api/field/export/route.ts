import { istMonth } from "@/lib/days";
import { fieldCsv } from "@/server/field";
import { handle, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: one person's field visits for a month (?user=<id>&month=2026-11). Audited. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const q = new URL(req.url).searchParams;
  const month = q.get("month") || istMonth();
  const { name, body } = await fieldCsv(user, uuidParam(q.get("user") ?? ""), month);
  const safe = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "field";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="field-visits-${safe}-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
});
