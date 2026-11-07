"use client";
// Customer page Part 2 (docs/CUSTOMER_PAGE_PHASE_PLAN.md): shop location box, the owner's Edit, comments, contact persons.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { GST_STATES } from "@plantops/types";
import { api } from "@/lib/api";
import { mapsLink, MAX_ACCURACY_M } from "@/lib/customer-page";
import { BILL_TERMS, TERMS_LABEL } from "@/lib/ledger";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const small = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export interface LocationProps {
  customerId: string;
  location: { lat: string; lng: string; accuracy_m: number | null; source: string; by: string; at: string } | null;
  canSave: boolean;
  canClear: boolean;
  canPaste: boolean;
}

/** Waits up to 20 s for a good GPS fix (stops early at ±25 m); the best one seen, or an error message. */
function bestPosition(onProgress: (m: number) => void): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone's browser can't share its location."));
    let best: GeolocationPosition | null = null;
    const finish = () => {
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(new Error("No location yet. Turn on Location for the browser and try again outside."));
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        onProgress(Math.round(best.coords.accuracy));
        if (best.coords.accuracy <= 25) finish();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          navigator.geolocation.clearWatch(id);
          clearTimeout(timer);
          reject(new Error("Location is blocked. Allow location for this site in the browser settings, then try again."));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    const timer = setTimeout(finish, 20000);
  });
}

