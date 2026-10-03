"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { brandStyle, Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { LauncherTiles, PlanCard, type PlanSummary, type Tile } from "@/lib/launcher-tiles";
import { MODULES } from "@/lib/modules";

type Plant = { id: string; code: string; name: string; status: string };
type View = { plant: { name: string; code: string; brand_color: string | null; logo_url: string | null }; tiles: Tile[]; plan_summary: PlanSummary };

const KEY = "plantops.super.dashboardPlant";
/** Modules that already have the read-only support view (built per module from Phase 3). */
const SUPPORT_READY: string[] = ["lab_records"];

/** super_admin: pick a plant and see its tiles and plan exactly as its owner does (read-only). */
export default function SuperDashboard() {
  const router = useRouter();
  const [plants, setPlants] = useState<Plant[]>();
  const [id, setId] = useState("");
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<Plant[]>("/api/super/tenants").then((r) => {
      if (r.status === 401) return router.replace("/super/login");
      if (!r.ok) return setError(r.error);
      setPlants(r.data);
      let saved = "";
      try {
        saved = localStorage.getItem(KEY) ?? "";
      } catch {}
      setId(r.data.some((p) => p.id === saved) ? saved : (r.data[0]?.id ?? ""));
    });
  }, [router]);

  useEffect(() => {
    if (!id) return;
    setView(undefined);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
    api<View>(`/api/super/tenants/${id}/launcher`).then((r) => (r.ok ? setView(r.data) : setError(r.error)));
  }, [id]);

  async function openSupport(module: string) {
    const r = await api<{ redirect_url: string }>(`/api/super/tenants/${id}/support/${module}`, { body: {} });
    if (!r.ok) return setError(r.error);
    window.location.assign(r.data.redirect_url); // "Exit" in the module brings you back here
  }

  if (!plants) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plant dashboard</h1>
        <Link href="/super" className="font-medium text-(--brand)">All plants</Link>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Plant</span>
        <select value={id} onChange={(e) => setId(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
          {plants.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.code}){p.status === "suspended" ? " - suspended" : ""}</option>
          ))}
        </select>
      </label>
      <ErrorText>{error}</ErrorText>
      {view && (
        // The plant's own brand colour, as its people see it.
        <div className="space-y-4" style={brandStyle(view.plant.brand_color) as CSSProperties}>
          <p className="text-sm text-slate-500">Live numbers from each module, as the owner of {view.plant.name} sees them. Read-only.</p>
          <LauncherTiles tiles={view.tiles} summaryUrl={(m) => `/api/super/tenants/${id}/summary/${m}`} openHref={null} />
          {view.tiles.some((t) => t.state === "open" && SUPPORT_READY.includes(t.module)) && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Support view: open a module&apos;s data read-only. The plant owner sees every page you open.</p>
              <div className="flex flex-wrap gap-2">
                {view.tiles
                  .filter((t) => t.state === "open" && SUPPORT_READY.includes(t.module))
                  .map((t) => (
                    <Button key={t.module} variant="secondary" onClick={() => openSupport(t.module)}>
                      Open {MODULES[t.module].label} (read-only)
                    </Button>
                  ))}
              </div>
            </div>
          )}
          <PlanCard plan={view.plan_summary} />
        </div>
      )}
    </div>
  );
}
