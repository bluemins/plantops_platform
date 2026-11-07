// A customer's page like Zoho's (docs/CUSTOMER_PAGE_PHASE_PLAN.md Part 1; mock-up https://claude.ai/artifact/NcJtuLX74cmspbpZU5vgzx):
// money boxes, then Overview (details + timeline) / Transactions (Bills and Payments tables) / Orders / Statement. Also
// used for a Zoho contact not matched yet (no payments can be taken there: match it to a customer first).
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { GST_STATES } from "@plantops/types";
import { ACCOUNT_TABS, quickRanges, type AccountTab } from "@/lib/customer-page";
import { TERMS_LABEL, type BillTerms } from "@/lib/ledger";
export { pickTab } from "@/lib/customer-page";
import type { Account } from "@/server/ledger";
import type { OcUser } from "@/server/session";
import { AddComment, EditCustomer, LocationBox, PersonsEditor } from "./customer-forms";
import { CancelWithReason, PrintButton, ReceivePayment } from "./ledger-forms";
import { BillBadge, PhoneLink, StatusBadge } from "./parts";

export const BILL_SHOW = [
  ["all", "All"],
  ["due", "Due"],
  ["paid", "Paid"],
  ["cancelled", "Cancelled"],
] as const;
export const PAY_SHOW = [
  ["all", "All"],
  ["received", "Received"],
  ["cancelled", "Cancelled"],
] as const;
type BillShow = (typeof BILL_SHOW)[number][0];
type PayShow = (typeof PAY_SHOW)[number][0];
const billShows = (s: BillShow, status: string) =>
  s === "all" || (s === "paid" ? status === "paid" : s === "cancelled" ? status === "cancelled" : status !== "paid" && status !== "cancelled");
const payShows = (s: PayShow, cancelled: boolean) => s === "all" || (s === "cancelled" ? cancelled : !cancelled);

const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" };
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (at: string) =>
  at.length === 10
    ? day(at)
    : new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const sum = (xs: string[]) => (xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0) / 100).toFixed(2);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
const TYPE_LABEL: Record<string, string> = { shop: "Shop", household: "Household", office: "Office", institution: "Institution", individual: "Individual" };
const TREATMENT_LABEL: Record<string, string> = { registered: "Registered business", unregistered: "Unregistered business", consumer: "Consumer" };
const Dash = () => <span className="text-slate-400">—</span>;

