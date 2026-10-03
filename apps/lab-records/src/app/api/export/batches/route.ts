import { exportBatches } from "@/server/export";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: all batches as a CSV file (opens in Excel), regardless of the plan's history window. */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const body = await exportBatches(user);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="lab-batches-${day}.csv"`, "cache-control": "no-store" },
  });
});
