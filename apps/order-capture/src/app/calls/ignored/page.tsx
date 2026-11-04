import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { ignoredList } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { AddIgnored, RemoveIgnored } from "./editor";

/**
 * The owner's "Not an order number" list: the order phone is the owner's own, so family, suppliers and staff are kept
 * out. Calls from these numbers are not recorded at all. Owner only (labels can be private); support reads.
 */
export default async function IgnoredPage() {
  const user = await requirePageUser("/calls/ignored");
  const plant = await kit.branding(user.tenantId);
  if (!can(user, "view_ignored")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>Only the plant owner sees this list.</Card>
      </div>
    );
  }
  const rows = await ignoredList(user);
  const edit = can(user, "calls_ignore");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href="/calls">← Calls</BackLink>
      <h1 className="text-xl font-bold">Not an order number</h1>
      <p className="text-sm text-slate-600">Calls from these numbers are not recorded, counted or sent to Delivery staff. Only you see this list.</p>
      {edit && <AddIgnored />}
      {rows.length === 0 ? (
        <Card>
          <p className="text-slate-500">No numbers yet.</p>
        </Card>
      ) : (
        rows.map((r) => (
          <div key={r.phone} className="space-y-1 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">{r.label}</span>
              <span className="shrink-0 font-mono text-sm">{r.number}</span>
            </div>
            <p className="text-sm text-slate-500">
              Added by {r.by}, {r.at}
            </p>
            {r.customer && <p className="text-sm text-amber-800">This is customer {r.customer}. The customer itself is not changed.</p>}
            {edit && <RemoveIgnored phone={r.phone} label={r.label} />}
          </div>
        ))
      )}
    </div>
  );
}
