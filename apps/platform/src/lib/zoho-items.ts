// Zoho Items → PlantOps products (owner, 2026-11-06; docs/ZOHO_IMPORT_PHASE_PLAN.md section 4). Pure functions, used by
// the browser (reading the CSV) and by the server (working out the preview again before saving).
//
// Rules: only items Zoho sells; matched by SKU code; Zoho wins on name, SKU code, HSN, purchase rate and active /
// inactive; PlantOps keeps size, pack type and units per pack; a Zoho code no product has yet is matched by hand once
// (or added as a new product, with a size the owner checks); products missing from Zoho are never touched.

export const PACK_TYPES = ["bottle", "jar", "pouch", "cup", "case", "other"] as const;
export type PackType = (typeof PACK_TYPES)[number];

export type ZohoItem = {
  line: number;
  name: string;
  sku: string;
  hsn: string;
  cost_rate: number | null;
  active: boolean;
  /** true when Zoho sells it (Item Type "Sales" or "Sales and Purchases"); files without that column: true */
  sold: boolean;
};

export const ZOHO_ITEMS_MAX = 2000;

const money = (s: string | undefined): number | null => {
  const t = (s ?? "").replace(/INR|₹|,/gi, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** The rows of Zoho's Items export (header row first). Throws a plain message when it isn't one. */
export function readZohoItems(rows: string[][]): ZohoItem[] {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col("item name");
  const iSku = col("sku");
  if (iName < 0 || iSku < 0) throw new Error("This isn't Zoho's Items export: it needs the columns Item Name and SKU.");
  const iHsn = col("hsn/sac");
  const iCost = col("purchase rate");
  const iStatus = col("status");
  const iType = col("item type");
  const items: ZohoItem[] = [];
  rows.slice(1).forEach((r, i) => {
    const cell = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    if (r.every((c) => !c.trim())) return;
    items.push({
      line: i + 2,
      name: cell(iName).replace(/\s+/g, " "),
      sku: cell(iSku).toUpperCase(),
      hsn: cell(iHsn),
      cost_rate: money(cell(iCost)),
      active: iStatus < 0 || cell(iStatus).toLowerCase() !== "inactive",
      sold: iType < 0 || cell(iType).toLowerCase().includes("sales"),
    });
  });
  return items;
}

export type ExistingSku = {
  id: string;
  name: string;
  sku_code: string | null;
  volume_ml: number;
  units_per_pack: number;
  pack_type: string;
  status: "active" | "inactive";
  hsn: string | null;
  cost_rate: number | null;
};

export type NewSpec = { volume_ml: number; units_per_pack: number; pack_type: PackType };

/** The owner's answers: per Zoho SKU code with no product yet, a product id or "new"; and the size of each new one. */
export type ItemChoices = { match: Record<string, string>; specs: Record<string, NewSpec> };

type Field = "name" | "sku_code" | "hsn" | "cost_rate" | "status";
export type FieldChange = { field: Field; from: string | number | null; to: string | number | null };

export type ItemsPlan = {
  updated: { id: string; name: string; sku: string; changes: FieldChange[] }[];
  unchanged: { id: string; name: string; sku: string }[];
  added: { sku: string; name: string; hsn: string | null; cost_rate: number | null; active: boolean; spec: NewSpec }[];
  /** Zoho codes no product has: the owner picks a product (from `candidates`) or "new" */
  to_choose: { sku: string; name: string; guess: NewSpec }[];
  skipped: { line: number; name: string; reason: string }[];
  warnings: { sku: string; text: string }[];
  /** products not in this Zoho file: left exactly as they are */
  kept: { id: string; name: string; sku_code: string | null }[];
  /** products not matched by code, which a Zoho item may be matched to by hand */
  candidates: { id: string; name: string; sku_code: string | null }[];
};

const SKU_RE = /^[A-Z0-9._/-]{1,40}$/;
const HSN_RE = /^[0-9]{4,8}$/;

/** A first guess at size / pack for a new product, from its Zoho name ("500ml", "1 Litre", "20 Litre"). */
export function guessSpec(name: string): NewSpec {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|liter|lit)\b/i);
  const n = m ? Number(m[1]) : NaN;
  const ml = !m ? 1000 : m[2]!.toLowerCase() === "ml" ? Math.round(n) : Math.round(n * 1000);
  const volume_ml = Math.min(Math.max(ml || 1000, 1), 100000);
  const lower = name.toLowerCase();
  const pack_type: PackType = /connection|deposit/.test(lower) ? "other" : volume_ml >= 10000 ? "jar" : "bottle";
  return { volume_ml, units_per_pack: 1, pack_type };
}

