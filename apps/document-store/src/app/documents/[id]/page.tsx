import { Card } from "@plantops/ui";
import { getDocument, responsibleChoices, type VersionView } from "@/server/documents";
import { uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { localizedDate, localizedDateTime, localizedExpiry, localizedReminderStatus, localizedStage, translate, type Locale, type MessageKey } from "@/lib/i18n";
import { ExpiryChip, fileSize, SectionTitle } from "@/lib/ui";
import { Header } from "../../header";
import { DocumentActions } from "./actions";
import { getLocale } from "@/server/locale";

type Props = { params: Promise<{ id: string }> };

const KIND: Record<VersionView["kind"], MessageKey> = { initial: "added", renewal: "renewed", correction: "corrected" };

function Details({ v, locale }: { v: VersionView; locale: Locale }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const rows: [string, string | null][] = [
    [t("certificateNumber"), v.certificate_no],
    [t("issuedLabel"), v.issued_on && localizedDate(locale, v.issued_on)],
    [t("expiresLabel"), v.expires_on ? localizedDate(locale, v.expires_on) : t("noExpiryValue")],
    [t("authorityLabel"), v.authority],
    [t("contactLabel"), v.support_contact],
    [t("remarkLabel"), v.remark],
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

function FileLink({ v, locale }: { v: VersionView; locale: Locale }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <span className="inline-flex flex-wrap gap-3 text-sm">
      <a href={`/files/${v.file.id}`} target="_blank" rel="noopener" className="font-semibold text-(--brand) underline">
        📎 {t("open")} {v.file.content_type === "application/pdf" ? t("pdf") : t("photo")}
      </a>
      <a href={`/files/${v.file.id}?download=1`} className="text-(--brand) underline">
        {t("download")}
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
  const [plant, doc, people, locale] = await Promise.all([kit.branding(user.tenantId), orNotFound(getDocument(user, uuidParam(id))), user.canManage ? responsibleChoices(user) : Promise.resolve([]), getLocale()]);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const v = doc.current;
  const older = [...doc.versions].reverse().slice(1);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} locale={locale} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        {t("allDocuments")}
      </a>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{v.name}</h1>
        {doc.status === "archived" ? <span className="rounded-full bg-slate-200 px-3 py-0.5 text-sm font-semibold">{t("archivedBadge")}</span> : <ExpiryChip kind={doc.expiry.kind} text={localizedExpiry(locale, doc.expiry.kind, doc.expiry.days)} />}
      </div>

      <Card className="space-y-3">
        <Details v={v} locale={locale} />
        <p className="text-sm">
          {t("responsible")}: <b>{doc.responsible_name}</b>
        </p>
        <FileLink v={v} locale={locale} />
        {v.file.content_type.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element -- the plant's own uploaded photo
          <img src={`/files/${v.file.id}`} alt={v.name} className="max-h-96 rounded-xl border border-slate-200" />
        )}
        <p className="text-xs text-slate-400">
          {t("version")} {v.version} · {t(KIND[v.kind])} by {v.entered_by_name}, {localizedDateTime(locale, v.entered_at)}
          {v.reason && v.kind !== "renewal" ? ` · ${v.reason}` : ""} · 🔒 {t("earlierVersionsKept")}
        </p>
      </Card>

      {user.canManage && <DocumentActions id={doc.id} current={v} archived={doc.status === "archived"} people={people} responsible={doc.responsible_user_id} />}

      <SectionTitle>{t("reminders")}</SectionTitle>
      {doc.reminders.length === 0 ? (
        <p className="text-sm text-slate-500">{v.expires_on ? t("noRemindersYet") : t("neverExpires")}</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-600">
          {doc.reminders.map((r, i) => (
            <li key={i}>
              {localizedDateTime(locale, r.created_at)} · {localizedStage(locale, r.stage)} · {r.recipient_name}
              {r.email ? ` (${r.email})` : ""}: <b>{localizedReminderStatus(locale, r.status)}</b>
              {r.error ? ` – ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      {older.length > 0 && (
        <>
          <SectionTitle>{t("earlierVersions")}</SectionTitle>
          {older.map((o) => (
            <Card key={o.id} className="space-y-2 opacity-85">
              <p className="font-semibold">
                {t("version")} {o.version} · {t(KIND[o.kind])} by {o.entered_by_name}, {localizedDateTime(locale, o.entered_at)}
                {o.reason && o.kind === "correction" ? ` · ${o.reason}` : ""}
              </p>
              <Details v={o} locale={locale} />
              <FileLink v={o} locale={locale} />
            </Card>
          ))}
        </>
      )}
      <p className="text-xs text-slate-400">
        {t("added")} by {doc.created_by_name}, {localizedDateTime(locale, doc.created_at)}
      </p>
    </div>
  );
}
