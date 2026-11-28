// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md Phase 1): the card list, M2's facts against Receivables, the
// sentence and the Copy rules (no amounts, no phone numbers, private cards never). Pure, no database.
import { describe, expect, it } from "vitest";
import { allFields, CARDS, cardById, isBuilt, type CardDef } from "@/lib/answers/cards";
import { copyText, CopyRefused, leakIn, maskPhones } from "@/lib/answers/copy";
import { formatValue } from "@/lib/answers/facts";
import { m2Facts } from "@/lib/answers/m2";
import { hasSentence, word } from "@/lib/answers/word";
import { agingSummary, type RecBill, type RecData } from "@/lib/receivables";

const TODAY = "2026-11-24";
const party = (k: string, name = `Shop ${k}`, place: string | null = "Bargarh") => ({ customer_key: `c:${k}`, customer_name: name, href: `/customers/${k}?tab=statement`, place });
const bill = (id: string, k: string, total: bigint, bill_date: string, due_date: string | null, name?: string): RecBill =>
  ({ ...party(k, name), id, number: id, bill_date, due_date, total, salesperson: null, vehicle: null });

// a: two late bills (64 and 40 days), part paid; b: one 31 days late; c: exactly 30 days (not counted);
// d: paid in full; e: not yet due; f: a name holding a mobile, no due date (counted from the bill date)
const data: RecData = {
  bills: [
    bill("B-0001", "a", 1_000_00n, "2026-09-01", "2026-09-21"),
    bill("B-0002", "a", 500_00n, "2026-10-01", "2026-10-15"),
    bill("B-0003", "b", 2_000_00n, "2026-10-01", "2026-10-24"),
    bill("B-0004", "c", 9_000_00n, "2026-10-10", "2026-10-25"),
    bill("B-0005", "d", 700_00n, "2026-09-01", "2026-09-10"),
    bill("B-0006", "e", 300_00n, "2026-11-20", "2026-12-05"),
    bill("INV-0007", "f", 250_00n, "2026-08-01", null, "Retail Customer 7999293831"),
  ],
  payments: [
    { ...party("a"), id: "p1", payment_date: "2026-10-05", amount: 400_00n },
    { ...party("d"), id: "p2", payment_date: "2026-09-12", amount: 700_00n },
  ],
  settles: [
    { bill_id: "B-0001", payment_id: "p1", amount: 400_00n, on: "2026-10-05" },
    { bill_id: "B-0005", payment_id: "p2", amount: 700_00n, on: "2026-09-12" },
  ],
};
const phones = new Map([["c:a", "9000000001"], ["c:b", "9000000002"]]);
const facts = m2Facts(data, phones, TODAY);

describe("the card list", () => {
  it("28 questions (M6 added by the owner 2026-11-28), unique ids, every one with an area, a title and the phase that builds it", () => {
    expect(CARDS).toHaveLength(28);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(28);
    for (const c of CARDS) expect(c.title.length > 0 && c.phase >= 1 && c.phase <= 11).toBe(true);
  });
  it("salary, attendance and applicant questions are private (D8, D10)", () => {
    expect(CARDS.filter((c) => c.private).map((c) => c.id)).toEqual(["T1", "T2", "T3", "J1"]);
  });
  it("every built card labels every fact; money is labelled money, phones personal; private cards carry a private fact", () => {
    for (const c of CARDS.filter(isBuilt)) {
      for (const f of allFields(c)) {
        expect(["shareable", "money", "personal", "private"]).toContain(f.privacy);
        if (f.kind === "money") expect(f.privacy).toBe("money");
        if (f.kind === "phone") expect(f.privacy).toBe("personal");
      }
      expect(c.fields!.some((f) => f.privacy === "private")).toBe(c.private);
      expect(hasSentence(c.id)).toBe(true);
      expect(c.source?.href.startsWith("/")).toBe(true);
    }
  });
  it("Phases 1–4 build the money, order and stock cards", () => {
    expect(CARDS.filter(isBuilt).map((c) => c.id)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "O1", "O2", "O3", "O4", "O5", "S1", "S2", "S3", "S4"]);
  });
  it("every fact of a built card, in every table, has a note saying what it is (owner 2026-11-28)", () => {
    for (const c of CARDS.filter(isBuilt)) for (const f of allFields(c)) expect(f.note.length, `${c.id}.${f.key}`).toBeGreaterThan(10);
  });
  it("M4 and M6 are screen only: no Copy for anyone", () => {
    expect(CARDS.filter((c) => c.noCopy).map((c) => c.id)).toEqual(["M4", "M6"]);
  });
});

