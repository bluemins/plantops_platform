// The generic starter list offered to a plant with no sections yet (the owner can edit it or skip it).
// Common RO-plant items only; finished goods, empty bottles and labels come from THAT plant's own products.
// Nothing here is specific to one plant (CLAUDE.md: no customer-specific code).
import type { TenantSku } from "@plantops/types";
import type { SectionKind } from "@/server/schema";

export interface TemplateItem {
  name: string;
  unit: string;
  second_unit?: string;
  sku_id?: string;
}
export interface TemplateSection {
  name: string;
  kind: SectionKind;
  items: TemplateItem[];
}

const size = (ml: number) => (ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`);
/** 20 L jars have stickers and caps, not bottle packets and labels. */
const isJar = (s: TenantSku) => s.volume_ml >= 20_000;
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s);

/** Item names must be unique within a section: a repeated name gets the product code or a number. */
function unique(items: TemplateItem[], skus: TenantSku[]): TemplateItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let name = item.name;
    const sku = skus.find((s) => s.id === item.sku_id);
    if (seen.has(name.toLowerCase()) && sku?.sku_code) name = cut(`${item.name} ${sku.sku_code}`, 80);
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = cut(`${item.name} (${n})`, 80);
    seen.add(name.toLowerCase());
    return { ...item, name };
  });
}

export function starterTemplate(products: TenantSku[]): TemplateSection[] {
  const active = products.filter((p) => p.status === "active");
  const bottles = active.filter((p) => !isJar(p));
  // "Bluemins" -> "Bluemins 1 L"; a name that already says its size ("SampleAqua1L") stays as it is
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const label = (p: TenantSku) => {
    const name = p.name.replace(/\s+/g, " ").trim();
    return cut(squash(name).includes(squash(size(p.volume_ml))) ? name : `${name} ${size(p.volume_ml)}`, 70);
  };
  return [
    {
      name: "Finished goods",
      kind: "finished",
      items: unique(
        active.map((p) => ({ name: label(p), unit: cut(p.units_per_pack > 1 ? "box" : p.pack_type || "pcs", 20), sku_id: p.id })),
        active,
      ),
    },
    {
      name: "Raw material",
      kind: "stock",
      items: unique(
        bottles.map((p) => ({ name: `Empty bottles ${label(p)}`, unit: "packet", sku_id: p.id })),
        bottles,
      ),
    },
    {
      name: "Consumable",
      kind: "stock",
      items: unique(
        [
          { name: "20 L cap", unit: "pcs" },
          { name: "20 L sticker", unit: "pcs" },
          { name: "Screw cap blue", unit: "box" },
          { name: "Screw cap yellow", unit: "box" },
          { name: "Screw cap sky blue", unit: "box" },
          ...bottles.map((p) => ({ name: `Label ${label(p)}`, unit: "bundle", second_unit: "count", sku_id: p.id })),
          { name: 'Filter 210"', unit: "pcs" },
          { name: 'Filter 220"', unit: "pcs" },
          { name: "Roll", unit: "roll" },
          { name: "Dosing chemical Ca", unit: "packet" },
          { name: "Dosing chemical Mg", unit: "packet" },
          { name: "Dosing chemical Ka", unit: "packet" },
          { name: "Inkjet solution", unit: "bottle" },
          { name: "Inkjet ink", unit: "bottle" },
          { name: "Dosing liquid", unit: "bottle" },
          { name: "Ring", unit: "pcs" },
          { name: "Tap", unit: "pcs" },
        ],
        bottles,
      ),
    },
    {
      name: "Returnable items",
      kind: "stock",
      // counted in the plant only (who holds them comes later, with dispatch): good + damaged
      items: ["20 L jar", "Jerry can", "Chiller jar", "Battery dispenser", "Pump dispenser"].map((name) => ({ name, unit: "good", second_unit: "damaged" })),
    },
  ];
}
