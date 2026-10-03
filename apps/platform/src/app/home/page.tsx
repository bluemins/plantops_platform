"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card } from "@plantops/ui";
import { api, MODULE_LABELS, ROLE_LABELS } from "@/lib/api";

type Me = { display_name: string; roles: string[]; must_change_secret: boolean; modules: string[] };

/** Placeholder after login. The real launcher (module tiles) is Phase 2. */
export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<Me>("/api/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      if (r.data.must_change_secret) return router.replace("/change-secret");
      setMe(r.data);
    });
  }, [router]);

  async function logout() {
    await api("/api/auth/logout", { body: {} });
    router.replace("/login");
  }

  // Simple module buttons until the Phase 2 launcher tiles replace them.
  async function open(module: string) {
    setError(undefined);
    const r = await api<{ redirect_url: string }>("/api/sso/handoff", { body: { module } });
    if (!r.ok) return setError(r.error);
    window.location.href = r.data.redirect_url;
  }

  if (!me) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Hello, {me.display_name}</h1>
      <Card>
        <p className="text-slate-700">You are logged in as: {me.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}.</p>
        <p className="mt-2 text-sm text-slate-500">Full module tiles arrive in Phase 2. For now, open a module here:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {me.modules.length === 0 && <p className="text-sm text-slate-500">No modules available for you yet.</p>}
          {me.modules.map((m) => (
            <Button key={m} onClick={() => open(m)}>Open {MODULE_LABELS[m] ?? m}</Button>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </Card>
      <div className="flex flex-wrap gap-2">
        {me.roles.includes("tenant_admin") && (
          <Link href="/admin/users"><Button>Manage users</Button></Link>
        )}
        <Link href="/change-secret"><Button variant="secondary">Change PIN / password</Button></Link>
        <Button variant="secondary" onClick={logout}>Log out</Button>
      </div>
    </div>
  );
}
