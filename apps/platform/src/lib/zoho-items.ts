// Zoho Items → PlantOps products (owner, 2026-11-06; docs/ZOHO_IMPORT_PHASE_PLAN.md section 4). Pure functions, used by
// the browser (reading the CSV) and by the server (working out the preview again before saving).
//
// Rules: only items Zoho sells; matched by the link from an earlier import (Zoho's Item ID), else by SKU code, else by
// hand once (or added as a new product, with a size the owner checks). Zoho wins on name, SKU code, HSN, purchase rate
// and active / inactive, but **only where Zoho changed since the last import**: an edit the owner made in PlantOps is
// kept otherwise (owner, 2026-11-06). PlantOps keeps size, pack type and units per pack. Products missing from Zoho are
// never touched.

export const PACK_TYPES = ["bottle", "jar", "pouch", "cup", "case", "other"] as const;
export type PackType = (typeof PACK_TYPES)[number];

export type ZohoItem = {
  line: number;
  /** Zoho's Item ID (stable even when the SKU changes); files without it use "sku:<code>" */
  zoho_id: string;
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
  const iId = col("item id");
  const items: ZohoItem[] = [];
  rows.slice(1).forEach((r, i) => {
    const cell = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    if (r.every((c) => !c.trim())) return;
    items.push({
      line: i + 2,
      zoho_id: cell(iId).slice(0, 60) || `sku:${cell(iSku).toUpperCase()}`,
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
/** a field where PlantOps differs from Zoho and the owner's edit is kept (Zoho hasn't changed it since last time) */
export type KeptEdit = { field: Field; yours: string | number | null; zoho: string | number | null };

/** What Zoho said about a linked product at the last import (platform.zoho_item_links). */
export type ItemLink = {
  sku_id: string;
  zoho_id: string;
  sku: string;
  name: string;
  hsn: string | null;
  cost_rate: number | null;
  active: boolean;
};

/** One link row to save: for a product (by id) or a product added by this import (by its new SKU code). */
export type LinkRow = Omit<ItemLink, "sku_id"> & { sku_id: string | null; new_sku: string | null };

export type ItemsPlan = {
  updated: { id: string; name: string; sku: string; changes: FieldChange[]; kept: KeptEdit[] }[];
  unchanged: { id: string; name: string; sku: string; kept: KeptEdit[] }[];
  added: { sku: string; name: string; hsn: string | null; cost_rate: number | null; active: boolean; spec: NewSpec }[];
  /** Zoho codes no product has: the owner picks a product (from `candidates`) or "new" */
  to_choose: { sku: string; name: string; guess: NewSpec }[];
  skipped: { line: number; name: string; reason: string }[];
  warnings: { sku: string; text: string }[];
  /** products not in this Zoho file: left exactly as they are */
  kept: { id: string; name: string; sku_code: string | null }[];
  /** products not matched by link or code, which a Zoho item may be matched to by hand */
  candidates: { id: string; name: string; sku_code: string | null }[];
  /** what Zoho says now, for every product matched or added: saved as the next import's starting point */
  links: LinkRow[];
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

/**
 * `links`: what Zoho said at the last import, per linked product. `importedBefore`: this plant has run the import
 * before (products matched by code without a link then keep the owner's values: they were imported before links
 * existed, v0.37.0). A product matched by hand, or the plant's first import: Zoho wins.
 */
export function planItems(
  items: ZohoItem[],
  existing: ExistingSku[],
  choices: ItemChoices,
  ctx: { links: ItemLink[]; importedBefore: boolean } = { links: [], importedBefore: false },
): ItemsPlan {
  const plan: ItemsPlan = { updated: [], unchanged: [], added: [], to_choose: [], skipped: [], warnings: [], kept: [], candidates: [], links: [] };
  const sale: ZohoItem[] = [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  for (const it of items) {
    if (!it.sold) plan.skipped.push({ line: it.line, name: it.name, reason: "Bought only (not sold)" });
    else if (!it.sku) plan.skipped.push({ line: it.line, name: it.name, reason: "No SKU in Zoho" });
    else if (!SKU_RE.test(it.sku)) plan.skipped.push({ line: it.line, name: it.name, reason: "SKU has characters PlantOps doesn't allow (letters, digits, . _ / -)" });
    else if (!it.name || it.name.length > 80) plan.skipped.push({ line: it.line, name: it.name, reason: "Name must be 1 to 80 characters" });
    else if (seen.has(it.sku) || seenIds.has(it.zoho_id)) plan.skipped.push({ line: it.line, name: it.name, reason: `SKU ${it.sku} is twice in the file` });
    else {
      seen.add(it.sku);
      seenIds.add(it.zoho_id);
      sale.push(it);
    }
  }

  const byId = new Map(existing.map((e) => [e.id, e]));
  const linkByZoho = new Map(ctx.links.filter((l) => byId.has(l.sku_id)).map((l) => [l.zoho_id, l]));
  const linkedIds = new Set(ctx.links.map((l) => l.sku_id));
  // a product linked to a Zoho item is found through the link only, never by its code
  const byCode = new Map(existing.filter((e) => e.sku_code && !linkedIds.has(e.id)).map((e) => [e.sku_code!, e]));
  type How = "link" | "code" | "hand";
  const found = new Map<ZohoItem, { t: ExistingSku; how: How; link?: ItemLink }>();
  for (const it of sale) {
    const link = linkByZoho.get(it.zoho_id);
    if (link) found.set(it, { t: byId.get(link.sku_id)!, how: "link", link });
  }
  const taken = new Set([...found.values()].map((f) => f.t.id));
  for (const it of sale) {
    if (found.has(it)) continue;
    const t = byCode.get(it.sku);
    if (t && !taken.has(t.id)) {
      found.set(it, { t, how: "code" });
      taken.add(t.id);
    }
  }
  const candidates = existing.filter((e) => !taken.has(e.id));
  plan.candidates = candidates.map((e) => ({ id: e.id, name: e.name, sku_code: e.sku_code }));
  const candidateIds = new Set(candidates.map((c) => c.id));
  const picked = new Set<string>();

  for (const it of sale) {
    const hsnOk = !it.hsn || HSN_RE.test(it.hsn);
    if (!hsnOk) plan.warnings.push({ sku: it.sku, text: `HSN "${it.hsn}" is not 4 to 8 digits: not copied` });
    const linkRow = { zoho_id: it.zoho_id, sku: it.sku, name: it.name, hsn: it.hsn || null, cost_rate: it.cost_rate, active: it.active };
    let match = found.get(it);
    if (!match) {
      const choice = choices.match[it.sku];
      if (choice && choice !== "new" && candidateIds.has(choice) && !picked.has(choice)) {
        picked.add(choice);
        match = { t: byId.get(choice)!, how: "hand" };
      } else if (choice === "new") {
        const spec = choices.specs[it.sku] ?? guessSpec(it.name);
        if (!validSpec(spec)) {
          plan.to_choose.push({ sku: it.sku, name: it.name, guess: guessSpec(it.name) });
          plan.warnings.push({ sku: it.sku, text: "Size, pack type or units per pack is not valid" });
        } else {
          plan.added.push({ sku: it.sku, name: it.name, hsn: hsnOk ? it.hsn || null : null, cost_rate: it.cost_rate, active: it.active, spec });
          plan.links.push({ ...linkRow, sku_id: null, new_sku: it.sku });
        }
        continue;
      } else {
        if (choice && choice !== "new") plan.warnings.push({ sku: it.sku, text: "The product picked is no longer free: pick again" });
        plan.to_choose.push({ sku: it.sku, name: it.name, guess: guessSpec(it.name) });
        continue;
      }
    }
    const { t, how, link } = match;
    plan.links.push({ ...linkRow, sku_id: t.id, new_sku: null });
    const zoho: Record<Field, string | number | null> = {
      name: it.name,
      sku_code: it.sku,
      hsn: hsnOk ? it.hsn || null : t.hsn,
      cost_rate: it.cost_rate,
      status: it.active ? "active" : "inactive",
    };
    const before: Record<Field, string | number | null> | null = link
      ? { name: link.name, sku_code: link.sku, hsn: hsnOk ? link.hsn : t.hsn, cost_rate: link.cost_rate, status: link.active ? "active" : "inactive" }
      : null;
    const keepYours = how === "code" && ctx.importedBefore;
    const changes: FieldChange[] = [];
    const kept: KeptEdit[] = [];
    for (const f of Object.keys(zoho) as Field[]) {
      const yours = t[f];
      if (yours === zoho[f]) continue;
      const zohoChanged = before ? before[f] !== zoho[f] : !keepYours;
      if (zohoChanged) changes.push({ field: f, from: yours, to: zoho[f] });
      else kept.push({ field: f, yours, zoho: zoho[f] });
    }
    if (changes.length) plan.updated.push({ id: t.id, name: t.name, sku: it.sku, changes, kept });
    else plan.unchanged.push({ id: t.id, name: t.name, sku: it.sku, kept });
  }
  plan.kept = existing.filter((e) => !taken.has(e.id) && !picked.has(e.id)).map((e) => ({ id: e.id, name: e.name, sku_code: e.sku_code }));
  return plan;
}

export const FIELD_LABEL: Record<Field, string> = { name: "Name", sku_code: "SKU", hsn: "HSN", cost_rate: "Purchase rate", status: "Status" };
