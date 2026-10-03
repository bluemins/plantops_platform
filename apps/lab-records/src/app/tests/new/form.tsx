"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { VerdictBadge } from "@/lib/ui";
import { judge, limitText } from "@/lib/verdict";
import type { ParameterView } from "@/server/parameters";

const NUMBER = /^-?\d{1,7}(\.\d{1,4})?$/;

/** "2026-10-03T18:30" for a datetime-local field, in the phone's own time (India). */
function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** One number box per check, judged live against the plant's limit (the server judges again on save). */
export function ResultInputs({
  parameters,
  values,
  onChange,
}: {
  parameters: Pick<ParameterView, "id" | "name" | "unit" | "limit_min" | "limit_max">[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-3">
      {parameters.map((p) => {
        const value = values[p.id] ?? "";
        const valid = NUMBER.test(value.trim());
        const verdict = valid ? judge(value, p.limit_min, p.limit_max) : null;
        const limit = limitText(p.limit_min, p.limit_max);
        return (
          <div key={p.id} className={`rounded-xl border p-3 ${verdict === "fail" ? "border-red-300 bg-red-50" : verdict === "pass" ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>
            <div className="flex items-end gap-3">
              <TextField
                label={`${p.name}${p.unit ? ` (${p.unit})` : ""}`}
                className="flex-1"
                inputMode="decimal"
                value={value}
                onChange={(e) => onChange({ ...values, [p.id]: e.target.value.replace(",", ".") })}
                placeholder={limit || "value"}
              />
              <div className="mb-3 w-20 text-right">{verdict && <VerdictBadge verdict={verdict} />}</div>
            </div>
            <p className="mt-1 text-sm text-slate-500">{limit ? `Allowed: ${limit}` : "No limit set yet – no pass/fail"}</p>
          </div>
        );
      })}
    </div>
  );
}

export function DailyTestForm({ parameters, batches, batchId }: { parameters: ParameterView[]; batches: { id: string; label: string }[]; batchId: string }) {
  const [batch, setBatch] = useState(batchId);
  const [testedAt, setTestedAt] = useState(nowLocal);
  const [values, setValues] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const filled = parameters.filter((p) => (values[p.id] ?? "").trim() !== "");
  const bad = filled.find((p) => !NUMBER.test(values[p.id]!.trim()));
  const fails = filled.filter((p) => !bad && judge(values[p.id]!, p.limit_min, p.limit_max) === "fail");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!filled.length) return setError("Enter at least one result");
    if (bad) return setError(`${bad.name}: enter a number like 500 or 6.5`);
    if (!confirm(`Save this test${fails.length ? ` (${fails.map((p) => p.name).join(", ")} FAIL)` : ""}? It can't be edited afterwards – only corrected with a reason.`)) return;
    setBusy(true);
    const r = await api<{ id: string }>("/api/entries", {
      body: {
        batch_id: batch || null,
        tested_at: new Date(testedAt).toISOString(),
        remark,
        results: filled.map((p) => ({ parameter_id: p.id, value: values[p.id]!.trim() })),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(batch ? `/batches/${batch}` : `/entries/${r.data.id}`);
  }

  if (!parameters.length) return <Card>No daily checks are switched on. Ask the owner or lab lead to set them up in “Tests &amp; limits”.</Card>;

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Batch</span>
          <select value={batch} onChange={(e) => setBatch(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base">
            <option value="">No batch (general check)</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Tested at" type="datetime-local" value={testedAt} max={nowLocal()} onChange={(e) => setTestedAt(e.target.value)} required />
        <ResultInputs parameters={parameters} values={values} onChange={setValues} />
        <TextField label="Remark (optional)" value={remark} maxLength={500} onChange={(e) => setRemark(e.target.value)} />
        {fails.length > 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {fails.map((p) => p.name).join(", ")} outside the limit. The test is still saved as entered.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save test
          </Button>
          <a href={batch ? `/batches/${batch}` : "/"} className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            Cancel
          </a>
        </div>
      </form>
    </Card>
  );
}
