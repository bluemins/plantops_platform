// Bank remarks (/admin/bank-remarks): owner only on the server, and the rules that fill Remarks / Party.
import { describe, expect, it } from "vitest";
import { getCurrentUser } from "@/server/auth";
import { ownerPageAccess } from "@/server/page-guard";
import {
  emptyMemory,
  findTable,
  learn,
  parseMemory,
  payerName,
  readLines,
  signature,
  suggest,
  type Memory,
} from "@/lib/bank-remarks";
import { makePlant, makeStaff } from "./helpers";

const userOf = (cookie: string) => getCurrentUser(new Request("http://localhost/", { headers: { cookie } }));

describe("who may open Bank remarks", () => {
  it("the owner only; staff, plant staff and nobody logged in are sent away", async () => {
    const plant = await makePlant({ modules: ["floor_stock", "attendance_salary"] });
    const owner = ownerPageAccess(await userOf(plant.adminCookie), "/admin/bank-remarks");
    expect(owner.ok).toBe(true);

    const keeper = await makeStaff(plant, "keeper", ["store_keeper", "plant_staff"]);
    expect(ownerPageAccess(await userOf(keeper.cookie), "/admin/bank-remarks")).toEqual({ ok: false, to: "/home" });
    const staff = await makeStaff(plant, "worker", ["plant_staff"]);
    expect(ownerPageAccess(await userOf(staff.cookie), "/admin/bank-remarks")).toEqual({ ok: false, to: "/home" });

    expect(ownerPageAccess(null, "/admin/bank-remarks")).toEqual({ ok: false, to: "/login?next=%2Fadmin%2Fbank-remarks" });
  });

  it("an owner with a temporary password changes it first", () => {
    const user = { roles: ["tenant_admin"], mustChangeSecret: true } as never;
    expect(ownerPageAccess(user, "/admin/bank-remarks")).toEqual({ ok: false, to: "/change-secret?next=%2Fadmin%2Fbank-remarks" });
  });
});

// The SBI layout from the owner's September statement: details on top, the table from "Txn Date".
const SBI: unknown[][] = [
  ["Account Name", ":", "BLUEMINS"],
  ["Opening Balance as on", "6,215.12"],
  [],
  ["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Branch Code", "Debit", "Credit", "Balance"],
  ["01-Sep-26", "01-Sep-26", "BY TRANSFER-NEFT*UTIB0000123*AXN2610014*ANIL KUMAR SAHU--", "TRANSFER", "4430", "", "4,620.00", "10,835.12"],
  ["05-Sep-26", "05-Sep-26", "DEBIT-ACHDr HDFC0213 CHOLAMANDALAM 61076", "/", "61076", "9,516.00", "", "1,319.12"],
  ["06-Sep-26", "06-Sep-26", "BY TRANSFER-SBIY2262 SELF", "TRANSFER", "80150", "", "50,000.00", "51,319.12"],
  ["06-Sep-26", "06-Sep-26", "TO TRANSFER-INB Advance payment BALAJI SALES 7781234", "CT0AJEYEZ", "99922", "60,000.00", "", "-8,680.88"],
  ["08-Sep-26", "08-Sep-26", "BY TRANSFER-UPI/CR/528114420917/PRIYA DAS/SBIN/priyadas@ybl/UPI--", "TRANSFER", "3679", "", "100", "-8,580.88"],
  ["21-Sep-26", "21-Sep-26", "TO TRANSFER-IMPS/P2A/529412887/KRISHNA ELEC/HDFC", "TRANSFER", "3679", "12,400.00", "", "x"],
  [],
  ["**This is a computer generated statement"],
];

describe("reading the bank's sheet", () => {
  it("finds the table and adds Remarks and Party after the last column", () => {
    const t = findTable(SBI)!;
    expect(t.header).toBe(3);
    expect(t.cols).toEqual({ date: 0, desc: 2, debit: 5, credit: 6, remarks: 8, party: 9 });
    expect(t.newRemarks && t.newParty).toBe(true);
  });

  it("uses Remarks the owner already added, and the column after it for Party", () => {
    const rows = SBI.map((r, i) => (i === 3 ? [...r, "Remarks"] : r));
    expect(findTable(rows)!.cols).toMatchObject({ remarks: 8, party: 9 });
    expect(findTable(rows)!.newRemarks).toBe(false);
  });

  it("reads only money lines, with in / out and amounts", () => {
    const t = findTable(SBI)!;
    const lines = readLines(SBI, t.header, t.cols);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatchObject({ row: 4, dir: "in", credit: 4620, debit: 0, source: "check" });
    expect(lines[1]).toMatchObject({ dir: "out", debit: 9516 });
  });

  it("no table → null", () => {
    expect(findTable([["hello"], ["Date", "Amount"]])).toBeNull();
  });
});

