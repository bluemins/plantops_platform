import { notFound, redirect } from "next/navigation";
import { DESK_STAGE_ABOUT, DESK_STAGE_LABEL, DESK_STAGES, type DeskStage } from "@/lib/accounts-desk";
import { money } from "@/lib/money";
import { dmy } from "@/lib/receivables";
import { can } from "@/server/access";
import { deskStage } from "@/server/accounts-desk";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";

type Props = { params: Promise<{ stage: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SHOW = 50;

/** One stage's orders, oldest waiting first, with the next thing to do. */
export default async function DeskStagePage({ params, searchParams }: Props) {
  const { stage: raw } = await params;
  if (!DESK_STAGES.includes(raw as DeskStage)) notFound();
  const stage = raw as DeskStage;
  const user = await requirePageUser(`/accounts/stage/${stage}`);
  if (!can(user, "accounts_desk")) redirect("/");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const all = one(sp.all) === "1";
  const [plant, rows] = await Promise.all([kit.branding(user.tenantId), deskStage(user, stage, q)]);
  const shown = all ? rows : rows.slice(0, SHOW);
  const moreHref = `?${new URLSearchParams({ ...(q ? { q } : {}), all: "1" })}`;
  return (
    <div className="space-y-3 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/accounts">← Accounts desk</BackLink>
      <div>
        <h1 className="text-2xl font-bold">{DESK_STAGE_LABEL[stage]}</h1>
        <p className="text-sm text-slate-600">{rows.length} {rows.length === 1 ? "order" : "orders"} · {DESK_STAGE_ABOUT[stage]}</p>
      </div>
      <form method="get" className="flex gap-2">
        <label className="flex-1 text-xs text-slate-600">
          Search customer or order
          <input type="search" name="q" defaultValue={q} placeholder="Name, place, O-number" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900" />
        </label>
        <button className="min-h-11 self-end rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold">Search</button>
      </form>
      {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No orders here.</p>}
      {shown.map((r) => {
        const action =
          r.stage === "delivered" && can(user, "bill_make")
            ? { href: r.href, label: "Make bill" }
            : (r.stage === "billed" || r.stage === "part") && can(user, "payment_receive")
              ? { href: `${r.customer_href}?tab=bills`, label: "Receive payment" }
              : null;
        return (
          <article key={r.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <a href={r.href} className="text-sm font-bold text-(--brand)">{r.ref}{r.bill ? ` · ${r.bill.number}` : ""}</a>
              {r.overdue ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">Overdue{r.days !== null ? ` · ${r.days} d` : ""}</span>
              ) : r.days !== null ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">{r.days} {r.days === 1 ? "day" : "days"}</span>
              ) : r.paid_on ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-900">Paid {dmy(r.paid_on)}</span>
              ) : null}
            </div>
            <div className="flex items-start justify-between gap-3">
              <a href={r.customer_href} className="min-w-0">
                <strong className="block break-words">{r.customer_name}</strong>
                <span className="block text-xs text-slate-600">{r.place}</span>
              </a>
              <strong className="whitespace-nowrap">{money(r.amount)}</strong>
            </div>
            {action && (
              <a href={action.href} className="flex min-h-11 items-center justify-center rounded-lg bg-(--brand) text-sm font-bold text-(--brand-contrast)">{action.label}</a>
            )}
          </article>
        );
      })}
      {!all && rows.length > SHOW && (
        <a href={moreHref} className="flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-(--brand)">Show {rows.length - SHOW} more</a>
      )}
    </div>
  );
}
