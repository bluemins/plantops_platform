import { Card } from "@plantops/ui";
import { fmtDate, fmtDateTime } from "@plantops/module-kit/format";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSetup } from "@/server/setup";
import { countHistory } from "@/server/views";
import { Header } from "../header";
import { BackLink } from "../parts";

/** Every count by date (newest first), and each item's own history. */
export default async function HistoryPage() {
  const user = await requirePageUser("/history");
  const [plant, days, setup] = await Promise.all([kit.branding(user.tenantId), countHistory(user), listSetup(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">History</h1>

      <Card>
        <h2 className="mb-2 text-lg font-bold">By date</h2>
        {days.length === 0 ? (
          <p className="text-slate-500">Nothing has been counted yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {days.map((d) => (
              <li key={d.date}>
                <a href={`/day/${d.date}`} className="flex items-baseline justify-between gap-3 py-3 hover:bg-slate-50">
                  <span className="font-semibold">{fmtDate(d.date)}</span>
                  <span className="text-right text-sm text-slate-500">
                    {d.latest.entered_by}, {fmtDateTime(d.first_at)}
                    {d.versions > 1 && <span className="ml-2 font-semibold text-amber-700">corrected {d.versions - 1}×</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">By item</h2>
        {setup.map((s) => (
          <div key={s.id} className="mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{s.name}</h3>
            <div className="flex flex-wrap gap-2 py-1">
              {s.items.map((i) => (
                <a key={i.id} href={`/items/${i.id}`} className={`rounded-full border px-3 py-1.5 text-sm ${i.status === "off" ? "border-dashed text-slate-400" : "border-slate-300 hover:bg-slate-50"}`}>
                  {i.name}
                </a>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
