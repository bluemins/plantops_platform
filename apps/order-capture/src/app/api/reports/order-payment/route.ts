import { csv } from "@plantops/module-kit/csv";
import { rupees } from "@/lib/ledger";
import { FLOW_STAGE_LABEL } from "@/lib/order-flow";
import { handle } from "@/server/http";
import { istToday } from "@/server/ledger";
import { orderFlowReport, readFlowParams } from "@/server/reports";
import { requireApiUser } from "@/server/session";

/** Owner (support reads): Order to Payment as a CSV, one row per order, with the page's filters (and stage, if picked). */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const today = istToday();
  const p = readFlowParams(Object.fromEntries(new URL(req.url).searchParams), today);
  const { rows } = await orderFlowReport(user, p, today);
  const shown = p.stage ? rows.filter((r) => r.stage === p.stage) : rows;
  const out: unknown[][] = [
    ["Order to Payment", `as of ${today}`, "bill amounts with GST"],
    ["Stage", "Order", "Entered", "Customer", "Place", "Order amount", "Delivered", "Bill", "Bill date", "Bill amount", "Received", "Still due", "Days waiting", "Overdue", "Paid on", "Salesperson"],
  ];
  for (const r of shown) {
    out.push([
      FLOW_STAGE_LABEL[r.stage], r.ref, r.entered, r.customer_name, r.place, rupees(r.order_total), r.delivered ?? "",
      r.bill?.number ?? "", r.bill?.date ?? "", r.bill ? rupees(r.bill.total) : "", r.bill ? rupees(r.bill.received) : "",
      r.bill ? rupees(r.due) : "", r.days ?? "", r.overdue ? "yes" : "", r.paid_on ?? "", r.salesperson,
    ]);
  }
  return new Response(csv(out), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="order-to-payment-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
});
