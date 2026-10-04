"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api, uploadFile } from "@/lib/api";
import { DocumentFields, emptyFields, fieldsBody, FilePicker, PersonPicker } from "../../document-fields";
import { useTranslation } from "../../language-provider";

export function DocumentForm({ people, me }: { people: { user_id: string; name: string; email: string | null }[]; me: string }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(emptyFields);
  const [responsible, setResponsible] = useState(people.some((p) => p.user_id === me) ? me : "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError(t("chooseFile"));
    setBusy(true);
    setError(undefined);
    const up = await uploadFile(file);
    if (!up.ok) {
      setBusy(false);
      return setError(up.error);
    }
    const r = await api<{ id: string }>("/api/documents", { body: { ...fieldsBody(fields), responsible_user_id: responsible, file_id: up.id } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/documents/${r.data.id}`);
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <DocumentFields value={fields} onChange={setFields} />
        <PersonPicker people={people} value={responsible} onChange={setResponsible} />
        <FilePicker label={t("uploadDocument")} file={file} onChange={setFile} required />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy ? t("saving") : t("saveDocument")}
          </Button>
          <a href="/" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            {t("cancel")}
          </a>
        </div>
      </form>
    </Card>
  );
}
