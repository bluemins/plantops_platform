import { Card } from "@plantops/ui";
import { getBatch, type BatchDetail } from "@/server/batches";
import { uuidParam } from "@/server/http";
import { orHidden } from "@/server/pages";
import { branding } from "@/server/platform";
import type { LabUser } from "@/server/session";
import { requirePageUser } from "@/server/session";
import { fmtAge, fmtDate, fmtDateTime } from "@/lib/format";
import { LinkButton, SectionTitle, StatusChip } from "@/lib/ui";
import { ActionButton, TextAction } from "../../actions";
import { EntryCard } from "../../entry-card";
import { Header } from "../../header";

type Props = { params: Promise<{ id: string }> };

const EVENT_TEXT: Record<string, string> = {
  created: "Batch created",
  held: "Put on hold",
  released: "Hold released",
  approved: "Approved for production",
  rejected: "Rejected",
};

const ALERT_TEXT: Record<string, string> = { sent: "sent", pending: "sending…", skipped: "not sent", failed: "failed" };

/** What the batch is waiting for, and the buttons for whoever may act on it. */
function StatusPanel({ batch, user }: { batch: BatchDetail; user: LabUser }) {
  const { check } = batch;
  const lastHeld = [...batch.events].reverse().find((e) => e.event === "held");
  const decided = [...batch.events].reverse().find((e) => e.event === "approved" || e.event === "rejected");

  if (batch.status === "approved") {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <p className="font-semibold text-emerald-800">Approved for production</p>
        {decided && <p className="text-sm text-emerald-800">by {decided.by_name}, {fmtDateTime(decided.at)}</p>}
      </Card>
    );
  }
  if (batch.status === "rejected") {
    return (
      <Card className="border-slate-300 bg-slate-100">
        <p className="font-semibold">Rejected – closed for good</p>
        {decided && (
          <p className="text-sm text-slate-700">
            by {decided.by_name}, {fmtDateTime(decided.at)}: {decided.note}
          </p>
        )}
      </Card>
    );
  }

  const canNote = user.canEnter || user.canApprove;
  if (batch.status === "on_hold") {
    const releaseBlock = !check.correctiveSinceHold
      ? "Needs a corrective-action note first."
      : check.failing.length
        ? `Still failing: ${check.failing.join("; ")}. Add a passing retest.`
        : null;
    return (
      <Card className="space-y-3 border-red-200 bg-red-50">
        <div>
          <p className="text-lg font-bold text-red-800">ON HOLD{batch.held_since ? ` · ${fmtAge(batch.held_since)}` : ""}</p>
          {lastHeld?.note && <p className="text-red-800">Failed: {lastHeld.note}</p>}
          <p className="text-sm text-red-700">Can&apos;t be approved or dispatched until the hold is released.</p>
        </div>
        {canNote && <TextAction path={`/api/batches/${batch.id}/corrective`} field="note" label="Corrective action (what was done)" placeholder="e.g. RO membrane flushed, prefilter replaced" button="Save corrective note" variant="secondary" />}
        {user.canApprove && (
          <div className="space-y-3 border-t border-red-200 pt-3">
            {releaseBlock && <p className="text-sm font-semibold text-red-800">To release: {releaseBlock}</p>}
            <ActionButton path={`/api/batches/${batch.id}/release`} disabled={!!releaseBlock} confirmText={`Release the hold on ${batch.batch_no}? It goes back to "awaiting approval".`}>
              Release hold
            </ActionButton>
            <TextAction
              path={`/api/batches/${batch.id}/reject`}
              field="reason"
              label="Or reject the batch for good"
              placeholder="e.g. discarded 2,000 L / sent for reprocessing"
              button="Reject batch"
              variant="danger"
              confirmText={`Reject ${batch.batch_no} for good? It can never be approved or dispatched.`}
            />
          </div>
        )}
      </Card>
    );
  }

  // pending
  const approveBlock = !check.tests ? "Add at least one test first." : check.failing.length ? `Still failing: ${check.failing.join("; ")}` : null;
  return (
    <Card className="space-y-3 border-amber-200 bg-amber-50">
      <p className="font-semibold text-amber-900">Awaiting approval</p>
      {user.canApprove ? (
        <>
          {approveBlock && <p className="text-sm font-semibold text-amber-900">{approveBlock}</p>}
          <ActionButton path={`/api/batches/${batch.id}/approve`} disabled={!!approveBlock} confirmText={`Approve ${batch.batch_no} for production as ${user.name}?`}>
            ✓ Approve for production
          </ActionButton>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">Reject instead…</summary>
            <div className="mt-2">
              <TextAction path={`/api/batches/${batch.id}/reject`} field="reason" label="Reason" button="Reject batch" variant="danger" confirmText={`Reject ${batch.batch_no} for good?`} />
            </div>
          </details>
        </>
      ) : (
        <p className="text-sm text-amber-900">The owner or a lab lead approves it once the tests are in.</p>
      )}
    </Card>
  );
}

