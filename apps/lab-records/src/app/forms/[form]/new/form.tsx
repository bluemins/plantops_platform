"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { FORMS, type FormId } from "@/lib/forms";
import { judge } from "@/lib/verdict";
import type { ParameterView } from "@/server/parameters";
import { FormFields } from "../../../form-fields";
import { ResultInputs } from "../../../tests/new/form";

const NUMBER = /^-?\d{1,7}(\.\d{1,4})?$/;
const todayLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

/** One FSSAI form record: batch (Forms 1, 2), the sheet's columns, and Form 1's parameter results. */
export function FormEntry({
  form,
  parameters,
  batches,
  batchId,
}: {
  form: FormId;
  parameters: ParameterView[];
  batches: { id: string; label: string; production_date: string }[];
  batchId: string;
}) {
  const def = FORMS[form];
  const first = batches.find((b) => b.id === batchId);
  const [batch, setBatch] = useState(batchId);
  const [data, setData] = useState<Record<string, string>>({
    ...(form === "form1" ? { test_date: todayLocal(), source: "in_house" } : {}),
    ...(form === "form2" ? { manufacturing_date: first?.production_date ?? "", sample_sent_on: todayLocal() } : {}),
    ...(form === "form3" ? { sample_sent_on: todayLocal() } : {}),
    ...(form === "form4" ? { samples_sent_on: todayLocal(), outcome: "pending" } : {}),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const active = parameters.filter((p) => p.active);
  const filled = active.filter((p) => (values[p.id] ?? "").trim() !== "");
  const bad = filled.find((p) => !NUMBER.test(values[p.id]!.trim()));
  const fails = filled.filter((p) => !bad && judge(values[p.id]!, p.limit_min, p.limit_max) === "fail");
  const fields = form === "form1" && data.source !== "outside" ? def.fields.filter((f) => f.key !== "lab_name") : def.fields;

  function pickBatch(id: string) {
    setBatch(id);
    const b = batches.find((x) => x.id === id);
    if (form === "form2" && b) setData((d) => ({ ...d, manufacturing_date: b.production_date }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (def.batch === "required" && !batch) return setError("Choose the batch");
    if (def.hasResults && !filled.length) return setError("Enter at least one result");
    if (bad) return setError(`${bad.name}: enter a number like 0.05`);
    if (!confirm(`Save this ${def.code} record${fails.length ? ` (${fails.map((p) => p.name).join(", ")} FAIL – the batch goes on hold)` : ""}? It can't be edited afterwards – only corrected with a reason.`)) return;
    setBusy(true);
    const r = await api<{ id: string }>("/api/entries", {
      body: {
        form,
        batch_id: def.batch === "none" ? null : batch || null,
        data,
        results: def.hasResults ? filled.map((p) => ({ parameter_id: p.id, value: values[p.id]!.trim() })) : undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/entries/${r.data.id}`);
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {def.batch !== "none" && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Batch no.</span>
            <select value={batch} onChange={(e) => pickBatch(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base" required>
              <option value="">Choose the batch</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <FormFields fields={fields.filter((f) => f.key !== "remark")} values={data} onChange={setData} />
        {def.hasResults && (
          <>
            <p className="pt-2 text-sm font-bold uppercase tracking-wide text-slate-500">Results (fill in what was tested)</p>
            <ResultInputs parameters={active} values={values} onChange={setValues} />
          </>
        )}
        <FormFields fields={fields.filter((f) => f.key === "remark")} values={data} onChange={setData} />
        {fails.length > 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {fails.map((p) => p.name).join(", ")} outside the limit – saving puts the batch on hold.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save {def.code} record
          </Button>
          <a href="/forms" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            Cancel
          </a>
        </div>
      </form>
    </Card>
  );
}
