import { Card } from "@plantops/ui";
import { getEntry } from "@/server/entries";
import { uuidParam } from "@/server/http";
import { orHidden } from "@/server/pages";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { fmtDateTime } from "@/lib/format";
import { FORMS } from "@/lib/forms";
import { LinkButton, SectionTitle, VerdictBadge } from "@/lib/ui";
import { ActionButton } from "../../actions";
import { Header } from "../../header";
import { RecordDetails } from "../../record-details";

type Props = { params: Promise<{ id: string }> };

/** One record with every version: the latest on top, earlier versions kept below exactly as entered. */
export default async function EntryPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/entries/${id}`);
  const [plant, entry] = await Promise.all([branding(user.tenantId), orHidden(getEntry(user, uuidParam(id)))]);
  if ("hidden" in entry) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>{entry.hidden}</Card>
      </div>
    );
  }
  const def = FORMS[entry.form];
  const older = [...entry.versions].reverse().slice(1);
  const v = entry.current;
  const back = entry.batch_id ? `/batches/${entry.batch_id}` : entry.form === "daily" ? "/" : "/forms";

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href={back} className="text-sm font-semibold text-(--brand)">
        ← Back
      </a>
      <div className="flex items-start justify-between gap-2">
        <div>
          {def.code && <p className="text-sm font-bold uppercase tracking-wide text-slate-500">{def.code}</p>}
          <h1 className="text-2xl font-bold">{def.title}</h1>
        </div>
        <VerdictBadge verdict={v.verdict} />
      </div>
      <Card>
        <p className="text-sm text-slate-500">
          {entry.form === "daily" ? `Tested ${fmtDateTime(v.tested_at)} · ` : ""}Sign: <b className="text-slate-700">{v.entered_by_name}</b>, {fmtDateTime(v.entered_at)}
          {v.version > 1 && ` · version ${v.version}`}
        </p>
        {v.reason && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">Correction reason: {v.reason}</p>}
        <RecordDetails entry={entry} version={v} />
        <p className="mt-3 text-sm">
          Verified by:{" "}
          {v.verified ? (
            <b className="text-emerald-700">
              {v.verified.by}, {fmtDateTime(v.verified.at)} ✓
            </b>
          ) : (
            <span className="text-slate-500">not yet</span>
          )}
        </p>
        <p className="mt-3 text-xs text-slate-400">🔒 Saved records can't be edited or deleted. A correction adds a new version; this one stays on record.</p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {user.canApprove && !v.verified && (
          <ActionButton path={`/api/entries/${entry.id}/verify`} confirmText={`Verify version ${v.version} as ${user.name}?`}>
            ✓ Verify
          </ActionButton>
        )}
        {user.canEnter && (
          <LinkButton href={`/entries/${entry.id}/correct`} variant="secondary">
            Correct a mistake…
          </LinkButton>
        )}
      </div>

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
                {o.verified ? ` · verified by ${o.verified.by}` : ""}
              </p>
              <RecordDetails entry={entry} version={o} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
