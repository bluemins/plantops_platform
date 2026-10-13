// Customer upload (docs/ORDER_CAPTURE_PHASE_PLAN.md "Duplicates"): every row of the duplicates table, first as the
// pure rule (classifyUpload), then end to end on the database (preview saves nothing; confirm saves exactly what the
// preview showed; the same file twice changes nothing). Plus the CSV reader and the rejected-rows file.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/customers/upload/confirm/route";
import { POST as previewRoute } from "@/app/api/customers/upload/preview/route";
import { guessColumns, parseCsv, TEMPLATE_CSV } from "@/lib/csv-read";
import { classifyUpload, planCounts, rejectedCsv, type ExistingCustomer, type UploadRow } from "@/lib/upload";
import { createCustomer, CustomerInput, updateCustomer } from "@/server/customers";
import { confirmUpload, previewUpload } from "@/server/upload";
import { asOwner, auditRows, jsonReq, plant, refused, signInAs } from "./helpers";

afterEach(() => vi.restoreAllMocks());

let n = 1;
const row = (name: string, phone: string, place: string, line = ++n): UploadRow => ({ line, name, phone, place });
const have = (name: string, phone: string, place: string, active = true): ExistingCustomer => ({ id: `id-${phone}`, name, phone, place, active });
const rowsOf = async (tenantId: string) =>
  (await asOwner<{ name: string; phone: string; place: string; active: boolean }>("select name, phone, place, active from order_capture.customers where tenant_id = $1 order by phone", [tenantId])).rows;

describe("the duplicates table (classifyUpload)", () => {
  const list = [have("Sri ram hotel", "9692905402", "bijepur"), have("Raju Store", "9700000455", "Sambalpur", false)];

  it("phone not in the list → New", () => {
    const p = classifyUpload([row("Maa Tarini Store", "+91 91234 56780", "Bargarh", 2)], list);
    expect(p.added).toEqual([{ line: 2, name: "Maa Tarini Store", phone: "9123456780", phoneTyped: "+91 91234 56780", place: "Bargarh" }]);
    expect(planCounts(p)).toMatchObject({ added: 1, unchanged: 0, updated: 0, rejected: 0 });
  });

  it("phone in the list, same name and place → Unchanged (any phone spelling)", () => {
    const p = classifyUpload([row(" Sri  ram hotel ", "096929 05402", "bijepur", 3)], list);
    expect(p.unchanged).toEqual([{ line: 3, name: "Sri ram hotel", phone: "9692905402" }]);
    expect(p.added).toEqual([]);
  });

  it("phone in the list, different name or place → Update, old → new (letter case counts)", () => {
    const p = classifyUpload([row("Sri Ram Hotel", "9692905402", "Bijepur", 4)], list);
    expect(p.updated).toEqual([
      { line: 4, id: "id-9692905402", phone: "9692905402", from: { name: "Sri ram hotel", place: "bijepur", active: true }, to: { name: "Sri Ram Hotel", place: "Bijepur" } },
    ]);
  });

  it("phone in the list but switched off → Update (switched back on), even with the same details", () => {
    const p = classifyUpload([row("Raju Store", "9700000455", "Sambalpur", 5)], list);
    expect(p.updated).toMatchObject([{ id: "id-9700000455", from: { active: false }, to: { name: "Raju Store", place: "Sambalpur" } }]);
  });

  it("same phone twice in the file, identical rows → counted once, the repeat ignored", () => {
    const p = classifyUpload([row("Laxmi Bhojanalaya", "9000000001", "Attabira", 6), row("Laxmi  Bhojanalaya", "+91 90000 00001", " Attabira", 9)], list);
    expect(p.added).toHaveLength(1);
    expect(p.added[0]).toMatchObject({ line: 6, phone: "9000000001" });
    expect(p.repeated).toEqual([{ lines: [6, 9], phone: "9000000001" }]);
    expect(planCounts(p)).toMatchObject({ added: 1, repeated: 1, rejected: 0 });
  });

  it("same phone twice in the file, different name or place → both rows Rejected with their line numbers", () => {
    const p = classifyUpload([row("Raju Store", "9700000455", "Sambalpur", 88), row("Raju General Store", "9700000455", "Sambalpur", 120)], list);
    expect(p.rejected).toEqual([{ lines: [88, 120], phone: "9700000455", reason: "Same phone on lines 88 and 120 with different details (Raju Store, Sambalpur / Raju General Store, Sambalpur)" }]);
    expect(p.added).toEqual([]);
    expect(p.updated).toEqual([]); // not even the switched-off customer is touched
    expect(planCounts(p).rejected).toBe(2);
  });

  it.each([
    ["a bad phone", row("Shop", "12345", "Bargarh", 14), "Not a 10-digit mobile number"],
    ["a non-mobile number", row("Shop", "5876543210", "Bargarh", 14), "Not a 10-digit mobile number"],
    ["an Excel E+ number", row("Shop", "9.18E+11", "Bargarh", 14), "Excel changed this number. Format the phone column as Text and save again"],
    ["no phone", row("Shop", "  ", "Bargarh", 14), "Phone is empty"],
    ["no name", row("", "9123456789", "Bargarh", 14), "Name is missing"],
    ["a one-letter name", row("S", "9123456789", "Bargarh", 14), "Name is too short"],
    ["a name over 100 characters", row("x".repeat(101), "9123456789", "Bargarh", 14), "Name is longer than 100 characters"],
    ["no place", row("Shop", "9123456789", "", 14), "Place is missing"],
    ["a place over 200 characters", row("Shop", "9123456789", "y".repeat(201), 14), "Place is longer than 200 characters"],
    ["several problems at once", row("", "12345", "", 14), "Not a 10-digit mobile number; Name is missing; Place is missing"],
  ])("%s → Rejected with the reason and line number", (_, r, reason) => {
    expect(classifyUpload([r], list).rejected).toEqual([{ lines: [14], phone: r.phone.trim(), reason }]);
  });

  it("same name and place as a customer in the list, another phone → New with a 'possible duplicate' warning", () => {
    const p = classifyUpload([row("SRI RAM HOTEL", "9800000045", "Bijepur", 45)], list);
    expect(p.added).toMatchObject([{ line: 45, phone: "9800000045", possibleDuplicate: "SRI RAM HOTEL, Bijepur already has 96929 05402 in your list" }]);
  });

  it("same name and place twice in the file with different phones → both New, the second with a warning", () => {
    const p = classifyUpload([row("Maa Tarini Store", "9123456780", "Bargarh", 10), row("Maa Tarini Store", "9123456781", "Bargarh", 11)], list);
    expect(p.added.map((a) => [a.line, a.possibleDuplicate ?? null])).toEqual([
      [10, null],
      [11, "Maa Tarini Store, Bargarh is also on line 10 with 91234 56780"],
    ]);
  });

  it("completely empty rows are skipped quietly", () => {
    expect(planCounts(classifyUpload([row("", "", "", 7), row(" ", " ", " ", 8)], list))).toEqual({ added: 0, unchanged: 0, updated: 0, rejected: 0, repeated: 0 });
  });
});

