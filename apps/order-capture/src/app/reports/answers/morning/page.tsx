import { notFound, redirect } from "next/navigation";
import { cardById } from "@/lib/answers/cards";
import { dmy } from "@/lib/receivables";
import { can } from "@/server/access";
import { answersOn } from "@/server/answers";
import { kit } from "@/server/kit";
import { morningPage } from "@/server/morning-report";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { CopyWhatsapp } from "../../../cash/van/van-parts";
import { MarkButtons } from "./mark-buttons";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const LEVEL: Record<number, { label: string; cls: string }> = {
  1: { label: "Stock count", cls: "bg-red-100 text-red-900" },
  2: { label: "Make today", cls: "bg-amber-100 text-amber-900" },
  3: { label: "Running out", cls: "bg-amber-100 text-amber-900" },
  4: { label: "Give a delivery day", cls: "bg-sky-100 text-sky-900" },
  5: { label: "Call for money", cls: "bg-slate-200 text-slate-800" },
  6: { label: "Late to reorder", cls: "bg-slate-200 text-slate-800" },
};
const weekday = (d: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));
const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).toLowerCase();

/** The morning report (owner; support reads): the saved 8:30 actions, Useful / Not useful, Copy, earlier mornings. */
export default async function MorningPage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requirePageUser("/reports/answers/morning");
  if (!answersOn(user.tenantId)) notFound();
  if (!can(user, "answers")) redirect("/");
  const p = await morningPage(user, one(sp.d));
  const plant = await kit.branding(user.tenantId);
  const r = p.report;

  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/reports/answers">← Plant answers</BackLink>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Morning report</h1>
        <p className="text-sm text-slate-600">
          {weekday(p.day)}
          {r ? ` · made ${time(r.createdAt)} by the rules (no AI)` : ""}
        </p>
      </div>

      {!r && (
        <p className="rounded-2xl border border-slate-200 bg-white p-4">
          No morning report for {dmy(p.day)} yet. It is made at 8:30 am each day.
        </p>
      )}

      {r?.missing.map((m) => (
        <p key={m} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Not checked: {m}</p>
      ))}

      {r && !r.actions.length && (
        <div className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-lg font-semibold">Nothing urgent today.</p>
          <p className="text-sm text-slate-600">Count done, enough stock for pending orders, no material running out in 3 days, no order waiting with stock ready, no bill over 30 days, nobody late to reorder.</p>
        </div>
      )}

      {r && r.actions.length > 0 && (
        <ol className="space-y-3">
          {r.actions.map((a, i) => {
            const lv = LEVEL[a.level] ?? { label: `Level ${a.level}`, cls: "bg-slate-200 text-slate-800" };
            return (
              <li key={i} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-semibold ${lv.cls}`}>{a.level} · {lv.label}</span>
                  <span className="text-slate-500">{a.cardId}</span>
                </div>
                <p className="font-semibold leading-snug">{a.text}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a href={a.href} className="flex min-h-11 items-center text-sm font-semibold text-(--brand)">
                    Open {a.href.startsWith("/reports/answers/") ? `"${cardById(a.cardId)?.title ?? a.cardId}"` : "it"} ›
                  </a>
                  {p.canMark && <MarkButtons date={r.date} no={i + 1} initial={p.marks[i + 1] ?? null} />}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {r && (
        <p className="text-sm text-slate-600">
          At most 7 actions a day, in this order: stock count, what to make, materials running out, orders ready to deliver, late bills, late reorders.
          Saved at {time(r.createdAt)}, so it doesn&apos;t change during the day; each link shows the live numbers.
        </p>
      )}

      {p.copy && (
        <div className="space-y-1">
          <CopyWhatsapp text={p.copy} />
          <p className="text-xs text-slate-600">The message has no amounts, no phone numbers and no staff names.</p>
        </div>
      )}

      {p.past.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold">Earlier mornings</h2>
          <ul className="divide-y divide-slate-100">
            {p.past.map((d) => (
              <li key={d.date}>
                <a href={`?d=${d.date}`} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  <span className="text-(--brand)">{weekday(d.date)}</span>
                  <span className="text-slate-600">{d.actions ? `${d.actions} actions · ${d.useful} useful` : "Nothing urgent"}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-slate-500">
        {user.isSupport ? "PlantOps support: read only, no Copy or Useful buttons." : "Only the plant owner sees this page. PlantOps support can read it (logged)."}
      </p>
    </div>
  );
}
