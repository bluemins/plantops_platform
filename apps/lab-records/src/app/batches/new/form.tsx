"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";

export function NewBatchForm({ products, today }: { products: { id: string; label: string }[]; today: string }) {
  const [form, setForm] = useState({ batch_no: "", production_date: today, sku_id: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api<{ id: string }>("/api/batches", { body: { ...form, sku_id: form.sku_id || null } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/batches/${r.data.id}`);
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Batch number"
          value={form.batch_no}
          onChange={(e) => setForm({ ...form, batch_no: e.target.value.toUpperCase() })}
          placeholder="e.g. B-1004"
          autoCapitalize="characters"
          autoFocus
          required
        />
        <TextField label="Production date" type="date" max={today} value={form.production_date} onChange={(e) => setForm({ ...form, production_date: e.target.value })} required />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Product</span>
          <select
            value={form.sku_id}
            onChange={(e) => setForm({ ...form, sku_id: e.target.value })}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base"
          >
            <option value="">{products.length ? "Choose a product (optional)" : "No products set up yet (optional)"}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            Create batch
          </Button>
          <a href="/" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            Cancel
          </a>
        </div>
      </form>
    </Card>
  );
}