describe("upload on the database (owner)", () => {
  const file = (): UploadRow[] => [
    row("Maa Tarini Store", "+91 91234 56780", "Bargarh", 2), // new
    row("Sri ram hotel", "096929 05402", "bijepur", 3), // unchanged
    row("Hotel Annapurna Deluxe", "9811100102", "Sambalpur", 4), // update
    row("Raju Store", "9700000455", "Sambalpur", 5), // switched off → back on
    row("Laxmi Bhojanalaya", "9000000001", "Attabira", 6), // new …
    row("Laxmi Bhojanalaya", "9000000001", "Attabira", 7), // … repeated
    row("Gupta Stores", "9555500001", "Bargarh", 8), // clash …
    row("Gupta General Stores", "9555500001", "Bargarh", 9), // … clash
    row("Bad", "12345", "Bargarh", 10), // rejected
    row("Sri ram hotel", "9800000045", "bijepur", 11), // new, possible duplicate
  ];
  async function setUp() {
    const p = plant();
    const add = (name: string, phone: string, place: string) => createCustomer(p.owner, CustomerInput.parse({ name, phone, place }));
    await add("Sri ram hotel", "9692905402", "bijepur");
    await add("Hotel Annapurna", "9811100102", "Sambalpur");
    const { customer: raju } = await add("Raju Store", "9700000455", "Sambalpur");
    await updateCustomer(p.owner, raju.id, { active: false });
    return p;
  }

  it("preview shows every case and saves nothing", async () => {
    const p = await setUp();
    const before = await rowsOf(p.tenantId);
    const auditBefore = (await auditRows(p.tenantId)).length;
    const pv = await previewUpload(p.owner, { file_name: "customers.csv", rows: file() });
    expect(pv.counts).toEqual({ added: 3, unchanged: 1, updated: 2, rejected: 3, repeated: 1 });
    expect(pv.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await rowsOf(p.tenantId)).toEqual(before);
    expect(await auditRows(p.tenantId)).toHaveLength(auditBefore);
  });

  it("confirm saves exactly the preview; the same file again changes nothing", async () => {
    const p = await setUp();
    const pv = await previewUpload(p.owner, { file_name: "customers.csv", rows: file() });
    expect(await confirmUpload(p.owner, { file_name: "customers.csv", rows: file(), fingerprint: pv.fingerprint })).toMatchObject({ added: 3, updated: 2, unchanged: 1, rejected: 3 });
    expect(await rowsOf(p.tenantId)).toEqual([
      { name: "Laxmi Bhojanalaya", phone: "9000000001", place: "Attabira", active: true },
      { name: "Maa Tarini Store", phone: "9123456780", place: "Bargarh", active: true },
      { name: "Sri ram hotel", phone: "9692905402", place: "bijepur", active: true },
      { name: "Raju Store", phone: "9700000455", place: "Sambalpur", active: true },
      { name: "Sri ram hotel", phone: "9800000045", place: "bijepur", active: true },
      { name: "Hotel Annapurna Deluxe", phone: "9811100102", place: "Sambalpur", active: true },
    ]);
    const audit = (await auditRows(p.tenantId)).at(-1)!;
    expect(audit).toMatchObject({ action: "customers.upload", details: { file: "customers.csv", added: 3, updated: 2, unchanged: 1, rejected: 3 } });
    expect(audit.details.updates).toEqual([
      { phone: "9811100102", from: { name: "Hotel Annapurna", place: "Sambalpur", active: true }, to: { name: "Hotel Annapurna Deluxe", place: "Sambalpur" } },
      { phone: "9700000455", from: { name: "Raju Store", place: "Sambalpur", active: false }, to: { name: "Raju Store", place: "Sambalpur" } },
    ]);

    const again = await previewUpload(p.owner, { file_name: "customers.csv", rows: file() });
    expect(again.counts).toEqual({ added: 0, unchanged: 6, updated: 0, rejected: 3, repeated: 1 });
    expect(await confirmUpload(p.owner, { file_name: "customers.csv", rows: file(), fingerprint: again.fingerprint })).toMatchObject({ added: 0, updated: 0 });
    expect(await rowsOf(p.tenantId)).toHaveLength(6);
  });

  it("a stale preview is refused (409) and nothing is saved", async () => {
    const p = await setUp();
    const pv = await previewUpload(p.owner, { rows: file(), file_name: "" });
    await createCustomer(p.desk, CustomerInput.parse({ name: "Maa Tarini Store", phone: "9123456780", place: "Bargarh" })); // added meanwhile
    const count = (await rowsOf(p.tenantId)).length;
    expect(await refused(() => confirmUpload(p.owner, { rows: file(), file_name: "", fingerprint: pv.fingerprint }))).toEqual({
      status: 409,
      message: "The customer list changed since the preview. Please check the preview again.",
    });
    expect(await rowsOf(p.tenantId)).toHaveLength(count);
  });

  it("owner only: Order desk, plant staff and support are refused", async () => {
    const p = plant();
    for (const u of [p.desk, p.staff, p.support]) expect((await refused(() => previewUpload(u, { rows: file(), file_name: "" }))).status).toBe(403);
    expect((await refused(() => confirmUpload(p.desk, { rows: file(), file_name: "", fingerprint: "a".repeat(64) }))).status).toBe(403);
  });

  it("through the API: preview 200, confirm 200; over 5,000 rows → 400", async () => {
    const p = plant();
    signInAs(p.owner);
    const rows = [row("Maa Tarini Store", "9123456780", "Bargarh", 2)];
    const pv = await previewRoute(jsonReq("POST", "/api/customers/upload/preview", { file_name: "a.csv", rows }), undefined as never);
    expect(pv.status).toBe(200);
    const { fingerprint } = await pv.json();
    const ok = await confirmRoute(jsonReq("POST", "/api/customers/upload/confirm", { file_name: "a.csv", rows, fingerprint }), undefined as never);
    expect([ok.status, (await ok.json()).added]).toEqual([200, 1]);
    const big = Array.from({ length: 5001 }, (_, i) => row("Shop", "9123456780", "Bargarh", i + 2));
    const tooBig = await previewRoute(jsonReq("POST", "/api/customers/upload/preview", { file_name: "big.csv", rows: big }), undefined as never);
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error).toMatch(/at most 5,000 rows/);
  });

  it("each plant's upload is compared with its own list only", async () => {
    const a = await setUp();
    const b = plant();
    const pv = await previewUpload(b.owner, { rows: file(), file_name: "" });
    expect(pv.counts).toMatchObject({ added: 6, unchanged: 0, updated: 0 });
    await confirmUpload(b.owner, { rows: file(), file_name: "", fingerprint: pv.fingerprint });
    expect(await rowsOf(a.tenantId)).toHaveLength(3);
  });
});

