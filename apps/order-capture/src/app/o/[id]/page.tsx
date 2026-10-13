import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { eventText } from "@/lib/history";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { getOrder } from "@/server/handling";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink, PhoneLink, StatusBadge } from "../../parts";
import { OrderActions } from "./actions";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One order (mock-up "Order O-0042"): customer, lines, history, every version, and the buttons this person may use. */
export default async function OrderPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/o/${id}`);
  const [plant, o] = await Promise.all([kit.branding(user.tenantId), orNotFound(getOrder(user, id))]);
  const pending = o.status === "pending";
  const may = {
    deliver: pending && can(user, "deliver"),
    change: pending && can(user, "enter"),
    cancel: pending && can(user, "cancel"),
    undo: o.status === "delivered" && can(user, "undo_delivered"),
  };

  return (
    <div className="space-y-5 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={`/?tab=${o.status}`}>← Orders</BackLink>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Order {o.ref}</h1>
        <StatusBadge status={o.status} />
      </div>

      <Card className="space-y-1">
        <p className="text-xl font-semibold break-words">{o.customer.name}</p>
        <p className="text-slate-600">{o.customer.place}</p>
        <p className="pt-1">
          <PhoneLink phone={o.customer.phone} plain={user.isSupport} prefix="Call +91 " />
        </p>
      </Card>

      <Card className="space-y-2">
        <div className="flex justify-between text-sm text-slate-500">
          <span>Product</span>
          <span>Amount</span>
        </div>
        {o.lines.map((l) => (
          <div key={l.sku_id} className="flex justify-between gap-3">
            <span className="break-words">
              {l.product} · {l.quantity.toLocaleString("en-IN")} {l.unit} × {money(l.rate)}
            </span>
            <span className="shrink-0">{money(l.total)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold">
          <span>Total</span>
          <span>{money(o.total)}</span>
        </div>
        <p className="text-sm text-slate-500">
          Entered by {o.entered_by} · {fmtDateTime(o.created_at)}
          {o.version > 1 && ` · version ${o.version}`}
        </p>
        {o.delivered && (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
            <p className="font-semibold">
              Delivered by {o.delivered.by} · {fmtDateTime(o.delivered.at)}
            </p>
            {o.delivered.note && <p>{o.delivered.note}</p>}
            {o.delivered.invoice_no && <p>Zoho invoice {o.delivered.invoice_no}</p>}
          </div>
        )}
        {o.status === "cancelled" && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Cancelled is final. Enter a new order if needed.</p>}
      </Card>

      <OrderActions
        order={{ id: o.id, ref: o.ref, status: o.status, version: o.version, summary: o.lines.map((l) => `${l.product} ${l.quantity.toLocaleString("en-IN")} ${l.unit}`).join(", ") }}
        may={may}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">History</h2>
        <Card className="p-4">
          <ul className="space-y-3">
            {[...o.events].reverse().map((e, i) => {
              const t = eventText(e, o.versions);
              return (
                <li key={i} className="text-sm">
                  <p className="font-semibold">
                    {t.title} · {fmtDateTime(e.at)}
                  </p>
                  {t.detail && <p className="text-slate-600 break-words">{t.detail}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
        {o.versions.length > 1 && (
          <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="min-h-8 cursor-pointer font-semibold">All versions ({o.versions.length})</summary>
            <div className="mt-2 space-y-3">
              {[...o.versions].reverse().map((v) => (
                <div key={v.version}>
                  <p className="font-semibold">
                    Version {v.version}
                    {v.version === o.version ? " (current)" : ""} · {money(v.total)}
                  </p>
                  {v.lines.map((l) => (
                    <p key={l.sku_id} className="text-slate-600">
                      {l.product} · {l.quantity.toLocaleString("en-IN")} {l.unit} × {money(l.rate)} = {money(l.total)}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
