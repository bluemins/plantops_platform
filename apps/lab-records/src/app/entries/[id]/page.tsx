import { Card } from "@plantops/ui";
import { getEntry } from "@/server/entries";
import { uuidParam } from "@/server/http";
import { orNotFound } from "@/server/pages";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { fmtDateTime } from "@/lib/format";
import { LinkButton, SectionTitle, VerdictBadge } from "@/lib/ui";
import { ResultsTable } from "../../entry-card";
import { Header } from "../../header";

type Props = { params: Promise<{ id: string }> };

/** One test with every version: the latest on top, earlier versions kept below exactly as entered. */
export default async function EntryPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/entries/${id}`);
  const [plant, entry] = await Promise.all([branding(user.tenantId), orNotFound(getEntry(user, uuidParam(id)))]);
  const older = [...entry.versions].reverse().slice(1);
  const v = entry.current;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href={entry.batch_id ? `/batches/${entry.batch_id}` : "/"} className="text-sm font-semibold text-(--brand)">
        ← {entry.batch_id ? "Back to batch" : "Home"}
      </a>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Daily test</h1>
        <VerdictBadge verdict={v.verdict} />
      </div>
      <Card>
        <p className="text-sm text-slate-500">
          Tested {fmtDateTime(v.tested_at)} · entered by <b className="text-slate-700">{v.entered_by_name}</b> at {fmtDateTime(v.entered_at)}
          {v.version > 1 && ` · version ${v.version}`}
        </p>
        {v.reason && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">Correction reason: {v.reason}</p>}
        <ResultsTable version={v} />
        {v.remark && <p className="mt-2 text-sm text-slate-600">Remark: {v.remark}</p>}
        <p className="mt-3 text-xs text-slate-400">🔒 Saved entries can't be edited or deleted. A correction adds a new version; this one stays on record.</p>
      </Card>

      {user.canEnter && <LinkButton href={`/entries/${entry.id}/correct`} variant="secondary">Correct a mistake…</LinkButton>}

      {older.length > 0 && (
        <>
          <SectionTitle>Earlier versions</SectionTitle>
          {older.map((o) => (
            <Card key={o.id} className="opacity-80">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Version {o.version}</span>
                <VerdictBadge verdict={o.verdict} />
              </div>
              <p className="text-sm text-slate-500">
                {o.entered_by_name} · {fmtDateTime(o.entered_at)}
                {o.reason ? ` · reason: ${o.reason}` : ""}
              </p>
              <ResultsTable version={o} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
