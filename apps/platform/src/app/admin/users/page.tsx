"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { RolePicker, TempSecret, UserCard, type UserView } from "@/lib/user-form";

const emptyForm = { username: "", display_name: "", phone: "", email: "", roles: [] as string[] };

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserView[]>();
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ who: string; secret: string; kind: string }>();
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const r = await api<UserView[]>("/api/admin/users");
    if (r.status === 401) return router.replace("/login");
    if (!r.ok) return setError(r.error);
    setUsers(r.data);
  }, [router]);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const r = await api("/api/admin/users", { body: form });
    if (!r.ok) return setError(r.error);
    setTemp({ who: form.display_name, secret: r.data.temporary_secret, kind: r.data.secret_kind });
    setForm(emptyForm);
    load();
  }

  /** Runs an API call for one user; returns the error message (if any) and reloads the list on success. */
  async function act(path: string, method: string, body: unknown) {
    const r = await api(path, { method, body });
    if (!r.ok) return { error: r.error, data: r.data };
    load();
    return { data: r.data };
  }

  if (!users) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <Link href="/home" className="text-(--brand) font-medium">Back</Link>
      </div>
      {temp && <TempSecret info={temp} onClose={() => setTemp(undefined)} />}
      <ErrorText>{error}</ErrorText>

      {users.map((u) => (
        <UserCard
          key={u.id}
          user={u}
          onTemp={setTemp}
          patch={async (body) => (await act(`/api/admin/users/${u.id}`, "PATCH", body)).error}
          reset={async (secret) => {
            const r = await act(`/api/admin/users/${u.id}/reset-secret`, "POST", { secret });
            return { error: r.error, ...r.data };
          }}
          unlock={async () => (await act(`/api/admin/users/${u.id}/unlock`, "POST", {})).error}
        />
      ))}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Add a user</h2>
        <form onSubmit={create} className="space-y-3">
          <TextField label="Name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
          <TextField label="Username (for login)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required />
          <TextField label="Mobile (for WhatsApp alerts, optional)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextField label="Email (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoCapitalize="none" />
          <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
          <Button type="submit" className="w-full">Add user</Button>
        </form>
      </Card>
    </div>
  );
}
