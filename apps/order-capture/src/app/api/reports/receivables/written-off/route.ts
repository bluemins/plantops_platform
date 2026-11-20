import { csv } from "@plantops/module-kit/csv";
import { handle } from "@/server/http";
import { writeOffsReport } from "@/server/ledger";
import { requireApiUser } from "@/server/session";
import { readWriteOffParams } from "@/server/write-off-report";

/** Owner (support reads): Reports → Receivables → Written off as a CSV, same period as the page. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const p = readWriteOffParams(Object.fromEntries(new URL(req.url).searchParams));
  const r = await writeOffsReport(user, p);
  const rows: unknown[][] = [
    ["Written off", `${p.from} to ${p.to}`, "amounts with GST"],
    ["Date", "Customer", "Bills", "Reason", "By", "Amount"],
    ...r.rows.map((x) => [x.on, x.name, x.bills, x.reason, x.by, x.amount]),
    ["", "Total", "", "", "", r.total],
  ];
  return new Response(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="written-off-${p.from}-${p.to}.csv"` },
  });
});
