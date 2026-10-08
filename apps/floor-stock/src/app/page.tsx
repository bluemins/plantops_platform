import { Card } from "@plantops/ui";
import { fmtDate } from "@plantops/module-kit/format";
import { qty } from "@/lib/compare";
import { istDay, istTime } from "@/lib/days";
import { LinkButton } from "@/lib/ui";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSetup } from "@/server/setup";
import { dayView, homeStatus } from "@/server/views";
import type { VersionInfo } from "@/server/counts";
import { Header } from "./header";

/** Floor Stock home: is today counted, what is low, and the way to everything else. */
export default async function HomePage() {
  const user = await requirePageUser("/");
  const [plant, setup, status] = await Promise.all([kit.branding(user.tenantId), listSetup(user), homeStatus(user, istDay())]);
  const sections = setup.filter((s) => s.status === "active" && s.items.some((i) => i.status === "active"));
  const latest = status.lastDate ? await dayView(user, status.lastDate) : null;
  const canEnter = user.canCount && !user.isSupport;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">Floor Stock</h1>

      {sections.length === 0 ? (
        <Card className="space-y-3">
          <p className="text-lg font-semibold">Sections are not set up yet</p>
          {user.isOwner ? (
            <>
              <p className="text-slate-600">Set up the sections and items your staff count every evening. You can start from a ready starter list.</p>
              <LinkButton href="/setup">⚙ Set up sections</LinkButton>
            </>
          ) : (
            <p className="text-slate-600">Your plant owner has not set up the sections to count yet. Please ask them to do it first.</p>
          )}
        </Card>
      ) : (
        <>
          <DayCard label="Today" date={status.today} count={status.todayCount} canEnter={canEnter} main />
          {!status.yesterdayCount && <DayCard label="Yesterday" date={status.yesterday} count={null} canEnter={canEnter} />}
        </>
      )}

      {latest && latest.low.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <h2 className="mb-2 font-bold text-red-800">
            Below the limit ({latest.low.length}) · count of {fmtDate(latest.date)}
          </h2>
          <ul className="space-y-1 text-red-900">
            {latest.low.map((r) => (
              <li key={r.item_id}>
                <a href={`/items/${r.item_id}`} className="hover:underline">
                  {r.name}: {qty(r.closing)} {r.unit} (limit {qty(r.min_level!)})
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <LinkButton href="/history" variant="secondary">
          History
        </LinkButton>
        {sections.length > 0 && (
          <LinkButton href="/setup" variant="secondary">
            ⚙ Sections &amp; items
          </LinkButton>
        )}
        {(user.isOwner || user.isSupport) && (
          <LinkButton href="/changes" variant="secondary">
            Recent changes
          </LinkButton>
        )}
        {user.isOwner && (
          <LinkButton href="/api/export" variant="secondary">
            Export CSV
          </LinkButton>
        )}
        {user.isOwner && (
          <LinkButton href="/support-access" variant="secondary">
            Support access
          </LinkButton>
        )}
      </div>
    </div>
  );
}

function DayCard({ label, date, count, canEnter, main }: { label: string; date: string; count: VersionInfo | null; canEnter: boolean; main?: boolean }) {
  if (count) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-green-200 bg-green-50">
        <div>
          <p className="text-lg font-semibold text-green-900">
            ✓ {label}&apos;s count done · {fmtDate(date)}
          </p>
          <p className="text-sm text-green-800">
            {count.version === 1 ? "Counted" : "Corrected"} at {istTime(count.entered_at)} by {count.entered_by}
          </p>
        </div>
        <LinkButton href={`/day/${date}`} variant="secondary">
          View
        </LinkButton>
      </Card>
    );
  }
  return (
    <Card className={`flex flex-wrap items-center justify-between gap-3 ${main ? "border-amber-200 bg-amber-50" : ""}`}>
      <div>
        <p className={`font-semibold ${main ? "text-lg text-amber-900" : ""}`}>
          {label}&apos;s count not done · {fmtDate(date)}
        </p>
        {!canEnter && <p className="text-sm text-slate-600">The store keeper enters it.</p>}
      </div>
      {canEnter && (
        <LinkButton href={`/count?date=${date}`} variant={main ? "primary" : "secondary"}>
          Enter {label.toLowerCase()}&apos;s count
        </LinkButton>
      )}
    </Card>
  );
}
