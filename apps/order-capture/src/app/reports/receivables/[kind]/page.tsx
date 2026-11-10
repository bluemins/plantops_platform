import { notFound, redirect } from "next/navigation";
import { money } from "@/lib/money";
import {
  AS_OF_LABEL,
  AS_OFS,
  BILL_SHOW_LABEL,
  BILL_SHOWS,
  dmy,
  GROUPS_FOR,
  REC_GROUP_LABEL,
  REC_KINDS,
  REC_TITLE,
  SHOW_LABEL,
  type RecCell,
  type RecKind,
} from "@/lib/receivables";
import { PERIOD_LABEL, PERIODS } from "@/lib/report";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { readRecParams, receivablesReport } from "@/server/reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { PrintButton } from "../../../ledger-forms";
import { BackLink } from "../../../parts";

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const field = "min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";
/** money with a sign: a minus balance is an advance */
const signed = (p: bigint) => (p < 0n ? `−${money(-p)}` : money(p));
/** nothing owed in a cell = "—" (easier to read than a column of ₹0) */
const show = (c: RecCell) => (typeof c === "bigint" ? (c === 0n ? "—" : signed(c)) : c);

/** Receivables: Customer Balances, Aging Summary, Aging Details, Bill Details, with filters. Owner (support reads). */
export default async function ReceivablesReportPage({ params, searchParams }: Props) {
  const { kind: k } = await params;
  if (!(REC_KINDS as readonly string[]).includes(k)) notFound();
  const kind = k as RecKind;
  const user = await requirePageUser(`/reports/receivables/${kind}`);
  if (!can(user, "reports")) redirect("/");
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const p = readRecParams(kind, sp);
  const [plant, { table: t, choices }] = await Promise.all([kit.branding(user.tenantId), receivablesReport(user, p)]);
  const { kind: _k, ...rest } = p;
  const query = new URLSearchParams(Object.entries(rest).map(([a, b]) => [a, String(b)]).filter(([, v]) => v !== "")).toString();
  const aging = kind === "aging" || kind === "aging-details";
  // column widths: names wide, numbers and dates narrow; the table never squeezes below the sum of the minimums
  const min = (h: string) => (h === "Customer" ? 190 : /date|^date$/i.test(h) ? 96 : h === "Age" || h === "Status" ? 104 : h === "Bills" ? 56 : 104);
  const firstMin = t.firstHead === "Customer" ? 210 : 140;
  const gridCols = `minmax(${firstMin}px, 2fr) ${t.heads.map((h) => `minmax(${min(h)}px, ${h === "Customer" ? 2 : 1}fr)`).join(" ")}`;
  const tableMin = firstMin + t.heads.reduce((s, h) => s + min(h), 0) + 16 * t.heads.length + 32;
  const filters = [p.salesperson && `salesperson: ${p.salesperson}`, p.place && `place: ${p.place}`, p.vehicle && `vehicle: ${p.vehicle}`].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><BackLink href="/reports?section=receivables">← Reports · Receivables</BackLink></div>
          <h1 className="text-2xl font-bold">{REC_TITLE[kind]}</h1>
        </div>
        <div className="flex gap-4 print:hidden">
          <a href={`/api/reports/receivables/${kind}?${query}`} className="min-h-10 text-sm font-semibold text-(--brand)">CSV</a>
          <PrintButton />
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 print:hidden">
        {aging ? (
          <>
            <label className={label}>As of
              <select name="as_of" defaultValue={p.as_of} className={field}>
                {AS_OFS.map((x) => <option key={x} value={x}>{AS_OF_LABEL[x]}</option>)}
              </select>
            </label>
            <label className={label}>Date (custom)<input type="date" name="date" defaultValue={p.date} className={field} /></label>
            <label className={label}>Age by
              <select name="basis" defaultValue={p.basis} className={field}>
                <option value="due">Due date</option><option value="bill">Bill date</option>
              </select>
            </label>
            <label className={label}>Age bands
              <select name="interval" defaultValue={String(p.interval)} className={field}>
                <option value="15">15 days × 4</option><option value="30">30 days × 4</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className={label}>Period
              <select name="period" defaultValue={p.period} className={field}>
                {PERIODS.map((x) => <option key={x} value={x}>{PERIOD_LABEL[x]}</option>)}
              </select>
            </label>
            <label className={label}>From (custom)<input type="date" name="from" defaultValue={p.from} className={field} /></label>
            <label className={label}>To (custom)<input type="date" name="to" defaultValue={p.to} className={field} /></label>
          </>
        )}
        {kind === "balances" && (
          <label className={label}>Show
            <select name="show" defaultValue={p.show} className={field}>
              {(["owe", "nonzero", "all"] as const).map((x) => <option key={x} value={x}>{SHOW_LABEL[x]}</option>)}
            </select>
          </label>
        )}
        {kind === "bills" && (
          <label className={label}>Bills
            <select name="status" defaultValue={p.status} className={field}>
              {BILL_SHOWS.map((x) => <option key={x} value={x}>{BILL_SHOW_LABEL[x]}</option>)}
            </select>
          </label>
        )}
        <label className={label}>Salesperson
          <select name="salesperson" defaultValue={p.salesperson} className={field}>
            <option value="">All</option>
            <option value="Not mentioned">Not mentioned</option>
            {choices.salespeople.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Place
          <select name="place" defaultValue={p.place} className={field}>
            <option value="">All</option>
            {choices.places.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Vehicle
          <select name="vehicle" defaultValue={p.vehicle} className={field}>
            <option value="">All</option>
            {choices.vehicles.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Group by
          <select name="group" defaultValue={p.group} className={field}>
            {GROUPS_FOR[kind].map((g) => <option key={g} value={g}>{REC_GROUP_LABEL[g]}</option>)}
          </select>
        </label>
        <button className="min-h-10 rounded-lg bg-(--brand) px-4 text-sm font-bold text-(--brand-contrast)">Run report</button>
      </form>
      <p className="text-xs text-slate-500 print:hidden">
        {aging ? 'Date is used when "As of" is "Custom date".' : 'From / To are used when the period is "Custom dates".'}
      </p>

      {/* wider than the page column on a PC (aging has 8 columns); phones scroll the table sideways; print = page width */}
      <section className="relative rounded-2xl border border-slate-200 bg-white lg:left-1/2 lg:w-[min(1200px,calc(100vw-2rem))] lg:-translate-x-1/2 print:static print:w-full print:translate-x-0">
        <div className="space-y-0.5 py-4 text-center">
          <p className="text-sm text-slate-500">{plant?.name}</p>
          <p className="text-lg font-bold">{REC_TITLE[kind]}</p>
          <p className="text-sm text-slate-500">
            {aging ? `As of ${dmy(p.date)}` : `From ${dmy(p.from)} to ${dmy(p.to)}`} · {t.count} {t.firstHead === "Customer" ? "customers" : "bills"} · amounts with GST
            {filters ? ` · ${filters}` : ""}
          </p>
        </div>
        <p className="px-4 pb-2 text-xs text-slate-500 sm:hidden print:hidden">Swipe the table sideways to see every column →</p>
        <div className="overflow-x-auto">
          <div className="text-sm" style={{ minWidth: tableMin }}>
            <div className="grid gap-x-4 border-y border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold tracking-wide text-slate-600" style={{ gridTemplateColumns: gridCols }}>
              <span>{t.firstHead.toUpperCase()}</span>
              {t.heads.map((h, i) => <span key={h} className={t.right[i] ? "text-right" : ""}>{h.toUpperCase()}</span>)}
            </div>
            {t.groups.length === 0 && <p className="px-4 py-6 text-center text-slate-500">{t.empty}</p>}
            {t.groups.map((g) => (
              <div key={g.key}>
                {t.grouped && (
                  <div className="grid gap-x-4 border-b border-slate-100 bg-slate-50/60 px-4 py-2 font-bold" style={{ gridTemplateColumns: gridCols }}>
                    <span>{g.label}</span>
                    {g.total.map((c, i) => <span key={i} className={t.right[i] ? "text-right" : ""}>{show(c)}</span>)}
                  </div>
                )}
                {g.rows.map((row) => (
                  <div key={row.key} className="grid gap-x-4 border-b border-slate-100 px-4 py-2" style={{ gridTemplateColumns: gridCols }}>
                    <a href={row.href} title={row.label} className={`truncate font-semibold text-(--brand) ${t.grouped ? "pl-4" : ""}`}>{row.label}</a>
                    {row.cells.map((c, i) => (
                      <span key={i} className={`${t.right[i] ? "text-right" : ""} ${typeof c === "bigint" && c < 0n ? "text-emerald-700" : ""}`}>{show(c)}</span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {t.groups.length > 0 && (
              <div className="grid gap-x-4 px-4 py-3 text-base font-bold" style={{ gridTemplateColumns: gridCols }}>
                <span>Total</span>
                {t.total.map((c, i) => <span key={i} className={t.right[i] ? "text-right" : ""}>{show(c)}</span>)}
              </div>
            )}
          </div>
        </div>
      </section>
      {t.advance ? (
        <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          Advances not yet used on a bill on {dmy(p.date)}: <b>{money(t.advance)}</b>. They are not taken off above (see Customer Balances).
        </p>
      ) : null}
      {t.notes.map((n) => <p key={n} className="text-xs text-slate-500">{n}</p>)}
    </div>
  );
}
