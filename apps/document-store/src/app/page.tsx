import { Card } from "@plantops/ui";
import { listDocuments, ListInput } from "@/server/documents";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { stageText } from "@/lib/expiry";
import { ExpiryChip, LinkButton, reminderStatusText } from "@/lib/ui";
import { Header } from "./header";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const FILTERS = [
  ["all", "All"],
  ["soon", "Expiring soon"],
  ["expired", "Expired"],
  ["none", "No expiry"],
  ["archived", "Archived"],
] as const;

/** The documents table: every licence / certificate with its expiry status and last reminder. */
export default async function DocumentsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = ListInput.parse({ filter: raw.filter, q: raw.q || undefined });
  const user = await requirePageUser(`/?${new URLSearchParams(raw as Record<string, string>).toString()}`);
  const [plant, rows, all] = await Promise.all([kit.branding(user.tenantId), listDocuments(user, q), listDocuments(user, { filter: "all" })]);
  const expired = all.filter((d) => d.expiry.kind === "expired").length;
  const soon = all.filter((d) => d.expiry.kind === "soon" || d.expiry.kind === "today").length;
  const link = (filter: string) => `/?${new URLSearchParams({ filter, ...(q.q ? { q: q.q } : {}) })}`;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Licences &amp; certificates</h1>
        <div className="flex flex-wrap gap-2">
          {user.canManage && <LinkButton href="/documents/new">+ Add document</LinkButton>}
          {user.isOwner && (
            <LinkButton href="/api/export" variant="secondary">
              ⬇ Export
            </LinkButton>
          )}
          {user.isOwner && (
            <LinkButton href="/support-access" variant="secondary">
              Support access
            </LinkButton>
          )}
        </div>
      </div>

      {(expired > 0 || soon > 0) && (
        <div className="flex flex-wrap gap-2">
          {expired > 0 && (
            <a href={link("expired")} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">
              {expired} expired →
            </a>
          )}
          {soon > 0 && (
            <a href={link("soon")} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-amber-900">
              {soon} expiring within 30 days →
            </a>
          )}
        </div>
      )}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="filter" value={q.filter} />
        <input name="q" defaultValue={q.q} placeholder="Search name, certificate no., authority" className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4" />
        <button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold">Search</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <a
            key={f}
            href={link(f)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${q.filter === f ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {label}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>{all.length === 0 ? (user.canManage ? "No documents yet. Tap “Add document” to add your first licence or certificate." : "No documents yet.") : "Nothing matches."}</Card>
      ) : (
        <>
          {/* Phones: cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((d) => (
              <a key={d.id} href={`/documents/${d.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{d.current.name}</span>
                  <ExpiryChip kind={d.expiry.kind} text={d.expiry.text} />
                </div>
                <p className="text-sm text-slate-500">
                  {[d.current.certificate_no && `No. ${d.current.certificate_no}`, d.current.authority, d.current.expires_on && `till ${fmtDate(d.current.expires_on)}`].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm text-slate-500">Responsible: {d.responsible_name}</p>
                {d.last_reminder && (
                  <p className="text-xs text-slate-400">
                    Reminder ({stageText(d.last_reminder.stage)}): {reminderStatusText(d.last_reminder.status)}
                    {d.last_reminder.error ? ` – ${d.last_reminder.error}` : ""}
                  </p>
                )}
              </a>
            ))}
          </div>

          {/* Computers: table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {["Name", "Certificate no.", "Authority", "Expires", "Status", "Responsible", "Last reminder", "File"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-semibold">
                      <a href={`/documents/${d.id}`} className="text-(--brand) underline">
                        {d.current.name}
                      </a>
                    </td>
                    <td className="px-3 py-2">{d.current.certificate_no ?? "—"}</td>
                    <td className="px-3 py-2">{d.current.authority ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{d.current.expires_on ? fmtDate(d.current.expires_on) : "—"}</td>
                    <td className="px-3 py-2">
                      <ExpiryChip kind={d.expiry.kind} text={d.expiry.text} />
                    </td>
                    <td className="px-3 py-2">{d.responsible_name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {d.last_reminder ? (
                        <>
                          {reminderStatusText(d.last_reminder.status)} ({stageText(d.last_reminder.stage)})
                          <div className="text-xs text-slate-400">
                            {d.last_reminder.sent_at ? fmtDateTime(d.last_reminder.sent_at) : d.last_reminder.error}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/files/${d.current.file.id}`} target="_blank" rel="noopener" className="text-(--brand) underline" title={d.current.file.original_name}>
                        📎 Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
