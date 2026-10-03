"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api, ROLE_LABELS } from "@/lib/api";

type User = {
  id: string;
  username: string;
  display_name: string;
  phone: string | null;
  roles: string[];
  status: "active" | "disabled";
  secret_kind: "pin" | "password";
  locked: boolean;
};

const ROLES = Object.keys(ROLE_LABELS);

function RolePicker({ value, onChange }: { value: string[]; onChange: (roles: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${on ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {ROLE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}

/** Shown once: a temporary PIN/password the owner passes on to the user. */
function TempSecret({ info, onClose }: { info: { who: string; secret: string; kind: string }; onClose: () => void }) {
  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="text-slate-800">
        Temporary {info.kind === "pin" ? "PIN" : "password"} for <b>{info.who}</b>:
      </p>
      <p className="my-2 font-mono text-3xl font-bold tracking-widest">{info.secret}</p>
      <p className="text-sm text-slate-600">Give this to them now - it will not be shown again. They must change it when they first log in.</p>
      <Button variant="secondary" className="mt-3" onClick={onClose}>Done</Button>
    </Card>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>();
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ who: string; secret: string; kind: string }>();
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState({ username: "", display_name: "", phone: "", roles: [] as string[] });

  const load = useCallback(async () => {
    const r = await api<User[]>("/api/admin/users");
    if (r.status === 401) return router.replace("/login");
    if (!r.ok) return setError(r.error);
    setUsers(r.data);
  }, [router]);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const r = await api("/api/admin/users", { body: { ...form, phone: form.phone || undefined } });
    if (!r.ok) return setError(r.error);
    setTemp({ who: form.display_name, secret: r.data.temporary_secret, kind: r.data.secret_kind });
    setForm({ username: "", display_name: "", phone: "", roles: [] });
    load();
  }

  async function act(path: string, method: string, body: unknown, after?: (data: any) => void) {
    setError(undefined);
    const r = await api(path, { method, body });
    if (!r.ok) return setError(r.error);
    after?.(r.data);
    load();
  }

  if (!users) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <Link href="/home" className="text-blue-700">Back</Link>
      </div>
      {temp && <TempSecret info={temp} onClose={() => setTemp(undefined)} />}
      <ErrorText>{error}</ErrorText>

      {users.map((u) => (
        <Card key={u.id} className={u.status === "disabled" ? "opacity-60" : ""}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{u.display_name}</p>
              <p className="text-sm text-slate-500">
                {u.username} · {u.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                {u.status === "disabled" && " · disabled"}
                {u.locked && <span className="ml-1 rounded bg-red-100 px-2 text-red-700">locked</span>}
              </p>
            </div>
          </div>
          {editing === u.id ? (
            <div className="mt-3 space-y-3">
              <RolePicker value={u.roles} onChange={(roles) => act(`/api/admin/users/${u.id}`, "PATCH", { roles })} />
              <Button variant="secondary" onClick={() => setEditing(undefined)}>Close</Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(u.id)}>Roles</Button>
              <Button
                variant="secondary"
                onClick={() =>
                  act(`/api/admin/users/${u.id}/reset-secret`, "POST", {}, (d) =>
                    setTemp({ who: u.display_name, secret: d.temporary_secret, kind: d.secret_kind }),
                  )
                }
              >
                Reset {u.secret_kind === "pin" ? "PIN" : "password"}
              </Button>
              {u.locked && <Button variant="secondary" onClick={() => act(`/api/admin/users/${u.id}/unlock`, "POST", {})}>Unlock</Button>}
              <Button
                variant={u.status === "active" ? "danger" : "secondary"}
                onClick={() => act(`/api/admin/users/${u.id}`, "PATCH", { status: u.status === "active" ? "disabled" : "active" })}
              >
                {u.status === "active" ? "Disable" : "Enable"}
              </Button>
            </div>
          )}
        </Card>
      ))}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Add a user</h2>
        <form onSubmit={create} className="space-y-3">
          <TextField label="Name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
          <TextField label="Username (for login)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required />
          <TextField label="Mobile (for WhatsApp alerts, optional)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
          <Button type="submit" className="w-full">Add user</Button>
        </form>
      </Card>
    </div>
  );
}
