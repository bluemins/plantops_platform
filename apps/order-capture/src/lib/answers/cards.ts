// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md): the ONE list of questions PlantOps can answer exactly. Pure, no
// database. The owner's page lists it today; the question finder (Phase 12) and any later AI read the same list, and
// nothing outside it can be asked. Each fact a card returns is declared here with a privacy label, and the Copy
// button (src/lib/answers/copy.ts) uses those labels: only `shareable` facts ever leave PlantOps in a copied message.

/**
 * shareable = may go in a copied WhatsApp message (names, places, bill numbers, counts, days);
 * money = rupee amounts (screen only, D7); personal = phone numbers, notes (screen only);
 * private = salary, attendance, applicants: owner only, never copied, never shown to support (D8, D10).
 */
export type Privacy = "shareable" | "money" | "personal" | "private";
export type FieldKind = "count" | "money" | "days" | "date" | "text" | "phone";
export type Area = "money" | "orders" | "stock" | "purchases" | "staff" | "other" | "business";
export type InputKind = "customer" | "product" | "vehicle" | "date" | "period";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  privacy: Privacy;
  /** a plant-wide total, or one value per row (e.g. per customer) */
  scope: "total" | "row";
}

export interface CardDef {
  id: string;
  area: Area;
  title: string;
  /** the phase that builds it (section 7 of the plan) */
  phase: number;
  inputs: InputKind[];
  /** owner only, never copied, never support (T1–T3, J1) */
  private: boolean;
  /** the facts it returns; set when the card is built (an unbuilt card has none, so nothing is guessed) */
  fields?: FieldDef[];
  /** the PlantOps page the numbers come from */
  source?: { label: string; href: string };
}

export const AREA_LABEL: Record<Area, string> = {
  money: "Money",
  orders: "Orders and customers",
  stock: "Stock and production",
  purchases: "Purchases",
  staff: "Attendance and salary",
  other: "Complaints, applicants, documents",
  business: "Business questions",
};
export const AREAS = Object.keys(AREA_LABEL) as Area[];

/** Bills more than this many days past their due date count for M2 */
export const M2_DAYS = 30;

const card = (id: string, area: Area, phase: number, title: string, o: Partial<Pick<CardDef, "inputs" | "private" | "fields" | "source">> = {}): CardDef => ({
  id,
  area,
  phase,
  title,
  inputs: o.inputs ?? [],
  private: o.private ?? false,
  ...(o.fields ? { fields: o.fields } : {}),
  ...(o.source ? { source: o.source } : {}),
});

export const CARDS: readonly CardDef[] = [
  card("M1", "money", 2, "Who owes the most, and who is paying slower than usual?"),
  card("M2", "money", 1, "Which bills are over 30 days? Call these first", {
    fields: [
      { key: "bills", label: "Bills", kind: "count", privacy: "shareable", scope: "total" },
      { key: "customers", label: "Customers", kind: "count", privacy: "shareable", scope: "total" },
      { key: "due", label: "Still due", kind: "money", privacy: "money", scope: "total" },
      { key: "customer", label: "Customer", kind: "text", privacy: "shareable", scope: "row" },
      { key: "place", label: "Place", kind: "text", privacy: "shareable", scope: "row" },
      { key: "bill_numbers", label: "Bills", kind: "text", privacy: "shareable", scope: "row" },
      { key: "oldest_days", label: "Days late", kind: "days", privacy: "shareable", scope: "row" },
      { key: "due", label: "Still due", kind: "money", privacy: "money", scope: "row" },
      { key: "phone", label: "Phone", kind: "phone", privacy: "personal", scope: "row" },
    ],
    source: { label: "Receivables → Aging Details", href: "/reports/receivables/aging-details?as_of=today&basis=due&interval=15&group=band" },
  }),
  card("M3", "money", 2, "How much came in this week, cash and online?"),
  card("M4", "money", 2, "Why is cash in hand short today?"),
  card("M5", "money", 2, "Is this month's sales up or down, and from which customers or brands?"),
  card("O1", "orders", 3, "Which pending orders are waiting too long, and is stock there?"),
  card("O2", "orders", 3, "Who usually orders regularly but hasn't for a while?"),
  card("O3", "orders", 3, "Who stopped buying a product, and when?", { inputs: ["product"] }),
  card("O4", "orders", 3, "Which villages had the most orders?", { inputs: ["period"] }),
  card("O5", "orders", 3, "What does this customer usually order?", { inputs: ["customer"] }),
  card("S1", "stock", 4, "What should we make today?"),
  card("S2", "stock", 4, "When will caps, labels or preforms run out?"),
  card("S3", "stock", 4, "Was today's count done? Did someone forget consumables?"),
  card("S4", "stock", 4, "Which items hold too much stock on the shelf?"),
  card("P1", "purchases", 8, "What do I owe vendors, and what's due this week?"),
  card("P2", "purchases", 8, "Preform cost per month: is the price going up?", { inputs: ["period"] }),
  card("T1", "staff", 9, "Who hasn't marked IN? Who is often late?", { private: true }),
  card("T2", "staff", 9, "Which field-duty claims are waiting?", { private: true }),
  card("T3", "staff", 9, "What will this month's salary come to so far?", { private: true }),
  card("C1", "other", 10, "Which complaints are open over 3 days, and on which product?"),
  card("C2", "other", 10, "Do complaints rise after a certain product?", { inputs: ["period"] }),
  card("J1", "other", 10, "How many new applicants for each post?", { private: true }),
  card("L1", "other", 10, "Which licences expire in the next 30 days?"),
  card("B1", "business", 11, "My best 10 customers: are any slowing down?"),
  card("B2", "business", 11, "Is a van's trip worth it?", { inputs: ["vehicle", "period"] }),
  card("B3", "business", 11, "If I stop a product, what do I lose?", { inputs: ["product"] }),
  card("B4", "business", 11, "Summarise this month in 5 lines for my accountant", { inputs: ["period"] }),
];

export const cardById = (id: string) => CARDS.find((c) => c.id === id);
export const isBuilt = (c: CardDef) => !!c.fields;