export default async function BatchPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/batches/${id}`);
  const [plant, batch] = await Promise.all([branding(user.tenantId), orHidden(getBatch(user, uuidParam(id)))]);
  if ("hidden" in batch) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>{batch.hidden}</Card>
      </div>
    );
  }
  const open = batch.status !== "rejected";

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← All batches
      </a>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Batch {batch.batch_no}</h1>
        <StatusChip status={batch.status} />
      </div>
      <Card>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Production date</dt>
          <dd className="font-medium">{fmtDate(batch.production_date)}</dd>
          <dt className="text-slate-500">Product</dt>
          <dd className="font-medium">{batch.product_name ?? "—"}</dd>
          <dt className="text-slate-500">Created by</dt>
          <dd className="font-medium">
            {batch.created_by_name}, {fmtDateTime(batch.created_at)}
          </dd>
        </dl>
      </Card>

      <StatusPanel batch={batch} user={user} />
      <a href={`/print/batch/${batch.id}`} className="inline-block text-sm font-semibold text-(--brand) underline">
        🖨 Print batch report
      </a>

      {user.canEnter && open && (
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/tests/new?batch=${batch.id}`}>{batch.status === "on_hold" ? "+ Retest (daily test)" : "+ Daily test"}</LinkButton>
          <LinkButton href={`/forms/form1/new?batch=${batch.id}`} variant="secondary">
            + Form 1
          </LinkButton>
          <LinkButton href={`/forms/form2/new?batch=${batch.id}`} variant="secondary">
            + Form 2
          </LinkButton>
        </div>
      )}

      <SectionTitle>Tests &amp; records ({batch.entries.length})</SectionTitle>
      {batch.entries.length === 0 ? (
        <p className="text-slate-500">No tests for this batch yet.</p>
      ) : (
        <div className="space-y-2">
          {batch.entries.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </div>
      )}

      {batch.corrective.length > 0 && (
        <>
          <SectionTitle>Corrective actions</SectionTitle>
          <div className="space-y-2">
            {batch.corrective.map((c) => (
              <Card key={c.id}>
                <p>{c.note}</p>
                <p className="text-sm text-slate-500">
                  {c.by_name} · {fmtDateTime(c.at)}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>History</SectionTitle>
      <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
        {batch.events.map((e, i) => (
          <li key={i}>
            <p className="font-medium">{EVENT_TEXT[e.event] ?? e.event}</p>
            <p className="text-sm text-slate-500">
              {e.by_name} · {fmtDateTime(e.at)}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          </li>
        ))}
      </ol>

      {batch.alerts.length > 0 && (
        <>
          <SectionTitle>WhatsApp alerts</SectionTitle>
          <ul className="space-y-1 text-sm">
            {batch.alerts.map((a, i) => (
              <li key={i} className="text-slate-600">
                {fmtDateTime(a.created_at)} · {a.recipient_name}: <b>{ALERT_TEXT[a.status]}</b>
                {a.error ? ` – ${a.error}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
