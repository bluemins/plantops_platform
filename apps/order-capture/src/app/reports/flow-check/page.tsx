import { redirect } from "next/navigation";
import {
  CHECK_PERIOD_LABEL,
  CHECK_PERIODS,
  FIRST_CHECK,
  HOUR_BANDS,
  LATE_HOURS,
  lookAlikePlaces,
  pct,
  TARGETS,
  type Count,
} from "@/lib/flow-check";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { flowCheckReport, readCheckParams } from "@/server/flow-check";
import { kit } from "@/server/kit";
import { istToday } from "@/server/ledger";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { PrintButton } from "../../ledger-forms";
import { BackLink } from "../../parts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const field = "min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";
const box = "rounded-2xl border border-slate-200 bg-white p-4";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** 31 h under two days, else days with one decimal */
const hrs = (h: number | null) => (h === null ? "—" : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`);
const pctText = (n: number | null) => (n === null ? "—" : `${n} %`);

function Score({ title, value, good, target, first, about }: { title: string; value: string; good: boolean | null; target: string; first: string; about: string }) {
  const tone = good === null ? "text-slate-700" : good ? "text-green-800" : "text-red-800";
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3">
      <span className="text-xs font-bold text-slate-600">{title}</span>
      <span className={`text-2xl font-bold ${tone}`}>{value}</span>
      <span className="text-xs text-slate-600">Target {target} · first check {first}</span>
      <span className="text-xs text-slate-500">{about}</span>
    </div>
  );
}

function Bars({ rows, total }: { rows: { name: string; count: number }[]; total: number }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing in these dates.</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate" title={r.name}>{r.name}</span>
          <span className="h-3 rounded bg-slate-100">
            <span className="block h-3 rounded bg-(--brand)" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="w-20 text-right tabular-nums">{r.count}{total ? <span className="text-slate-500"> · {pct(r.count, total)} %</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

const sum = (xs: Count[]) => xs.reduce((t, x) => t + x.count, 0);

/** Order flow check (Reports → Sales): the order measures of the lean analysis for any dates. Owner (support reads). */
export default async function FlowCheckPage({ searchParams }: Props) {
  const user = await requirePageUser("/reports/flow-check");
  if (!can(user, "reports")) redirect("/");
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const today = istToday();
  const p = readCheckParams(sp, today);
  const [plant, c] = await Promise.all([kit.branding(user.tenantId), flowCheckReport(user, p)]);
  const s = c.speed;
  const alike = lookAlikePlaces(c.places);
  const live = c.orders.entered - c.orders.cancelled;

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><BackLink href="/reports?section=sales">← Reports · Sales</BackLink></div>
          <h1 className="text-2xl font-bold">Order flow check</h1>
          <p className="text-sm text-slate-600">
            How fast orders go from saved to delivered, what waits, what gets changed, and who does the work. Orders entered{" "}
            {dm(c.from)} – {dm(c.to)} {c.to.slice(0, 4)} ({c.days} days) · as of {dm(today)}.
          </p>
        </div>
        <div className="print:hidden"><PrintButton /></div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 print:hidden">
        <label className={label}>Orders entered
          <select name="period" defaultValue={p.period} className={field}>
            {CHECK_PERIODS.map((x) => <option key={x} value={x}>{CHECK_PERIOD_LABEL[x]}</option>)}
          </select>
        </label>
        <label className={label}>From (custom)<input type="date" name="from" defaultValue={p.period === "custom" ? p.from : ""} className={field} /></label>
        <label className={label}>To (custom)<input type="date" name="to" defaultValue={p.period === "custom" ? p.to : ""} className={field} /></label>
        <button className="min-h-10 rounded-lg bg-(--brand) px-4 text-sm font-bold text-(--brand-contrast)">Run check</button>
      </form>

      <section aria-label="The four measures" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
        <Score
          title="Delivered same or next day"
          value={pctText(c.sameNextPct)}
          good={c.sameNextPct === null ? null : c.sameNextPct >= TARGETS.sameNextPct}
          target={`${TARGETS.sameNextPct} %`}
          first={`${FIRST_CHECK.sameNextPct} %`}
          about={`${s.sameDay + s.nextDay} of ${s.delivered} delivered orders`}
        />
        <Score
          title="Pending over 2 days (now)"
          value={String(c.pendingLate)}
          good={c.pendingLate <= TARGETS.pendingOld}
          target={String(TARGETS.pendingOld)}
          first={String(FIRST_CHECK.pendingOld)}
          about={`of ${c.pendingNow.length} pending today, any date`}
        />
        <Score
          title="Changed after saving"
          value={pctText(c.changed.pct)}
          good={c.changed.pct === null ? null : c.changed.pct < TARGETS.changedPct}
          target={`under ${TARGETS.changedPct} %`}
          first={`${FIRST_CHECK.changedPct} %`}
          about={`${c.changed.orders} of ${live} orders (cancelled left out)`}
        />
        <Score
          title="Delivered with a bill"
          value={pctText(c.billed.pct)}
          good={c.billed.pct === null ? null : c.billed.pct >= 90}
          target="all"
          first={`${FIRST_CHECK.billedPct} %`}
          about={`${c.billed.billed} of ${c.billed.delivered}: a bill linked or a Zoho invoice no. typed`}
        />
      </section>
      <p className="text-xs text-slate-500">
        Green = on target, red = not yet. “First check” = the analysis of orders entered {FIRST_CHECK.label} 2026. Stock measures (out of stock
        days, material days) come with Reports → Stock.
      </p>

      <section className={box}>
        <h2 className="text-lg font-bold">Pending now ({c.pendingNow.length})</h2>
        <p className="text-sm text-slate-600">Every pending order, oldest first, whatever the dates above. Red = over 2 days: give it a delivery day or cancel it with a reason.</p>
        {c.pendingNow.length === 0 ? (
          <p className="py-3 text-sm text-slate-500">No pending orders.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-bold tracking-wide text-slate-600">
                  <th className="py-2 pr-3">ORDER</th><th className="py-2 pr-3">CUSTOMER</th><th className="py-2 pr-3">PLACE</th>
                  <th className="py-2 pr-3">ENTERED</th><th className="py-2 pr-3 text-right">WAITING</th><th className="py-2 text-right">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {c.pendingNow.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-semibold"><a href={r.href} className="text-(--brand) hover:underline">{r.ref}</a></td>
                    <td className="py-2 pr-3"><a href={r.customer_href} className="hover:underline">{r.customer_name}</a></td>
                    <td className="py-2 pr-3">{r.place}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{dm(r.entered)}</td>
                    <td className={`py-2 pr-3 text-right whitespace-nowrap ${r.hours > LATE_HOURS ? "font-bold text-red-800" : ""}`}>{hrs(r.hours)}</td>
                    <td className="py-2 text-right whitespace-nowrap">{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={box}>
          <h2 className="text-lg font-bold">Orders in these dates</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-600">Entered</dt><dd className="text-right font-semibold">{c.orders.entered}</dd>
            <dt className="text-slate-600">Delivered / pending / cancelled</dt><dd className="text-right font-semibold">{c.orders.delivered} / {c.orders.pending} / {c.orders.cancelled}</dd>
            <dt className="text-slate-600">Order value (not cancelled)</dt><dd className="text-right font-semibold">{money(c.value.total)}</dd>
            <dt className="text-slate-600">Average / median order</dt><dd className="text-right font-semibold">{c.value.average === null ? "—" : money(c.value.average)} / {c.value.median === null ? "—" : money(c.value.median)}</dd>
            <dt className="text-slate-600">Customers</dt><dd className="text-right font-semibold">{c.customers.total}</dd>
            <dt className="text-slate-600">… ordered once / twice / 3 or more</dt><dd className="text-right font-semibold">{c.customers.once} / {c.customers.twice} / {c.customers.more}</dd>
            <dt className="text-slate-600">Days with a delivery</dt><dd className="text-right font-semibold">{c.deliveryDays} of {c.days}</dd>
          </dl>
        </section>
        <section className={box}>
          <h2 className="text-lg font-bold">Entered → Delivered</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-600">Median</dt><dd className="text-right font-semibold">{hrs(s.medianHours)}</dd>
            <dt className="text-slate-600">Average</dt><dd className="text-right font-semibold">{hrs(s.averageHours)}</dd>
            <dt className="text-slate-600">8 in 10 orders within</dt><dd className="text-right font-semibold">{hrs(s.p80Hours)}</dd>
            <dt className="text-slate-600">Longest</dt><dd className="text-right font-semibold">{hrs(s.longestHours)}</dd>
            <dt className="text-slate-600">Same day / next day / later</dt><dd className="text-right font-semibold">{s.sameDay} / {s.nextDay} / {s.later}</dd>
            <dt className="text-slate-600">Over 4 days</dt><dd className={`text-right font-semibold ${s.over4Days ? "text-red-800" : ""}`}>{s.over4Days}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Delivered orders only, from saving to the Delivered tap.</p>
        </section>
      </div>

      <section className={box}>
        <h2 className="text-lg font-bold">Week by week</h2>
        <p className="text-sm text-slate-600">Monday to Sunday, by the day the order was entered. The first and last week may be part weeks.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold tracking-wide text-slate-600">
                <th className="py-2 pr-3">WEEK</th><th className="py-2 pr-3 text-right">ENTERED</th><th className="py-2 pr-3 text-right">DELIVERED</th>
                <th className="py-2 pr-3 text-right">SAME / NEXT DAY</th><th className="py-2 pr-3 text-right">CHANGED</th><th className="py-2 text-right">CANCELLED</th>
              </tr>
            </thead>
            <tbody>
              {c.weeks.map((w) => (
                <tr key={w.from} className="border-b border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap">{w.from === w.to ? dm(w.from) : `${dm(w.from)} – ${dm(w.to)}`}</td>
                  <td className="py-2 pr-3 text-right">{w.entered}</td>
                  <td className="py-2 pr-3 text-right">{w.delivered}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${w.sameNextPct === null ? "" : w.sameNextPct >= TARGETS.sameNextPct ? "text-green-800" : "text-red-800"}`}>{pctText(w.sameNextPct)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${w.changedPct === null ? "" : w.changedPct < TARGETS.changedPct ? "text-green-800" : "text-red-800"}`}>{pctText(w.changedPct)}</td>
                  <td className="py-2 text-right">{w.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={box}>
          <h2 className="text-lg font-bold">Who entered the orders</h2>
          <div className="mt-2"><Bars rows={c.enteredBy} total={sum(c.enteredBy)} /></div>
        </section>
        <section className={box}>
          <h2 className="text-lg font-bold">Who tapped Delivered</h2>
          <div className="mt-2"><Bars rows={c.deliveredBy} total={sum(c.deliveredBy)} /></div>
        </section>
        <section className={box}>
          <h2 className="text-lg font-bold">When orders come in</h2>
          <div className="mt-2"><Bars rows={HOUR_BANDS.map((b, i) => ({ name: b.label, count: c.enteredHours[i]! }))} total={c.orders.entered} /></div>
          <p className="mt-2 text-xs text-slate-500">India time, when the order was saved. Helps set the same-day cut-off.</p>
        </section>
        <section className={box}>
          <h2 className="text-lg font-bold">When Delivered is tapped</h2>
          <div className="mt-2"><Bars rows={HOUR_BANDS.map((b, i) => ({ name: b.label, count: c.deliveredHours[i]! }))} total={c.orders.delivered} /></div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={box}>
          <h2 className="text-lg font-bold">Changes and cancels</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-600">Orders changed after saving</dt><dd className="text-right font-semibold">{c.changed.orders} ({c.changed.changes} changes)</dd>
            <dt className="text-slate-600">… changed on a later day</dt><dd className="text-right font-semibold">{c.changed.later}</dd>
            <dt className="text-slate-600">“Undo delivered”</dt><dd className="text-right font-semibold">{c.changed.undone}</dd>
            <dt className="text-slate-600">Cancelled</dt><dd className="text-right font-semibold">{c.cancels.total}</dd>
            <dt className="text-slate-600">… within 1 hour (mistake / test)</dt><dd className="text-right font-semibold">{c.cancels.quick}</dd>
          </dl>
          {c.cancels.reasons.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-bold">Reasons (cancelled after the first hour)</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {c.cancels.reasons.slice(0, 10).map((r) => <li key={r.name} className="flex justify-between gap-2"><span className="break-words">{r.name}</span><span>{r.count}</span></li>)}
              </ul>
            </>
          )}
        </section>
        <section className={box}>
          <h2 className="text-lg font-bold">Places</h2>
          <p className="text-sm text-slate-600">Orders per place (not cancelled), as the customer's place is typed today. For planning route days.</p>
          <div className="mt-2"><Bars rows={c.places.slice(0, 15)} total={live} /></div>
          {c.places.length > 15 && <p className="mt-1 text-xs text-slate-500">+ {c.places.length - 15} more places</p>}
          {alike.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">Maybe the same place typed differently</p>
              <ul className="mt-1 list-disc pl-5">{alike.map(([a, b]) => <li key={`${a}|${b}`}>{a} · {b}</li>)}</ul>
              <p className="mt-1 text-xs">Fix the spelling on the customer's page (Customers → Edit) so orders group by route.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