describe("reading the file", () => {
  it("quotes, commas and quotes inside quotes, CRLF, a BOM and Odia text", () => {
    const text = '﻿Name,Phone,Place\r\n"Gupta, Sons",98765 43210,Bargarh\r\n"Hotel ""Annapurna""",+91 91234 56780,"Sambalpur\r\nWard 4"\r\nମା ତାରିଣୀ ଷ୍ଟୋର,9000000001,ବରଗଡ଼\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Phone", "Place"],
      ["Gupta, Sons", "98765 43210", "Bargarh"],
      ['Hotel "Annapurna"', "+91 91234 56780", "Sambalpur\r\nWard 4"],
      ["ମା ତାରିଣୀ ଷ୍ଟୋର", "9000000001", "ବରଗଡ଼"],
    ]);
  });

  it("semicolon files (some Excel settings) and a last line without a line break", () => {
    expect(parseCsv("Name;Phone;Place\nRaju Store;9700000455;Sambalpur")).toEqual([
      ["Name", "Phone", "Place"],
      ["Raju Store", "9700000455", "Sambalpur"],
    ]);
  });

  it("guesses which column is which from the header, whatever the order", () => {
    expect(guessColumns(["Place", "Customer Name", "Mobile No."])).toEqual({ name: 1, phone: 2, place: 0 });
    expect(guessColumns(["Party", "Contact", "City", "GSTIN"])).toEqual({ name: 0, phone: 1, place: 2 });
    expect(guessColumns(["A", "B", "C"])).toEqual({ name: -1, phone: -1, place: -1 });
  });

  it("the template is the plan's, and it uploads cleanly", () => {
    const t = parseCsv(TEMPLATE_CSV);
    expect(t).toEqual([
      ["Name", "Phone", "Place"],
      ["Sri ram hotel", "98765 43210", "bijepur"],
      ["Maa Tarini Store", "+91 91234 56780", "Bargarh"],
    ]);
    const rows = t.slice(1).map((r, i) => ({ line: i + 2, name: r[0]!, phone: r[1]!, place: r[2]! }));
    expect(planCounts(classifyUpload(rows, []))).toMatchObject({ added: 2, rejected: 0 });
  });

  it("the rejected rows come back as the file had them, with a Reason column, formulas neutralised", () => {
    const table = [
      ["Name", "Phone", "Place", "Notes"],
      ["Good", "9123456780", "Bargarh", ""],
      ["=HYPERLINK(1)", "12345", "Bargarh", "call first"],
      ["Raju Store", "9700000455", "Sambalpur", ""],
      ["Raju General Store", "9700000455", "Sambalpur", ""],
    ];
    const rows = table.slice(1).map((r, i) => ({ line: i + 2, name: r[0]!, phone: r[1]!, place: r[2]! }));
    const out = rejectedCsv(table, classifyUpload(rows, []).rejected);
    expect(out.replace(/^﻿/, "").split("\r\n")).toEqual([
      "Name,Phone,Place,Notes,Reason",
      "'=HYPERLINK(1),12345,Bargarh,call first,Not a 10-digit mobile number",
      'Raju Store,9700000455,Sambalpur,,"Same phone on lines 4 and 5 with different details (Raju Store, Sambalpur / Raju General Store, Sambalpur)"',
      'Raju General Store,9700000455,Sambalpur,,"Same phone on lines 4 and 5 with different details (Raju Store, Sambalpur / Raju General Store, Sambalpur)"',
      "",
    ]);
  });
});
