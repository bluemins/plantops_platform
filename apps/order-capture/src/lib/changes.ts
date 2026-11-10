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
      const list = (details.rates ?? []) as { product: string; unit?: Change; rate?: Change; brand?: Change }[];
      const parts = list.map((r) => {
        const bits: string[] = [];
        if (r.unit) bits.push(`unit ${show(r.unit.from)} → ${show(r.unit.to)}`);
        if (r.rate) bits.push(`rate ${rateText(r.rate.from as string | null)} → ${rateText(r.rate.to as string | null)}`);
        if (r.brand) bits.push(`brand ${r.brand.from === "" ? "none" : show(r.brand.from)} → ${r.brand.to === "" ? "none" : show(r.brand.to)}`);
        return `${r.product}: ${bits.join(", ")}`;
      });
      return `Rates changed. ${parts.join("; ")}`;
    }
    case "customer.add":
      return `Added customer ${show(details.name)}, ${show(details.place)} (${phone(details.phone)})${details.from === "call" ? " from a phone call" : ""}`;
    case "drop.switch":
      return `Drop app ${details.enabled ? "switched on" : "switched off"} for ${show(details.name)}`;
    case "drop.brands": {
      const list = (details.brands ?? []) as string[];
      return `Drop app brands for ${show(details.name)}: ${list.length ? list.join(", ") : `${show(details.main)} only`}`;
    }
    case "drop.phone_add":
      return `Drop app: extra phone ${phone(details.phone)} added for ${show(details.name)}`;
    case "drop.phone_remove":
      return `Drop app: extra phone ${phone(details.phone)} removed from ${show(details.name)}`;
    case "drop.make_main":
      return `Drop app: ${phone(details.to)} is now the main phone of ${show(details.name)} (was ${phone(details.from)}): ${show(details.reason)}`;
    case "drop.points_settings": {
      const rewards = (details.rewards ?? []) as string[];
      return `Drop points settings from ${show(details.effective_from)}: start ${show(details.start_date)}, ₹${show(details.rupees_per_point)} a point, paid within ${show(details.late_days)} days of delivery, poll ${show(details.poll_points)} points; free boxes ${rewards.length ? rewards.join(", ") : "none"}`;
    }
    case "drop.poll_add":
      return `Drop poll published: "${show(details.question)}" (${show(details.opens_on)} to ${show(details.closes_on)})`;
    case "drop.poll_close":
      return `Drop poll closed early: "${show(details.question)}"`;
    case "export.poll_csv":
      return `Drop poll answers downloaded (CSV): "${show(details.question)}", ${plural(details.answers, "answer")}`;
    case "drop.reward_add":
      return `Drop free box (points) ${show(details.reward)} added to ${show(details.order)} for ${show(details.name)}`;
    case "drop.reward_cancel":
      return `Drop free box (points) ${show(details.reward)} cancelled for ${show(details.name)}, ${show(details.points)} points back: ${show(details.reason)}`;
    case "ignored.add":
      return `Number ${phone(details.phone)} added to Not an order number (${show(details.label)})`;
    case "ignored.remove":
      return `Number ${phone(details.phone)} removed from Not an order number`;
    case "customer.update": {
      const parts: string[] = [];
      if (changes.name) parts.push(`name ${show(changes.name.from)} → ${show(changes.name.to)}`);
      if (changes.place) parts.push(`place ${show(changes.place.from)} → ${show(changes.place.to)}`);
      if (changes.active) parts.push(changes.active.to ? "switched on" : "switched off");
      return `Customer ${show(details.name)} (${phone(details.phone)}): ${parts.join(", ")}`;
    }
    case "customer.reminders":
      return `Customer ${show(details.name)} (${phone(details.phone)}): ${details.reminders ? "agreed to WhatsApp reminders (on the phone)" : "WhatsApp reminders stopped"}`;
    case "customers.upload":
      return `Uploaded customers${details.file ? ` from ${show(details.file)}` : ""}: ${show(details.added)} new, ${show(details.updated)} updated, ${show(details.unchanged)} unchanged, ${plural(details.rejected, "row")} rejected`;
    case "bot.order":
      return `WhatsApp order ${show(details.ref)}: ${show(details.customer)}, ${show(details.place)} (${plural(details.lines, "product")})`;
    case "bill.link":
      return `Bill ${show(details.number)} linked to order ${show(details.order)} (${show(details.customer)}${details.bill_customer && details.bill_customer !== details.customer ? `; bill under ${show(details.bill_customer)}` : ""})`;
    case "bill.unlink":
      return `Bill ${show(details.number)} taken off order ${show(details.order)} (${show(details.customer)}): ${show(details.reason)}`;
    case "purchases.import":
      return `Imported purchases from Zoho: ${plural(details.vendors_new, "vendor")}, ${plural(details.items_new, "item")}, ${plural(details.bills_new, "bill")} (₹${show(details.billed)}), ${plural(details.payments_new, "payment")} (₹${show(details.paid)})`;
    case "export.csv":
      return `Exported the orders (CSV, ${plural(details.orders, "order")}, ${plural(details.lines, "line")})`;
    default:
      return action;
  }
}
