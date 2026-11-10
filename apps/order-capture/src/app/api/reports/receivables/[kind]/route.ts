import { csv } from "@plantops/module-kit/csv";
import { rupees } from "@/lib/ledger";
import { REC_KINDS, REC_TITLE, dmy, type RecCell, type RecKind } from "@/lib/receivables";
import { handle, notFound } from "@/server/http";
import { readRecParams, receivablesReport } from "@/server/reports";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ kind: string }> };
const cell = (c: RecCell) => (typeof c === "bigint" ? rupees(c) : c);

/** Owner (support reads): a Receivables report on screen as a CSV, with the same filters (the page's address). */
export const GET = handle(async (req, ctx: Ctx) => {
  const { kind: k } = await ctx.params;
  if (!(REC_KINDS as readonly string[]).includes(k)) throw notFound();
  const kind = k as RecKind;
  const user = await requireApiUser();
  const p = readRecParams(kind, Object.fromEntries(new URL(req.url).searchParams));
  const { table: t } = await receivablesReport(user, p);
  const aging = kind === "aging" || kind === "aging-details";
  const when = aging ? `as of ${p.date}` : `${p.from} to ${p.to}`;
  const rows: unknown[][] = [
    [REC_TITLE[kind], when, "amounts with GST"],
    [...(t.grouped ? ["Group"] : []), t.firstHead, ...t.heads],
  ];
  for (const g of t.groups) {
    for (const r of g.rows) rows.push([...(t.grouped ? [g.label] : []), r.label, ...r.cells.map(cell)]);
    if (t.grouped) rows.push([g.label, "Group total", ...g.total.map(cell)]);
  }
  rows.push([...(t.grouped ? [""] : []), "Total", ...t.total.map(cell)]);
  if (t.advance) rows.push([], [`Advances not yet used on a bill on ${dmy(p.date)}`, rupees(t.advance)]);
  const slug = aging ? p.date : `${p.from}-to-${p.to}`;
  return new Response(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${slug}.csv"`,
      "cache-control": "no-store",
    },
  });
});
