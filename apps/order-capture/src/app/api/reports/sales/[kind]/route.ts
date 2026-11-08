import { csv } from "@plantops/module-kit/csv";
import { rupees } from "@/lib/ledger";
import { qtyText, type Cell, type ReportKind } from "@/lib/report";
import { handle, notFound } from "@/server/http";
import { readParams, salesReport } from "@/server/reports";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ kind: string }> };

/** Owner (support reads): the report on screen as a CSV, with the same filters (the page's address). */
export const GET = handle(async (req, ctx: Ctx) => {
  const { kind: k } = await ctx.params;
  if (k !== "item" && k !== "customer") throw notFound();
  const kind = k as ReportKind;
  const user = await requireApiUser();
  const p = readParams(Object.fromEntries(new URL(req.url).searchParams));
  const r = await salesReport(user, kind, p);
  const broken = p.breakdown !== "none";
  const qty = (c: Cell) => qtyText(c.qty).replace(/,/g, "");
  // free boxes (scheme): their own column, only when the period has any
  const hasFree = r.total.free_qty > 0n;
  const free = (c: Cell) => (hasFree ? [qtyText(c.free_qty).replace(/,/g, "")] : []);
  const nums = (c: Cell) =>
    kind === "item"
      ? broken ? [...c.amounts.map(rupees), qty(c), ...free(c), rupees(c.amount)] : [qty(c), ...free(c), rupees(c.amount)]
      : broken ? [String(c.bills), ...c.amounts.map(rupees), rupees(c.amount)] : [String(c.bills), rupees(c.before), rupees(c.with_gst)];
  const heads =
    kind === "item"
      ? broken ? [...r.buckets.map((b) => b.label), "Quantity", ...(hasFree ? ["Free"] : []), "Total"] : ["Quantity", ...(hasFree ? ["Free"] : []), "Amount"]
      : broken ? ["Bills", ...r.buckets.map((b) => b.label), "Total"] : ["Bills", "Sales", "Sales with GST"];
  const grouped = r.group !== "none";
  const rows: unknown[][] = [
    [kind === "item" ? "Sales by Item" : "Sales by Customer", `${p.from} to ${p.to}`, p.amount === "with" ? "with GST" : "before GST"],
    [...(grouped ? ["Group"] : []), kind === "item" ? "Item" : "Customer", ...(kind === "item" ? ["SKU"] : []), ...heads],
  ];
  for (const g of r.groups) {
    for (const row of g.rows) rows.push([...(grouped ? [g.label] : []), row.label, ...(kind === "item" ? [row.sku ?? ""] : []), ...nums(row)]);
    if (grouped) rows.push([g.label, "Group total", ...(kind === "item" ? [""] : []), ...nums(g)]);
  }
  rows.push([...(grouped ? [""] : []), "Total", ...(kind === "item" ? [""] : []), ...nums(r.total)]);
  return new Response(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sales-by-${kind}-${p.from}-to-${p.to}.csv"`,
      "cache-control": "no-store",
    },
  });
});