export function LocationBox({ customerId, location, canSave, canClear, canPaste }: LocationProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<"none" | "paste" | "clear">("none");
  const [text, setText] = useState("");

  async function saveHere() {
    setError(undefined);
    setBusy("Finding your location…");
    try {
      const p = await bestPosition((m) => setBusy(`Finding your location… ±${m} m`));
      const r = await api(`/api/customers/${customerId}/location`, { body: { source: "phone", lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy } });
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(undefined);
  }
  async function send(path: string, body: unknown) {
    setError(undefined);
    setBusy("Saving…");
    const r = await api(path, { body });
    setBusy(undefined);
    if (!r.ok) return setError(r.error);
    setMode("none");
    setText("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {location ? (
        <>
          <a href={mapsLink(location.lat, location.lng)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-semibold text-(--brand)">
            📍 Open in Google Maps
          </a>
          <p className="text-xs text-slate-500">
            Saved {when(location.at)} by {location.by}
            {location.source === "map_link" ? " (from a Maps link)" : location.source === "field_visit" ? " (field visit)" : ""}
            {location.accuracy_m !== null ? ` · ±${location.accuracy_m} m` : ""}
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">No shop location yet.</p>
      )}
      {busy && <p className="text-sm text-slate-600" role="status">{busy}</p>}
      <ErrorText>{error}</ErrorText>
      {mode === "none" && (canSave || canPaste || (canClear && location)) && (
        <div className="flex flex-wrap gap-2">
          {canSave && (
            <button type="button" className={small} disabled={!!busy} onClick={saveHere}>
              📍 Save my location here
            </button>
          )}
          {canPaste && (
            <button type="button" className={small} disabled={!!busy} onClick={() => setMode("paste")}>
              Paste a Maps link
            </button>
          )}
          {canClear && location && (
            <button type="button" className={`${small} text-red-700`} disabled={!!busy} onClick={() => setMode("clear")}>
              Clear
            </button>
          )}
        </div>
      )}
      {canSave && mode === "none" && <p className="text-xs text-slate-500">Tap it while standing at the shop. Needs ±{MAX_ACCURACY_M} m or better.</p>}
      {mode === "paste" && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor={`maplink-${customerId}`}>Google Maps link or numbers</label>
          <input id={`maplink-${customerId}`} className={field} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://maps.app.goo.gl/… or 21.0234, 83.7841" />
          <div className="flex gap-2">
            <Button disabled={!!busy || text.trim().length < 3} onClick={() => send(`/api/customers/${customerId}/location`, { source: "map_link", link: text })}>Save</Button>
            <Button variant="secondary" onClick={() => setMode("none")}>Cancel</Button>
          </div>
        </div>
      )}
      {mode === "clear" && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <label className="block text-sm text-red-900" htmlFor={`clear-${customerId}`}>Why clear it? (it stays on record)</label>
          <input id={`clear-${customerId}`} className={field} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="e.g. pin was at the wrong shop" />
          <div className="flex gap-2">
            <Button className="bg-red-700 hover:bg-red-800" disabled={!!busy || text.trim().length < 3} onClick={() => send(`/api/customers/${customerId}/location/clear`, { reason: text })}>Clear location</Button>
            <Button variant="secondary" onClick={() => setMode("none")}>Keep it</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- the owner's Edit ----------

export interface EditValues {
  name: string;
  place: string;
  phone: string;
  legal_name: string | null;
  gst_treatment: string | null;
  gstin: string | null;
  state_code: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_pin: string | null;
  email: string | null;
  other_phone: string | null;
  customer_type: string | null;
  delivery_address: string | null;
  delivery_landmark: string | null;
  payment_terms: string | null;
}
type Key = keyof EditValues;

const TYPES = [["", "—"], ["shop", "Shop"], ["household", "Household"], ["office", "Office"], ["institution", "Institution"], ["individual", "Individual"]] as const;
const TREATMENTS = [["", "—"], ["registered", "Registered business (has GSTIN)"], ["unregistered", "Unregistered business"], ["consumer", "Consumer"]] as const;

export function EditCustomer({ customerId, values }: { customerId: string; values: EditValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<Key, string>>(() => Object.fromEntries(Object.entries(values).map(([k, x]) => [k, x ?? ""])) as Record<Key, string>);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: Key) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const phoneChanged = v.phone.replace(/\D/g, "").slice(-10) !== values.phone;

  async function save() {
    setBusy(true);
    setError(undefined);
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(v) as Key[]) if (v[k] !== (values[k] ?? "")) body[k] = k === "gst_treatment" || k === "customer_type" || k === "payment_terms" ? v[k] || null : v[k];
    if (phoneChanged) body.phone_reason = reason;
    else delete body.phone;
    const r = await api(`/api/customers/${customerId}/details`, { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit customer
      </Button>
    );
  const input = (k: Key, label: string, props: Record<string, unknown> = {}) => (
    <label className="block space-y-1 text-sm font-semibold">
      <span>{label}</span>
      <input className={field} value={v[k]} onChange={set(k)} {...props} />
    </label>
  );
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">Edit customer</h2>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold text-slate-700">Sales (calling name)</legend>
        {input("name", "Calling name (orders, lists, ordinary bills)", { maxLength: 100 })}
        {input("place", "Place", { maxLength: 200 })}
        {input("phone", "Mobile", { inputMode: "tel", maxLength: 30 })}
        {phoneChanged ? (
          <label className="block space-y-1 text-sm font-semibold">
            <span>Reason for the new mobile</span>
            <input className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. changed number" />
          </label>
        ) : (
          <span className="hidden sm:block" />
        )}
        {input("other_phone", "Other phone", { inputMode: "tel", maxLength: 30 })}
        {input("email", "Email", { type: "email", maxLength: 120 })}
        <label className="block space-y-1 text-sm font-semibold">
          <span>Customer type</span>
          <select className={field} value={v.customer_type} onChange={set("customer_type")}>
            {TYPES.map(([x, l]) => <option key={x} value={x}>{l}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          <span>Payment terms</span>
          <select className={field} value={v.payment_terms} onChange={set("payment_terms")}>
            <option value="">Plant default (Bill settings)</option>
            {BILL_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABEL[t]}</option>)}
          </select>
        </label>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold text-slate-700">Delivery</legend>
        {input("delivery_address", "Delivery address (if not the place)", { maxLength: 300 })}
        {input("delivery_landmark", "Landmark", { maxLength: 150 })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold text-slate-700">GST details (only for GST bills and Zoho)</legend>
        {input("legal_name", "Legal name (as on the GST registration / in Zoho)", { maxLength: 200 })}
        <label className="block space-y-1 text-sm font-semibold">
          <span>GST treatment</span>
          <select className={field} value={v.gst_treatment} onChange={set("gst_treatment")}>
            {TREATMENTS.map(([x, l]) => <option key={x} value={x}>{l}</option>)}
          </select>
        </label>
        {input("gstin", "GSTIN", { maxLength: 20, autoCapitalize: "characters" })}
        <label className="block space-y-1 text-sm font-semibold">
          <span>GST state (place of supply)</span>
          <select className={field} value={v.state_code} onChange={set("state_code")}>
            <option value="">—</option>
            {Object.entries(GST_STATES).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
          </select>
        </label>
        {input("billing_address", "Billing address", { maxLength: 300 })}
        {input("billing_city", "City", { maxLength: 80 })}
        {input("billing_pin", "PIN code", { inputMode: "numeric", maxLength: 6 })}
      </fieldset>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="text-xs text-slate-500">Every change goes into the timeline. Old orders and bills keep the details they were made with.</p>
    </div>
  );
}

// ---------- comments and contact persons ----------

export function AddComment({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/customers/${customerId}/comments`, { body: { body } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody("");
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor="new-comment">Add a comment (can&apos;t be changed later)</label>
      <textarea id="new-comment" className={`${field} min-h-24 py-2`} value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Pays every Saturday. Call Ramesh if Ajit is out." />
      <ErrorText>{error}</ErrorText>
      <Button disabled={busy || !body.trim()} onClick={save}>{busy ? "Adding..." : "Add comment"}</Button>
    </div>
  );
}

export function PersonsEditor({ customerId, persons }: { customerId: string; persons: { id: string; name: string; phone: string | null; role: string | null; active: boolean }[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [p, setP] = useState({ name: "", phone: "", role: "" });
  const [error, setError] = useState<string>();
  async function add() {
    setError(undefined);
    const r = await api(`/api/customers/${customerId}/persons`, { body: p });
    if (!r.ok) return setError(r.error);
    setP({ name: "", phone: "", role: "" });
    setAdding(false);
    router.refresh();
  }
  async function toggle(id: string, active: boolean) {
    const r = await api(`/api/customers/${customerId}/persons/${id}`, { body: { active } });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <div className="space-y-2">
      {persons.map((x) => (
        <div key={x.id} className="flex items-center justify-between gap-2 text-sm">
          <span className={x.active ? "" : "text-slate-400 line-through"}>{x.name}{x.role ? ` · ${x.role}` : ""}{x.phone ? ` · ${x.phone}` : ""}</span>
          <button type="button" className="min-h-11 shrink-0 text-xs font-semibold text-(--brand)" onClick={() => toggle(x.id, !x.active)}>{x.active ? "Switch off" : "Switch on"}</button>
        </div>
      ))}
      {adding ? (
        <div className="space-y-2">
          <input aria-label="Name" className={field} value={p.name} maxLength={100} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Name" />
          <input aria-label="Phone" className={field} value={p.phone} inputMode="tel" maxLength={30} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="Phone (optional)" />
          <input aria-label="Role" className={field} value={p.role} maxLength={60} onChange={(e) => setP({ ...p, role: e.target.value })} placeholder="Role, e.g. shop boy (optional)" />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button disabled={p.name.trim().length < 2} onClick={add}>Add</Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button type="button" className={small} onClick={() => setAdding(true)}>+ Add person</button>
      )}
    </div>
  );
}
