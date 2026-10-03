"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { ROLE_LABELS } from "@/lib/api";

/** A user as both the owner's and super_admin's user lists return it. */
export type UserView = {
  id: string;
  username: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  status: "active" | "disabled";
  secret_kind: "pin" | "password";
  must_change_secret: boolean;
  locked: boolean;
};

const ROLES = Object.keys(ROLE_LABELS);

export function RolePicker({ value, onChange }: { value: string[]; onChange: (roles: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${on ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {ROLE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}

/** Shown once: a temporary PIN/password the admin passes on to the user. */
export function TempSecret({ info, onClose }: { info: { who: string; secret: string; kind: string }; onClose: () => void }) {
  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="text-slate-800">
        Temporary {info.kind === "pin" ? "PIN" : "password"} for <b>{info.who}</b>:
      </p>
      <p className="my-2 font-mono text-3xl font-bold tracking-widest">{info.secret}</p>
      <p className="text-sm text-slate-600">Give this to them now - it will not be shown again. They must change it when they next log in.</p>
      <Button variant="secondary" className="mt-3" onClick={onClose}>Done</Button>
    </Card>
  );
}

/** Name, username (super_admin only), mobile, email and roles. `save` returns an error message or nothing. */
export function UserEditForm({
  user,
  canEditUsername,
  save,
  onClose,
}: {
  user: UserView;
  canEditUsername?: boolean;
  save: (body: Record<string, unknown>) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    username: user.username,
    display_name: user.display_name,
    phone: user.phone ?? "",
    email: user.email ?? "",
    roles: user.roles,
  });
  const [error, setError] = useState<string>();
  const ownerChange = form.roles.includes("tenant_admin") !== user.roles.includes("tenant_admin");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { username, ...details } = form;
    const body: Record<string, unknown> = { ...details };
    if (canEditUsername && username.trim().toLowerCase() !== user.username) {
      if (!confirm(`Change username to "${username.trim().toLowerCase()}"? ${user.display_name} is logged out and must log in with the new username.`)) return;
      body.username = username;
    }
    setError(await save(body));
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <TextField label="Name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
      {canEditUsername && (
        <TextField label="Username (for login)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required />
      )}
      <TextField label="Mobile (for WhatsApp alerts)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoCapitalize="none" />
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Roles</span>
        <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
      </div>
      {ownerChange && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Owners log in with a password, staff with a PIN. They log in once more with their current one and are then asked to
          set a new {form.roles.includes("tenant_admin") ? "password (10+ characters)" : "6-digit PIN"}.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">Save</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

/** New temporary PIN/password: typed by the admin, or random if left blank. */
export function ResetSecretForm({
  user,
  reset,
  onClose,
}: {
  user: UserView;
  reset: (secret: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string>();
  const pin = user.secret_kind === "pin";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(await reset(secret));
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <TextField
        label={pin ? "New temporary PIN (6 digits) - leave blank for a random one" : "New temporary password (10+ characters) - leave blank for a random one"}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        inputMode={pin ? "numeric" : undefined}
        maxLength={pin ? 6 : 100}
        autoComplete="off"
      />
      <p className="text-sm text-slate-500">{user.display_name} is logged out and must choose their own {pin ? "PIN" : "password"} at next login.</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">Reset {pin ? "PIN" : "password"}</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

/** One user card with Edit / Reset / Unlock / Disable actions; the page supplies the API calls. */
export function UserCard({
  user,
  canEditUsername,
  patch,
  reset,
  unlock,
  onTemp,
}: {
  user: UserView;
  canEditUsername?: boolean;
  patch: (body: Record<string, unknown>) => Promise<string | undefined>;
  reset: (secret: string) => Promise<{ error?: string; temporary_secret?: string; secret_kind?: string }>;
  unlock?: () => Promise<string | undefined>;
  onTemp: (info: { who: string; secret: string; kind: string }) => void;
}) {
  const [mode, setMode] = useState<"edit" | "reset">();
  const [error, setError] = useState<string>();
  const run = async (p: Promise<string | undefined>) => setError(await p);

  return (
    <Card className={user.status === "disabled" ? "opacity-60" : ""}>
      <p className="text-lg font-semibold">{user.display_name}</p>
      <p className="text-sm text-slate-500">
        {user.username} · {user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
        {user.status === "disabled" && " · disabled"}
        {user.must_change_secret && " · has not set own " + (user.secret_kind === "pin" ? "PIN" : "password") + " yet"}
        {user.locked && <span className="ml-1 rounded bg-red-100 px-2 text-red-700">locked</span>}
      </p>
      {(user.phone || user.email) && (
        <p className="text-sm text-slate-500">{[user.phone, user.email].filter(Boolean).join(" · ")}</p>
      )}

      {mode === "edit" && (
        <UserEditForm
          user={user}
          canEditUsername={canEditUsername}
          onClose={() => setMode(undefined)}
          save={async (body) => {
            const err = await patch(body);
            if (!err) setMode(undefined);
            return err;
          }}
        />
      )}
      {mode === "reset" && (
        <ResetSecretForm
          user={user}
          onClose={() => setMode(undefined)}
          reset={async (secret) => {
            const r = await reset(secret);
            if (r.error) return r.error;
            setMode(undefined);
            onTemp({ who: user.display_name, secret: r.temporary_secret!, kind: r.secret_kind! });
          }}
        />
      )}
      {!mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMode("edit")}>Edit</Button>
          <Button variant="secondary" onClick={() => setMode("reset")}>Reset {user.secret_kind === "pin" ? "PIN" : "password"}</Button>
          {user.locked && unlock && <Button variant="secondary" onClick={() => run(unlock())}>Unlock</Button>}
          <Button
            variant={user.status === "active" ? "danger" : "secondary"}
            onClick={() => run(patch({ status: user.status === "active" ? "disabled" : "active" }))}
          >
            {user.status === "active" ? "Disable" : "Enable"}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
