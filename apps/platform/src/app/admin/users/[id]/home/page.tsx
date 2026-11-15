"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, ErrorText } from "@plantops/ui";
import { api, ROLE_LABELS } from "@/lib/api";
import { extraCards, LauncherTiles, type Tile } from "@/lib/launcher-tiles";
import { moduleLabel } from "@/lib/modules";

type Preview = { user: { display_name: string; status: string; roles: string[] }; tiles: Tile[]; landing: string };

/** A card above the tiles, drawn without its link or numbers (preview only). */
function StaticCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <Card className="h-full">
      <p className="font-semibold">{icon} {title}</p>
      <p className="text-sm text-slate-500">{text}</p>
    </Card>
  );
}

/**
 * Owner's preview of one person's home screen (owner 2026-11-15: "to be sure of their access rights"). Same tiles the
 * person gets, worked out on the server; nothing here opens a module, and the owner stays logged in as themselves.
 */
export default function UserHomePreview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Preview>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<Preview>(`/api/admin/users/${id}/launcher`).then((r) => {
      if (r.status === 401) return router.replace("/login");
      if (r.status === 403) return router.replace("/home");
      if (!r.ok) return setError(r.error);
      setData(r.data);
    });
  }, [id, router]);

  if (!data) return <ErrorText>{error}</ErrorText>;
  const name = data.user.display_name;
  const first = name.split(" ")[0];
  const owner = data.user.roles.includes("tenant_admin");
  const cards = extraCards(data.user.roles, data.tiles);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{first}&apos;s home screen</h1>
        <Link href="/admin/users" className="text-(--brand) font-medium">Back</Link>
      </div>

      <div className="rounded-lg border border-(--brand-ring) bg-(--brand-soft) p-3 text-sm">
        <p><strong>Preview.</strong> This is what {name} sees after logging in. You are still logged in as yourself; nothing here opens a module.</p>
        <p className="mt-1 text-slate-600">Roles: {data.user.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ") || "none"}</p>
      </div>

      {data.user.status !== "active" && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">⚠ {name} is disabled and can&apos;t log in at all.</p>
      )}
      {data.landing !== "launcher" && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ {first} goes straight into <strong>{moduleLabel(data.landing)}</strong> after login and doesn&apos;t see this screen
          (it opens only from the module&apos;s Account link).
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <StaticCard icon="📝" title="Plant board" text="Everyone can write · plan the next day" />
        {cards.owner && <StaticCard icon="📊" title="Reports" text="Sales by item and customer" />}
        {(cards.owner || cards.marketing) && <StaticCard icon="👥" title="Customers" text="Details, bills, payments and statement for each customer" />}
      </div>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Their modules</h2>
        {/* no live numbers: they would be yours, not theirs */}
        <LauncherTiles tiles={data.tiles} summaryUrl={() => ""} openHref={null} numbers={false} />
      </section>

      {owner && <p className="text-sm text-slate-500">{first} is an owner: owners also get the plan card and Manage users.</p>}
      <p className="text-sm text-slate-500">
        What {first} can do inside each module: <Link href="/admin/permissions" className="font-semibold text-(--brand)">Permissions</Link>.
      </p>
    </div>
  );
}
