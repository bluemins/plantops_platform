"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { MODULES } from "@/lib/modules";

type Mod = { id: keyof typeof MODULES; name: string; base_url: string | null; secret_set: boolean; status: "active" | "disabled"; ready: boolean };

/** super_admin: where each module app lives, its client secret, and the switch for all plants. */
export default function ModulesPage() {
  const router = useRouter();
  const [mods, setMods] = useState<Mod[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<{ module: string; value: string }>();

  const load = useCallback(async () => {
    const r = await api<Mod[]>("/api/super/modules");
    if (r.status === 401) return router.replace("/super/login");
    if (!r.ok) return setError(r.error);
    setMods(r.data);
  }, [router]);
  useEffect(() => void load(), [load]);

  async function patch(id: string, body: unknown) {
    setError(undefined);
    const r = await api(`/api/super/modules/${id}`, { method: "PATCH", body });
    if (!r.ok) return setError(r.error);
    setEditing(undefined);
    load();
  }

  async function rotate(m: Mod) {
    if (m.secret_set && !confirm(`New secret for ${m.name}? The current one stops working at once - the module must be updated with the new one.`)) return;
    setError(undefined);
    const r = await api<{ client_secret: string }>(`/api/super/modules/${m.id}/secret`, { body: {} });
    if (!r.ok) return setError(r.error);
    setSecret({ module: m.name, value: r.data.client_secret });
    load();
  }

  if (!mods) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Modules</h1>
        <Link href="/super" className="font-medium text-(--brand)">All plants</Link>
      </div>
      <p className="text-sm text-slate-500">
        A module works when it has a URL and a secret and is switched on. Which plants may use it is set in each plant's plan.
      </p>
      {secret && (
        <Card className="border-amber-300 bg-amber-50">
          <p>New client secret for <b>{secret.module}</b>. Put it in that module's settings (MODULE_SECRET). Shown only once:</p>
          <p className="my-2 font-mono text-sm break-all">{secret.value}</p>
          <Button variant="secondary" onClick={() => setSecret(undefined)}>Done</Button>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      {mods.map((m) => (
        <Card key={m.id} className={m.status === "disabled" ? "opacity-70" : ""}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-semibold">{MODULES[m.id]?.icon} {m.name}</p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.ready ? "bg-green-100 text-green-800" : m.status === "disabled" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
              {m.status === "disabled" ? "Switched off" : m.ready ? "Active" : "Not set up"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">URL: {m.base_url ?? "not set"} · Secret: {m.secret_set ? "set" : "not set"}</p>
          {editing === m.id ? (
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                patch(m.id, { base_url: url.trim() || null });
              }}
            >
              <TextField label="Module URL" className="flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://lab.example.com" autoCapitalize="none" />
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(undefined)}>Cancel</Button>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setEditing(m.id); setUrl(m.base_url ?? ""); }}>Change URL</Button>
              <Button variant="secondary" onClick={() => rotate(m)}>{m.secret_set ? "New secret" : "Create secret"}</Button>
              {m.status === "active" ? (
                <Button
                  variant="danger"
                  onClick={() => confirm(`Switch ${m.name} off for ALL plants? Nobody can open it, and people inside it are logged out within about 5 minutes. Plant plans keep their settings.`) && patch(m.id, { status: "disabled" })}
                >
                  Switch off for all plants
                </Button>
              ) : (
                <Button onClick={() => patch(m.id, { status: "active" })}>Switch on</Button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