describe("the other person's name in the bank's description", () => {
  it.each([
    ["BY TRANSFER-NEFT*UTIB0000123*AXN2610014*ANIL KUMAR SAHU--", "ANIL KUMAR SAHU"],
    ["BY TRANSFER-UPI/CR/528114420917/PRIYA DAS/SBIN/priyadas@ybl/UPI--", "PRIYA DAS"],
    ["TO TRANSFER-IMPS/P2A/529412887/KRISHNA ELEC/HDFC", "KRISHNA ELEC"],
    ["BY TRANSFER-NEFT*HDFC0000001*N12345*", ""],
    ["BY TRANSFER-SBIY2262 SELF", ""],
    ["CASH DEPOSIT-CASH DEPOSIT SELF", ""],
  ])("%s → %s", (desc, name) => {
    expect(payerName(desc)).toBe(name);
  });

  it("a description without its reference numbers stays the same month to month", () => {
    expect(signature("TO TRANSFER-INB Advance payment BALAJI SALES 7781234")).toBe(signature("TO TRANSFER-INB Advance payment BALAJI SALES 9921100"));
    expect(signature("BY TRANSFER-SBIY2262 SELF")).toContain("SBIY2262");
  });
});

describe("filling remarks", () => {
  const t = findTable(SBI)!;
  const lines = readLines(SBI, t.header, t.cols);
  let n = 0;
  const id = () => `r${++n}`;

  it("nothing remembered: payer names for money in, the payee as party for money out, the rest to check", () => {
    const got = lines.map((l) => suggest(l, emptyMemory()));
    expect(got.map((l) => [l.source, l.remark, l.party])).toEqual([
      ["bank", "Anil Kumar Sahu", ""],
      ["check", "", ""],
      ["check", "", ""],
      ["check", "", ""],
      ["bank", "Priya Das", ""],
      ["check", "", "Krishna Elec"],
    ]);
  });

  it("taught from a remarked month, the next month fills itself", () => {
    const remarked = lines.map((l, i) => ({
      ...l,
      remark: ["Anil Kumar Sahu", "Vehicle EMI", "Self-investment", "B2B purchase", "Priya Das (shop)", "Repairs"][i]!,
      party: ["", "Chola finance", "", "Balaji Sales", "", "Krishna Elec"][i]!,
      source: "file" as const,
    }));
    const memory = learn(emptyMemory(), remarked, id);
    // "Anil Kumar Sahu" is only the bank's name: no rule needed
    expect(memory.rules.map((r) => r.remark).sort()).toEqual(["B2B purchase", "Priya Das (shop)", "Repairs", "Self-investment", "Vehicle EMI"]);

    const october = [
      { ...lines[3]!, desc: "TO TRANSFER-INB Advance payment BALAJI SALES 9912345" },
      { ...lines[2]! },
      { ...lines[4]!, desc: "BY TRANSFER-UPI/CR/600000000001/PRIYA DAS/SBIN/priyadas@ybl/UPI--" },
    ].map((l) => suggest(l, memory));
    expect(october.map((l) => [l.source, l.remark, l.party])).toEqual([
      ["learned", "B2B purchase", "Balaji Sales"],
      ["learned", "Self-investment", ""],
      ["learned", "Priya Das (shop)", ""],
    ]);
  });

  it("a close description is a guess to check; your own rule beats a learned one", () => {
    const memory: Memory = {
      v: 1,
      rules: [
        { id: "a", match: signature("DEBIT-ACHDr HDFC0213 CHOLAMANDALAM"), dir: "out", remark: "Vehicle EMI", party: "Chola finance", by: "learned", uses: 1 },
        { id: "b", match: "SBIY2262", dir: "any", remark: "Own transfer", party: "", by: "you", uses: 0 },
        { id: "c", match: signature("BY TRANSFER-SBIY2262 SELF"), dir: "in", remark: "Self-investment", party: "", by: "learned", uses: 3 },
      ],
    };
    const guess = suggest({ ...lines[1]!, desc: "DEBIT-ACHDr ICIC0213 CHOLAMANDALAM" }, memory);
    expect(guess).toMatchObject({ source: "guess", remark: "Vehicle EMI", ruleId: "a" });
    expect(suggest(lines[2]!, memory)).toMatchObject({ source: "rule", remark: "Own transfer" });
    expect(suggest({ ...lines[1]!, dir: "in" }, memory).source).toBe("check"); // a rule for money out never fills money in
  });

  it("an edit replaces the remembered remark; an unchanged rule just counts a use", () => {
    const m1 = learn(emptyMemory(), [{ ...lines[2]!, remark: "Self-investment", party: "", source: "file" }], id);
    const filled = suggest(lines[2]!, m1);
    const m2 = learn(m1, [filled], id);
    expect(m2.rules).toHaveLength(1);
    expect(m2.rules[0]!.uses).toBe(2);
    const m3 = learn(m2, [{ ...filled, remark: "Capital from owner", source: "edited" }], id);
    expect(m3.rules).toHaveLength(1);
    expect(m3.rules[0]).toMatchObject({ remark: "Capital from owner", uses: 3 });
    expect(m1.rules[0]!.uses).toBe(1); // learn never changes the memory it was given
  });

  it("a backup file is accepted only in the right shape", () => {
    const m = learn(emptyMemory(), [{ ...lines[2]!, remark: "Self-investment", source: "file" }], id);
    expect(parseMemory(JSON.stringify(m))).toEqual(m);
    expect(parseMemory("{}")).toBeNull();
    expect(parseMemory("not json")).toBeNull();
    expect(parseMemory(JSON.stringify({ v: 1, rules: [{ id: 1 }] }))).toBeNull();
  });
});
