import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { callsTab } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { LinkRow, SectionTabs } from "../parts";
import { AutoRefresh, CallCard } from "./card";

/** The Calls tab (mock-up screen 4): numbers waiting for a call back, oldest first, and what was attended today. */
export default async function CallsPage() {
  const user = await requirePageUser("/calls");
  const plant = await kit.branding(user.tenantId);
  if (!can(user, "calls_view")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>You don&apos;t have access to Calls. Ask the plant owner.</Card>
      </div>
    );
  }
  const tab = await callsTab(user);
  const canAttend = can(user, "calls_attend");
  return (
    <div className="space-y-4">
      <AutoRefresh seconds={30} />
      <Header user={user} plant={plant} />
      {can(user, "read") && <SectionTabs current="calls" waiting={tab.waiting.length} />}
      <p className="text-sm text-slate-600">
        Today so far: {tab.today.calls} call{tab.today.calls === 1 ? "" : "s"} from {tab.today.numbers} number{tab.today.numbers === 1 ? "" : "s"} ·{" "}
        <b>{tab.waiting.length} waiting</b>
      </p>

      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Waiting</h2>
      {tab.waiting.length === 0 ? (
        <Card>
          <p className="text-slate-500">Nobody is waiting for a call back.</p>
        </Card>
      ) : (
        tab.waiting.map((c) => <CallCard key={c.phone} card={c} canAttend={canAttend} canIgnore={can(user, "calls_ignore")} plain={user.isSupport} />)
      )}

      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Attended today</h2>
      {tab.attended.length === 0 ? (
        <Card>
          <p className="text-slate-500">Nothing attended yet today.</p>
        </Card>
      ) : (
        tab.attended.map((a, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">{a.name}</span>
              <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Attended</span>
            </div>
            <p className="text-sm text-slate-500">
              {a.place ? `${a.place} · ` : ""}
              {a.rings} call{a.rings === 1 ? "" : "s"} · by {a.by} {a.at}
              {a.outcome === "new_customer" ? " · saved as a customer" : ""}
            </p>
          </div>
        ))
      )}

      {(can(user, "calls_numbers") || can(user, "view_ignored")) && (
        <nav className="space-y-3 pt-2" aria-label="More">
          {can(user, "calls_numbers") && (
            <LinkRow href="/calls/numbers" note="Calls, missed, attended and waiting by day">
              Calls numbers
            </LinkRow>
          )}
          {can(user, "view_ignored") && (
            <LinkRow href="/calls/ignored" note="Family, suppliers, staff: their calls are not recorded">
              Not an order number
            </LinkRow>
          )}
        </nav>
      )}
    </div>
  );
}
