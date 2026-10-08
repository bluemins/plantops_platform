// A small test plant with sections, items and counts, shared by the count and view tests.
import type { CountInput } from "@/server/counts";
import { createItem, createSection } from "@/server/setup";
import { plant } from "./helpers";

export const TODAY = "2026-10-08";
/** 6 pm in India on a given day. */
export const at = (date: string) => new Date(`${date}T18:00:00+05:30`);

/** A plant with a finished-goods section (1 L box) and a stock section (labels: bundle + count; roll). */
export async function stockPlant() {
  const p = plant();
  const fin = await createSection(p.owner, { name: "Finished goods", kind: "finished" });
  const con = await createSection(p.owner, { name: "Consumable", kind: "stock" });
  const box = await createItem(p.owner, { section_id: fin.id, name: "Bluemins 1 L", unit: "box" });
  const label = await createItem(p.owner, { section_id: con.id, name: "Label 1 L", unit: "bundle", second_unit: "count" });
  const roll = await createItem(p.owner, { section_id: con.id, name: "Roll", unit: "roll", min_level: 2 });
  return { ...p, fin: fin.id, con: con.id, box: box.id, label: label.id, roll: roll.id };
}
export type P = Awaited<ReturnType<typeof stockPlant>>;

/** A full count: production + closing for the box, closing for label and roll. */
export const fullCount = (p: P, date: string, n: { made?: number; box: number; label: number; roll: number }, extra: Partial<CountInput> = {}): CountInput => ({
  date,
  expected_version: 0,
  lines: [
    ...(n.made !== undefined ? [{ item_id: p.box, kind: "production" as const, qty: n.made }] : []),
    { item_id: p.box, kind: "stock", qty: n.box },
    { item_id: p.label, kind: "stock", qty: n.label, second_qty: n.label * 1000 },
    { item_id: p.roll, kind: "stock", qty: n.roll },
  ],
  ...extra,
});

