"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { FORMS } from "@/lib/forms";
import type { EntryView } from "@/server/entries";
import { FormFields } from "../../../form-fields";
import { ResultInputs } from "../../../tests/new/form";

const asStrings = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)]));

export function CorrectionForm({ entry }: { entry: EntryView }) {
  const def = FORMS[entry.form];
  const v = entry.current;
  // The same values as the original, judged against the limits that applied when it was tested.
  const params = v.results.map((r) => ({ id: r.parameter_id, name: r.name, unit: r.unit, limit_min: r.limit_min, limit_max: r.limit_max }));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(v.results.map((r) => [r.parameter_id, r.value])));
  const [data, setData] = useState<Record<string, string>>(asStrings(v.data));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/api/entries/${entry.id}/versions`, {
      body: {
        reason,
        data,
        results: def.hasResults ? params.map((p) => ({ parameter_id: p.id, value: (values[p.id] ?? "").trim() })) : undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/entries/${entry.id}`);
  }

  const fields = def.fields.filter((f) => f.key !== "remark");
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {fields.length > 0 && <FormFields fields={fields} values={data} onChange={setData} />}
        {def.hasResults && <ResultInputs parameters={params} values={values} onChange={setValues} />}
        <FormFields fields={def.fields.filter((f) => f.key === "remark")} values={data} onChange={setData} />
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
