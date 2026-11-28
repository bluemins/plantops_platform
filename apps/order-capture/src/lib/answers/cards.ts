// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md): the ONE list of questions PlantOps can answer exactly. Pure, no
// database. The owner's page lists it today; the question finder (Phase 12) and any later AI read the same list, and
// nothing outside it can be asked. Each fact a card returns is declared here with a privacy label and a note saying what
// it is (owner 2026-11-28: a note beside every number), and the Copy button (src/lib/answers/copy.ts) uses the labels:
// only `shareable` facts ever leave PlantOps in a copied message.

/**
 * shareable = may go in a copied WhatsApp message (names, places, bill numbers, counts, days, percents);
 * money = rupee amounts (screen only, D7); personal = phone numbers, people's names, notes (screen only);
 * private = salary, attendance, applicants: owner only, never copied, never shown to support (D8, D10).
 */
export type Privacy = "shareable" | "money" | "personal" | "private";
export type FieldKind = "count" | "money" | "days" | "date" | "text" | "phone" | "percent";
export type Area = "money" | "orders" | "stock" | "purchases" | "staff" | "other" | "business";
export type InputKind = "customer" | "product" | "vehicle" | "date" | "period";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  privacy: Privacy;
  /** a plant-wide total, or one value per row (e.g. per customer) */
  scope: "total" | "row";
  /** what the number is and what it counts, shown beside it (owner 2026-11-28); a card may give a fuller one per answer */
  note: string;
}

