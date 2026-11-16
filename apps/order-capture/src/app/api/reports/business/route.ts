import { csv } from "@plantops/module-kit/csv";
import { rupees } from "@/lib/ledger";
import { businessCharts, readChartParams } from "@/server/business";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner (support reads): the Business charts' figures per month / week / day, with the page's filters. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const p = readChartParams(Object.fromEntries(new URL(req.url).searchParams));
  const c = await businessCharts(user, p);
  const heads = [
    "Period", "From", "To", "Sales", ...(c.sales.lastYear ? ["Sales same days last year"] : []),
    ...c.sales.byBrand.map((s) => `Sales: ${s.name}`), ...c.expenses.groups.map((s) => `Expenses: ${s.name}`),
    "Expenses", "Left over", "Money in", "Money out", "Running total (in − out)", "Customers owe at the end",
  ];
  const rows: unknown[][] = [["Business charts", `${p.from} to ${p.to}`, p.amount === "with" ? "with GST" : "before GST", p.brand ? `brand ${p.brand}` : "all brands"], heads];
  c.buckets.forEach((b, i) => {
    rows.push([
      b.label, b.from, b.to, rupees(c.sales.total[i]!), ...(c.sales.lastYear ? [rupees(c.sales.lastYear[i]!)] : []),
      ...c.sales.byBrand.map((s) => rupees(s.values[i]!)), ...c.expenses.groups.map((s) => rupees(s.values[i]!)),
      rupees(c.expenses.total[i]!), rupees(c.sales.total[i]! - c.expenses.total[i]!), rupees(c.money.in[i]!), rupees(c.money.out[i]!),
      rupees(c.money.running[i]!), rupees(c.owed[i]!),
    ]);
  });
  return new Response(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="business-${p.from}-to-${p.to}.csv"`,
      "cache-control": "no-store",
    },
  });
});
