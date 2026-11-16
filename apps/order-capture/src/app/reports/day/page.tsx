import { redirect } from "next/navigation";
import { dayLabel, dayWhatsappText, type Section, type Tone } from "@/lib/day-report";
import { can } from "@/server/access";
import { addDays } from "@/server/cash";
import { dayReport } from "@/server/day-report";
import { kit } from "@/server/kit";
import { istToday } from "@/server/ledger";
import { requirePageUser } from "@/server/session";
import { CopyWhatsapp } from "../../cash/van/van-parts";
import { Header } from "../../header";
import { PrintButton } from "../../ledger-forms";
import { BackLink } from "../../parts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TONE_TEXT: Record<Tone, string> = { ok: "text-green-800", warn: "text-amber-800", bad: "text-red-800" };
const TONE_PILL: Record<Tone, string> = { ok: "bg-green-50 text-green-800", warn: "bg-amber-50 text-amber-800", bad: "bg-red-50 text-red-800" };

function SectionBox({ s, open }: { s: Section; open: boolean }) {
  const p = s.part;
  return (
    <details id={s.id} open={open} className="rounded-2xl border border-slate-200 bg-white print:break-inside-avoid" >
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
        <span className="font-bold">{s.title}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${p?.tone ? TONE_PILL[p.tone] : "bg-slate-100 text-slate-700"}`}>
          {p ? p.summary : "Numbers unavailable right now"}
        </span>
      </summary>
      <div className="px-4 pb-3">
        {!p ? (
          <p className="text-sm text-slate-600">{s.title} didn&apos;t answer. Open the report again in a minute.</p>
        ) : p.rows.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing to show.</p>
        ) : (
          <dl className="divide-y divide-slate-100 text-sm">
            {p.rows.map((r, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5">
                <dt className={r.label.startsWith("  ") ? "pl-4 text-slate-600" : "text-slate-700"}>{r.label.trim()}</dt>
                <dd className={`min-w-0 text-right font-semibold tabular-nums ${r.tone ? TONE_TEXT[r.tone] : ""}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

/** Reports → Day report: one day on one page (owner; support reads). ‹ › moves a day; nothing is stored. */
export default async function DayReportPage({ searchParams }: Props) {
  const user = await requirePageUser("/reports/day");
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const today = istToday();
  const asked = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) && sp.d <= today ? sp.d : today;
  const [plant, r] = await Promise.all([kit.branding(user.tenantId), dayReport(user, asked)]);
  const prev = addDays(asked, -1);
  const next = addDays(asked, 1);

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="print:hidden"><BackLink href="/reports">← Reports</BackLink></div>

      <header className="space-y-2 rounded-2xl bg-(--brand) p-4 text-(--brand-contrast)">
        <h1 className="text-xl font-bold">Day report</h1>
        <nav aria-label="Pick a day" className="flex items-center gap-2">
          <a href={`/reports/day?d=${prev}`} className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold print:hidden">‹ {dayLabel(prev, "weekday")}</a>
          <span className="flex-1 text-center font-bold">{dayLabel(asked, "long")}</span>
          {next <= today ? (
            <a href={`/reports/day?d=${next}`} className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold print:hidden">{dayLabel(next, "weekday")} ›</a>
          ) : (
            <span className="rounded-lg px-3 py-2 text-sm opacity-40 print:hidden">Next ›</span>
          )}
        </nav>
        {r.isToday && <p className="text-xs opacity-90">Today so far. Numbers change until the day ends.</p>}
      </header>

      {r.attention.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 border-l-4 border-l-red-600 bg-white p-4">
          <h2 className="mb-1 font-bold">Needs you ({r.attention.length})</h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {r.attention.map((a, i) => (
              <li key={i}><a href={`#${a.section}`} className="hover:underline">{a.text}</a></li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800">Nothing needs you for this day.</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {r.tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-600">{t.label}</p>
            <p className="truncate text-xl font-bold tabular-nums" title={t.value}>{t.value}</p>
            <p className={`text-xs ${t.tone ? TONE_TEXT[t.tone] : "text-slate-600"}`}>{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {r.sections.map((s, i) => (
          <SectionBox key={s.id} s={s} open={i === 0 || (s.part?.tone ?? "ok") !== "ok"} />
        ))}
      </div>

      <div className="flex flex-col gap-2 print:hidden sm:flex-row sm:items-start">
        <div className="flex-1"><CopyWhatsapp text={dayWhatsappText(r)} /></div>
        <PrintButton />
      </div>
      <p className="text-center text-xs text-slate-500">
        Owner only. Every number is worked out when this page opens; nothing is stored. Sales are bills + van cash sales, with GST.
      </p>
    </div>
  );
}