/** A second (third…) table on a card, e.g. M1's "Paying slower than usual". Its fields are per row. */
export interface ListDef {
  key: string;
  title: string;
  note: string;
  fields: FieldDef[];
  /** false = never in the copied message (e.g. money day by day) */
  copy?: boolean;
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
  /** screen only: no Copy for anyone (M4, M6: cash stays on the owner's screen) */
  noCopy?: boolean;
  /** the facts it returns; set when the card is built (an unbuilt card has none, so nothing is guessed) */
  fields?: FieldDef[];
  /** the heading and note over the card's main rows */
  rowsTitle?: string;
  rowsNote?: string;
  lists?: ListDef[];
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
/** M1 lists this many customers who owe the most */
export const M1_TOP = 10;
/** O1: pending orders entered this many hours ago or more are "waiting too long" (the amber mark on Pending) */
export const O1_HOURS = 48;

type O = Partial<Pick<CardDef, "inputs" | "private" | "noCopy" | "fields" | "rowsTitle" | "rowsNote" | "lists" | "source">>;
const card = (id: string, area: Area, phase: number, title: string, o: O = {}): CardDef => ({
  id,
  area,
  phase,
  title,
  inputs: o.inputs ?? [],
  private: o.private ?? false,
  ...(o.noCopy ? { noCopy: true } : {}),
  ...(o.fields ? { fields: o.fields } : {}),
  ...(o.rowsTitle ? { rowsTitle: o.rowsTitle } : {}),
  ...(o.rowsNote ? { rowsNote: o.rowsNote } : {}),
  ...(o.lists ? { lists: o.lists } : {}),
  ...(o.source ? { source: o.source } : {}),
});

const T = (key: string, label: string, kind: FieldKind, privacy: Privacy, note: string): FieldDef => ({ key, label, kind, privacy, scope: "total", note });
const R = (key: string, label: string, kind: FieldKind, privacy: Privacy, note: string): FieldDef => ({ key, label, kind, privacy, scope: "row", note });
const customer = R("customer", "Customer", "text", "shareable", "The customer's name in Sales (a Zoho contact not matched yet shows its Zoho name).");
const place = R("place", "Place", "text", "shareable", "The place typed on the customer.");
const phone = R("phone", "Phone", "phone", "personal", "The customer's mobile, for Call and WhatsApp. Never copied.");

export const CARDS: readonly CardDef[] = [
  card("M1", "money", 2, "Who owes the most, and who is paying slower than usual?", {
    fields: [
      T("owed", "Customers owe, today", "money", "money", "All unpaid bills (Zoho and PlantOps, opening balances too) minus advances. The same number as Receivables → Customer Balances."),
      T("customers", "Customers who owe", "count", "shareable", "Customers with something still due today."),
      T("slower", "Paying slower than usual", "count", "shareable", "Customers whose last 3 bills took at least 7 days longer, and 1.5 times longer, to pay than their other bills this year."),
    ],
    rowsTitle: `Owe the most (top ${M1_TOP})`,
    rowsNote: "Largest amount due first.",
    lists: [
      {
        key: "slower",
        title: "Paying slower than usual",
        note: "The same rule as \"paying slower lately\" on the customer's page: their last 3 bills against their other bills of the last 12 months.",
        fields: [
          customer,
          place,
          R("recent_days", "Last 3 bills took", "days", "shareable", "Average days from bill to payment of their last 3 bills (an unpaid one counts its days so far)."),
          R("usual_days", "Usually", "days", "shareable", "Average days of their other bills of the last 12 months."),
          R("due", "Due now", "money", "money", "What they owe today."),
        ],
      },
    ],
    source: { label: "Receivables → Customer Balances", href: "/reports/receivables/balances" },
  }),
  card("M2", "money", 1, "Which bills are over 30 days? Call these first", {
    fields: [
      T("bills", "Bills", "count", "shareable", "Bills still owing that are more than 30 days past their due date (no due date: their bill date)."),
      T("customers", "Customers", "count", "shareable", "Customers those bills belong to."),
      T("due", "Still due", "money", "money", "What is still unpaid on those bills. Equal to Aging Summary's 31–45 + Over 45 days."),
      customer,
      place,
      R("bill_numbers", "Bills", "text", "shareable", "Their bills over 30 days late, oldest first."),
      R("oldest_days", "Days late", "days", "shareable", "Days past the due date of their oldest late bill."),
      R("due", "Still due", "money", "money", "What is unpaid on those bills."),
      phone,
    ],
    rowsNote: "Largest amount first.",
    source: { label: "Receivables → Aging Details", href: "/reports/receivables/aging-details?as_of=today&basis=due&interval=15&group=band" },
  }),
  card("M3", "money", 2, "How much came in this week, cash and online?", {
    fields: [
      T("total", "Came in this week", "money", "money", "Customer payments + van cash sales, Monday to today. Cancelled payments are left out. The same as Business Overview's money in for these days."),
      T("cash", "Cash payments", "money", "money", "Customer payments marked Cash."),
      T("van", "Van cash sales", "money", "money", "Cash the vans took on their trips (van reports: sales − not paid)."),
      T("online", "Online payments", "money", "money", "Customer payments marked UPI, bank, cheque or other."),
      T("last_week", "Same days last week", "money", "money", "Monday to the same weekday last week, same rule."),
      T("change_pct", "Change on last week", "percent", "shareable", "This week against the same days last week."),
      T("payments", "Payments", "count", "shareable", "Customer payments this week."),
      T("cash_payments", "Cash", "count", "shareable", "Of those, marked Cash."),
      T("online_payments", "Online", "count", "shareable", "Of those, UPI, bank, cheque or other."),
      T("van_reports", "Van reports", "count", "shareable", "Van reports this week with cash sales."),
      T("to_post", "Collected, not posted yet", "money", "money", "Collections waiting in Cash → To post. Not in the total: they count as payments once posted, so nothing is counted twice."),
      T("to_post_count", "Collections to post", "count", "shareable", "Collection lines waiting in Cash → To post."),
    ],
    lists: [
      {
        key: "days",
        title: "Day by day",
        note: "Money in each day (payments + van cash sales), this week against last week.",
        copy: false,
        fields: [
          R("day", "Day", "text", "shareable", "The weekday."),
          R("this_week", "This week", "money", "money", "Money in that day this week."),
          R("last_week", "Last week", "money", "money", "The same weekday last week."),
        ],
      },
      {
        key: "biggest",
        title: "Biggest payments this week",
        note: "The five largest customer payments since Monday.",
        copy: false,
        fields: [
          R("customer", "Customer", "text", "personal", "Who paid. Not copied: who paid is not for a group."),
          R("date", "Date", "date", "shareable", "Payment date."),
          R("mode", "Mode", "text", "shareable", "Cash, UPI, bank, cheque or other."),
          R("amount", "Amount", "money", "money", "The payment."),
        ],
      },
    ],
    source: { label: "Business Overview", href: "/reports?section=business" },
  }),
  card("M4", "money", 2, "Why is cash in hand short today?", {
    noCopy: true,
    fields: [
      T("state", "Last close", "text", "personal", "Short, extra or matched at the last close of the cash book."),
      T("close_date", "Closed on", "date", "personal", "The cash day of the last close."),
      T("difference", "Difference", "money", "money", "Counted minus expected at that close. Short = less cash in the box than the book says."),
      T("expected", "Expected", "money", "money", "The count before + cash in − cash out of the entries in between."),
      T("counted", "Counted", "money", "money", "The cash counted in the box at the close."),
      T("reason", "Reason typed", "text", "personal", "What was typed when closing with a difference."),
      T("days_open", "Days not closed", "count", "personal", "Days since the last close, today not counted."),
      R("ref", "Entry", "text", "personal", "The cash-book entry number."),
      R("what", "What", "text", "personal", "The kind of entry, with its expense type, van or person."),
      R("direction", "In / out", "text", "personal", "Cash in or out of the box."),
      R("amount", "Amount", "money", "money", "The entry's amount."),
      R("by", "Entered by", "text", "personal", "Who typed it."),
      R("marks", "Look here", "text", "personal", "Why this entry is worth checking: cancelled after the close, van short, ₹2,000 or more, staff cash, or typed for an earlier day."),
    ],
    rowsTitle: "Where to look",
    rowsNote: "Every entry between the close before and this close, biggest first. The marks show where a mistake often hides: they show where to look, not the proven cause.",
    lists: [],
    source: { label: "Cash → day sheet", href: "/cash" },
  }),
  card("M5", "money", 2, "Is this month's sales up or down, and from which customers or brands?", {
    fields: [
      T("now", "Sold this month so far", "money", "money", "Bills + van cash sales, before GST. Cancelled bills and opening balances are left out. The same as Business charts for these dates."),
      T("before", "Same days last month", "money", "money", "The same days of the month before, same rule."),
      T("change_pct", "Change", "percent", "shareable", "This period against the one it is compared with."),
      T("from", "From", "date", "shareable", "First day counted."),
      T("to", "To", "date", "shareable", "Last day counted."),
      T("last_year", "Same days last year", "money", "money", "Shown only when PlantOps has full records for those days."),
      T("last_year_pct", "Change on last year", "percent", "shareable", "Against the same days last year."),
    ],
    lists: [
      {
        key: "brands",
        title: "By brand",
        note: "Before GST. The brand comes from Rates. Van sales have no product, so they are their own line.",
        fields: [
          R("brand", "Brand", "text", "shareable", "The product's brand on Rates (a guess from the name when empty)."),
          R("now", "Now", "money", "money", "This period."),
          R("before", "Before", "money", "money", "The period compared with."),
          R("change_pct", "Change", "percent", "shareable", "Up or down."),
        ],
      },
      {
        key: "grew",
        title: "Grew most",
        note: "The 5 customers whose bills went up most against the period compared with.",
        fields: [customer, R("now", "Now", "money", "money", "Their bills this period, before GST."), R("change", "Change", "money", "money", "How much more they bought than in the period compared with.")],
      },
      {
        key: "dropped",
        title: "Dropped most",
        note: "The 5 customers whose bills went down most. ₹0 now = bought before, nothing yet this period.",
        fields: [customer, R("now", "Now", "money", "money", "Their bills this period, before GST."), R("change", "Change", "money", "money", "How much less they bought than in the period compared with.")],
      },
    ],
    source: { label: "Reports → Business charts", href: "/reports/business/charts" },
  }),
  card("M6", "money", 2, "How much cash is in the box now, and how much did we sell today?", {
    noCopy: true,
    fields: [
      T("cash", "Cash in the box", "money", "money", "Counted at today's close, or (not closed yet) expected now: the last count + cash in − cash out since."),
      T("cash_state", "Counted or expected", "text", "personal", "Counted = someone counted the box today. Expected = what the book says should be there."),
      T("last_count", "Last count", "money", "money", "The cash counted at the last close."),
      T("cash_in", "Cash in since", "money", "money", "Cash-book entries in after the last count (not cancelled)."),
      T("cash_out", "Cash out since", "money", "money", "Cash-book entries out after the last count (not cancelled)."),
      T("sold", "Sold today so far", "money", "money", "Bills dated today + van cash sales today, with GST. Cancelled bills and opening balances are left out. Orders not billed yet are not in it."),
      T("bills", "Bills today", "count", "personal", "Bills dated today."),
      T("vans", "Van reports today", "count", "personal", "Van reports for today with cash sales."),
      T("week_ago", "Same weekday last week", "money", "money", "The whole of that day, same rule."),
      T("change", "Change", "money", "money", "Today so far against all of that day. It can still grow before tonight."),
      T("not_billed", "Delivered, not billed yet", "count", "personal", "Orders delivered today with no bill. Their value is not in \"Sold today\" until billed."),
    ],
    source: { label: "Cash → day sheet and Reports → Day report", href: "/reports/day" },
  }),
  card("O1", "orders", 3, "Which pending orders are waiting too long, and is stock there?", {
    fields: [
      T("late", "Waiting 2 days or more", "count", "shareable", "Pending orders entered 2 days (48 hours) ago or more: the same rule as the amber mark on Sales → Pending."),
      T("pending", "Pending in all", "count", "shareable", "Every order not yet delivered or cancelled, today's included."),
      T("stock_on", "Stock as of", "date", "shareable", "The day of the last Floor Stock count. Anything made or sent out since is not in it."),
      R("ref", "Order", "text", "shareable", "The order number."),
      customer,
      place,
      R("days", "Waiting", "days", "shareable", "Whole days since the order was entered."),
      R("products", "Products", "text", "shareable", "What the order is for, free boxes included."),
      R("stock", "Stock", "text", "shareable", "Whether the last count has enough for all pending orders of these products."),
      phone,
    ],
    rowsTitle: "Waiting too long",
    rowsNote: "Oldest first.",
    lists: [
      {
        key: "stock",
        title: "Stock for all pending orders",
        note: "What all pending orders need, against the closing stock of the last count. Free boxes count. Short = to make before delivery.",
        fields: [
          R("product", "Product", "text", "shareable", "The product on the orders."),
          R("needed", "Needed", "count", "shareable", "Boxes (or the order's unit) all pending orders need."),
          R("in_stock", "In stock", "count", "shareable", "Closing stock at the last count, in the same unit."),
          R("short", "Short", "text", "shareable", "Needed − in stock, when more is needed. \"Not counted\" = the product isn't linked in Floor Stock."),
        ],
      },
    ],
    source: { label: "Sales → Pending", href: "/?tab=pending" },
  }),
  card("O2", "orders", 3, "Who usually orders regularly but hasn't for a while?", {
    fields: [
      T("late", "Late to reorder", "count", "shareable", "Customers with a usual gap between orders whose next order is later than that gap allows. The same rule as \"Next order: late\" on the customer's page."),
      T("stopped", "Looks stopped", "count", "shareable", "No order for more than 60 days and 3 times their usual gap."),
      customer,
      place,
      R("usual_gap", "Usual gap", "days", "shareable", "The middle gap between their last orders."),
      R("since_last", "Since last order", "days", "shareable", "Days since their last order or bill."),
      R("days_late", "Late by", "days", "shareable", "Days past the day their next order was expected."),
      R("basket", "Usual order", "text", "shareable", "Products in at least half of their last 5 orders."),
      R("pending", "Pending order", "text", "shareable", "An order of theirs waiting to be delivered, if any."),
      phone,
    ],
    rowsTitle: "Late to reorder",
    rowsNote: "Most days late first.",
    lists: [
      {
        key: "stopped",
        title: "Looks stopped",
        note: "Listed apart: a call may not bring them back.",
        fields: [
          customer,
          place,
          R("usual_gap", "Usual gap", "days", "shareable", "Their usual gap when they were ordering."),
          R("last_date", "Last order", "date", "shareable", "Their last order or bill."),
          R("since_last", "Since then", "days", "shareable", "Days without an order."),
        ],
      },
    ],
    source: { label: "the customer's Buying & paying", href: "/customers" },
  }),
  card("O3", "orders", 3, "Who stopped buying a product, and when?", {
    inputs: ["product"],
    fields: [
      T("product", "Product", "text", "shareable", "The product asked about."),
      T("stopped", "Stopped buying it", "count", "shareable", "It was in at least 3 (and 40 %) of their 10 orders before the last 3, and in none of the last 3. The same rule as \"Products stopped\" on the customer's page."),
      T("still_buying", "Still buying other products", "count", "shareable", "Of those, customers still ordering from us, just not this product."),
      T("stopped_all", "Stopped everything", "count", "shareable", "Of those, customers with no order for 60 days and 3 times their usual gap."),
      customer,
      place,
      R("last_date", "Last bought it", "date", "shareable", "The last order or bill with this product."),
      R("times", "Was in", "text", "shareable", "How many of their earlier orders had it."),
      R("still_buys", "Now buys", "text", "shareable", "Their usual order now; \"no orders\" = stopped everything."),
    ],
    rowsTitle: "Who, latest stop first",
    rowsNote: "Customers with fewer than 6 orders in all aren't judged: too few to tell.",
    source: { label: "the customer's Buying & paying", href: "/customers" },
  }),
  card("O4", "orders", 3, "Which villages had the most orders?", {
    inputs: ["period"],
    fields: [
      T("orders", "Orders", "count", "shareable", "Orders entered in the period, delivered or pending. Cancelled orders are left out."),
      T("places", "Places", "count", "shareable", "Different places typed on the customers. A place spelled two ways counts twice until it is fixed."),
      T("from", "From", "date", "shareable", "First day counted."),
      T("to", "To", "date", "shareable", "Last day counted."),
      R("place", "Place", "text", "shareable", "The place on the customer (spelled as most of its customers have it)."),
      R("orders", "Orders", "count", "shareable", "Orders from customers of that place."),
      R("customers", "Customers", "count", "shareable", "Customers of that place who ordered."),
      R("quantity", "Quantity", "count", "shareable", "Boxes (and other units) on those orders, free boxes included."),
      R("vs_before", "vs before", "text", "shareable", "Orders against the same number of days just before."),
    ],
    rowsTitle: "By place",
    rowsNote: "Most orders first.",
    lists: [
      {
        key: "lookalike",
        title: "Maybe the same place",
        note: "Places whose names are very close: they are counted apart. Fix the place on those customers to merge them.",
        fields: [R("places", "Places", "text", "shareable", "The two spellings."), R("orders", "Orders", "count", "shareable", "Orders of both together.")],
      },
    ],
    source: { label: "Order flow check", href: "/reports/flow-check" },
  }),
  card("O5", "orders", 3, "What does this customer usually order?", {
    inputs: ["customer"],
    fields: [
      T("customer", "Customer", "text", "shareable", "The customer asked about."),
      T("usual_gap", "Usual gap between orders", "days", "shareable", "The middle gap of their last orders."),
      T("last_date", "Last order", "date", "shareable", "Their last order or bill."),
      T("next_date", "Next order expected", "date", "shareable", "Last order + usual gap."),
      T("next_state", "Next order", "text", "shareable", "Ahead, due, late or stopped, as on the customer's page."),
      R("product", "Product", "text", "shareable", "A product in at least half of their last 5 orders."),
      R("usual", "Usual quantity", "text", "shareable", "The middle quantity of those orders."),
      R("times", "In last orders", "text", "shareable", "How many of their last 5 orders had it."),
      R("last_rate", "Last rate", "money", "money", "The rate on their latest bill line for it. Never copied."),
    ],
    rowsTitle: "Usual order",
    rowsNote: "Paid lines only: free boxes don't count as buying.",
    lists: [
      {
        key: "stopped",
        title: "Stopped buying",
        note: "In at least 3 of their 10 earlier orders, not in the last 3.",
        fields: [R("product", "Product", "text", "shareable", "The product."), R("last_date", "Last bought", "date", "shareable", "The last order or bill with it.")],
      },
    ],
    source: { label: "the customer's Buying & paying", href: "/customers" },
  }),
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
/** Every fact of a card: its totals, its main rows and each list's columns. */
export const allFields = (c: CardDef) => [...(c.fields ?? []), ...(c.lists ?? []).flatMap((l) => l.fields)];
