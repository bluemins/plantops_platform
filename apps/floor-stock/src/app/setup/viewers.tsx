"use client";

import { useState } from "react";
import { Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

type Viewer = { user_id: string; name: string; section_ids: string[] };
type Section = { id: string; name: string; off: boolean };

/**
 * Owner only: which sections each Stock viewer sees (v0.27.0). A tick saves at once. A Stock viewer is added on
 * PlantOps → Manage users (role "Stock viewer"); they appear here within a minute.
 */
export function ViewerSections({ viewers, sections }: { viewers: Viewer[] | null; sections: Section[] }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-bold">Who sees what</h2>
        <p className="text-sm text-slate-500">Stock viewers see only the sections ticked for them. They can&apos;t count or change anything.</p>
      </div>
      {viewers === null ? (
        <p className="text-sm text-slate-600">PlantOps could not be reached right now. Please reload the page in a minute.</p>
      ) : viewers.length === 0 ? (
        <p className="text-sm text-slate-600">
          No Stock viewers yet. Give someone the role &quot;Stock viewer&quot; on PlantOps → Manage users, then come back here to pick their sections.
        </p>
      ) : (
        viewers.map((v) => <ViewerRow key={v.user_id} viewer={v} sections={sections} />)
      )}
    </Card>
  );
}

function ViewerRow({ viewer, sections }: { viewer: Viewer; sections: Section[] }) {
  const [ticked, setTicked] = useState(new Set(viewer.section_ids));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/viewers/${viewer.user_id}`, { method: "PUT", body: { section_ids: [...next] } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTicked(next);
  }

  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="font-semibold">
        {viewer.name} <span className="text-sm font-normal text-slate-500">· {ticked.size ? `${ticked.size} section${ticked.size === 1 ? "" : "s"}` : "sees no stock yet"}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sections
          .filter((s) => !s.off || ticked.has(s.id))
          .map((s) => (
            <label key={s.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 ${ticked.has(s.id) ? "border-(--brand) bg-(--brand-soft)" : "border-slate-300 bg-white"}`}>
              <input type="checkbox" className="h-5 w-5" checked={ticked.has(s.id)} disabled={busy} onChange={() => toggle(s.id)} />
              <span>
                {s.name}
                {s.off && <span className="text-sm text-slate-500"> (switched off)</span>}
              </span>
            </label>
          ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
