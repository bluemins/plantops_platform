import { Card } from "@plantops/ui";
import { getDocument, responsibleChoices, type VersionView } from "@/server/documents";
import { uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { stageText } from "@/lib/expiry";
import { ExpiryChip, fileSize, reminderStatusText, SectionTitle } from "@/lib/ui";
import { Header } from "../../header";
import { DocumentActions } from "./actions";

type Props = { params: Promise<{ id: string }> };

const KIND: Record<string, string> = { initial: "Added", renewal: "Renewed", correction: "Corrected" };

function Details({ v }: { v: VersionView }) {
  const rows: [string, string | null][] = [
    ["Certificate / licence no.", v.certificate_no],
    ["Issued on", v.issued_on && fmtDate(v.issued_on)],
    ["Expires on", v.expires_on ? fmtDate(v.expires_on) : "Does not expire"],
    ["Authority", v.authority],
    ["Contact for renewal / support", v.support_contact],
    ["Remark", v.remark],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows
        .filter(([, x]) => x)
        .map(([l, x]) => (
          <div key={l} className="contents">
            <dt className="text-slate-500">{l}</dt>
            <dd className="font-medium whitespace-pre-wrap">{x}</dd>
          </div>
        ))}
    </dl>
  );
}

function FileLink({ v }: { v: VersionView }) {
  return (
    <span className="inline-flex flex-wrap gap-3 text-sm">
      <a href={`/files/${v.file.id}`} target="_blank" rel="noopener" className="font-semibold text-(--brand) underline">
        📎 Open {v.file.content_type === "application/pdf" ? "PDF" : "photo"}
      </a>
      <a href={`/files/${v.file.id}?download=1`} className="text-(--brand) underline">
        Download
      </a>
      <span className="text-slate-400">
        {v.file.original_name} · {fileSize(v.file.size_bytes)}
      </span>
    </span>
  );
}

export default async function DocumentPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/documents/${id}`);
  const [plant, doc, people] = await Promise.all([kit.branding(user.tenantId), orNotFound(getDocument(user, uuidParam(id))), user.canManage ? responsibleChoices(user) : Promise.resolve([])]);
  const v = doc.current;
  const older = [...doc.versions].reverse().slice(1);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← All documents
      </a>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{v.name}</h1>
        {doc.status === "archived" ? <span className="rounded-full bg-slate-200 px-3 py-0.5 text-sm font-semibold">Archived</span> : <ExpiryChip kind={doc.expiry.kind} text={doc.expiry.text} />}
      </div>

      <Card className="space-y-3">
        <Details v={v} />
        <p className="text-sm">
          Responsible: <b>{doc.responsible_name}</b>
        </p>
        <FileLink v={v} />
        {v.file.content_type.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element -- the plant's own uploaded photo
          <img src={`/files/${v.file.id}`} alt={v.name} className="max-h-96 rounded-xl border border-slate-200" />
        )}
        <p className="text-xs text-slate-400">
          Version {v.version} · {KIND[v.kind]} by {v.entered_by_name}, {fmtDateTime(v.entered_at)}
          {v.reason && v.kind !== "renewal" ? ` · ${v.reason}` : ""} · 🔒 earlier versions and files are kept
        </p>
      </Card>

      {user.canManage && <DocumentActions id={doc.id} current={v} archived={doc.status === "archived"} people={people} responsible={doc.responsible_user_id} />}

      <SectionTitle>Reminders</SectionTitle>
      {doc.reminders.length === 0 ? (
        <p className="text-sm text-slate-500">{v.expires_on ? "No reminders yet. The first goes out 30 days before expiry." : "This document doesn't expire, so there are no reminders."}</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-600">
          {doc.reminders.map((r, i) => (
            <li key={i}>
              {fmtDateTime(r.created_at)} · {stageText(r.stage)} · {r.recipient_name}
              {r.email ? ` (${r.email})` : ""}: <b>{reminderStatusText(r.status)}</b>
              {r.error ? ` – ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      {older.length > 0 && (
        <>
          <SectionTitle>Earlier versions</SectionTitle>
          {older.map((o) => (
            <Card key={o.id} className="space-y-2 opacity-85">
              <p className="font-semibold">
                Version {o.version} · {KIND[o.kind]} by {o.entered_by_name}, {fmtDateTime(o.entered_at)}
                {o.reason && o.kind === "correction" ? ` · ${o.reason}` : ""}
              </p>
              <Details v={o} />
              <FileLink v={o} />
            </Card>
          ))}
        </>
      )}
      <p className="text-xs text-slate-400">
        Added by {doc.created_by_name}, {fmtDateTime(doc.created_at)}
      </p>
    </div>
  );
}
