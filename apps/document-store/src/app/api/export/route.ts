import { exportDocuments } from "@/server/export";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: every document and version as a CSV file (opens in Excel). The files themselves stay in the app. */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportDocuments(user);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="documents-${day}.csv"`, "cache-control": "no-store" },
  });
});
