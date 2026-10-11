"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { contentText, kindOf, num, type Measure, type MeasureKind } from "@/lib/recipe";
import type { SectionView, SetupItemView } from "@/server/setup";

type Product = { id: string; label: string; active: boolean; per_box: number };
type TemplatePreview = { name: string; kind: "finished" | "stock"; items: string[] }[];
type Can = { owner: boolean; edit: boolean };
type Editing = { kind: "section-new" } | { kind: "section"; id: string } | { kind: "item-new"; sectionId: string } | { kind: "item"; id: string } | { kind: "recipe"; id: string } | { kind: "contents"; id: string } | null;

const KIND_TEXT = { finished: "Today production + closing stock", stock: "Closing stock only" } as const;
const done = () => window.location.reload();
const fmt = (n: number) => String(Number(n.toFixed(2)));

/** Moves one id up or down in a list; null when it is already at that end. */
function moved(ids: string[], id: string, by: -1 | 1) {
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function SetupEditor({ sections, products, template, can }: { sections: SectionView[]; products: Product[]; template: TemplatePreview | null; can: Can }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [showOff, setShowOff] = useState(false);
  const [skipTemplate, setSkipTemplate] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => setEditing(null);
  const activeSections = sections.filter((s) => s.status === "active");
  const offCount = sections.filter((s) => s.status === "off").length + sections.reduce((n, s) => n + s.items.filter((i) => i.status === "off").length, 0);
  const visible = showOff ? sections : activeSections;
  const names = new Map(sections.flatMap((s) => s.items.map((i) => [i.id, i.name] as const)));
  // what a recipe can use: active items of active stock sections
  const materials = activeSections.filter((s) => s.kind === "stock").flatMap((s) => s.items.filter((i) => i.status === "active"));

  async function call(path: string, body: unknown, method = "POST") {
    setError(undefined);
    const r = await api(path, { method, body });
    if (!r.ok) return setError(r.error);
    done();
  }
  const moveSection = (id: string, by: -1 | 1) => {
    const ids = moved(sections.map((s) => s.id), id, by);
    if (ids) void call("/api/sections/order", { ids });
  };
  const moveItem = (section: SectionView, id: string, by: -1 | 1) => {
    const ids = moved(section.items.map((i) => i.id), id, by);
    if (ids) void call("/api/items/order", { section_id: section.id, ids });
  };

  if (template && !skipTemplate) return <TemplateOffer template={template} productCount={products.filter((p) => p.active).length} onSkip={() => setSkipTemplate(true)} />;

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        What your staff count every evening, in this order. Sections and items are switched off, never deleted, so old counts still show.
        {!can.owner && can.edit && " Only the plant owner can change sections, set limits or move an item to another section."}
      </p>
      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center gap-3">
        {can.owner && editing?.kind !== "section-new" && <Button onClick={() => setEditing({ kind: "section-new" })}>+ Add section</Button>}
        {offCount > 0 && (
          <label className="flex min-h-12 items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
            Show switched-off ({offCount})
          </label>
        )}
      </div>
      {editing?.kind === "section-new" && <SectionForm onClose={close} />}

      {sections.length === 0 && (
        <Card>{can.owner ? "No sections yet. Add the first one." : "Your plant owner has not set up any sections yet."}</Card>
      )}

      {visible.map((section) => {
        const off = section.status === "off";
        const shownItems = showOff ? section.items : section.items.filter((i) => i.status === "active");
        return (
          <Card key={section.id} className={off ? "border-dashed bg-slate-50" : ""}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className={`text-lg font-bold ${off ? "text-slate-400" : ""}`}>
                  {section.name} {off && <Chip>Switched off</Chip>}
                </h2>
                <p className="text-sm text-slate-500">{KIND_TEXT[section.kind]}</p>
              </div>
              {can.owner && (
                <div className="flex flex-wrap gap-2">
                  <SmallButton label="Move section up" onClick={() => moveSection(section.id, -1)}>↑</SmallButton>
                  <SmallButton label="Move section down" onClick={() => moveSection(section.id, 1)}>↓</SmallButton>
                  <SmallButton onClick={() => setEditing({ kind: "section", id: section.id })}>Rename</SmallButton>
                  <SmallButton
                    onClick={() => {
                      if (!off && !confirm(`Switch off "${section.name}"? Its items will no longer be counted. Old counts stay.`)) return;
                      void call(`/api/sections/${section.id}`, { status: off ? "active" : "off" }, "PATCH");
                    }}
                  >
                    {off ? "Switch on" : "Switch off"}
                  </SmallButton>
                </div>
              )}
            </div>
            {editing?.kind === "section" && editing.id === section.id && <SectionForm section={section} onClose={close} />}

            <ul className="mt-3 divide-y divide-slate-100">
              {shownItems.length === 0 && <li className="py-3 text-slate-500">No items in this section yet.</li>}
              {shownItems.map((item) =>
                editing?.kind === "item" && editing.id === item.id ? (
                  <li key={item.id} className="py-3">
                    <ItemForm item={item} sectionId={section.id} sections={activeSections} products={products} can={can} onClose={close} />
                  </li>
                ) : (
                  <li key={item.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ItemSummary item={item} products={products} finished={section.kind === "finished"} names={names} owner={can.owner} />
                      {can.edit && !off && (
                        <div className="flex flex-wrap gap-2">
                          <SmallButton label="Move item up" onClick={() => moveItem(section, item.id, -1)}>↑</SmallButton>
                          <SmallButton label="Move item down" onClick={() => moveItem(section, item.id, 1)}>↓</SmallButton>
                          <SmallButton onClick={() => setEditing({ kind: "item", id: item.id })}>Edit</SmallButton>
                          {can.owner && item.status === "active" && (
                            <SmallButton onClick={() => setEditing({ kind: section.kind === "finished" ? "recipe" : "contents", id: item.id })}>
                              {section.kind === "finished" ? "Recipe" : "Contents"}
                            </SmallButton>
                          )}
                        </div>
                      )}
                    </div>
                    {editing?.kind === "recipe" && editing.id === item.id && <RecipeForm item={item} materials={materials} products={products} onClose={close} />}
                    {editing?.kind === "contents" && editing.id === item.id && <ContentsForm item={item} onClose={close} />}
                  </li>
                ),
              )}
            </ul>
            {can.edit && !off && (
              <div className="mt-3">
                {editing?.kind === "item-new" && editing.sectionId === section.id ? (
                  <ItemForm sectionId={section.id} sections={activeSections} products={products} can={can} onClose={close} />
                ) : (
                  <Button variant="secondary" onClick={() => setEditing({ kind: "item-new", sectionId: section.id })}>
                    + Add item
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------- first start ----------
function TemplateOffer({ template, productCount, onSkip }: { template: TemplatePreview; productCount: number; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function apply() {
    setBusy(true);
    const r = await api("/api/setup/template", { body: {} });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <Card className="space-y-4">
      <p className="text-lg font-semibold">Start with the starter list?</p>
      <p className="text-slate-600">
        A ready list of common RO-plant sections and items. Finished goods, empty bottles and labels are made from your {productCount} product
        {productCount === 1 ? "" : "s"} in PlantOps. You can rename, add, re-order or switch off anything afterwards, and set limits.
      </p>
      {productCount === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No products were found. Add your products in PlantOps Business details first, or the finished goods section will be empty.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {template.map((s) => (
          <div key={s.name} className="rounded-xl border border-slate-200 p-3">
            <p className="font-semibold">{s.name}</p>
            <p className="mb-1 text-xs text-slate-500">{KIND_TEXT[s.kind]}</p>
            <p className="text-sm text-slate-600">{s.items.length ? s.items.join(", ") : "No items"}</p>
          </div>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button onClick={apply} disabled={busy}>
          {busy ? "Creating…" : "Use the starter list"}
        </Button>
        <Button variant="secondary" onClick={onSkip} disabled={busy}>
          Start empty
        </Button>
      </div>
    </Card>
  );
}

// ---------- sections ----------
function SectionForm({ section, onClose }: { section?: SectionView; onClose: () => void }) {
  const [name, setName] = useState(section?.name ?? "");
  const [kind, setKind] = useState<"finished" | "stock">(section?.kind ?? "stock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = section ? await api(`/api/sections/${section.id}`, { method: "PATCH", body: { name } }) : await api("/api/sections", { body: { name, kind } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <FormBox title={section ? "Rename section" : "New section"} onSubmit={submit} busy={busy} error={error} onClose={onClose}>
      <TextField label="Section name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="e.g. Hotel room" />
      {!section && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">What is counted here?</legend>
          {(["stock", "finished"] as const).map((k) => (
            <label key={k} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3">
              <input type="radio" name="kind" className="h-5 w-5" checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <span className="block font-medium">{k === "finished" ? "Finished goods" : "Stock"}</span>
                <span className="block text-sm text-slate-500">
                  {k === "finished" ? "Entered as today's production AND counted as closing stock" : "Closing stock only (materials, consumables, returnables…)"}
                </span>
              </span>
            </label>
          ))}
          <p className="text-sm text-slate-500">This can't be changed later.</p>
        </fieldset>
      )}
    </FormBox>
  );
}

// ---------- items ----------
function ItemSummary({ item, products, finished, names, owner }: { item: SetupItemView; products: Product[]; finished: boolean; names: Map<string, string>; owner: boolean }) {
  const off = item.status === "off";
  const product = products.find((p) => p.id === item.sku_id);
  const perBox = product ? product.per_box : item.recipe?.case_size ?? null;
  let extra: string | null = null;
  if (finished && item.recipe?.lines.length) {
    const parts = item.recipe.lines.map((l) => `${l.measure === "pcs" ? num(l.qty) : `${num(l.qty)} ${l.measure}`} ${names.get(l.material_item_id) ?? "?"}`);
    extra = `1 bottle = ${parts.join(" + ")}${perBox && perBox > 1 ? ` · ${perBox} per ${item.unit}` : ""}`;
  } else if (finished && owner) extra = "No recipe yet";
  else if (!finished && item.content) extra = contentText(item.unit, item.content);
  return (
    <div className={`min-w-0 ${off ? "text-slate-400" : ""}`}>
      <p className="font-semibold">
        {item.name} {off && <Chip>Off</Chip>}
      </p>
      <p className="text-sm text-slate-500">
        {item.unit}
        {item.second_unit ? ` + ${item.second_unit}` : ""}
        {product ? ` · ${product.label}` : item.sku_id ? " · product not found" : ""}
        {" · "}
        {item.min_level === null ? "no limit" : <span className="font-semibold text-slate-700">limit {fmt(item.min_level)}</span>}
      </p>
      {extra && <p className={`text-sm ${extra === "No recipe yet" ? "text-slate-400" : "text-(--brand)"}`}>{extra}</p>}
    </div>
  );
}

// ---------- "Can make": what 1 unit holds, and what 1 bottle needs (owner only) ----------
const CHOICES: Record<MeasureKind, Measure[]> = { pieces: ["pcs"], weight: ["g", "kg"], volume: ["ml", "L"], length: ["m"] };
const MEASURE_TEXT: Record<Measure, string> = { pcs: "pieces (pcs)", g: "grams (g)", kg: "kilograms (kg)", ml: "millilitres (ml)", L: "litres (L)", m: "metres (m)" };
/** The measures a recipe may use for a material: the same kind as what 1 of its units holds (no contents = pieces). */
const choicesFor = (m: SetupItemView | undefined) => CHOICES[m?.content ? kindOf(m.content.measure) : "pieces"];

function ContentsForm({ item, onClose }: { item: SetupItemView; onClose: () => void }) {
  const c = item.content;
  const [f, setF] = useState({ qty: c ? String(c.qty) : "", measure: (c?.measure ?? "pcs") as Measure, damage: c ? String(c.damage_pct) : "0", loose: c?.second_is_pieces ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  const canLoose = !!item.second_unit && f.measure === "pcs";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const qty = Number(f.qty);
    const damage = f.damage.trim() === "" ? 0 : Number(f.damage);
    if (!Number.isFinite(qty) || qty <= 0) return setError(`Enter how much 1 ${item.unit} holds (a number above 0)`);
    if (!Number.isFinite(damage) || damage < 0 || damage >= 100) return setError("Damage allowance must be from 0 to below 100");
    setBusy(true);
    const r = await api(`/api/materials/${item.id}`, { method: "PUT", body: { content_qty: qty, content_measure: f.measure, damage_pct: damage, second_is_pieces: canLoose && f.loose } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }

  return (
    <FormBox title={`What is in 1 ${item.unit} of ${item.name}`} onSubmit={submit} busy={busy} error={error} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={`1 ${item.unit} holds`} type="number" inputMode="decimal" min={0} step="0.01" value={f.qty} onChange={(e) => set({ qty: e.target.value })} required autoFocus placeholder="e.g. 25000" />
        <Select label="Measured in" value={f.measure} onChange={(v) => set({ measure: v as Measure })}>
          {(Object.keys(MEASURE_TEXT) as Measure[]).map((m) => (
            <option key={m} value={m}>
              {MEASURE_TEXT[m]}
            </option>
          ))}
        </Select>
      </div>
      <TextField label="Damage allowance (%)" type="number" inputMode="decimal" min={0} max={99.9999} step="0.0001" value={f.damage} onChange={(e) => set({ damage: e.target.value })} placeholder="0" />
      <p className="text-sm text-slate-500">Always taken off before working out what can be made, e.g. 0.01.</p>
      {canLoose && (
        <label className="flex min-h-12 items-center gap-3 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-5 w-5" checked={f.loose} onChange={(e) => set({ loose: e.target.checked })} />
          The &quot;{item.second_unit}&quot; number is loose pieces (added to the total)
        </label>
      )}
    </FormBox>
  );
}

type Draft = { material_item_id: string; qty: string; measure: Measure };

function RecipeForm({ item, materials, products, onClose }: { item: SetupItemView; materials: SetupItemView[]; products: Product[]; onClose: () => void }) {
  const product = products.find((p) => p.id === item.sku_id);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const [lines, setLines] = useState<Draft[]>(() =>
    item.recipe?.lines.length ? item.recipe.lines.map((l) => ({ material_item_id: l.material_item_id, qty: String(l.qty), measure: l.measure })) : [{ material_item_id: "", qty: "", measure: "pcs" }],
  );
  const [caseSize, setCaseSize] = useState(item.recipe?.case_size ? String(item.recipe.case_size) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const setLine = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => setLine(i, { material_item_id: id, measure: choicesFor(byId.get(id))[0]! });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const filled = lines.filter((l) => l.material_item_id || l.qty.trim());
    for (const l of filled) {
      const name = byId.get(l.material_item_id)?.name;
      if (!name) return setError("Pick a material on every line (or remove the line)");
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q <= 0) return setError(`Enter how much 1 bottle needs of ${name}`);
    }
    const size = caseSize.trim() === "" ? null : Number(caseSize);
    if (!product && size !== null && (!Number.isInteger(size) || size < 1)) return setError(`Bottles per ${item.unit} must be a whole number, 1 or more`);
    if (!filled.length && !confirm(`Remove the recipe of ${item.name}? It will no longer show under "Can make".`)) return;
    setBusy(true);
    const r = await api(`/api/recipes/${item.id}`, {
      method: "PUT",
      body: { case_size: product ? null : size, lines: filled.map((l) => ({ material_item_id: l.material_item_id, qty: Number(l.qty), measure: l.measure })) },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }

  return (
    <FormBox title={`What makes 1 bottle of ${item.name}`} onSubmit={submit} busy={busy} error={error} onClose={onClose}>
      {product ? (
        <p className="text-sm text-slate-600">
          1 {item.unit} = {product.per_box} bottle{product.per_box === 1 ? "" : "s"} (from the product {product.label})
        </p>
      ) : (
        <TextField label={`Bottles per ${item.unit}`} type="number" inputMode="numeric" min={1} step="1" value={caseSize} onChange={(e) => setCaseSize(e.target.value)} placeholder="Blank = 1" />
      )}
      {materials.length === 0 && <p className="text-sm text-amber-800">Add raw material and consumable items first (in a stock section).</p>}
      <div className="space-y-2">
        {lines.map((l, i) => {
          const m = byId.get(l.material_item_id);
          return (
            <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <Select label={`Material ${i + 1}`} value={l.material_item_id} onChange={(v) => pick(i, v)}>
                <option value="">Pick…</option>
                {materials.map((x) => (
                  <option key={x.id} value={x.id} disabled={x.id !== l.material_item_id && lines.some((o) => o.material_item_id === x.id)}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <TextField label="1 bottle needs" type="number" inputMode="decimal" min={0} step="0.01" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <Select label="In" value={l.measure} onChange={(v) => setLine(i, { measure: v as Measure })}>
                  {choicesFor(m).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
                <SmallButton label={`Remove ${m?.name ?? "this material"}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  ✕
                </SmallButton>
              </div>
            </div>
          );
        })}
      </div>
      <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { material_item_id: "", qty: "", measure: "pcs" }])}>
        + Add material
      </Button>
      <p className="text-sm text-slate-500">A material counted in packets of grams needs its Contents set first, so its amount here can be in g.</p>
    </FormBox>
  );
}

function ItemForm({ item, sectionId, sections, products, can, onClose }: { item?: SetupItemView; sectionId: string; sections: SectionView[]; products: Product[]; can: Can; onClose: () => void }) {
  const [f, setF] = useState({
    section_id: item?.section_id ?? sectionId,
    name: item?.name ?? "",
    unit: item?.unit ?? "",
    second: !!item?.second_unit,
    second_unit: item?.second_unit ?? "",
    sku_id: item?.sku_id ?? "",
    min_level: item?.min_level === null || item?.min_level === undefined ? "" : String(item.min_level),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  const hasLimit = item?.min_level !== null && item?.min_level !== undefined;
  // a store keeper picks the section when adding; only the owner moves an existing item
  const canPickSection = !item || can.owner;

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    const r = item ? await api(`/api/items/${item.id}`, { method: "PATCH", body }) : await api("/api/items", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const unit = f.unit.trim();
    if (item && unit !== item.unit && !confirm(`Change the unit from "${item.unit}" to "${unit}"?\n\nOld counts stay in ${item.unit}; new counts will be in ${unit}. The day it changes is not compared.`)) return;
    const limit = f.min_level.trim() === "" ? null : Number(f.min_level);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return setError("The limit must be a number, 0 or more");
    const body: Record<string, unknown> = {
      section_id: f.section_id,
      name: f.name,
      unit,
      second_unit: f.second && f.second_unit.trim() ? f.second_unit.trim() : null,
      sku_id: f.sku_id || null,
    };
    if (can.owner) body.min_level = limit; // a store keeper never sends a limit
    await save(body);
  }

  const switchOff = () => {
    if (!item) return;
    if (item.status === "active" && !confirm(`Switch off "${item.name}"? It will no longer be counted. Old counts stay.`)) return;
    void save({ status: item.status === "active" ? "off" : "active" });
  };

  return (
    <FormBox title={item ? `Edit ${item.name}` : "New item"} onSubmit={submit} busy={busy} error={error} onClose={onClose}
      extra={
        item && (item.status === "off" || can.owner || !hasLimit) ? (
          <Button type="button" variant={item.status === "active" ? "danger" : "secondary"} onClick={switchOff} disabled={busy}>
            {item.status === "active" ? "Switch off" : "Switch on"}
          </Button>
        ) : null
      }
    >
      <TextField label="Item name" value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required autoFocus placeholder="e.g. Preform 18.5 g" />
      <TextField label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={20} required placeholder="box, pcs, packet, bundle, roll…" />
      <label className="flex min-h-12 items-center gap-3 text-sm font-medium text-slate-700">
        <input type="checkbox" className="h-5 w-5" checked={f.second} onChange={(e) => set({ second: e.target.checked })} />
        A second number (e.g. bundle + count, good + damaged)
      </label>
      {f.second && <TextField label="Second number's name" value={f.second_unit} onChange={(e) => set({ second_unit: e.target.value })} maxLength={20} required placeholder="count, damaged…" />}
      <Select label="PlantOps product (optional)" value={f.sku_id} onChange={(v) => set({ sku_id: v })}>
        <option value="">No product</option>
        {products.filter((p) => p.active || p.id === f.sku_id).map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.active ? "" : " (inactive)"}
          </option>
        ))}
      </Select>
      {canPickSection ? (
        <Select label="Section" value={f.section_id} onChange={(v) => set({ section_id: v })}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ) : null}
      {can.owner ? (
        <TextField label="Limit (optional): alert when the count is below this" type="number" inputMode="decimal" min={0} step="0.01" value={f.min_level} onChange={(e) => set({ min_level: e.target.value })} placeholder="Blank = never alert" />
      ) : (
        <p className="text-sm text-slate-500">Limit: {hasLimit ? `${fmt(item!.min_level!)} (set by the owner)` : "none"}. Only the owner sets limits.</p>
      )}
      {item && !can.owner && hasLimit && item.status === "active" && <p className="text-sm text-slate-500">This item has a limit, so only the owner can switch it off.</p>}
    </FormBox>
  );
}

// ---------- small parts ----------
function FormBox({ title, onSubmit, busy, error, onClose, extra, children }: { title: string; onSubmit: (e: FormEvent) => void; busy: boolean; error?: string; onClose: () => void; extra?: ReactNode; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4 rounded-xl border border-(--brand-ring) bg-(--brand-soft)/40 p-4">
      <p className="font-semibold">{title}</p>
      {children}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {extra}
      </div>
    </form>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
        {children}
      </select>
    </label>
  );
}

function SmallButton({ onClick, label, children }: { onClick: () => void; label?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50">
      {children}
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="ml-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-slate-600">{children}</span>;
}
