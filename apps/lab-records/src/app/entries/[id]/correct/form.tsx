"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import type { EntryView } from "@/server/entries";
import { ResultInputs } from "../../../tests/new/form";

export function CorrectionForm({ entry }: { entry: EntryView }) {
  const v = entry.current;
  // The same checks as the original, judged against the limits that applied when it was tested.
  const params = v.results.map((r) => ({ id: r.parameter_id, name: r.name, unit: r.unit, limit_min: r.limit_min, limit_max: r.limit_max }));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(v.results.map((r) => [r.parameter_id, r.value])));
  const [remark, setRemark] = useState(v.remark);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/api/entries/${entry.id}/versions`, {
      body: { reason, remark, results: params.map((p) => ({ parameter_id: p.id, value: (values[p.id] ?? "").trim() })) },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/entries/${entry.id}`);
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <ResultInputs parameters={params} values={values} onChange={setValues} />
        <TextField label="Remark" value={remark} maxLength={500} onChange={(e) => setRemark(e.target.value)} />
        <TextField label="Why are you correcting this? (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. typed 620, meter showed 420" required minLength={3} />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save correction
          </Button>
          <a href={`/entries/${entry.id}`} className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            Cancel
          </a>
        </div>
      </form>
    </Card>
  );
}
