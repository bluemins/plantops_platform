// "Recent changes": audit rows in plain words for the owner ("Rates: 500ml unit box → case").
import { rateText } from "./rates";

type Change = { from: unknown; to: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const phone = (v: unknown) => (typeof v === "string" && v.length === 10 ? `${v.slice(0, 5)} ${v.slice(5)}` : show(v));
const plural = (n: unknown, word: string) => `${show(n)} ${word}${n === 1 ? "" : "s"}`;

/** One audit row as a sentence. */
export function describeChange(action: string, details: Record<string, unknown>): string {
  const changes = (details.changes ?? {}) as Record<string, Change>;
  switch (action) {
    case "rates.set": {
      const list = (details.rates ?? []) as { product: string; unit?: Change; rate?: Change }[];
      const parts = list.map((r) => {
        const bits: string[] = [];
        if (r.unit) bits.push(`unit ${show(r.unit.from)} → ${show(r.unit.to)}`);
        if (r.rate) bits.push(`rate ${rateText(r.rate.from as string | null)} → ${rateText(r.rate.to as string | null)}`);
        return `${r.product}: ${bits.join(", ")}`;
      });
      return `Rates changed. ${parts.join("; ")}`;
    }
    case "customer.add":
      return `Added customer ${show(details.name)}, ${show(details.place)} (${phone(details.phone)})`;
    case "customer.update": {
      const parts: string[] = [];
      if (changes.name) parts.push(`name ${show(changes.name.from)} → ${show(changes.name.to)}`);
      if (changes.place) parts.push(`place ${show(changes.place.from)} → ${show(changes.place.to)}`);
      if (changes.active) parts.push(changes.active.to ? "switched on" : "switched off");
      return `Customer ${show(details.name)} (${phone(details.phone)}): ${parts.join(", ")}`;
    }
    case "customers.upload":
      return `Uploaded customers${details.file ? ` from ${show(details.file)}` : ""}: ${show(details.added)} new, ${show(details.updated)} updated, ${show(details.unchanged)} unchanged, ${plural(details.rejected, "row")} rejected`;
    case "export.csv":
      return `Exported the orders (CSV, ${plural(details.orders, "order")}, ${plural(details.lines, "line")})`;
    default:
      return action;
  }
}
