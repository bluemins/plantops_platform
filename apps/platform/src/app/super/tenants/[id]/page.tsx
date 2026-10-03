"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { BusinessSections } from "@/lib/business-form";
import { PlanFields, moduleLimitFormValues, planBody, type PlanFormValue } from "@/lib/plan-form";
import { TempSecret, UserCard, type UserView } from "@/lib/user-form";

type Tenant = {
  id: string;
  code: string;
  name: string;
  status: "active" | "suspended";
  plan: { plan_name: string; enabled_modules: string[]; limits: { platform: { max_users?: number }; modules: Record<string, unknown> }; renews_on: string | null } | null;
  users: UserView[];
};

export default function TenantPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Tenant>();
  const [plan, setPlan] = useState<PlanFormValue>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [owner, setOwner] = useState({ username: "", display_name: "" });
  const [code, setCode] = useState("");
  const [temp, setTemp] = useState<{ who: string; secret: string; kind: string }>();

  const show = useCallback((data: Tenant) => {
    setT(data);
    setCode(data.code);
    setPlan({
      plan_name: data.plan?.plan_name ?? "",
      enabled_modules: data.plan?.enabled_modules ?? [],
      max_users: String(data.plan?.limits.platform.max_users ?? ""),
      renews_on: data.plan?.renews_on ?? "",
      ...moduleLimitFormValues(data.plan?.limits.modules),
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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.name} <span className="text-base text-slate-500">({t.code})</span></h1>
        <Link href="/super" className="text-(--brand) font-medium">All plants</Link>
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <Card className="border-amber-300 bg-amber-50 font-mono">{notice}</Card>}

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Plant code</h2>
        <p className="mb-3 text-sm text-slate-500">Everyone in this plant types it at login. People already logged in stay logged in.</p>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const next = code.trim().toUpperCase();
            if (next === t.code) return;
            if (!confirm(`Change plant code from ${t.code} to ${next}? Tell the plant: from now on they log in with ${next}.`)) return;
            run(`/api/super/tenants/${id}`, "PATCH", { code: next }, (d) => {
              show(d);
              setNotice(`Plant code changed to ${d.code}.`);
            });
          }}
          className="flex items-end gap-2"
        >
          <TextField label="Plant code" className="flex-1" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" required />
          <Button type="submit" variant="secondary">Change code</Button>
        </form>
      </Card>

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

      <h2 className="pt-2 text-xl font-bold">Users ({t.users.length})</h2>
      <p className="text-sm text-slate-500">
        Owners and staff of this plant. Changing a username or resetting a PIN/password logs that person out. A reset also
        unlocks them.
      </p>
      {temp && <TempSecret info={temp} onClose={() => setTemp(undefined)} />}
      {t.users.map((u) => (
        <UserCard
          key={u.id}
          user={u}
          canEditUsername
          onTemp={setTemp}
          patch={async (body) => {
            const r = await api<Tenant>(`/api/super/tenants/${id}/users/${u.id}`, { method: "PATCH", body });
            if (!r.ok) return r.error;
            show(r.data);
          }}
          reset={async (secret) => {
            const r = await api(`/api/super/tenants/${id}/users/${u.id}/reset-secret`, { body: { secret } });
            if (!r.ok) return { error: r.error };
            const fresh = await api<Tenant>(`/api/super/tenants/${id}`);
            if (fresh.ok) show(fresh.data);
            return r.data;
          }}
        />
      ))}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Add an owner</h2>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(`/api/super/tenants/${id}/admins`, "POST", owner, async (d) => {
              setTemp({ who: owner.display_name, secret: d.temporary_secret, kind: d.secret_kind });
              setOwner({ username: "", display_name: "" });
              const r = await api<Tenant>(`/api/super/tenants/${id}`);
              if (r.ok) show(r.data);
            });
          }}
          className="grid grid-cols-2 gap-3"
        >
          <TextField label="Name" value={owner.display_name} onChange={(e) => setOwner({ ...owner, display_name: e.target.value })} required />
          <TextField label="Username" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value })} autoCapitalize="none" required />
          <Button type="submit" variant="secondary" className="col-span-2">Add owner</Button>
        </form>
        <p className="mt-2 text-sm text-slate-500">Staff are added by the plant owner.</p>
      </Card>

      <BusinessSections
        businessUrl={`/api/super/tenants/${id}/business`}
        skusUrl={`/api/super/tenants/${id}/skus`}
        onSaved={(b) => setT((prev) => prev && { ...prev, name: b.name })}
      />

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
