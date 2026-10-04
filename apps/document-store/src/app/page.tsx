import { Card } from "@plantops/ui";
import { listDocuments, ListInput } from "@/server/documents";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { localizedDate, localizedDateTime, localizedExpiry, localizedReminderStatus, localizedStage, translate } from "@/lib/i18n";
import { ExpiryChip, LinkButton } from "@/lib/ui";
import { Header } from "./header";
import { getLocale } from "@/server/locale";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const FILTERS = [
  ["all", "all"],
  ["soon", "expiringSoon"],
  ["expired", "expired"],
  ["none", "noExpiry"],
  ["archived", "archived"],
] as const;
const TABLE_HEADERS = ["name", "certificateNumber", "authorityLabel", "expiresLabel", "status", "responsible", "lastReminder", "file"] as const;

/** The documents table: every licence / certificate with its expiry status and last reminder. */
export default async function DocumentsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = ListInput.parse({ filter: raw.filter, q: raw.q || undefined });
  const user = await requirePageUser(`/?${new URLSearchParams(raw as Record<string, string>).toString()}`);
  const [plant, rows, all, locale] = await Promise.all([kit.branding(user.tenantId), listDocuments(user, q), listDocuments(user, { filter: "all" }), getLocale()]);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const expired = all.filter((d) => d.expiry.kind === "expired").length;
  const soon = all.filter((d) => d.expiry.kind === "soon" || d.expiry.kind === "today").length;
  const link = (filter: string) => `/?${new URLSearchParams({ filter, ...(q.q ? { q: q.q } : {}) })}`;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} locale={locale} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          {user.canManage && <LinkButton href="/documents/new">{t("addDocument")}</LinkButton>}
          {user.isOwner && (
            <LinkButton href="/api/export" variant="secondary">
              {t("export")}
            </LinkButton>
          )}
          {user.isOwner && (
            <LinkButton href="/api/export/files" variant="secondary">
              {t("exportFiles")}
            </LinkButton>
          )}
          {user.isOwner && (
            <LinkButton href="/support-access" variant="secondary">
              {t("supportAccess")}
            </LinkButton>
          )}
        </div>
      </div>

      {(expired > 0 || soon > 0) && (
        <div className="flex flex-wrap gap-2">
          {expired > 0 && (
            <a href={link("expired")} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">
              {t("expiredCount", { count: expired })}
            </a>
          )}
          {soon > 0 && (
            <a href={link("soon")} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-amber-900">
              {t("expiresWithin", { count: soon })}
            </a>
          )}
        </div>
      )}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="filter" value={q.filter} />
        <input name="q" defaultValue={q.q} placeholder={t("searchPlaceholder")} className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4" />
        <button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold">{t("search")}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <a
            key={f}
            href={link(f)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${q.filter === f ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {t(label)}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>{all.length === 0 ? (user.canManage ? t("noDocuments") : t("noDocumentsReadOnly")) : t("nothingMatches")}</Card>
      ) : (
        <>
          {/* Phones: cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((d) => (
              <a key={d.id} href={`/documents/${d.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{d.current.name}</span>
                  <ExpiryChip kind={d.expiry.kind} text={localizedExpiry(locale, d.expiry.kind, d.expiry.days)} />
                </div>
                <p className="text-sm text-slate-500">
                  {[d.current.certificate_no && `No. ${d.current.certificate_no}`, d.current.authority, d.current.expires_on && `till ${localizedDate(locale, d.current.expires_on)}`].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm text-slate-500">{t("responsible")}: {d.responsible_name}</p>
                {d.last_reminder && (
                  <p className="text-xs text-slate-400">
                    {t("reminders")} ({localizedStage(locale, d.last_reminder.stage)}): {localizedReminderStatus(locale, d.last_reminder.status)}
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
                  {TABLE_HEADERS.map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {t(h)}
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
                    <td className="whitespace-nowrap px-3 py-2">{d.current.expires_on ? localizedDate(locale, d.current.expires_on) : "—"}</td>
                    <td className="px-3 py-2">
                      <ExpiryChip kind={d.expiry.kind} text={localizedExpiry(locale, d.expiry.kind, d.expiry.days)} />
                    </td>
                    <td className="px-3 py-2">{d.responsible_name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {d.last_reminder ? (
                        <>
                          {localizedReminderStatus(locale, d.last_reminder.status)} ({localizedStage(locale, d.last_reminder.stage)})
                          <div className="text-xs text-slate-400">
                            {d.last_reminder.sent_at ? localizedDateTime(locale, d.last_reminder.sent_at) : d.last_reminder.error}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/files/${d.current.file.id}`} target="_blank" rel="noopener" className="text-(--brand) underline" title={d.current.file.original_name}>
                        📎 {t("open")}
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
