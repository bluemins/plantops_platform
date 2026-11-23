import { redirect } from "next/navigation";
import { DESK_STAGE_ABOUT, DESK_STAGE_LABEL, type DeskStage } from "@/lib/accounts-desk";
import { can } from "@/server/access";
import { deskHome } from "@/server/accounts-desk";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";
import { DeskTabs } from "./parts";

const STAGES: { stage: Exclude<DeskStage, "overdue">; tone: string }[] = [
  { stage: "pending", tone: "bg-slate-200 text-slate-800" },
  { stage: "delivered", tone: "bg-amber-100 text-amber-900" },
  { stage: "billed", tone: "bg-red-100 text-red-900" },
  { stage: "part", tone: "bg-violet-100 text-violet-900" },
  { stage: "paid", tone: "bg-green-100 text-green-900" },
];

/** Accounts desk: today's work and how many orders are at each stage. Counts only, never a plant ₹ total. */
export default async function AccountsDeskPage() {
  const user = await requirePageUser("/accounts");
  if (!can(user, "accounts_desk")) redirect("/");
  const [plant, d] = await Promise.all([kit.branding(user.tenantId), deskHome(user)]);
  const work = [
    { n: d.counts.delivered, label: "to bill", href: "/accounts/stage/delivered" },
    { n: d.customers_overdue, label: d.customers_overdue === 1 ? "customer overdue" : "customers overdue", href: "/accounts/dues?overdue=1" },
    { n: d.promises_today, label: "promises due today", href: "/accounts/dues?promise=today" },
    { n: d.promises_broken, label: "promises broken", href: "/accounts/dues?promise=broken" },
    { n: d.to_post, label: "collections to post", href: "/cash/post" },
    { n: d.gst_to_make, label: "GST invoices to make", href: "/bills/gst" },
  ];
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink>← Sales</BackLink>
      <h1 className="text-2xl font-bold">Accounts desk</h1>
      <DeskTabs current="stages" />

      <section aria-labelledby="work" className="rounded-2xl border border-slate-200 bg-white p-3">
        <h2 id="work" className="mb-2 font-bold">Today&apos;s work</h2>
        <div className="grid grid-cols-2 gap-2">
          {work.map((w) => (
            <a key={w.label} href={w.href} className="flex min-h-14 flex-col justify-center rounded-lg bg-(--brand-soft) px-3 py-2">
              <strong className="text-lg text-(--brand)">{w.n}</strong>
              <span className="text-xs text-slate-700">{w.label}</span>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="stages" className="space-y-2">
        <h2 id="stages" className="font-bold">Where the orders are</h2>
        {STAGES.map(({ stage, tone }) => (
          <a key={stage} href={`/accounts/stage/${stage}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
            <span className={`grid h-12 min-w-12 place-items-center rounded-lg px-1 text-xl font-extrabold ${tone}`}>{d.counts[stage]}</span>
            <span className="min-w-0 flex-1">
              <strong className="block">{DESK_STAGE_LABEL[stage]}</strong>
              <span className="block text-xs text-slate-600">{DESK_STAGE_ABOUT[stage]}</span>
            </span>
            <span aria-hidden="true" className="text-slate-500">›</span>
          </a>
        ))}
      </section>

      {d.counts.overdue > 0 && (
        <a href="/accounts/stage/overdue" className="flex min-h-14 items-center justify-between rounded-xl bg-red-800 px-4 font-bold text-white">
          <span>{d.counts.overdue} {d.counts.overdue === 1 ? "order is" : "orders are"} overdue</span>
          <span className="text-sm">Call first</span>
        </a>
      )}
    </div>
  );
}
