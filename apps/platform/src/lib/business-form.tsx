"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";

const MAX_LOGO_BYTES = 300 * 1024;
const DEFAULT_COLOR = "#1d4ed8";
const PACK_TYPES = ["bottle", "jar", "pouch", "cup", "case", "other"] as const;

/** Text fields of the business profile. "" means not set. */
export type ProfileValue = {
  brand_color: string;
  description: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
};
export const emptyProfile: ProfileValue = { brand_color: "", description: "", address: "", city: "", state: "", pincode: "", phone: "" };

/** undefined = keep the current logo, null = remove it, otherwise the new image. */
export type LogoChange = { data_base64: string; preview: string } | null | undefined;

/** Request body for the profile part (blank fields are sent as "" and saved as "not set"). */
export function profileBody(value: ProfileValue, logo: LogoChange) {
  return { ...value, ...(logo === undefined ? {} : { logo: logo && { data_base64: logo.data_base64 } }) };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Logo, brand color, description, location and phone. Used by the owner and by super_admin. */
export function ProfileFields({
  value,
  onChange,
  logo,
  onLogo,
  currentLogoUrl,
}: {
  value: ProfileValue;
  onChange: (v: ProfileValue) => void;
  logo: LogoChange;
  onLogo: (l: LogoChange) => void;
  currentLogoUrl?: string | null;
}) {
  const [logoError, setLogoError] = useState<string>();
  const set = (k: keyof ProfileValue) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const preview = logo === null ? null : (logo?.preview ?? currentLogoUrl ?? null);

  async function pick(file: File | undefined) {
    setLogoError(undefined);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setLogoError("Logo must be a PNG, JPG or WebP image");
    if (file.size > MAX_LOGO_BYTES) return setLogoError("Logo is too big (max 300 KB)");
    const dataUrl = await readFile(file);
    onLogo({ data_base64: dataUrl.slice(dataUrl.indexOf(",") + 1), preview: dataUrl });
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Business logo (PNG, JPG or WebP, max 300 KB)</span>
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {preview ? <img src={preview} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
          </div>
          <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            Choose image
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {preview && (
            <button type="button" className="text-sm text-red-700" onClick={() => onLogo(null)}>Remove</button>
          )}
        </div>
        <ErrorText>{logoError}</ErrorText>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Brand color (used in your modules)</span>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={value.brand_color || DEFAULT_COLOR}
            onChange={set("brand_color")}
            className="h-12 w-16 cursor-pointer rounded-lg border border-slate-300"
          />
          <span className="font-mono text-sm text-slate-600">{value.brand_color || "not set"}</span>
          {value.brand_color && (
            <button type="button" className="text-sm text-slate-500" onClick={() => onChange({ ...value, brand_color: "" })}>Clear</button>
          )}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">About the brand (max 500 characters)</span>
        <textarea
          value={value.description}
          onChange={set("description")}
          maxLength={500}
          rows={3}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </label>
      <TextField label="Address" value={value.address} onChange={set("address")} maxLength={200} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="City" value={value.city} onChange={set("city")} maxLength={80} />
        <TextField label="State" value={value.state} onChange={set("state")} maxLength={80} />
        <TextField label="PIN code" value={value.pincode} onChange={set("pincode")} inputMode="numeric" pattern="\d{6}" maxLength={6} />
        <TextField label="Business phone" type="tel" value={value.phone} onChange={set("phone")} maxLength={20} />
      </div>
    </div>
  );
}

type Business = ProfileValue & { name: string; code: string; logo_url: string | null };
type BusinessResponse = { [K in keyof Business]: Business[K] | null };

/** Loads and saves business details from `url` (owner: /api/admin/business, super_admin: .../tenants/:id/business). */
export function BusinessEditor({ url, onSaved }: { url: string; onSaved?: (b: { name: string }) => void }) {
  const [name, setName] = useState<string>();
  const [profile, setProfile] = useState(emptyProfile);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logo, setLogo] = useState<LogoChange>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = useCallback((b: BusinessResponse) => {
    setName(b.name ?? "");
    setProfile(Object.fromEntries(Object.keys(emptyProfile).map((k) => [k, b[k as keyof ProfileValue] ?? ""])) as ProfileValue);
    setLogoUrl(b.logo_url);
    setLogo(undefined);
  }, []);

  useEffect(() => {
    api<BusinessResponse>(url).then((r) => (r.ok ? show(r.data) : setError(r.error)));
  }, [url, show]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    setBusy(true);
    const r = await api<BusinessResponse>(url, { method: "PATCH", body: { name, ...profileBody(profile, logo) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    show(r.data);
    setSaved(true);
    onSaved?.({ name: r.data.name ?? "" });
  }

  if (name === undefined) return <ErrorText>{error}</ErrorText>;
  return (
    <form onSubmit={save} className="space-y-3">
      <TextField label="Plant / business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      <ProfileFields value={profile} onChange={setProfile} logo={logo} onLogo={setLogo} currentLogoUrl={logoUrl} />
      <ErrorText>{error}</ErrorText>
      {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving..." : "Save business details"}</Button>
    </form>
  );
}

type Sku = {
  id: string;
  name: string;
  sku_code: string | null;
  volume_ml: number;
  units_per_pack: number;
  pack_type: string;
  status: "active" | "inactive";
};

export const sizeLabel = (ml: number) => (ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`);
/** "Case of 24 × 500 ml" or "1 L bottle". */
const packLabel = (s: Sku) =>
  s.units_per_pack > 1 ? `${s.pack_type} of ${s.units_per_pack} × ${sizeLabel(s.volume_ml)}` : `${sizeLabel(s.volume_ml)} ${s.pack_type}`;

const emptySku = { name: "", sku_code: "", size: "", unit: "L" as "ml" | "L", units: "1", pack_type: "bottle" as string };

/** Product list (SKUs) at `url`. Products are made inactive, never deleted. */
export function SkuEditor({ url }: { url: string }) {
  const [skus, setSkus] = useState<Sku[]>();
  const [form, setForm] = useState(emptySku);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const r = await api<Sku[]>(url);
    if (!r.ok) return setError(r.error);
    setSkus(r.data);
  }, [url]);
  useEffect(() => void load(), [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const size = Number(form.size);
    if (!(size > 0)) return setError("Enter the size of one bottle/jar, e.g. 1 L or 500 ml");
    const units = Number(form.units);
    if (!Number.isInteger(units) || units < 1) return setError("Units per pack: a whole number, 1 or more");
    const body = {
      name: form.name,
      sku_code: form.sku_code,
      volume_ml: Math.round(form.unit === "L" ? size * 1000 : size),
      units_per_pack: units,
      pack_type: form.pack_type,
    };
    const r = editing ? await api(`${url}/${editing}`, { method: "PATCH", body }) : await api(url, { body });
    if (!r.ok) return setError(r.error);
    setForm(emptySku);
    setEditing(undefined);
    load();
  }

  function edit(s: Sku) {
    const inLitres = s.volume_ml >= 1000;
    setEditing(s.id);
    setForm({
      name: s.name,
      sku_code: s.sku_code ?? "",
      size: String(inLitres ? s.volume_ml / 1000 : s.volume_ml),
      unit: inLitres ? "L" : "ml",
      units: String(s.units_per_pack),
      pack_type: s.pack_type,
    });
  }

  async function toggle(s: Sku) {
    setError(undefined);
    const r = await api(`${url}/${s.id}`, { method: "PATCH", body: { status: s.status === "active" ? "inactive" : "active" } });
    if (!r.ok) return setError(r.error);
    load();
  }

  if (!skus) return <ErrorText>{error}</ErrorText>;
  return (
    <div className="space-y-3">
      {skus.length === 0 && <p className="text-sm text-slate-500">No products yet.</p>}
      {skus.map((s) => (
        <div key={s.id} className={`flex items-center justify-between gap-2 border-b border-slate-100 py-2 ${s.status === "inactive" ? "opacity-50" : ""}`}>
          <div>
            <p className="font-medium">{s.name}{s.status === "inactive" && " (inactive)"}</p>
            <p className="text-sm text-slate-500">
              <span className="capitalize">{packLabel(s)}</span>{s.sku_code ? ` · ${s.sku_code}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => edit(s)}>Edit</Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => toggle(s)}>
              {s.status === "active" ? "Make inactive" : "Make active"}
            </Button>
          </div>
        </div>
      ))}

      <form onSubmit={save} className="space-y-3 pt-2">
        <p className="text-sm font-medium text-slate-700">{editing ? "Edit product" : "Add product"}</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aqua 1L" maxLength={80} required />
          <TextField label="SKU code (optional)" value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: e.target.value })} autoCapitalize="characters" maxLength={40} />
          <div className="flex items-end gap-2">
            <TextField label="Size of one bottle/jar" className="flex-1" inputMode="decimal" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} required />
            <select
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value as "ml" | "L" })}
              className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base"
            >
              <option value="L">L</option>
              <option value="ml">ml</option>
            </select>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Pack type</span>
            <select
              value={form.pack_type}
              onChange={(e) => setForm({ ...form, pack_type: e.target.value })}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base capitalize"
            >
              {PACK_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <TextField
            label="Units per pack (1 = single bottle/jar)"
            inputMode="numeric"
            value={form.units}
            onChange={(e) => setForm({ ...form, units: e.target.value })}
            required
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">{editing ? "Save product" : "Add product"}</Button>
          {editing && (
            <Button type="button" variant="secondary" onClick={() => { setEditing(undefined); setForm(emptySku); }}>Cancel</Button>
          )}
        </div>
      </form>
    </div>
  );
}

export function BusinessSections({ businessUrl, skusUrl, onSaved }: { businessUrl: string; skusUrl: string; onSaved?: (b: { name: string }) => void }) {
  return (
    <>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Business details</h2>
        <BusinessEditor url={businessUrl} onSaved={onSaved} />
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Products (SKUs)</h2>
        <SkuEditor url={skusUrl} />
      </Card>
    </>
  );
}
