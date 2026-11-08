"use client";
// A customer's Drop card (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 1, mock-ups 1–3): Can use Drop, brands shown, the main
// and extra phones with last login, Add extra phone, Remove, Make main phone. The server decides who may do what
// (owner: all; Order desk: phones; support: read-only); the buttons only follow it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { DropCardView } from "@/server/drop/manage";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const small = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primary = "min-h-11 rounded-lg bg-(--brand) px-4 text-sm font-semibold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-50";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const pretty = (p: string) => p.replace(/^(\d{5})(\d{5})$/, "$1 $2");

export function DropCard({ customerId, view }: { customerId: string; view: DropCardView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<{ kind: "none" } | { kind: "add" } | { kind: "main"; phone: string }>({ kind: "none" });
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");

  async function send(path: string, body: unknown) {
    setError(undefined);
    setBusy(true);
    const r = await api(path, { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMode({ kind: "none" });
    setPhone("");
    setReason("");
    router.refresh();
  }
  const base = `/api/customers/${customerId}/drop`;
  const setAccess = (enabled: boolean, brands: string[]) => send(base, { enabled, brands });

  if (!view.set_up) return <p className="text-sm text-slate-500">The Drop app isn&apos;t set up for this plant yet.</p>;

  const toggleBrand = (b: string) => setAccess(view.enabled, view.brands.includes(b) ? view.brands.filter((x) => x !== b) : [...view.brands, b]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Can use Drop</p>
          <p className="text-xs text-slate-500">Off = no login; phones are logged out at once</p>
        </div>
        {view.can.manage ? (
          <button
            type="button"
            role="switch"
            aria-checked={view.enabled}
            aria-label={`Can use Drop: ${view.enabled ? "on" : "off"}`}
            disabled={busy || (!view.enabled && !view.customer_active)}
            onClick={() => setAccess(!view.enabled, view.brands)}
            className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${view.enabled ? "bg-(--brand)" : "bg-slate-300"}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${view.enabled ? "right-1" : "left-1"}`} />
          </button>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${view.enabled ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{view.enabled ? "On" : "Off"}</span>
        )}
      </div>
      {!view.customer_active && !view.enabled && <p className="text-xs text-slate-500">This customer is switched off. Switch the customer on first.</p>}

      <div className="space-y-2">
        <p className="text-sm font-semibold">Brands shown in Drop</p>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-(--brand) bg-(--brand-soft) px-3 text-sm">
            <input type="checkbox" checked disabled /> {view.main_brand} <span className="text-xs text-slate-500">always</span>
          </label>
          {view.brand_choices.map((b) => (
            <label key={b} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm">
              <input type="checkbox" checked={view.brands.includes(b)} disabled={!view.can.manage || busy} onChange={() => toggleBrand(b)} /> {b}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Phones that can log in</p>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-semibold">
            {pretty(view.main.phone)} <span className="ml-1 rounded-md bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-900">MAIN</span>
          </p>
          <p className="text-xs text-slate-500">{view.main.last_login ? `Last login ${when(view.main.last_login)}` : "Never logged in"}</p>
        </div>
        {view.extras.map((e) => (
          <div key={e.phone} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold">{pretty(e.phone)}</p>
              <p className="text-xs text-slate-500">
                Extra · added by {e.added_by}, {day(e.added_at)} · {e.last_login ? `last login ${when(e.last_login)}` : "never logged in"}
              </p>
            </div>
            <div className="flex gap-2">
              {view.can.manage && (
                <button type="button" className={small} disabled={busy} onClick={() => setMode({ kind: "main", phone: e.phone })}>
                  Make main
                </button>
              )}
              {view.can.phones && (
                <button type="button" className={`${small} border-red-200 text-red-800`} disabled={busy} onClick={() => send(`${base}/phones/remove`, { phone: e.phone })}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}

        {view.can.phones && mode.kind === "none" && (
          <button type="button" onClick={() => setMode({ kind: "add" })} className="min-h-11 w-full rounded-lg border border-dashed border-(--brand) text-sm font-semibold text-(--brand)">
            + Add extra phone
          </button>
        )}

        {mode.kind === "add" && (
          <form
            className="space-y-2 rounded-lg border border-slate-200 p-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void send(`${base}/phones`, { phone });
            }}
          >
            <label htmlFor="drop-phone" className="text-sm font-semibold">Extra phone (sees the same as the main phone)</label>
            <input id="drop-phone" inputMode="tel" autoComplete="off" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
            <div className="flex gap-2">
              <button type="button" className={small} onClick={() => { setMode({ kind: "none" }); setError(undefined); }}>Cancel</button>
              <button type="submit" className={primary} disabled={busy || !phone.trim()}>Add phone</button>
            </div>
          </form>
        )}

        {mode.kind === "main" && (
          <form
            className="space-y-2 rounded-lg border border-slate-200 p-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void send(`${base}/make-main`, { phone: mode.phone, reason });
            }}
          >
            <p className="text-sm font-semibold">Make {pretty(mode.phone)} the main phone?</p>
            <p className="text-xs text-slate-600">
              It becomes the customer&apos;s mobile in Sales (orders, bills, WhatsApp thank-you, reminders, the bot and Calls). {pretty(view.main.phone)} stays as an
              extra phone. Nobody is logged out.
            </p>
            <label htmlFor="drop-reason" className="text-sm font-semibold">Reason (required)</label>
            <input id="drop-reason" className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. owner changed his number" />
            <div className="flex gap-2">
              <button type="button" className={small} onClick={() => { setMode({ kind: "none" }); setError(undefined); }}>Cancel</button>
              <button type="submit" className={primary} disabled={busy || reason.trim().length < 3}>Make main</button>
            </div>
          </form>
        )}
        <ErrorText>{error}</ErrorText>
      </div>

      {view.changed_at && (
        <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">
          {view.enabled ? "Switched on" : "Switched off"} by {view.changed_by}, {when(view.changed_at)}
        </p>
      )}
    </div>
  );
}