function Chips<T extends string>({ items, on, href }: { items: readonly (readonly [T, string])[]; on: T; href: (t: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5 print:hidden">
      {items.map(([t, l]) => (
        <a key={t} href={href(t)} aria-current={t === on ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-semibold ${t === on ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 text-slate-700"}`}>
          {l}
        </a>
      ))}
    </div>
  );
}

export function AccountView({
  user,
  a,
  tab,
  base,
  range,
  today,
  show = {},
  plant,
}: {
  user: OcUser;
  a: Account;
  tab: AccountTab;
  base: string;
  range: { from?: string; to?: string };
  today: string;
  show?: { bills?: string; pays?: string };
  plant?: { name: string; gstin?: string | null };
}) {
  const isCustomer = a.party.kind === "customer";
  const qs = (t: string) => `${base}?tab=${t}`;
  const stmtQs = new URLSearchParams({ ...(isCustomer ? { c: a.party.id } : { z: a.party.id }), ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
  const bShow = (BILL_SHOW.find(([s]) => s === show.bills)?.[0] ?? "all") as BillShow;
  const pShow = (PAY_SHOW.find(([s]) => s === show.pays)?.[0] ?? "all") as PayShow;
  const txHref = (b: BillShow, p: PayShow) => `${base}?tab=transactions${b !== "all" ? `&bs=${b}` : ""}${p !== "all" ? `&ps=${p}` : ""}`;
  const billsShown = a.bills.filter((b) => billShows(bShow, b.status));
  const paysShown = a.payments.filter((p) => payShows(pShow, p.cancelled));
  const payCancel = can(user, "payment_cancel");
  const d = a.details;
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold break-words">{a.party.name}</h1>
        <p className="text-sm text-slate-600">
          {a.party.phone ? <PhoneLink phone={a.party.phone} plain={user.isSupport} /> : "no mobile"}
          {a.party.place ? ` · ${a.party.place}` : ""}
          {!a.party.active ? " · switched off" : ""}
        </p>
        {!isCustomer && (
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A Zoho contact not matched to a customer yet. <a href="/customers/match" className="font-semibold underline">Match it</a> to take payments and see its orders.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:hidden">
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
        <Card className="p-3">
          <p className="text-xs text-slate-500">Billed, last 6 months</p>
          <p className="text-lg font-bold">{money(a.billed_6m)}</p>
        </Card>
      </div>

      {isCustomer && can(user, "payment_receive") && (
        <div className="print:hidden">
          <ReceivePayment customerId={a.party.id} openBills={a.open_bills.map((b) => ({ id: b.id, number: b.number, bill_date: b.bill_date, due: b.due }))} today={today} />
        </div>
      )}

      <nav aria-label="Customer" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 print:hidden">
        {ACCOUNT_TABS.filter(([t]) => t !== "comments" || isCustomer).map(([t, l]) => (
          <a key={t} href={qs(t)} aria-current={t === tab ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-center text-sm font-semibold whitespace-nowrap ${t === tab ? "bg-(--brand-soft) text-(--brand)" : "text-slate-600"}`}>
            {l}
            {t === "comments" && a.comments.length ? <span className="ml-1 text-xs text-slate-500">({a.comments.length})</span> : null}
          </a>
        ))}
      </nav>

      {tab === "overview" && d && can(user, "customer_edit") && (
        <EditCustomer
          customerId={a.party.id}
          values={{ name: a.party.name, place: a.party.place ?? "", phone: a.party.phone ?? "", gstin: a.party.gstin, state_code: a.party.state_code, ...d }}
        />
      )}

      {tab === "overview" && (
        <div className="grid gap-4 md:grid-cols-[19rem_1fr]">
          <div className="space-y-3">
            <Section title="Contact">
              <dl className="space-y-1.5">
                <Row k="Calling name">{a.party.name}</Row>
                <Row k="Mobile">{a.party.phone ? a.party.phone.replace(/^(\d{5})(\d{5})$/, "$1 $2") : <Dash />}</Row>
                {d?.other_phone && <Row k="Other phone">{d.other_phone}</Row>}
                {d?.email && <Row k="Email">{d.email}</Row>}
                <Row k="Place">{a.party.place ?? <Dash />}</Row>
                {d?.customer_type && <Row k="Type">{TYPE_LABEL[d.customer_type] ?? d.customer_type}</Row>}
                {d && <Row k="Payment terms">{d.payment_terms ? TERMS_LABEL[d.payment_terms as BillTerms] : "Plant default"}</Row>}
                {isCustomer && <Row k="Status">{a.party.active ? "On" : "Switched off"}</Row>}
                {a.party.created_at && <Row k="Added">{when(a.party.created_at)}{a.party.created_by_name ? ` by ${a.party.created_by_name}` : ""}</Row>}
              </dl>
            </Section>
            {isCustomer && (
              <Section title="Shop location">
                <LocationBox customerId={a.party.id} location={a.location} canSave={can(user, "location_save")} canClear={can(user, "location_clear")} canPaste={can(user, "customer_edit")} />
                {(d?.delivery_address || d?.delivery_landmark) && (
                  <dl className="space-y-1.5 pt-1">
                    {d.delivery_address && <Row k="Deliver to">{d.delivery_address}</Row>}
                    {d.delivery_landmark && <Row k="Landmark">{d.delivery_landmark}</Row>}
                  </dl>
                )}
              </Section>
            )}
            <Section title="GST details (for GST bills)">
              <dl className="space-y-1.5">
                {d && <Row k="Legal name">{d.legal_name ?? <Dash />}</Row>}
                {d && <Row k="Treatment">{d.gst_treatment ? TREATMENT_LABEL[d.gst_treatment] : <Dash />}</Row>}
                <Row k="GSTIN">{a.party.gstin ?? <Dash />}</Row>
                {isCustomer && <Row k="GST state">{a.party.state_code ? `${GST_STATES[a.party.state_code] ?? ""} (${a.party.state_code})` : <Dash />}</Row>}
                {d && <Row k="Billing address">{[d.billing_address, d.billing_city, d.billing_pin].filter(Boolean).join(", ") || <Dash />}</Row>}
              </dl>
            </Section>
            {isCustomer && (a.persons.length > 0 || can(user, "customer_edit")) && (
              <Section title="Contact persons">
                {can(user, "customer_edit") ? (
                  <PersonsEditor customerId={a.party.id} persons={a.persons} />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {a.persons.filter((x) => x.active).map((x) => <li key={x.id}>{x.name}{x.role ? ` · ${x.role}` : ""}{x.phone ? ` · ${x.phone}` : ""}</li>)}
                  </ul>
                )}
              </Section>
            )}
            <Section title={a.contacts.length === 1 ? "Zoho contact" : `Zoho contacts (${a.contacts.length})`}>
              {a.contacts.length === 0 && <p className="text-sm text-slate-500">None linked.{isCustomer && can(user, "zoho_match") ? <> <a href="/customers/match" className="font-semibold text-(--brand)">Match Zoho customers</a></> : null}</p>}
              <ul className="space-y-2">
                {a.contacts.map((z) => (
                  <li key={z.id} className="text-sm">
                    <span className="block font-semibold">{z.name}</span>
                    <span className="block text-slate-500">
                      {[z.company, z.mobile, z.gstin ? `GSTIN ${z.gstin}` : null, z.status].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <section className="min-w-0 space-y-2">
            <h2 className="font-semibold">Timeline</h2>
            {a.timeline.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
            <ol className="ml-1.5 border-l-2 border-slate-200">
              {a.timeline.map((t, i) => (
                <li key={i} className="relative pb-3 pl-4">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-(--brand) bg-white" />
                  <span className="block text-sm">{t.href ? <a href={t.href} className="text-(--brand) hover:underline">{t.text}</a> : t.text}</span>
                  <span className="block text-xs text-slate-500">{when(t.at)}{t.by ? ` · ${t.by}` : ""}</span>
                </li>
              ))}
            </ol>
            {a.timeline.length === 50 && <p className="text-xs text-slate-500">The latest 50. Every bill and payment is in Transactions.</p>}
          </section>
        </div>
      )}

      {tab === "transactions" && (
        <div className="space-y-6">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Bills</h2>
              <Chips items={BILL_SHOW} on={bShow} href={(s) => txHref(s, pShow)} />
            </div>
            {billsShown.length === 0 && <p className="text-sm text-slate-500">No bills{bShow !== "all" ? " here" : ""}.</p>}
            {billsShown.length > 0 && (
              <>
                <ul className="space-y-2 sm:hidden">
                  {billsShown.map((b) => (
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
                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Bill no.</th>
                        <th className="px-3 py-2 font-semibold">Order</th>
                        <th className="px-3 py-2 font-semibold">From</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-right font-semibold">Balance due</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsShown.map((b) => (
                        <tr key={b.id} className="border-b border-slate-100">
                          <td className="px-3 py-2 whitespace-nowrap">{day(b.bill_date)}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><a href={`/bills/${b.id}`} className="font-semibold text-(--brand) hover:underline">{b.number}</a>{b.gst_invoice_no ? <span className="block text-xs text-slate-500">GST {b.gst_invoice_no}</span> : null}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{b.order ? <a href={`/o/${b.order.id}`} className="text-(--brand) hover:underline">{b.order.ref}</a> : <Dash />}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{b.opening_balance ? "Zoho (opening)" : b.source === "zoho" ? "Zoho" : "PlantOps"}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{money(b.total)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{b.status === "cancelled" ? <Dash /> : money(b.due)}</td>
                          <td className="px-3 py-2"><BillBadge status={b.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={4}>{billsShown.length} bill{billsShown.length === 1 ? "" : "s"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(sum(billsShown.filter((b) => b.status !== "cancelled").map((b) => b.total)))}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(sum(billsShown.filter((b) => b.status !== "cancelled").map((b) => b.due)))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Payments</h2>
              <Chips items={PAY_SHOW} on={pShow} href={(s) => txHref(bShow, s)} />
            </div>
            {paysShown.length === 0 && <p className="text-sm text-slate-500">No payments{pShow !== "all" ? " here" : ""}.</p>}
            {paysShown.length > 0 && (
              <>
                <ul className="space-y-2 sm:hidden">
                  {paysShown.map((p) => (
                    <li key={p.id} className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 ${p.cancelled ? "opacity-60" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block font-semibold">{p.number.match(/^P-/) ? p.number : `Payment ${p.number}`}{p.source === "zoho" ? <span className="font-normal text-slate-500"> · from Zoho</span> : null}</span>
                          <span className="block text-sm text-slate-500">{day(p.payment_date)} · {MODE[p.mode] ?? p.mode}{p.reference ? ` · ${p.reference}` : ""}</span>
                          {p.for_bills.length > 0 && <span className="block text-sm text-slate-500">For {p.for_bills.join(", ")}</span>}
                          {p.cancelled && <span className="block text-sm text-red-700">Cancelled: {p.cancel_reason}</span>}
                          {!p.cancelled && p.unused !== "0.00" && <span className="block text-sm text-slate-600">{money(p.unused)} not used yet (advance)</span>}
                        </span>
                        <span className="shrink-0 font-semibold">{money(p.amount)}</span>
                      </div>
                      {!p.cancelled && payCancel && <CancelWithReason url={`/api/payments/${p.id}/cancel`} what="payment" effect="The bills it paid become due again." />}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Payment no.</th>
                        <th className="px-3 py-2 font-semibold">Reference</th>
                        <th className="px-3 py-2 font-semibold">Mode</th>
                        <th className="px-3 py-2 font-semibold">For bills</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-right font-semibold">Unused</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paysShown.map((p) => (
                        <tr key={p.id} className={`border-b border-slate-100 align-top ${p.cancelled ? "text-slate-500" : ""}`}>
                          <td className="px-3 py-2 whitespace-nowrap">{day(p.payment_date)}</td>
                          <td className="px-3 py-2 whitespace-nowrap font-semibold">{p.number}{p.source === "zoho" ? <span className="block text-xs font-normal text-slate-500">from Zoho</span> : null}</td>
                          <td className="px-3 py-2">{p.reference ?? <Dash />}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{MODE[p.mode] ?? p.mode}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{p.for_bills.length ? p.for_bills.join(", ") : <Dash />}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{money(p.amount)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{p.cancelled ? <Dash /> : money(p.unused)}</td>
                          <td className="px-3 py-2">
                            {p.cancelled ? (
                              <span title={p.cancel_reason ?? ""}><BillBadge status="cancelled" /></span>
                            ) : (
                              <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">Received</span>
                            )}
                            {!p.cancelled && payCancel && <div className="mt-1 min-w-56"><CancelWithReason url={`/api/payments/${p.id}/cancel`} what="payment" effect="The bills it paid become due again." /></div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={5}>{paysShown.length} payment{paysShown.length === 1 ? "" : "s"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(sum(paysShown.filter((p) => !p.cancelled).map((p) => p.amount)))}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(sum(paysShown.filter((p) => !p.cancelled).map((p) => p.unused)))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
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

      {tab === "comments" && isCustomer && (
        <div className="max-w-2xl space-y-4">
          {can(user, "customer_comment") && <AddComment customerId={a.party.id} />}
          <h2 className="font-semibold">All comments</h2>
          {a.comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
          <ul className="space-y-2">
            {a.comments.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-xs text-slate-500">{when(c.at)} · {c.by}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "statement" && (
        <Card className="space-y-3">
          <div className="flex flex-wrap gap-1.5 print:hidden">
            {quickRanges(today).map((r) => {
              const on = range.from === r.from && range.to === r.to;
              return (
                <a key={r.label} href={`${base}?tab=statement&from=${r.from}&to=${r.to}`} aria-current={on ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 text-slate-700"}`}>
                  {r.label}
                </a>
              );
            })}
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
            <input type="hidden" name="tab" value="statement" />
            <label className="text-sm">From <input type="date" name="from" defaultValue={range.from} className="ml-1 min-h-10 rounded-lg border border-slate-300 px-2" /></label>
            <label className="text-sm">To <input type="date" name="to" defaultValue={range.to} className="ml-1 min-h-10 rounded-lg border border-slate-300 px-2" /></label>
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Show</button>
          </form>
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            <div>
              <p className="text-slate-500">To</p>
              <p className="font-semibold">{a.party.name}</p>
              {a.party.place && <p className="text-slate-600">{a.party.place}</p>}
              {a.party.gstin && <p className="text-slate-600">GSTIN {a.party.gstin}</p>}
            </div>
            {plant && (
              <div className="text-right">
                <p className="font-semibold">{plant.name}</p>
                {plant.gstin && <p className="text-slate-600">GSTIN {plant.gstin}</p>}
              </div>
            )}
          </div>
          <h2 className="text-center font-semibold">
            Statement of account
            <span className="block text-sm font-normal text-slate-500">{range.from ? day(range.from) : "From the start"} to {range.to ? day(range.to) : "today"}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm tabular-nums">
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
