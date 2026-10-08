"use client";

import { useEffect, useState } from "react";
import { Card } from "@plantops/ui";
import { api } from "@/lib/api";
import { MODULES } from "@/lib/modules";

export type Tile = {
  module: keyof typeof MODULES;
  state: "open" | "off" | "locked";
  view: "owner" | "staff";
  locked_reason?: "not_enabled" | "addon";
};
export type PlanSummary = {
  plan_name: string | null;
  modules_enabled: number;
  modules_total: number;
  users_active: number;
  max_users: number | null;
  renews_on: string | null;
};
type Summary = { state: "ok"; badges: { text: string; tone: "ok" | "info" | "warn" | "danger" }[] } | { state: "unavailable" };

const TONES = {
  ok: "bg-green-100 text-green-800",
  info: "bg-(--brand-soft) text-(--brand)",
  warn: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700",
};

function Badge({ text, className }: { text: string; className: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{text}</span>;
}

/** Live numbers for one tile, fetched when the tile appears (each tile on its own, so one slow module never blocks). */
function TileNumbers({ url }: { url: string }) {
  const [s, setS] = useState<Summary>();
  useEffect(() => {
    let live = true;
    api<Summary>(url).then((r) => live && setS(r.ok ? r.data : { state: "unavailable" }));
    return () => {
      live = false;
    };
  }, [url]);
  if (!s) return <span className="inline-block h-5 w-24 animate-pulse rounded-full bg-slate-100" />;
  if (s.state === "unavailable") return <Badge text="Numbers unavailable right now" className="bg-slate-100 text-slate-500" />;
  if (!s.badges.length) return <Badge text="All clear" className={TONES.ok} />;
  return (
    <span className="flex flex-wrap gap-1">
      {s.badges.map((b, i) => <Badge key={i} text={b.text} className={TONES[b.tone]} />)}
    </span>
  );
}

function TileCard({ tile, summaryUrl, openHref }: { tile: Tile; summaryUrl: string; openHref: string | null }) {
  const m = MODULES[tile.module];
  const dim = tile.state !== "open";
  const subtitle =
    tile.state === "locked"
      ? tile.locked_reason === "addon" ? "Add-on service" : "Not enabled"
      : tile.view === "owner" ? "Read-only summary" : m.staff;
  const body = (
    <Card className={`h-full ${dim ? "border-dashed bg-slate-50/60" : openHref ? "transition hover:border-(--brand-ring) hover:shadow" : ""}`}>
      <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-xl ${dim ? "bg-slate-100 opacity-60" : "bg-(--brand-soft)"}`}>{m.icon}</div>
      <p className={`font-semibold ${dim ? "text-slate-400" : "text-slate-900"}`}>{m.label}</p>
      <p className={`mb-2 text-sm ${dim ? "text-slate-400" : "text-slate-500"}`}>{subtitle}</p>
      {tile.state === "open" && <TileNumbers url={summaryUrl} />}
      {tile.state === "off" && <Badge text="Temporarily unavailable" className="bg-slate-100 text-slate-500" />}
      <p className={`mt-3 text-sm font-semibold ${dim ? "text-slate-400" : "text-(--brand)"}`}>
        {tile.state === "locked" ? "🔒 Locked" : tile.state === "off" ? "" : openHref ? "Open →" : ""}
      </p>
    </Card>
  );
  if (!openHref || tile.state !== "open") return body;
  const card = <a href={openHref} className="block h-full">{body}</a>;
  // owner only: a second link straight to the module's setup screen (through the same one-time-code handoff)
  if (tile.view !== "owner" || !m.setup) return card;
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex-1">{card}</div>
      <a href={`${openHref}&next=${encodeURIComponent(m.setup.path)}`} className="px-1 py-2 text-sm font-semibold text-(--brand)">
        {m.setup.label}
      </a>
    </div>
  );
}

/**
 * Module tiles in a 2-column grid. `openHref(module)` = where a tap goes (null = read-only, e.g. super_admin).
 * `summaryUrl(module)` = where the live numbers come from.
 */
export function LauncherTiles({
  tiles,
  summaryUrl,
  openHref,
}: {
  tiles: Tile[];
  summaryUrl: (module: string) => string;
  openHref: ((module: string) => string) | null;
}) {
  if (!tiles.length) return <Card><p className="text-slate-500">No modules are available for your account yet. Ask your plant owner.</p></Card>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <TileCard key={t.module} tile={t} summaryUrl={summaryUrl(t.module)} openHref={openHref ? openHref(t.module) : null} />
      ))}
    </div>
  );
}

const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function PlanCard({ plan }: { plan: PlanSummary }) {
  const rows: [string, string][] = [
    ["Plan", plan.plan_name ?? "-"],
    ["Modules enabled", `${plan.modules_enabled} of ${plan.modules_total}`],
    ["Users", plan.max_users ? `${plan.users_active} / ${plan.max_users}` : String(plan.users_active)],
    ["Renews", plan.renews_on ? formatDate(plan.renews_on) : "-"],
  ];
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Plan summary</h2>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-t border-dashed border-slate-200 py-2 text-sm">
          <span className="text-slate-600">{k}</span>
          <span className="font-semibold">{v}</span>
        </div>
      ))}
    </Card>
  );
}
