"use client";

import { useState } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { SectionTitle } from "@/lib/ui";
import type { ParameterView } from "@/server/parameters";

type Row = { name: string; unit: string; limit_min: string; limit_max: string };
const toRow = (p: ParameterView): Row => ({ name: p.name, unit: p.unit ?? "", limit_min: p.limit_min ?? "", limit_max: p.limit_max ?? "" });

function ParameterRow({ p, onSaved }: { p: ParameterView; onSaved: (p: ParameterView) => void }) {
  const [row, setRow] = useState(toRow(p));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const changed = JSON.stringify(row) !== JSON.stringify(toRow(p));
  const fixedName = p.kind === "form1";

  async function save(extra: Partial<{ active: boolean }> = {}) {
    setSaved(false);
    const body = { ...(fixedName ? {} : { name: row.name }), unit: row.unit || null, limit_min: row.limit_min, limit_max: row.limit_max, ...extra };
    const r = await api<ParameterView>(`/api/parameters/${p.id}`, { method: "PATCH", body: fixedName ? { unit: body.unit, limit_min: body.limit_min, limit_max: body.limit_max } : body });
    if (!r.ok) return setError(r.error);
    setError(undefined);
    setSaved(true);
    setRow(toRow(r.data));
    onSaved(r.data);
  }

  return (
    <Card className={p.active ? "" : "opacity-60"}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fixedName ? (
          <p className="col-span-2 self-center text-lg font-semibold sm:col-span-1">{p.name}</p>
        ) : (
          <TextField label="Check" value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} />
        )}
        <TextField label="Unit" value={row.unit} onChange={(e) => setRow({ ...row, unit: e.target.value })} placeholder="mg/L" />
        <TextField label="Lowest allowed" inputMode="decimal" value={row.limit_min} onChange={(e) => setRow({ ...row, limit_min: e.target.value })} placeholder="no minimum" />
        <TextField label="Highest allowed" inputMode="decimal" value={row.limit_max} onChange={(e) => setRow({ ...row, limit_max: e.target.value })} placeholder="no maximum" />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} disabled={!changed}>
          Save
        </Button>
        {!fixedName && (
          <Button variant="secondary" onClick={() => save({ active: !p.active })}>
            {p.active ? "Switch off" : "Switch on"}
          </Button>
        )}
        {saved && !changed && <span className="text-sm text-emerald-700">Saved ✓</span>}
        {!p.active && <span className="text-sm text-slate-500">Switched off – not shown in new tests</span>}
      </div>
    </Card>
  );
}

function AddDailyCheck({ onAdded }: { onAdded: (p: ParameterView) => void }) {
  const [row, setRow] = useState<Row>({ name: "", unit: "", limit_min: "", limit_max: "" });
  const [error, setError] = useState<string>();
  async function add() {
    const r = await api<ParameterView>("/api/parameters", { body: { name: row.name, unit: row.unit || null, limit_min: row.limit_min, limit_max: row.limit_max } });
    if (!r.ok) return setError(r.error);
    setRow({ name: "", unit: "", limit_min: "", limit_max: "" });
    setError(undefined);
    onAdded(r.data);
  }
  return (
    <Card className="border-dashed">
      <p className="mb-2 font-semibold">Add a daily check</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField label="Check" value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} placeholder="e.g. Free chlorine" />
        <TextField label="Unit" value={row.unit} onChange={(e) => setRow({ ...row, unit: e.target.value })} />
        <TextField label="Lowest allowed" inputMode="decimal" value={row.limit_min} onChange={(e) => setRow({ ...row, limit_min: e.target.value })} />
        <TextField label="Highest allowed" inputMode="decimal" value={row.limit_max} onChange={(e) => setRow({ ...row, limit_max: e.target.value })} />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button className="mt-3" onClick={add} disabled={!row.name.trim()}>
        Add check
      </Button>
    </Card>
  );
}

export function ParameterEditor({ initial }: { initial: ParameterView[] }) {
  const [params, setParams] = useState(initial);
  const replace = (p: ParameterView) => setParams((all) => all.map((x) => (x.id === p.id ? p : x)));
  return (
    <div className="space-y-3">
      <SectionTitle>Daily in-house checks</SectionTitle>
      {params
        .filter((p) => p.kind === "daily")
        .map((p) => (
          <ParameterRow key={p.id} p={p} onSaved={replace} />
        ))}
      <AddDailyCheck onAdded={(p) => setParams((all) => [...all, p])} />

      <SectionTitle>FSSAI Form 1 – monthly testing</SectionTitle>
      <p className="text-sm text-slate-500">The 16 columns of the government form. Their names and order are fixed; set the unit and limits.</p>
      {params
        .filter((p) => p.kind === "form1")
        .map((p) => (
          <ParameterRow key={p.id} p={p} onSaved={replace} />
        ))}
    </div>
  );
}
