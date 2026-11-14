// "Recent changes": audit rows in plain words for the owner ("Rates: 500ml unit box → case").
import { rateText } from "./rates";

type Change = { from: unknown; to: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const phone = (v: unknown) => (typeof v === "string" && v.length === 10 ? `${v.slice(0, 5)} ${v.slice(5)}` : show(v));
const plural = (n: unknown, word: string) => `${show(n)} ${word}${n === 1 ? "" : "s"}`;

/** One audit row as a sentence. */
/** " (field visit, ±8 m)", " from a Maps link", " (±12 m)" */
export function locationHow(d: Record<string, unknown>): string {
  const acc = typeof d.accuracy_m === "number" ? `±${d.accuracy_m} m` : null;
  if (d.source === "map_link") return " from a Maps link";
  if (d.source === "field_visit") return ` (field visit${acc ? `, ${acc}` : ""})`;
  return acc ? ` (${acc})` : "";
}

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
    case "customer.location":
      return details.kind === "clear"
        ? `Shop location cleared for ${show(details.name)}: ${show(details.reason)}`
        : `Shop location saved for ${show(details.name)}${locationHow(details)}`;
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
    case "vendor.add":
      return `Vendor ${show(details.name)} added${details.gstin ? ` (GSTIN ${show(details.gstin)})` : ""}`;
    case "vendor.update":
      return `Vendor ${show(details.name)} changed: ${Array.isArray(details.changed) ? (details.changed as string[]).join(", ") : ""}`;
    case "purchase.bill":
      return `Purchase bill ${show(details.number)} from ${show(details.vendor)}: ₹${show(details.total)}${details.paid_now ? `, paid now (${show(details.paid_now)})` : ""}`;
    case "purchase.payment":
      return `Paid ₹${show(details.amount)} to ${show(details.vendor)} (${show(details.number)}, ${show(details.mode)})`;
    case "purchase.payment_mode":
      return `Payment ${show(details.number)} to ${show(details.vendor)}: ${show(details.from)} → ${show(details.to)}`;
    case "purchase.bill_cancel":
      return `Purchase bill ${show(details.number)} (${show(details.vendor)}, ₹${show(details.total)}) cancelled: ${show(details.reason)}`;
    case "purchase.payment_cancel":
      return `Payment ${show(details.number)} to ${show(details.vendor)} (₹${show(details.amount)}) cancelled: ${show(details.reason)}`;
    // cash book (docs/CASHBOOK_PHASE_PLAN.md)
    case "cash.start":
      return `Started the cash book on ${show(details.date)} with ₹${show(details.counted)}`;
    case "cash.entry":
      return `Cash ${show(details.ref)}: ${show(details.kind)} ₹${show(details.amount)}${details.category ? ` (${show(details.category)})` : ""}${details.person ? ` (${show(details.person)})` : ""} on ${show(details.date)}`;
    case "cash.cancel":
      return `Cash ${show(details.ref)} (₹${show(details.amount)}) cancelled: ${show(details.reason)}`;
    case "cash.spent":
      return `Spent from cash given: ${show(details.person)} ₹${show(details.amount)} (${show(details.category)}) on ${show(details.date)}`;
    case "cash.spent_cancel":
      return `Spent from cash given (${show(details.person)}, ₹${show(details.amount)}) cancelled: ${show(details.reason)}`;
    case "cash.close":
      return `Closed the cash book for ${show(details.date)}: ₹${show(details.counted)} counted, difference ₹${show(details.difference)}`;
    case "cash.close_fix":
      return `Corrected the cash close of ${show(details.date)}: ₹${show(details.counted)} counted (${show(details.reason)})`;
    case "cash.category_add":
      return `Added expense type "${show(details.name)}"`;
    case "cash.vehicle_add":
      return `Added vehicle "${show(details.name)}"`;
    case "cash.category_edit":
    case "cash.vehicle_edit":
      return `${action === "cash.vehicle_edit" ? "Vehicle" : "Expense type"} "${show(details.name)}"${details.was !== details.name ? ` (was "${show(details.was)}")` : ""}${details.active === false ? ", switched off" : ""}`;
    // cash book C2: 20 L customers and collections
    case "jar.import":
      return `Imported 20 L customers from ${show(details.file)}: ${show(details.customers_new)} new, ${show(details.added_to_existing)} added to existing, ₹${show(details.imported)} opening balances${Number(details.left_out) ? `, ${show(details.left_out)} left out` : ""}`;
    case "cash.collection":
      return `Collection${details.ref ? ` ${show(details.ref)}` : ""} on ${show(details.cash_date)}: ₹${show(details.cash)} cash${details.online !== "0.00" ? `, ₹${show(details.online)} online` : ""} (${plural(details.lines, "line")}, waiting to post)`;
    case "collection.post":
      return `Posted a collection of ₹${show(details.amount)} as ${show(details.payment)} on ${show(details.customer)}'s account`;
    case "collection.turn_down":
      return `Turned down a collection of ₹${show(details.amount)} from ${show(details.customer)}: ${show(details.reason)}`;
    // cash book C3: van reports
    case "cash.van":
      return `Van report ${show(details.ref)}: ${show(details.vehicle)} (${show(details.person)}) on ${show(details.date)}, sold ₹${show(details.sales)}, ₹${show(details.handed_in)} handed in${details.difference !== "0.00" ? ` (difference ₹${show(details.difference)})` : ""}`;
    case "van.credit_bill":
      return `Billed a van "not paid" line: ${show(details.bill)} for ${show(details.customer)}, ₹${show(details.amount)} (${show(details.vehicle)}, ${show(details.entry)})`;
    case "van.credit_turn_down":
      return `Turned down a van "not paid" line of ₹${show(details.amount)} for ${show(details.customer)}: ${show(details.reason)}`;
    case "export.csv":
      return `Exported the orders (CSV, ${plural(details.orders, "order")}, ${plural(details.lines, "line")})`;
    default:
      return action;
  }
}
