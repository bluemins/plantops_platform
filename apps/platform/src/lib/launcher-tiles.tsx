"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@plantops/ui";
import { api } from "@/lib/api";
import { MODULES } from "@/lib/modules";

export type Tile = {
  module: keyof typeof MODULES;
  state: "open" | "off" | "locked";
  view: "owner" | "staff";
  subtitle?: string;
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
      : tile.view === "owner" ? "Read-only summary" : (tile.subtitle ?? m.staff);
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

/**
 * "Arrange tiles" (owner, 2026-11-01): the tiles this person can open as a list with ↑ / ↓, saved to their account so
 * every phone / PC shows the same order. Locked tiles are not listed: they always stay last.
 */
export function ArrangeTiles({ tiles, onDone }: { tiles: Tile[]; onDone: (saved: Tile[] | "reload" | null) => void }) {
  const [list, setList] = useState(() => tiles.filter((t) => t.state !== "locked"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const locked = tiles.filter((t) => t.state === "locked");

  function move(i: number, by: -1 | 1) {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setList(next);
  }
  async function save(modules: string[]) {
    setBusy(true);
    setError(undefined);
    const r = await api("/api/launcher/order", { method: "PUT", body: { modules } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // "Usual order": the server works it out, so the launcher loads again
    onDone(modules.length ? [...list, ...locked] : "reload");
  }

  return (
    <Card>
      <p className="mb-3 text-sm text-slate-600">Move the modules you use most to the top. Your order is kept on every phone and PC you log in from.</p>
      <ol className="divide-y divide-slate-100">
        {list.map((t, i) => (
          <li key={t.module} className="flex items-center gap-3 py-1.5">
            <span className="w-5 text-right text-sm text-slate-500">{i + 1}.</span>
            <span className="text-xl">{MODULES[t.module].icon}</span>
            <span className="flex-1 font-semibold">{MODULES[t.module].label}</span>
            <button type="button" aria-label={`Move ${MODULES[t.module].label} up`} disabled={i === 0 || busy} onClick={() => move(i, -1)} className="h-11 w-11 rounded-lg border border-slate-200 text-lg disabled:opacity-30">
              ↑
            </button>
            <button type="button" aria-label={`Move ${MODULES[t.module].label} down`} disabled={i === list.length - 1 || busy} onClick={() => move(i, 1)} className="h-11 w-11 rounded-lg border border-slate-200 text-lg disabled:opacity-30">
              ↓
            </button>
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => save(list.map((t) => t.module))}>Done</Button>
        <Button variant="secondary" disabled={busy} onClick={() => onDone(null)}>Cancel</Button>
        <Button variant="secondary" disabled={busy} onClick={() => save([])}>Usual order</Button>
      </div>
    </Card>
  );
}

const formatDate =(iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

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

/**
 * The owner's Reports card (docs/REPORTS_PHASE_PLAN.md): every report lives behind it (Sales now; more sections later).
 * Its number is last month's sales from Order Capture; it opens the Reports page there through the normal handoff.
 */
export function ReportsCard({ summaryUrl, openHref }: { summaryUrl: string; openHref: string }) {
  return <OwnerCard icon="📊" title="Reports" text="Sales by item and customer · by month, quarter, salesperson" summaryUrl={summaryUrl} openHref={openHref} />;
}

/**
 * The owner's Customers card (docs/CUSTOMER_PAGE_PHASE_PLAN.md): customers, money due and Zoho contacts to match, from
 * Sales; it opens the customer list there through the normal handoff. Marketing staff with an order role get it too
 * (v0.46.1), with their numbers: customers, added this week, without shop location.
 */
export function CustomersCard({ summaryUrl, openHref }: { summaryUrl: string; openHref: string }) {
  return <OwnerCard icon="👥" title="Customers" text="Details, bills, payments and statement for each customer" summaryUrl={summaryUrl} openHref={openHref} />;
}

/** Plant board (owner, 2026-11-14): everyone's whiteboard for planning the next day, on every person's launcher. */
export function BoardCard() {
  return <OwnerCard icon="📝" title="Plant board" text="Everyone can write · plan the next day" summaryUrl="/api/board/summary" openHref="/board" />;
}

function OwnerCard({ icon, title, text, summaryUrl, openHref }: { icon: string; title: string; text: string; summaryUrl: string; openHref: string }) {
  return (
    <a href={openHref} className="block h-full">
      <Card className="flex h-full items-center justify-between gap-3 border-(--brand) hover:bg-slate-50">
        <span className="min-w-0 space-y-1">
          <span className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden="true">{icon}</span> {title}
          </span>
          <span className="block text-sm text-slate-500">{text}</span>
          <TileNumbers url={summaryUrl} />
        </span>
        <span aria-hidden="true" className="text-xl text-(--brand)">→</span>
      </Card>
    </a>
  );
}
