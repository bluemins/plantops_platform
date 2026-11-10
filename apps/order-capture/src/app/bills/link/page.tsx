import { redirect } from "next/navigation";
import { RANK_LABEL } from "@/lib/bill-link";
import { money } from "@/lib/money";
import { orderRef } from "@/lib/order-flow";
import { can } from "@/server/access";
import { linkList } from "@/server/bill-link";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { FindBill, LinkButton, LinkSure } from "./link-forms";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const gap = (n: number) => (n === 0 ? "same day" : n === 1 ? "1 day apart" : `${n} days apart`);

/**
 * Link bills to orders (owner; support reads): every delivered order without a bill, oldest delivery first, with up to
 * 3 suggested Zoho bills, a box for any other bill number, and "Link all sure matches". Work through it when there is time.
 */
export default async function LinkBillsPage() {
  const user = await requirePageUser("/bills/link");
  if (!can(user, "bill_link_view")) redirect("/");
  const [plant, rows] = await Promise.all([kit.branding(user.tenantId), linkList(user)]);
  const owner = can(user, "bill_link");
  const sure = rows.filter((r) => r.sure);
  const none = rows.filter((r) => r.suggestions.length === 0).length;

  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/reports/order-payment?stage=delivered&view=list">← Order to Payment</BackLink>
      <div>
        <h1 className="text-2xl font-bold">Link bills to orders</h1>
        <p className="text-sm text-slate-600">
          Delivered orders with no bill linked. Many were billed in Zoho and the bill came in with the import but isn&apos;t linked to the order.
          Link the right bill and the order moves to Billed / Part paid / Paid. Linking moves no money: the bill stays in its own customer&apos;s account.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-xs text-slate-600">Orders to look at</span><span className="text-xl font-bold">{rows.length}</span></p>
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-xs text-slate-600">Sure matches</span><span className="text-xl font-bold text-green-800">{sure.length}</span></p>
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-xs text-slate-600">With a suggestion</span><span className="text-xl font-bold">{rows.length - none}</span></p>
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-xs text-slate-600">No bill found</span><span className="text-xl font-bold text-amber-800">{none}</span></p>
      </div>

      {owner && (
        <LinkSure
          pairs={sure.map((r) => ({
            order_id: r.order.id,
            bill_id: r.sure!.id,
            text: `${orderRef(r.order.ref_no)} ${r.order.customer_name} ${money(r.order.total)} ← ${r.sure!.number} (${dm(r.sure!.bill_date)})`,
          }))}
        />
      )}

      {rows.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600">Every delivered order has its bill. Nothing to link.</p>}

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.order.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <a href={`/o/${r.order.id}`} className="font-bold text-(--brand) hover:underline">{orderRef(r.order.ref_no)}</a>{" "}
                <span className="font-semibold">{r.order.customer_name}</span>
                {r.order.place && <span className="text-sm text-slate-600"> · {r.order.place}</span>}
              </span>
              <span className="text-sm"><b>{money(r.order.total)}</b> · delivered {dm(r.order.delivered)}</span>
            </div>
            {r.suggestions.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No Zoho bill near this date for this customer or amount. Make the bill on the order, or, if it was a test or never went, undo the delivery and cancel it.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {r.suggestions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <a href={`/bills/${s.id}`} className="font-semibold text-(--brand) hover:underline">{s.number}</a>{" "}
                      <span className="text-sm">{money(s.total)} · {dm(s.bill_date)} ({gap(s.gap)})</span>
                      <span className="block text-xs text-slate-600">
                        {s.customer_name} · <span className={s.rank === 0 ? "font-semibold text-green-800" : s.rank === 2 ? "font-semibold text-amber-800" : ""}>{RANK_LABEL[s.rank]}</span>
                        {r.sure?.id === s.id ? " · sure match" : ""}
                      </span>
                    </span>
                    {owner && <LinkButton orderId={r.order.id} billId={s.id} number={s.number} />}
                  </li>
                ))}
              </ul>
            )}
            {owner && <FindBill orderId={r.order.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
