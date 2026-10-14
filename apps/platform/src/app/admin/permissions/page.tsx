"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api, ROLE_LABELS } from "@/lib/api";
import { moduleLabel } from "@/lib/modules";
import { cellFor, gridModules, ROLE_MEANINGS, type CellKind } from "@/lib/permissions";
import type { UserView } from "@/lib/user-form";

const CHIP: Record<CellKind, string> = {
  owner: "bg-(--brand) text-(--brand-contrast)",
  lead: "bg-violet-100 text-violet-900",
  work: "bg-(--brand-soft) text-slate-800",
  view: "bg-amber-100 text-amber-900",
};

/**
 * Owner only, read-only: one row per user, one column per module switched on for the plant (mock-up v0.14). Uses the
 * same user list as Manage users (the owner's own plant only); changes are made there.
 */
export default function PermissionsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserView[]>();
  const [enabled, setEnabled] = useState<string[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<UserView[]>("/api/admin/users").then((r) => {
      if (r.status === 401) return router.replace("/login");
      if (!r.ok) return setError(r.error);
      setUsers(r.data);
    });
    // modules switched on for this plant (locked tiles are the ones that aren't)
    api<{ tiles?: { module: string; state: string }[] }>("/api/launcher").then((r) => {
      if (r.ok) setEnabled((r.data.tiles ?? []).filter((t) => t.state !== "locked").map((t) => t.module));
      else setError(r.error);
    });
  }, [router]);

  if (!users || !enabled) return <ErrorText>{error}</ErrorText>;
  const mods = gridModules(enabled);
  const active = users.filter((u) => u.status === "active").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Who can do what</h1>
        <Link href="/home" className="text-(--brand) font-medium">Back</Link>
      </div>
      <p className="text-sm text-slate-500">
        {active} active user{active === 1 ? "" : "s"} · {mods.length} module{mods.length === 1 ? "" : "s"} switched on. 🔔 = gets that module&apos;s alerts. To change anything, use{" "}
        <Link href="/admin/users" className="font-medium text-(--brand)">Manage users</Link>.
      </p>

      {mods.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-600">No modules are switched on for your plant yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase shadow-[1px_0_0_#e2e8f0]">User</th>
                {mods.map((m) => (
                  <th key={m} scope="col" className="bg-slate-100 px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase">{moduleLabel(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const off = u.status !== "active";
                return (
                  <tr key={u.id} className={off ? "text-slate-400" : ""}>
                    <th scope="row" className={`sticky left-0 z-10 min-w-36 border-b border-slate-100 px-3 py-2.5 text-left align-top font-semibold shadow-[1px_0_0_#e2e8f0] ${off ? "bg-slate-50" : "bg-white"}`}>
                      {u.display_name}
                      <span className="block text-xs font-normal text-slate-500">{off ? "Disabled" : u.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "No role"}</span>
                    </th>
                    {mods.map((m) => {
                      const c = cellFor(u.roles, u.alert_modules ?? [], m);
                      return (
                        <td key={m} className="border-b border-slate-100 px-3 py-2.5 align-top">
                          {!c ? (
                            <span className="text-slate-300" aria-label="No access">–</span>
                          ) : off ? (
                            c.label
                          ) : (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP[c.kind]}`}>{c.label}</span>
                              {c.alerts && <span title="Gets alerts" aria-label="Gets alerts">🔔</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">What each one means</h2>
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {ROLE_MEANINGS.map((r) => (
            <li key={r.label} className="flex items-baseline gap-2">
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP[r.kind]}`}>{r.label}</span>
              <span>{r.text}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-2">
            <span className="shrink-0">🔔</span>
            <span>Gets that module&apos;s alerts (owners always do).</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
