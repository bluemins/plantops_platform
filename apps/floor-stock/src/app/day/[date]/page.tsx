import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDate, fmtDateTime } from "@plantops/module-kit/format";
import { qty } from "@/lib/compare";
import { addDays } from "@/lib/days";
import { LinkButton } from "@/lib/ui";
import { whatsappText } from "@/lib/whatsapp";
import { allowedDates } from "@/server/counts";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { dayView } from "@/server/views";
import { Header } from "../../header";
import { BackLink, ComparisonLine, lineText, LowChip } from "../../parts";
import { CopyButton } from "./copy-button";

type Props = { params: Promise<{ date: string }>; searchParams: Promise<{ v?: string }> };

/** One day's count, compared with the day before: Sold (finished goods), Used / received (everything else), low stock. */
export default async function DayPage({ params, searchParams }: Props) {
  const { date } = await params;
  const { v } = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) notFound();
  const user = await requirePageUser(`/day/${date}${v ? `?v=${v}` : ""}`);
  const version = v && /^\d+$/.test(v) ? Number(v) : undefined;
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(dayView(user, date, version))]);
  const canEnter = user.canCount && !user.isSupport && allowedDates().includes(date);
  const nav = (
    <div className="flex justify-between text-sm font-semibold text-(--brand)">
      <a href={`/day/${addDays(date, -1)}`}>← {fmtDate(addDays(date, -1))}</a>
      <a href="/history">History</a>
      <a href={`/day/${addDays(date, 1)}`}>{fmtDate(addDays(date, 1))} →</a>
    </div>
  );

  if (!view) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <BackLink />
        <h1 className="text-2xl font-bold">Count of {fmtDate(date)}</h1>
        <Card className="space-y-3">
          <p>Nothing was counted on this day.</p>
          {canEnter && <LinkButton href={`/count?date=${date}`}>Enter the count</LinkButton>}
        </Card>
        {nav}
      </div>
    );
  }

  const latest = view.versions.at(-1)!;
  const isLatest = view.shown.version === latest.version;
  const previousDate = fmtDate(view.previous_date);
  const finished = view.sections.filter((s) => s.kind === "finished");
  const made = finished.flatMap((s) => s.rows.filter((r) => r.production.length));

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <div>
        <h1 className="text-2xl font-bold">Count of {fmtDate(date)}</h1>
        <p className="text-slate-600">
          {view.shown.version === 1 ? "Counted" : `Correction ${view.shown.version - 1}`} by {view.shown.entered_by}, {fmtDateTime(view.shown.entered_at)}
          {view.shown.reason ? ` · “${view.shown.reason}”` : ""}
        </p>
        {view.versions.length > 1 && (
          <p className="mt-1 flex flex-wrap gap-2 text-sm">
            <span className="text-slate-500">Versions:</span>
            {view.versions.map((x) => (
              <a key={x.version} href={`/day/${date}?v=${x.version}`} className={x.version === view.shown.version ? "font-bold" : "text-(--brand) underline"}>
                {x.version === 1 ? "first count" : `correction ${x.version - 1}`}
              </a>
            ))}
          </p>
        )}
        {!isLatest && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is an old version. The latest is correction {latest.version - 1}.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <CopyButton text={whatsappText(plant?.name ?? "Floor Stock", date, view.sections)} />
        {canEnter && isLatest && (
          <LinkButton href={`/count?date=${date}&correct=1`} variant="secondary">
            Correct this count
          </LinkButton>
        )}
      </div>

      {view.low.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <h2 className="mb-2 font-bold text-red-800">Below the limit ({view.low.length})</h2>
          <ul className="space-y-1 text-red-900">
            {view.low.map((r) => (
              <li key={r.item_id}>
                {r.name}: {qty(r.closing)} {r.unit} (limit {qty(r.min_level!)})
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!view.previous_counted && <p className="text-sm text-slate-500">Nothing was counted on {previousDate}, so Sold and Used can't be worked out for this day.</p>}

      {made.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Today production</h2>
          <ul className="divide-y divide-slate-100">
            {made.map((r) => (
              <li key={r.item_id} className="flex items-baseline justify-between gap-3 py-2">
                <span>
                  <span className="font-semibold">{r.name}</span>
                  {r.production.length > 1 || r.production[0]?.remark ? <span className="block text-sm text-slate-500">{r.production.map((l) => lineText(l, r.unit, null)).join("; ")}</span> : null}
                </span>
                <span className="whitespace-nowrap text-lg font-bold">
                  {qty(r.production_total)} <span className="text-sm font-normal text-slate-500">{r.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view.sections.map((s) => (
        <Card key={s.id}>
          <h2 className="mb-2 text-lg font-bold">
            {s.name}
            {s.kind === "finished" && <span className="ml-2 text-sm font-normal text-slate-500">closing stock</span>}
          </h2>
          <ul className="divide-y divide-slate-100">
            {s.rows.map((r) => (
              <li key={r.item_id} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <a href={`/items/${r.item_id}`} className="font-semibold hover:underline">
                    {r.name}
                  </a>
                  <span className="whitespace-nowrap text-lg font-bold">
                    {qty(r.closing)} <span className="text-sm font-normal text-slate-500">{r.unit}</span>
                    {r.second_total !== null && r.second_unit && (
                      <span className="text-sm font-normal text-slate-500">
                        {" "}
                        + {qty(r.second_total)} {r.second_unit}
                      </span>
                    )}
                  </span>
                </div>
                {(r.stock.length > 1 || r.stock[0]?.remark) && <p className="text-sm text-slate-500">{r.stock.map((l) => lineText(l, r.unit, r.second_unit)).join("; ")}</p>}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {r.previous !== null && view.previous_counted && (
                    <span className="text-slate-500">
                      {previousDate}: {qty(r.previous)}
                    </span>
                  )}
                  {view.previous_counted && <ComparisonLine c={r.comparison} unit={r.unit} previousDate={previousDate} />}
                  {r.low && <LowChip minLevel={r.min_level} />}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {nav}
    </div>
  );
}