export function validSpec(s: NewSpec | undefined): s is NewSpec {
  return (
    !!s &&
    Number.isInteger(s.volume_ml) && s.volume_ml >= 1 && s.volume_ml <= 100000 &&
    Number.isInteger(s.units_per_pack) && s.units_per_pack >= 1 && s.units_per_pack <= 1000 &&
    (PACK_TYPES as readonly string[]).includes(s.pack_type)
  );
}

export function planItems(items: ZohoItem[], existing: ExistingSku[], choices: ItemChoices): ItemsPlan {
  const plan: ItemsPlan = { updated: [], unchanged: [], added: [], to_choose: [], skipped: [], warnings: [], kept: [], candidates: [] };
  const sale: ZohoItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.sold) plan.skipped.push({ line: it.line, name: it.name, reason: "Bought only (not sold)" });
    else if (!it.sku) plan.skipped.push({ line: it.line, name: it.name, reason: "No SKU in Zoho" });
    else if (!SKU_RE.test(it.sku)) plan.skipped.push({ line: it.line, name: it.name, reason: "SKU has characters PlantOps doesn't allow (letters, digits, . _ / -)" });
    else if (!it.name || it.name.length > 80) plan.skipped.push({ line: it.line, name: it.name, reason: "Name must be 1 to 80 characters" });
    else if (seen.has(it.sku)) plan.skipped.push({ line: it.line, name: it.name, reason: `SKU ${it.sku} is twice in the file` });
    else {
      seen.add(it.sku);
      sale.push(it);
    }
  }

  const byCode = new Map(existing.filter((e) => e.sku_code).map((e) => [e.sku_code!, e]));
  const matchedIds = new Set(sale.map((it) => byCode.get(it.sku)?.id).filter(Boolean) as string[]);
  const candidates = existing.filter((e) => !matchedIds.has(e.id));
  plan.candidates = candidates.map((e) => ({ id: e.id, name: e.name, sku_code: e.sku_code }));
  const candidateIds = new Set(candidates.map((c) => c.id));
  const picked = new Set<string>();
  const used = new Set<string>();

  for (const it of sale) {
    const hsnOk = !it.hsn || HSN_RE.test(it.hsn);
    if (!hsnOk) plan.warnings.push({ sku: it.sku, text: `HSN "${it.hsn}" is not 4 to 8 digits: not copied` });
    let target = byCode.get(it.sku);
    if (!target) {
      const choice = choices.match[it.sku];
      if (choice && choice !== "new" && candidateIds.has(choice) && !picked.has(choice)) {
        picked.add(choice);
        target = existing.find((e) => e.id === choice);
      } else if (choice === "new") {
        const spec = choices.specs[it.sku] ?? guessSpec(it.name);
        if (!validSpec(spec)) {
          plan.to_choose.push({ sku: it.sku, name: it.name, guess: guessSpec(it.name) });
          plan.warnings.push({ sku: it.sku, text: "Size, pack type or units per pack is not valid" });
        } else {
          plan.added.push({ sku: it.sku, name: it.name, hsn: hsnOk ? it.hsn || null : null, cost_rate: it.cost_rate, active: it.active, spec });
        }
        continue;
      } else {
        if (choice && choice !== "new") plan.warnings.push({ sku: it.sku, text: "The product picked is no longer free: pick again" });
        plan.to_choose.push({ sku: it.sku, name: it.name, guess: guessSpec(it.name) });
        continue;
      }
    }
    used.add(target!.id);
    const t = target!;
    const want: Record<Field, string | number | null> = {
      name: it.name,
      sku_code: it.sku,
      hsn: hsnOk ? it.hsn || null : t.hsn,
      cost_rate: it.cost_rate,
      status: it.active ? "active" : "inactive",
    };
    const changes: FieldChange[] = [];
    for (const f of Object.keys(want) as Field[]) {
      const from = t[f];
      if (from !== want[f]) changes.push({ field: f, from, to: want[f] });
    }
    if (changes.length) plan.updated.push({ id: t.id, name: t.name, sku: it.sku, changes });
    else plan.unchanged.push({ id: t.id, name: t.name, sku: it.sku });
  }
  plan.kept = existing.filter((e) => !used.has(e.id)).map((e) => ({ id: e.id, name: e.name, sku_code: e.sku_code }));
  return plan;
}

export const FIELD_LABEL: Record<Field, string> = { name: "Name", sku_code: "SKU", hsn: "HSN", cost_rate: "Purchase rate", status: "Status" };
