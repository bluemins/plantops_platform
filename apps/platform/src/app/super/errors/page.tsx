"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText } from "@plantops/ui";
import type { ModuleId } from "@plantops/types";
import { api } from "@/lib/api";
import { MODULES } from "@/lib/modules";

type Group = {
  app: string;
  kind: string;
  method: string;
  path: string;
  message: string;
  count: number;
  first_at: string;
  last_at: string;
  plants: string[];
  stack: string | null;
};
type Log = { groups: Group[]; yesterday: number; today: number };

const appName = (app: string) => (app === "platform" ? "PlantOps (platform)" : (MODULES[app as ModuleId]?.label ?? app));
const KIND: Record<string, string> = { api: "action / data", page: "screen", action: "form", proxy: "login check" };
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** super_admin: server errors of the platform and every module, last 7 days (STABILITY_PLAN B-09). Plants never see it. */
export default function ErrorsPage() {
  const router = useRouter();
  const [log, setLog] = useState<Log>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number>();

  const load = useCallback(async () => {
    const r = await api<Log>("/api/super/errors");
    if (r.status === 401) return router.replace("/super/login");
    if (!r.ok) return setError(r.error);
    setLog(r.data);
  }, [router]);
  useEffect(() => void load(), [load]);

  if (!log) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Errors</h1>
        <Link href="/super" className="font-medium text-(--brand)">All plants</Link>
      </div>
      <p className="text-sm text-slate-500">
        Server errors of PlantOps and every module, last 7 days (kept 30 days). Today {log.today} · yesterday {log.yesterday}. The same error on the
        same address is shown once with how many times it happened. Plants never see this page.
      </p>
      <ErrorText>{error}</ErrorText>
      {log.groups.length === 0 && <Card><p className="text-slate-600">No errors in the last 7 days.</p></Card>}
      {log.groups.map((g, i) => (
        <Card key={`${g.app}${g.method}${g.path}${g.message}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{appName(g.app)}</p>
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">{g.count} {g.count === 1 ? "time" : "times"}</span>
          </div>
          <p className="mt-1 break-words font-mono text-sm">{g.message}</p>
          <p className="mt-1 text-sm text-slate-600">
            {g.method} {g.path} · {KIND[g.kind] ?? g.kind} · {g.plants.length ? `plant ${g.plants.join(", ")}` : "no plant"}
          </p>
          <p className="text-sm text-slate-500">Last {when(g.last_at)}{g.count > 1 ? ` · first ${when(g.first_at)}` : ""}</p>
          {g.stack && (
            <div className="mt-2">
              <Button variant="secondary" onClick={() => setOpen(open === i ? undefined : i)}>{open === i ? "Hide details" : "Details"}</Button>
              {open === i && <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{g.stack}</pre>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