describe("M2: bills over 30 days", () => {
  it("bills more than 30 days past due (or past the bill date), still owing; largest first", () => {
    expect(facts.rows.map((r) => [r.customer, r.bill_numbers, r.oldest_days, r.due, r.phone])).toEqual([
      ["Shop b", "B-0003", 31, 2_000_00n, "9000000002"],
      ["Shop a", "B-0001, B-0002", 64, 1_100_00n, "9000000001"],
      ["Retail Customer 7999293831", "INV-0007", 115, 250_00n, null],
    ]);
    expect(facts.totals).toEqual({ bills: 4, customers: 3, due: 3_350_00n });
  });
  it("equals Receivables → Aging Summary's 31–45 + Over 45 bands (by due date, 15-day steps) to the paisa", () => {
    const t = agingSummary(data, { asOf: TODAY, basis: "due", interval: 15, filter: {}, group: "none" });
    expect(t.heads.slice(4, 6)).toEqual(["31–45 days", "Over 45 days"]);
    expect((t.total[4] as bigint) + (t.total[5] as bigint)).toBe(facts.totals.due);
  });
  it("no late bills: a plain sentence, no rows", () => {
    const none = m2Facts({ bills: [], payments: [], settles: [] }, new Map(), TODAY);
    expect(none).toEqual({ totals: { bills: 0, customers: 0, due: 0n }, rows: [] });
    expect(word("M2", none)).toBe("No bills are over 30 days late. Nobody to chase today.");
  });
  it("the sentence uses only the facts", () => {
    expect(word("M2", facts)).toBe("4 bills from 3 customers are over 30 days late, ₹3,350 in all. Call Shop b first: ₹2,000, 31 days late.");
  });
});

describe("Copy as WhatsApp message (D7, D10)", () => {
  const m2 = cardById("M2")!;
  const text = copyText(m2, facts, TODAY);

  it("names, places, bill numbers and days; no amounts, no phone numbers", () => {
    expect(text).toBe(
      [
        "*Which bills are over 30 days? Call these first* (as of 24-11-2026)",
        "Bills: 4 · Customers: 3",
        "1. Shop b · Bargarh · B-0003 · 31 days",
        "2. Shop a · Bargarh · B-0001, B-0002 · 64 days",
        "3. Retail Customer xxxxxx3831 · Bargarh · INV-0007 · 115 days",
      ].join("\n"),
    );
    expect(text).not.toMatch(/₹|9000000001|9000000002|7999293831|3,350|2,000/);
    expect(leakIn(text)).toBeNull();
  });
  it("the last check refuses a wrongly labelled field instead of leaking it", () => {
    const wrongMoney: CardDef = { ...m2, fields: m2.fields!.map((f) => (f.kind === "money" ? { ...f, privacy: "shareable" as const } : f)) };
    expect(() => copyText(wrongMoney, facts, TODAY)).toThrow(CopyRefused);
    const wrongPhone: CardDef = { ...m2, fields: m2.fields!.map((f) => (f.kind === "phone" ? { ...f, privacy: "shareable" as const } : f)) };
    expect(() => copyText(wrongPhone, facts, TODAY)).toThrow(CopyRefused);
  });
  it("a private card is never copied", () => {
    expect(() => copyText({ ...m2, private: true }, facts, TODAY)).toThrow(CopyRefused);
  });
  it("the guard knows money and phones in their usual spellings", () => {
    for (const s of ["₹500", "Rs 500", "Rs.500", "INR 20", "+91 98765 43210", "call 9876543210"]) expect(leakIn(s)).not.toBeNull();
    for (const s of ["B-0231", "INV-001700", "64 days", "O-0123"]) expect(leakIn(s)).toBeNull();
    expect(maskPhones("Retail Customer 7999293831")).toBe("Retail Customer xxxxxx3831");
    expect(maskPhones("Shop +91 9876543210")).toBe("Shop xxxxxx3210");
  });
  it("long lists stop at 30 rows and say how many more", () => {
    const many = { totals: facts.totals, rows: Array.from({ length: 35 }, (_, i) => ({ ...facts.rows[0]!, customer: `Shop ${i}` })) };
    const t = copyText(m2, many, TODAY).split("\n");
    expect(t).toHaveLength(2 + 30 + 1);
    expect(t.at(-1)).toBe("…and 5 more in PlantOps.");
  });
  it("money on screen always shows ₹, so the guard can recognise it", () => {
    expect(formatValue("money", 12_345_67n)).toBe("₹12,345.67");
  });
});
