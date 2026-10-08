import { Card } from "@plantops/ui";
import { fmtDate } from "@plantops/module-kit/format";
import { qty } from "@/lib/compare";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { uuidParam } from "@/server/http";
import { requirePageUser } from "@/server/session";
import { itemHistory } from "@/server/views";
import { Header } from "../../header";
import { BackLink, ComparisonLine, LowChip } from "../../parts";

type Props = { params: Promise<{ id: string }> };

/** One item over its last 60 counts: closing stock, production, Sold / Used against the day before. */
export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/items/${id}`);
  const [plant, h] = await Promise.all([kit.branding(user.tenantId), orNotFound(Promise.resolve().then(() => itemHistory(user, uuidParam(id))))]);
  const { item, days } = h;
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/history">← History</BackLink>
      <div>
        <h1 className="text-2xl font-bold">{item.name}</h1>
        <p className="text-slate-600">
          {item.section} · {item.unit}
          {item.second_unit ? ` + ${item.second_unit}` : ""} · {item.min_level === null ? "no limit" : `limit ${qty(item.min_level)}`}
          {item.status === "off" ? " · switched off" : ""}
        </p>
      </div>
      <Card>
        {days.length === 0 ? (
          <p className="text-slate-500">This item has not been counted yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {days.map((d) => (
              <li key={d.date} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <a href={`/day/${d.date}`} className="font-semibold hover:underline">
                    {fmtDate(d.date)}
                  </a>
                  <span className="whitespace-nowrap text-lg font-bold">
                    {qty(d.closing)} <span className="text-sm font-normal text-slate-500">{d.unit}</span>
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {item.finished && d.production !== null && (
                    <span className="text-slate-500">
                      made {qty(d.production)} {d.unit}
                    </span>
                  )}
                  <ComparisonLine c={d.comparison} unit={d.unit} />
                  {d.low && <LowChip minLevel={item.min_level} />}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
