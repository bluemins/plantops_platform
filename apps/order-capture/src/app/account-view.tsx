// A customer's account (mock-up 5): balance, advance, last payment; Bills / Orders / Payments / Statement. Also used for
// a Zoho contact not matched yet (no payments can be taken there: match it to a customer first).
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import type { Account } from "@/server/ledger";
import type { OcUser } from "@/server/session";
import { CancelWithReason, PrintButton, ReceivePayment } from "./ledger-forms";
import { BillBadge, PhoneLink, StatusBadge } from "./parts";

export const ACCOUNT_TABS = [
  ["bills", "Bills"],
  ["orders", "Orders"],
  ["payments", "Payments"],
  ["statement", "Statement"],
] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number][0];
const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" };
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function AccountView({ user, a, tab, base, range, today }: { user: OcUser; a: Account; tab: AccountTab; base: string; range: { from?: string; to?: string }; today: string }) {
  const isCustomer = a.party.kind === "customer";
  const qs = (t: string) => `${base}?tab=${t}`;
  const stmtQs = new URLSearchParams({ ...(isCustomer ? { c: a.party.id } : { z: a.party.id }), ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold break-words">{a.party.name}</h1>
        <p className="text-sm text-slate-600">
          {a.party.phone ? <PhoneLink phone={a.party.phone} plain={user.isSupport} /> : "no mobile"}
          {a.party.place ? ` · ${a.party.place}` : ""}
        </p>
        {isCustomer && a.zoho_names.length > 0 && <p className="text-xs text-slate-500">Zoho: {a.zoho_names.join(", ")}</p>}
        {!isCustomer && (
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A Zoho contact not matched to a customer yet. <a href="/customers/match" className="font-semibold underline">Match it</a> to take payments and see its orders.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Balance due</p>
          <p className={`text-lg font-bold ${a.totals.due !== "0.00" ? "text-amber-700" : ""}`}>{money(a.totals.due)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Advance</p>
          <p className="text-lg font-bold">{money(a.totals.advance)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Last payment</p>
          <p className="text-sm font-semibold">{a.last_payment ? `${money(a.last_payment.amount)} · ${day(a.last_payment.payment_date)}` : "—"}</p>
        </Card>
      </div>

      {isCustomer && can(user, "payment_receive") && <ReceivePayment customerId={a.party.id} openBills={a.open_bills.map((b) => ({ id: b.id, number: b.number, bill_date: b.bill_date, due: b.due }))} today={today} />}

      <nav aria-label="Account" className="grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1 print:hidden">
        {ACCOUNT_TABS.map(([t, l]) => (
          <a key={t} href={qs(t)} aria-current={t === tab ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold ${t === tab ? "bg-(--brand-soft) text-(--brand)" : "text-slate-600"}`}>
            {l}
          </a>
        ))}
      </nav>

      {tab === "bills" && (
        <ul className="space-y-2">
          {a.bills.length === 0 && <p className="text-sm text-slate-500">No bills.</p>}
          {a.bills.map((b) => (
            <li key={b.id}>
              <a href={`/bills/${b.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {b.number}
                    <span className="font-normal text-slate-500">{b.opening_balance ? " · opening balance" : b.source === "zoho" ? " · from Zoho" : ""}{b.order ? ` · ${b.order.ref}` : ""}</span>
                  </span>
                  <span className="block text-sm text-slate-500">{day(b.bill_date)}{b.gst_invoice_no ? ` · GST ${b.gst_invoice_no}` : ""}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{money(b.total)}</span>
                  <BillBadge status={b.status} due={money(b.due)} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {tab === "orders" && (
        <ul className="space-y-2">
          {a.orders.length === 0 && <p className="text-sm text-slate-500">No orders.</p>}
          {a.orders.map((o) => (
            <li key={o.id}>
              <a href={`/o/${o.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50">
                <span>
                  <span className="block font-semibold">{o.ref}</span>
                  <span className="block text-sm text-slate-500">{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}{o.bill ? ` · ${o.bill.number}` : ""}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{money(o.total)}</span>
                  {o.status === "closed" ? <BillBadge status="closed" /> : <StatusBadge status={o.status} />}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {tab === "payments" && (
        <ul className="space-y-2">
          {a.payments.length === 0 && <p className="text-sm text-slate-500">No payments.</p>}
          {a.payments.map((p) => (
            <li key={p.id} className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 ${p.cancelled ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="block font-semibold">{p.number.match(/^P-/) ? p.number : `Payment ${p.number}`}{p.source === "zoho" ? <span className="font-normal text-slate-500"> · from Zoho</span> : null}</span>
                  <span className="block text-sm text-slate-500">{day(p.payment_date)} · {MODE[p.mode] ?? p.mode}{p.reference ? ` · ${p.reference}` : ""}</span>
                  {p.cancelled && <span className="block text-sm text-red-700">Cancelled: {p.cancel_reason}</span>}
                  {!p.cancelled && p.unused !== "0.00" && <span className="block text-sm text-slate-600">{money(p.unused)} not used yet (advance)</span>}
                </span>
                <span className="shrink-0 font-semibold">{money(p.amount)}</span>
              </div>
              {!p.cancelled && can(user, "payment_cancel") && (
                <CancelWithReason url={`/api/payments/${p.id}/cancel`} what="payment" effect="The bills it paid become due again." />
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "statement" && (
        <Card className="space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
            <input type="hidden" name="tab" value="statement" />
            <label className="text-sm">From <input type="date" name="from" defaultValue={range.from} className="ml-1 min-h-10 rounded-lg border border-slate-300 px-2" /></label>
            <label className="text-sm">To <input type="date" name="to" defaultValue={range.to} className="ml-1 min-h-10 rounded-lg border border-slate-300 px-2" /></label>
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Show</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1 pr-2 font-semibold">Date</th>
                  <th className="py-1 pr-2 font-semibold">What</th>
                  <th className="py-1 pr-2 text-right font-semibold">Bill</th>
                  <th className="py-1 pr-2 text-right font-semibold">Paid</th>
                  <th className="py-1 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-1 pr-2">{range.from ? day(range.from) : ""}</td>
                  <td className="py-1 pr-2">Opening balance</td>
                  <td></td>
                  <td></td>
                  <td className="py-1 text-right">{money(a.statement.opening.replace("-", ""))}{a.statement.opening.startsWith("-") ? " adv." : ""}</td>
                </tr>
                {a.statement.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-2 whitespace-nowrap">{day(r.date)}</td>
                    <td className="py-1 pr-2">{r.kind === "bill" ? r.number : r.kind === "payment" ? `Payment ${r.number}${r.mode ? `, ${MODE[r.mode] ?? r.mode}` : ""}` : `Settled ${r.number}`}</td>
                    <td className="py-1 pr-2 text-right">{r.kind === "bill" ? money(r.debit) : ""}</td>
                    <td className="py-1 pr-2 text-right">{r.kind === "bill" ? "" : money(r.credit)}</td>
                    <td className="py-1 text-right font-medium">{money(r.balance.replace("-", ""))}{r.balance.startsWith("-") ? " adv." : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm font-semibold">Closing balance: {money(a.statement.closing.replace("-", ""))}{a.statement.closing.startsWith("-") ? " (advance)" : ""}</p>
          <div className="flex gap-4 print:hidden">
            <PrintButton />
            <a href={`/api/statement?${stmtQs}`} className="min-h-10 text-sm font-semibold text-(--brand)">Download CSV</a>
          </div>
          <p className="text-xs text-slate-500">A statement of account, not a tax invoice.</p>
        </Card>
      )}
    </div>
  );
}
