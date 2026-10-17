"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { LIMITS } from "@/lib/groups";
import type { OpeningView } from "@/server/openings";

const plainButton = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50";

/** Copy link + Print QR poster (mock-up 7). */
export function PublicLinkButtons({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // plain-http phone testing has no clipboard API: select-and-copy fallback
      const t = document.createElement("textarea");
      t.value = link;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={copy} className={plainButton}>
        {copied ? "Copied" : "Copy link"}
      </button>
      <a href="/openings/poster" className={`${plainButton} flex items-center justify-center`}>
        Print QR poster
      </a>
    </div>
  );
}

/** "Message at the top of the page" (≤ 300). Empty = the default text, shown greyed. */
export function MessageEditor({ initial, placeholder, canEdit }: { initial: string; placeholder: string; canEdit: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    const res = await api<{ message: string; isDefault: boolean }>("/api/app/page", { method: "PUT", body: { message: text } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(text.trim());
    setText(text.trim());
    router.refresh();
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor="intro" className="block pt-1 text-sm font-semibold">
        Message at the top of the page
      </label>
      <textarea
        id="intro"
        rows={3}
        maxLength={LIMITS.message}
        value={text}
        placeholder={placeholder}
        readOnly={!canEdit}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-y rounded-xl border border-slate-300 p-3 text-[15px] focus:border-(--brand) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {text.length} / {LIMITS.message}
          {!text && " · empty = the text shown above"}
        </span>
        {canEdit && text.trim() !== saved && (
          <button type="button" onClick={save} disabled={busy} className="min-h-11 rounded-xl bg-(--brand) px-4 text-sm font-bold text-(--brand-contrast) disabled:opacity-50">
            {busy ? "Saving…" : "Save message"}
          </button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** One position row's on / off switch and ↑ ↓ (within its group). Support and HR desk: the state only. */
export function OpeningControls({ opening, first, last, canEdit }: { opening: OpeningView; first: boolean; last: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(opening.status === "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(call: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(undefined);
    const res = await call;
    setBusy(false);
    if (!res.ok) setError(res.error);
    router.refresh();
    return res.ok;
  }
  async function toggle() {
    const next = !on;
    const { id: _id, sortOrder: _s, applications: _a, ...fields } = opening;
    if (await run(api(`/api/app/openings/${opening.id}`, { method: "PATCH", body: { ...fields, status: next ? "active" : "off" } }))) setOn(next);
  }
  const move = (direction: "up" | "down") => run(api(`/api/app/openings/${opening.id}/move`, { body: { direction } }));
  const arrow = "grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-700 disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {canEdit && (
        <>
          <button type="button" className={arrow} disabled={busy || first} onClick={() => move("up")} aria-label={`Move ${opening.title} up`}>
            ↑
          </button>
          <button type="button" className={arrow} disabled={busy || last} onClick={() => move("down")} aria-label={`Move ${opening.title} down`}>
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Show ${opening.title} on the public page`}
        disabled={!canEdit || busy}
        onClick={toggle}
        className={`relative ml-1 h-7 w-12 rounded-full transition disabled:cursor-default ${on ? "bg-(--brand)" : "bg-slate-300"}`}
      >
        <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all ${on ? "right-[3px]" : "left-[3px]"}`} />
      </button>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}
