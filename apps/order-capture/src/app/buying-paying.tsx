// "Buying & paying" card on a customer's Overview (rules: src/lib/customer-insights.ts). The three headline boxes, the
// paying trend and the financial-year chart are always shown; the rest is under "More" on phones and open on a PC.
import { FY_MONTHS, fyLabel, fyOf, type CustomerInsights } from "@/lib/customer-insights";
import { money } from "@/lib/money";

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYear = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthYear = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** paise -> "950", "18k", "1.2L" for the bar labels */
function short(p: bigint) {
  const r = Number(p) / 100;
  if (r < 1000) return String(Math.round(r));
  if (r < 100000) return `${r < 10000 ? (Math.round(r / 100) / 10).toString() : Math.round(r / 1000)}k`;
  return `${Math.round(r / 10000) / 10}L`;
}

function Box({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-base font-bold ${tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function YearChart({ y, base, today }: { y: CustomerInsights["year"]; base: string; today: string }) {
  const max = [...y.months, ...y.prev_months].reduce((m, v) => (v > m ? v : m), 0n);
  const pct = (v: bigint) => (max > 0n ? Math.max(v > 0n ? 2 : 0, Number((v * 1000n) / max) / 10) : 0);
  const total = y.months.reduce((s, v) => s + v, 0n);
  const prevTotal = y.prev_months.reduce((s, v) => s + v, 0n);
  const thisFy = fyOf(today);
  // months still to come in the current year
  const nowIdx = (Number(today.slice(5, 7)) + 8) % 12;
  const future = (i: number) => y.fy === thisFy && i > nowIdx;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Bills per month</h3>
        {y.fys.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {y.fys.map((f) => (
              <a key={f} href={`${base}?tab=overview&fy=${f}`} aria-current={f === y.fy ? "true" : undefined} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${f === y.fy ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 text-slate-700"}`}>
                {fyLabel(f)}
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {fyLabel(y.fy)}: <span className="font-semibold text-slate-800">{money(total)}</span>
        {prevTotal > 0n ? <> · {fyLabel(y.fy - 1)}: {money(prevTotal)} (pale bars)</> : null}
      </p>
      <div aria-hidden="true" className="flex h-36 items-end gap-0.5 border-b border-slate-300 sm:gap-1.5">
        {FY_MONTHS.map((m, i) => {
          const v = y.months[i]!;
          const pv = y.prev_months[i]!;
          return (
            <div key={m} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${m}: ${money(v)}${pv > 0n ? ` (last year ${money(pv)})` : ""}`}>
              <span className="block truncate text-center text-[10px] leading-tight text-slate-600 tabular-nums">{v > 0n ? short(v) : ""}</span>
              <div className="flex h-[calc(100%-14px)] items-end justify-center gap-px">
                <div className="w-1/3 max-w-3 rounded-t-sm bg-slate-200" style={{ height: `${pct(pv)}%` }} />
                <div className={`w-1/2 max-w-5 rounded-t-sm ${future(i) ? "bg-transparent" : "bg-(--brand)"}`} style={{ height: `${pct(v)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex gap-0.5 sm:gap-1.5">
        {FY_MONTHS.map((m, i) => (
          <span key={m} className={`min-w-0 flex-1 text-center text-[10px] ${future(i) ? "text-slate-300" : "text-slate-500"}`}>{m}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Bills per month, {fyLabel(y.fy)}</caption>
        <thead><tr><th>Month</th><th>This year</th><th>Last year</th></tr></thead>
        <tbody>
          {FY_MONTHS.map((m, i) => (
            <tr key={m}><td>{m}</td><td>{money(y.months[i]!)}</td><td>{money(y.prev_months[i]!)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BuyingPaying({ ins, base, today }: { ins: CustomerInsights; base: string; today: string }) {
  const { paying, ordering, next, trend, year } = ins;
  const nextBox =
    !next
      ? { value: "Not enough orders yet", sub: ordering.purchases ? `needs 3 orders, has ${ordering.purchases}` : undefined }
      : next.state === "ahead"
        ? { value: `Around ${day(next.expected)}`, sub: "expected next order" }
        : next.state === "due"
          ? { value: next.days_late === 0 ? "Due today" : "Due now", sub: `expected ${day(next.expected)}` }
          : next.state === "late"
            ? { value: `Late by ${plural(next.days_late, "day")}`, sub: `expected ${day(next.expected)}`, tone: "warn" as const }
            : { value: `No order for ${ordering.days_since_last} days`, sub: "may have stopped buying", tone: "bad" as const };

  const more = (
    <div className="space-y-3 text-sm">
      {(paying?.with_due_date || ins.oldest_unpaid) && (
        <ul className="space-y-1">
          {paying && paying.with_due_date > 0 && (
            <li>{paying.late} of {plural(paying.with_due_date, "bill")} paid after the due date{paying.all_time ? " (all time)" : " (last 12 months)"}.</li>
          )}
          {ins.oldest_unpaid && (
            <li className={ins.oldest_unpaid.days > 30 ? "text-amber-800" : ""}>
              Oldest unpaid bill: {plural(ins.oldest_unpaid.days, "day")} ({dayYear(ins.oldest_unpaid.bill_date)}).
            </li>
          )}
        </ul>
      )}
      <div>
        <h3 className="font-semibold">Usual order</h3>
        {ins.basket.length ? (
          <ul className="mt-1 space-y-0.5">
            {ins.basket.map((b) => (
              <li key={b.key}>
                {b.name} × {b.quantity}{b.unit ? ` ${b.unit}` : ""}
                <span className="text-xs text-slate-500"> · in {b.times} of the last {b.of}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">Not enough orders yet.</p>
        )}
      </div>
      {ins.stopped.length > 0 && (
        <div>
          <h3 className="font-semibold">Stopped buying?</h3>
          <ul className="mt-1 space-y-0.5 text-amber-800">
            {ins.stopped.map((s) => (
              <li key={s.key}>Hasn&apos;t ordered {s.name} since {dayYear(s.last_date)} <span className="text-xs text-slate-500">(was in {s.times} of {s.of} orders before)</span></li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="font-semibold">This year vs last</h3>
        <p>
          {fyLabel(fyOf(today))} so far: <span className="font-semibold">{money(year.ytd)}</span>
          {year.change_pct === null ? (
            year.ytd > 0n ? <span className="text-slate-500"> · nothing in the same months last year</span> : null
          ) : (
            <span className={year.change_pct < 0 ? "text-amber-800" : "text-green-800"}>
              {" "}· {year.change_pct === 0 ? "same as" : `${year.change_pct > 0 ? "up" : "down"} ${Math.abs(year.change_pct)}% on`} last year ({money(year.last_ytd)})
            </span>
          )}
        </p>
        <p className="text-slate-600">
          {year.customer_since ? `Customer since ${monthYear(year.customer_since)}` : "No bills yet"}
          {year.avg_bill !== null ? ` · average bill ${money(year.avg_bill)} (${plural(year.bills_12m, "bill")}, last 12 months)` : ""}
        </p>
      </div>
    </div>
  );

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h2 className="font-semibold">Buying &amp; paying</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Box
          label="Pays in"
          value={paying ? `avg ${plural(paying.avg_days, "day")}` : "No paid bills yet"}
          sub={paying ? `usually within ${plural(paying.within_days, "day")} · ${plural(paying.bills, "bill")}${paying.all_time ? ", all time" : ", last 12 months"}` : undefined}
        />
        <Box
          label="Orders every"
          value={ordering.usual_gap ? `usually ${plural(ordering.usual_gap, "day")}` : "Not enough orders yet"}
          sub={ordering.last_date ? `last: ${dayYear(ordering.last_date)} (${ordering.days_since_last === 0 ? "today" : `${plural(ordering.days_since_last!, "day")} ago`})` : "no orders yet"}
        />
        <Box label="Next order" {...nextBox} />
      </div>
      {trend && (
        <p className={`rounded-lg px-3 py-2 text-sm ${trend.kind === "slower" ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
          {trend.kind === "slower" ? "Paying slower lately" : "Paying faster lately"}: {plural(trend.recent_days, "day")} on the last 3 bills, usually {plural(trend.usual_days, "day")}.
        </p>
      )}
      <YearChart y={year} base={base} today={today} />
      <div className="hidden md:block">{more}</div>
      <details className="md:hidden">
        <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-(--brand)">More: usual order, this year vs last</summary>
        {more}
      </details>
    </section>
  );
}
