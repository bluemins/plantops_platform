import { notFound, redirect } from "next/navigation";
import { AREA_LABEL, AREAS, isBuilt } from "@/lib/answers/cards";
import { can } from "@/server/access";
import { answersOn, listCards } from "@/server/answers";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";

/** Reports → Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md): the questions by area. Owner (support reads). */
export default async function PlantAnswersPage() {
  const user = await requirePageUser("/reports/answers");
  if (!answersOn(user.tenantId)) notFound();
  if (!can(user, "answers")) redirect("/");
  const cards = listCards(user);
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/reports?section=answers">← Reports</BackLink>
      <div>
        <h1 className="text-2xl font-bold">Plant answers</h1>
        <p className="text-sm text-slate-600">
          Questions PlantOps answers from what is already recorded. Every number comes from the same rules as the reports, with its date and where it
          came from. Nothing is changed or sent.
        </p>
      </div>
      {AREAS.map((area) => {
        const list = cards.filter((c) => c.area === area);
        if (!list.length) return null;
        return (
          <section key={area} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-lg font-bold">{AREA_LABEL[area]}</h2>
            <ul className="divide-y divide-slate-100">
              {list.map((c) => (
                <li key={c.id}>
                  {isBuilt(c) ? (
                    <a href={`/reports/answers/${c.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                      <span className="font-semibold text-(--brand)">{c.title}</span>
                      <span className="shrink-0 text-sm text-slate-500">{c.private ? "🔒 owner only ›" : "›"}</span>
                    </a>
                  ) : (
                    <span className="flex min-h-12 items-center justify-between gap-3 py-2 text-slate-500">
                      <span>{c.title}</span>
                      <span className="shrink-0 text-xs">comes in Phase {c.phase}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
