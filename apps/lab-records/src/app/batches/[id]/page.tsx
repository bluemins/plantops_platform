import { Card } from "@plantops/ui";
import { getBatch } from "@/server/batches";
import { uuidParam } from "@/server/http";
import { orNotFound } from "@/server/pages";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { LinkButton, SectionTitle, StatusChip } from "@/lib/ui";
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

export default async function BatchPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/batches/${id}`);
  const [plant, batch] = await Promise.all([branding(user.tenantId), orNotFound(getBatch(user, uuidParam(id)))]);

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

      {user.canEnter && batch.status !== "rejected" && <LinkButton href={`/tests/new?batch=${batch.id}`}>+ Add daily test</LinkButton>}

      <SectionTitle>Tests ({batch.entries.length})</SectionTitle>
      {batch.entries.length === 0 ? (
        <p className="text-slate-500">No tests for this batch yet.</p>
      ) : (
        <div className="space-y-2">
          {batch.entries.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </div>
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
    </div>
  );
}
