"use client";

import { TextField } from "@plantops/ui";
import { useTranslation } from "./language-provider";

export type DocFields = {
  name: string;
  certificate_no: string;
  issued_on: string;
  expires_on: string;
  authority: string;
  support_contact: string;
  remark: string;
};

export const emptyFields: DocFields = { name: "", certificate_no: "", issued_on: "", expires_on: "", authority: "", support_contact: "", remark: "" };

/** The document's attributes as big phone-friendly inputs. `only` limits which ones are shown (renewal). */
export function DocumentFields({ value, onChange, only }: { value: DocFields; onChange: (v: DocFields) => void; only?: (keyof DocFields)[] }) {
  const { t } = useTranslation();
  const show = (k: keyof DocFields) => !only || only.includes(k);
  const set = (k: keyof DocFields) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-4">
      {show("name") && <TextField label={t("documentName")} value={value.name} onChange={set("name")} placeholder={t("exampleFssai")} required maxLength={120} />}
      {show("certificate_no") && <TextField label={t("certificateNo")} value={value.certificate_no} onChange={set("certificate_no")} maxLength={80} />}
      <div className="grid grid-cols-2 gap-3">
        {show("issued_on") && <TextField label={t("issuedOn")} type="date" value={value.issued_on} onChange={set("issued_on")} />}
        {show("expires_on") && <TextField label={t("expiresOn")} type="date" value={value.expires_on} onChange={set("expires_on")} />}
      </div>
      {show("authority") && <TextField label={t("authority")} value={value.authority} onChange={set("authority")} placeholder={t("exampleAuthority")} maxLength={160} />}
      {show("support_contact") && (
        <TextField label={t("renewalContact")} value={value.support_contact} onChange={set("support_contact")} placeholder={t("contactPlaceholder")} maxLength={300} />
      )}
      {show("remark") && <TextField label={t("remark")} value={value.remark} onChange={set("remark")} maxLength={500} />}
    </div>
  );
}

/** File picker: PDF or a photo (phones can take the photo directly). */
export function FilePicker({ label, file, onChange, required }: { label: string; file: File | null; onChange: (f: File | null) => void; required?: boolean }) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full rounded-xl border border-dashed border-slate-300 bg-white p-3 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-(--brand-soft) file:px-4 file:py-2 file:font-semibold file:text-(--brand)"
      />
      <span className="mt-1 block text-sm text-slate-500">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : t("uploadHint")}</span>
    </label>
  );
}

export function PersonPicker({ people, value, onChange }: { people: { user_id: string; name: string; email: string | null }[]; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{t("responsibleHelp")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base">
        <option value="">{t("choosePerson")}</option>
        {people.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.name} {p.email ? `(${p.email})` : t("noEmail")}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-sm text-slate-500">{t("responsibleHint")}</span>
    </label>
  );
}

/** Form fields -> API body (blank text and dates become "not set"). */
export const fieldsBody = (v: DocFields) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === "" ? null : x.trim()]));
