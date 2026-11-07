import { z } from "zod";
import { csv } from "@plantops/module-kit/csv";
import { zohoCsvRows } from "@/server/bill-make";
import { handle, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/**
 * Owner, Accounts: the GST bills as a file Zoho Books imports as invoices. "new" = not sent yet (marks them sent),
 * "again" = the ones already sent, without an INV number yet. A POST (JSON) because "new" changes the bills.
 */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { which } = await readJson(req, z.object({ which: z.enum(["new", "again"]) }));
  const { rows, count } = await zohoCsvRows(user, which);
  return new Response(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zoho-invoices-${istDay()}.csv"`,
      "cache-control": "no-store",
      "x-bill-count": String(count),
    },
  });
});
