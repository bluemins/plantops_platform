"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api, ROLE_LABELS } from "@/lib/api";
import { PlanFields, planBody, type PlanFormValue } from "@/lib/plan-form";

type Tenant = {
  id: string;
  code: string;
  name: string;
  status: "active" | "suspended";
  plan: { plan_name: string; enabled_modules: string[]; limits: { platform: { max_users?: number }; modules: Record<string, unknown> }; renews_on: string | null } | null;
  users: { id: string; username: string; display_name: string; status: string; roles: string[] }[];
};

export default function TenantPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Tenant>();
  const [plan, setPlan] = useState<PlanFormValue>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [owner, setOwner] = useState({ username: "", display_name: "" });

  const show = useCallback((data: Tenant) => {
    setT(data);
    setPlan({
      plan_name: data.plan?.plan_name ?? "",
      enabled_modules: data.plan?.enabled_modules ?? [],
      max_users: String(data.plan?.limits.platform.max_users ?? ""),
      renews_on: data.plan?.renews_on ?? "",
    });
  }, []);

  useEffect(() => {
    api<Tenant>(`/api/super/tenants/${id}`).then((r) => {
      if (r.status === 401) return router.replace("/super/login");
      if (!r.ok) return setError(r.error);
      show(r.data);
    });
  }, [id, router, show]);

  async function run(path: string, method: string, body: unknown, done?: (data: any) => void) {
    setError(undefined);
    setNotice(undefined);
    const r = await api(path, { method, body });
    if (!r.ok) return setError(r.error);
    done?.(r.data);
  }

  if (!t || !plan) return <ErrorText>{error}</ErrorText>;
  const owners = t.users.filter((u) => u.roles.includes("tenant_admin"));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.name} <span className="text-base text-slate-500">({t.code})</span></h1>
        <Link href="/super" className="text-blue-700">All plants</Link>
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <Card className="border-amber-300 bg-amber-50 font-mono">{notice}</Card>}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Plan</h2>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(`/api/super/tenants/${id}/plan`, "PUT", planBody(plan, t.plan?.limits.modules), (d) => {
              show(d);
              setNotice("Plan saved.");
            });
          }}
          className="space-y-3"
        >
          <PlanFields value={plan} onChange={setPlan} />
          <Button type="submit">Save plan</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Owners</h2>
        {owners.map((u) => (
          <div key={u.id} className="flex items-center justify-between border-b border-slate-100 py-2">
            <span>{u.display_name} <span className="text-sm text-slate-500">({u.username})</span></span>
            <Button
              variant="secondary"
              onClick={() =>
                run(`/api/super/tenants/${id}/admins/${u.id}/reset-password`, "POST", {}, (d) =>
                  setNotice(`Temporary password for ${u.username}: ${d.temporary_password}`),
                )
              }
            >
              Reset password
            </Button>
          </div>
        ))}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(`/api/super/tenants/${id}/admins`, "POST", owner, async (d) => {
              setNotice(`Owner ${owner.username} added. Temporary password: ${d.temporary_secret}`);
              setOwner({ username: "", display_name: "" });
              const r = await api<Tenant>(`/api/super/tenants/${id}`);
              if (r.ok) show(r.data);
            });
          }}
          className="mt-3 grid grid-cols-2 gap-3"
        >
          <TextField label="Name" value={owner.display_name} onChange={(e) => setOwner({ ...owner, display_name: e.target.value })} required />
          <TextField label="Username" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value })} autoCapitalize="none" required />
          <Button type="submit" variant="secondary" className="col-span-2">Add owner</Button>
        </form>
        <p className="mt-3 text-sm text-slate-500">
          {t.users.length} users in total: {t.users.map((u) => `${u.display_name} (${u.roles.map((r) => ROLE_LABELS[r]).join(", ")})`).join("; ")}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Status: {t.status}</h2>
        <Button
          variant={t.status === "active" ? "danger" : "primary"}
          onClick={() => {
            const next = t.status === "active" ? "suspended" : "active";
            if (next === "suspended" && !confirm(`Suspend ${t.name}? Everyone in this plant is logged out immediately.`)) return;
            run(`/api/super/tenants/${id}`, "PATCH", { status: next }, show);
          }}
        >
          {t.status === "active" ? "Suspend plant" : "Reactivate plant"}
        </Button>
      </Card>
    </div>
  );
}
