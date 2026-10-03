"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api, uploadFile } from "@/lib/api";
import type { VersionView } from "@/server/documents";
import { DocumentFields, fieldsBody, FilePicker, PersonPicker, type DocFields } from "../../document-fields";

type Person = { user_id: string; name: string; email: string | null };
const done = () => window.location.reload();
const toFields = (v: VersionView): DocFields => ({
  name: v.name,
  certificate_no: v.certificate_no ?? "",
  issued_on: v.issued_on ?? "",
  expires_on: v.expires_on ?? "",
  authority: v.authority ?? "",
  support_contact: v.support_contact ?? "",
  remark: v.remark ?? "",
});

/** The owner / document keeper's actions on one document. */
export function DocumentActions({ id, current, archived, people, responsible }: { id: string; current: VersionView; archived: boolean; people: Person[]; responsible: string }) {
  const [mode, setMode] = useState<"renew" | "correct" | "responsible">();
  const [error, setError] = useState<string>();

  async function archive() {
    if (!confirm(archived ? "Restore this document? Reminders start again." : "Archive this document? It is kept, but hidden and without reminders.")) return;
    const r = await api(`/api/documents/${id}/archive`, { body: { archived: !archived } });
    if (!r.ok) return setError(r.error);
    done();
  }

  return (
    <div className="space-y-3">
      {!mode && (
        <div className="flex flex-wrap gap-2">
          {!archived && <Button onClick={() => setMode("renew")}>↻ Renew</Button>}
          <Button variant="secondary" onClick={() => setMode("correct")}>
            Correct details…
          </Button>
          <Button variant="secondary" onClick={() => setMode("responsible")}>
            Change responsible
          </Button>
          <Button variant={archived ? "secondary" : "danger"} onClick={archive}>
            {archived ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {mode === "renew" && <RenewForm id={id} current={current} onClose={() => setMode(undefined)} />}
      {mode === "correct" && <CorrectForm id={id} current={current} onClose={() => setMode(undefined)} />}
      {mode === "responsible" && <ResponsibleForm id={id} people={people} value={responsible} onClose={() => setMode(undefined)} />}
    </div>
  );
}

function FormCard({ title, onSubmit, busy, error, onClose, button, children }: { title: string; onSubmit: (e: FormEvent) => void; busy: boolean; error?: string; onClose: () => void; button: string; children: React.ReactNode }) {
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-lg font-semibold">{title}</p>
        {children}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy ? "Saving…" : button}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RenewForm({ id, current, onClose }: { id: string; current: VersionView; onClose: () => void }) {
  const [fields, setFields] = useState<DocFields>({ ...toFields(current), issued_on: "", expires_on: "", remark: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose the new certificate (PDF or photo)");
    setBusy(true);
    const up = await uploadFile(file);
    if (!up.ok) {
      setBusy(false);
      return setError(up.error);
    }
    const b = fieldsBody(fields);
    const r = await api(`/api/documents/${id}/renew`, { body: { certificate_no: b.certificate_no, issued_on: b.issued_on, expires_on: b.expires_on, remark: b.remark, file_id: up.id, reason: "Renewed" } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <FormCard title="Renew – upload the new certificate" onSubmit={submit} busy={busy} error={error} onClose={onClose} button="Save renewal">
      <FilePicker label="New certificate (file)" file={file} onChange={setFile} required />
      <DocumentFields value={fields} onChange={setFields} only={["certificate_no", "issued_on", "expires_on", "remark"]} />
      <p className="text-sm text-slate-500">The current version and its file stay on record. Reminders start again for the new expiry date.</p>
    </FormCard>
  );
}

function CorrectForm({ id, current, onClose }: { id: string; current: VersionView; onClose: () => void }) {
  const [fields, setFields] = useState<DocFields>(toFields(current));
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    let file_id: string | undefined;
    if (file) {
      const up = await uploadFile(file);
      if (!up.ok) {
        setBusy(false);
        return setError(up.error);
      }
      file_id = up.id;
    }
    const r = await api(`/api/documents/${id}/correct`, { body: { ...fieldsBody(fields), file_id, reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <FormCard title="Correct the details" onSubmit={submit} busy={busy} error={error} onClose={onClose} button="Save correction">
      <DocumentFields value={fields} onChange={setFields} />
      <FilePicker label="Replace the file (optional – only if the wrong file was uploaded)" file={file} onChange={setFile} />
      <TextField label="What are you correcting? (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. expiry date typed wrong" required minLength={3} />
      <p className="text-sm text-slate-500">This adds a new version; the current one stays on record. For a new certificate use Renew.</p>
    </FormCard>
  );
}

function ResponsibleForm({ id, people, value, onClose }: { id: string; people: Person[]; value: string; onClose: () => void }) {
  const [person, setPerson] = useState(people.some((p) => p.user_id === value) ? value : "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/api/documents/${id}/responsible`, { body: { responsible_user_id: person } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <FormCard title="Change who is responsible" onSubmit={submit} busy={busy} error={error} onClose={onClose} button="Save">
      <PersonPicker people={people} value={person} onChange={setPerson} />
    </FormCard>
  );
}
