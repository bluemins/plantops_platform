"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@plantops/ui";
import { api } from "@/lib/api";
import { LauncherTiles, PlanCard, type PlanSummary, type Tile } from "@/lib/launcher-tiles";

type Launcher = {
  must_change_secret: boolean;
  user: { display_name: string; roles: string[] };
  plant: { name: string; code: string; logo_url: string | null };
  tiles: Tile[];
  plan_summary: PlanSummary | null;
  landing: string;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The launcher: module tiles for this user's roles and plant plan (mockups in refeDocs/). */
export default function HomePage() {
  const [data, setData] = useState<Launcher>();

  useEffect(() => {
    api<Launcher>("/api/launcher").then((r) => {
      if (r.status === 401) return window.location.replace("/login");
      if (!r.ok) return;
      if (r.data.must_change_secret) return window.location.replace("/change-secret");
      // Staff with a single module go straight into it - unless they came back on purpose (?launcher=1).
      const wantsLauncher = new URLSearchParams(window.location.search).has("launcher");
      if (r.data.landing !== "launcher" && !wantsLauncher) return window.location.replace(`/sso/start?module=${r.data.landing}`);
      setData(r.data);
    });
  }, []);

  async function logout() {
    await api("/api/auth/logout", { body: {} });
    window.location.assign("/login"); // full reload: back to PlantOps colours
  }

  if (!data) return null;
  const owner = data.user.roles.includes("tenant_admin");
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <span className="text-xl font-bold">
          Plant<span className="text-(--brand)">Ops</span>
        </span>
        <div className="flex items-center gap-3 text-right">
          <div>
            <p className="font-semibold leading-tight">{data.user.display_name}</p>
            <p className="text-xs text-slate-500">{data.plant.name}</p>
          </div>
          {data.plant.logo_url ? (
            <img src={data.plant.logo_url} alt="" className="h-10 w-10 rounded-full border border-slate-200 bg-white object-contain" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--brand-soft) text-sm font-bold text-(--brand)">
              {initials(data.user.display_name)}
            </span>
          )}
        </div>
      </header>

      <div>
        <h1 className="text-2xl font-bold">{greeting()}, {data.user.display_name.split(" ")[0]}</h1>
        <p className="text-slate-500">{owner ? "Here's what's available for your account today." : "Tap a module to open it."}</p>
      </div>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Your modules</h2>
        <LauncherTiles
          tiles={data.tiles}
          summaryUrl={(m) => `/api/launcher/summary/${m}`}
          openHref={(m) => `/sso/start?module=${m}`}
        />
      </section>

      {data.plan_summary && <PlanCard plan={data.plan_summary} />}
      {owner && (
        <p className="text-center text-sm text-slate-500">
          Modules shown with a lock are not enabled for your plant yet. Contact PlantOps to add them.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        {owner && (
          <>
            <Link href="/admin/users"><Button>Manage users</Button></Link>
            <Link href="/admin/business"><Button>Business details</Button></Link>
          </>
        )}
        <Link href="/change-secret"><Button variant="secondary">Change PIN / password</Button></Link>
        <Button variant="secondary" onClick={logout}>Log out</Button>
      </div>
    </div>
  );
}
