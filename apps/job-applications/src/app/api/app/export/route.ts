import { exportCsv } from "@/server/applications";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: every application as CSV (no files). Audited. */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportCsv(user);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="job-applications-${day}.csv"`, "cache-control": "no-store" },
  });
});
