"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { emptyPlan, PlanFields, planBody } from "@/lib/plan-form";

type Tenant = {
  id: string;
  code: string;
  name: string;
  status: string;
  active_users: number;
  plan: { plan_name: string; enabled_modules: string[]; limits: { platform: { max_users?: number } } } | null;
};

export default function SuperHome() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ code: string; username: string; password: string }>();
  const [form, setForm] = useState({ code: "", name: "", admin_name: "", admin_username: "", admin_phone: "" });
  const [plan, setPlan] = useState(emptyPlan);

  const load = useCallback(async () => {
    const r = await api<Tenant[]>("/api/super/tenants");
    if (r.status === 401) return router.replace("/super/login");
    if (!r.ok) return setError(r.error);
    setTenants(r.data);
  }, [router]);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const r = await api("/api/super/tenants", {
      body: {
        code: form.code,
        name: form.name,
        plan: planBody(plan),
        admin: { username: form.admin_username, display_name: form.admin_name, phone: form.admin_phone || undefined },
      },
    });
    if (!r.ok) return setError(r.error);
    setCreated({ code: r.data.code, username: form.admin_username.toLowerCase(), password: r.data.admin_temporary_password });
    setForm({ code: "", name: "", admin_name: "", admin_username: "", admin_phone: "" });
    setPlan(emptyPlan);
    load();
  }

  async function logout() {
    await api("/api/super/logout", { body: {} });
    router.replace("/super/login");
  }

  if (!tenants) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plants</h1>
        <div className="flex gap-2">
          <Link href="/super/change-password"><Button variant="secondary">Change password</Button></Link>
          <Button variant="secondary" onClick={logout}>Log out</Button>
        </div>
      </div>
      {created && (
        <Card className="border-amber-300 bg-amber-50">
          <p>Plant <b>{created.code}</b> created. Send the owner these login details:</p>
          <p className="my-2 font-mono">Plant code: {created.code}<br />Username: {created.username}<br />Temporary password: {created.password}</p>
          <p className="text-sm text-slate-600">Shown only once. The owner must change the password at first login.</p>
          <Button variant="secondary" className="mt-3" onClick={() => setCreated(undefined)}>Done</Button>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      {tenants.map((t) => (
        <Link key={t.id} href={`/super/tenants/${t.id}`} className="block">
          <Card className="hover:border-blue-400">
            <p className="text-lg font-semibold">{t.name} <span className="text-sm text-slate-500">({t.code})</span></p>
            <p className="text-sm text-slate-600">
              {t.status === "suspended" ? "Suspended · " : ""}
              {t.plan?.plan_name ?? "No plan"} · {t.plan?.enabled_modules.length ?? 0} modules · users {t.active_users}
              {t.plan?.limits.platform.max_users ? ` / ${t.plan.limits.platform.max_users}` : ""}
            </p>
          </Card>
        </Link>
      ))}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">New plant</h2>
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Plant code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoCapitalize="characters" required />
            <TextField label="Plant name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <PlanFields value={plan} onChange={setPlan} />
          <p className="pt-2 text-sm font-medium text-slate-700">Owner (tenant_admin)</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Owner name" value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} required />
            <TextField label="Owner username" value={form.admin_username} onChange={(e) => setForm({ ...form, admin_username: e.target.value })} autoCapitalize="none" required />
          </div>
          <TextField label="Owner mobile (optional)" type="tel" value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} />
          <Button type="submit" className="w-full">Create plant</Button>
        </form>
      </Card>
    </div>
  );
}
