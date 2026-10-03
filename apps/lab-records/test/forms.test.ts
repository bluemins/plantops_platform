// Steps 5 + 6: FSSAI Forms 1-4 (entry, correction, "Verified By"), search, the plan's history window and the
// owner's full export.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBatch, getBatch, listBatches } from "@/server/batches";
import { correctEntry, createEntry, getEntry, listEntries, verifyEntry } from "@/server/entries";
import { exportBatches, exportRecords } from "@/server/export";
import { listParameters, updateParameter } from "@/server/parameters";
import { form1Due } from "@/server/reminders";
import { search } from "@/server/search";
import { withTenant } from "@/server/db";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused } from "./helpers";

let platform: FakePlatform;
let P: ReturnType<typeof plant>;
let barium: string;
let iron: string;
let tds: string;
let batchId: string;

const day = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - offset * 86_400_000));

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  P = plant();
  const params = await listParameters(P.lead);
  barium = params.find((p) => p.code === "barium")!.id;
  iron = params.find((p) => p.code === "iron")!.id;
  tds = params.find((p) => p.code === "tds")!.id;
  await updateParameter(P.lead, barium, { limit_max: "0.7" });
  await updateParameter(P.lead, iron, { limit_max: "0.1" });
  batchId = (await createBatch(P.tech, { batch_no: "F-100", production_date: day(1) })).id;
});
afterAll(() => platform.close());

const form1 = (over: Record<string, unknown> = {}, results = [{ parameter_id: barium, value: "0.2" }]) =>
  createEntry(P.tech, { form: "form1", batch_id: batchId, data: { test_date: day(0), source: "in_house", ...over }, results });

describe("Form 1 – monthly testing", () => {
  it("saves the 16-column results for a batch, dated by the test date, with where it was tested", async () => {
    const e = await form1({ remark: "monthly" }, [{ parameter_id: barium, value: "0.2" }, { parameter_id: iron, value: "0.05" }]);
    expect(e).toMatchObject({ form: "form1", batch_no: "F-100", current: { verdict: "pass", data: { source: "in_house", test_date: day(0), remark: "monthly" } } });
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(e.current.tested_at))).toBe(day(0));
    expect(e.current.results.map((r) => r.name)).toEqual(["Barium", "Iron"]); // Form 1 column order
  });

  it("an outside lab needs its name and report no.", async () => {
    expect((await refused(() => form1({ source: "outside" }))).message).toMatch(/lab name and report no/);
    const e = await form1({ source: "outside", lab_name: "Odisha Test House", report_no: "OTH/26/118", report_date: day(0) });
    expect(e.current.data).toMatchObject({ lab_name: "Odisha Test House", report_no: "OTH/26/118" });
  });

  it("refuses: no batch, a daily check instead of a Form 1 parameter, no results, a future date", async () => {
    expect((await refused(() => createEntry(P.tech, { form: "form1", data: { test_date: day(0), source: "in_house" }, results: [{ parameter_id: barium, value: "1" }] }))).message).toMatch(/batch/);
    expect((await refused(() => form1({}, [{ parameter_id: tds, value: "100" }]))).status).toBe(400);
    expect((await refused(() => form1({}, []))).status).toBe(400);
    expect((await refused(() => form1({ test_date: day(-3) }))).message).toMatch(/future/);
  });

  it("a failing Form 1 result puts the batch on hold", async () => {
    const b = await createBatch(P.tech, { batch_no: "F-101", production_date: day(0) });
    await createEntry(P.tech, { form: "form1", batch_id: b.id, data: { test_date: day(0), source: "in_house" }, results: [{ parameter_id: iron, value: "0.3" }] });
    const d = await getBatch(P.owner, b.id);
    expect(d.status).toBe("on_hold");
    expect(d.events.at(-1)!.note).toBe("Iron 0.3 mg/L (max 0.1)");
  });

  it("recording Form 1 this month clears 'Form 1 due'", async () => {
    const Q = plant();
    await listParameters(Q.lead);
    expect(await withTenant(Q.tenantId, (tx) => form1Due(tx, Q.tenantId))).toBe(true);
    expect(await withTenant(P.tenantId, (tx) => form1Due(tx, P.tenantId))).toBe(false);
  });
});

describe("Forms 2, 3 and 4", () => {
  it("Form 2 (NABL lab) for a batch: the sheet's columns, no results; the report no. added later as a correction", async () => {
    const e = await createEntry(P.tech, {
      form: "form2",
      batch_id: batchId,
      data: { manufacturing_date: day(1), packing_type: "1 L PET bottle", sample_sent_on: day(0), lab_name: "NABL Lab Bhubaneswar" },
    });
    expect(e.current).toMatchObject({ verdict: "none", data: { packing_type: "1 L PET bottle", lab_name: "NABL Lab Bhubaneswar" } });
    const v2 = await correctEntry(P.tech, e.id, { reason: "report received", data: { report_no: "NABL/7781", report_date: day(0) } });
    expect(v2.versions.map((v) => v.data.report_no ?? null)).toEqual([null, "NABL/7781"]);
    expect((await refused(() => correctEntry(P.tech, e.id, { reason: "same again", data: { report_no: "NABL/7781" } }))).message).toMatch(/Nothing was changed/);
  });

  it("Form 2 refuses missing columns and parameter results", async () => {
    expect((await refused(() => createEntry(P.tech, { form: "form2", batch_id: batchId, data: { manufacturing_date: day(1), sample_sent_on: day(0), lab_name: "X" } }))).message).toMatch(/Type of packing: required/);
    expect(
      (await refused(() => createEntry(P.tech, { form: "form2", batch_id: batchId, data: { manufacturing_date: day(1), packing_type: "jar", sample_sent_on: day(0), lab_name: "X" }, results: [{ parameter_id: barium, value: "1" }] }))).status,
    ).toBe(400);
  });

  it("Form 3 (source water) has no batch; a FAIL outcome alerts the owner but holds nothing", async () => {
    const e = await createEntry(P.tech, { form: "form3", data: { source_of_water: "Borewell 2", lab_name: "SGS", sample_sent_on: day(2), results: "Nitrate 60 mg/L", outcome: "fail" } });
    expect(e).toMatchObject({ batch_id: null, current: { verdict: "fail" } });
    const alerts = await asOwner("select kind, message from lab_records.alerts where tenant_id = $1 and kind = 'form_failed'", [P.tenantId]);
    expect(alerts.rows[0]!.message).toMatch(/Form 3 · Source water: outcome FAIL \(Borewell 2\)/);
    expect((await refused(() => createEntry(P.tech, { form: "form3", batch_id: batchId, data: { source_of_water: "x", lab_name: "x", sample_sent_on: day(0), outcome: "pass" } }))).status).toBe(400);
  });

  it("Form 4 (plastic containers): pass, and 'awaiting report' gives no verdict", async () => {
    const base = { packaging_type: "20 L jar", supplier: "Kalinga Plastics", quantity_received: "5,000 pcs", lab_name: "SGS", samples_sent_on: day(3) };
    expect((await createEntry(P.tech, { form: "form4", data: { ...base, overall_migration: "4.1 mg/dm²", outcome: "pass" } })).current.verdict).toBe("pass");
    expect((await createEntry(P.tech, { form: "form4", data: { ...base, outcome: "pending" } })).current.verdict).toBe("none");
    expect((await listEntries(P.owner, "form4")).length).toBe(2);
  });

  it("the owner can't enter forms; dates older than two years are refused", async () => {
    expect((await refused(() => createEntry(P.owner, { form: "form3", data: { source_of_water: "x", lab_name: "x", sample_sent_on: day(0), outcome: "pass" } }))).status).toBe(403);
    expect((await refused(() => createEntry(P.tech, { form: "form3", data: { source_of_water: "x", lab_name: "x", sample_sent_on: day(800), outcome: "pass" } }))).status).toBe(400);
  });
});

describe("Verified By", () => {
  it("lab lead or owner verifies the current version; a correction needs verifying again", async () => {
    const e = await form1({ remark: "to verify" });
    expect((await refused(() => verifyEntry(P.tech, e.id))).status).toBe(403);
    const v = await verifyEntry(P.lead, e.id);
    expect(v.current.verified).toMatchObject({ by: "Priya" });
    expect((await refused(() => verifyEntry(P.owner, e.id))).message).toMatch(/Already verified by Priya/);
    const fixed = await correctEntry(P.tech, e.id, { reason: "wrong value typed", results: [{ parameter_id: barium, value: "0.25" }] });
    expect(fixed.current.verified).toBeNull();
    expect(fixed.versions[0]!.verified).toMatchObject({ by: "Priya" });
    expect((await verifyEntry(P.owner, e.id)).current.verified).toMatchObject({ by: "Sujata" });
  });
});

describe("search", () => {
  it("finds records by form, pass/fail and batch no.; batches by status", async () => {
    const byForm = await search(P.owner, { kind: "records", form: "form3" });
    expect(byForm.kind === "records" && byForm.records.every((r) => r.form === "form3")).toBe(true);
    const fails = await search(P.owner, { kind: "records", verdict: "fail" });
    expect(fails.kind === "records" && fails.records.length > 0 && fails.records.every((r) => r.current.verdict === "fail")).toBe(true);
    const f100 = await search(P.owner, { kind: "records", batch_no: "f-100" });
    expect(f100.kind === "records" && f100.records.length > 0 && f100.records.every((r) => r.batch_no === "F-100")).toBe(true);
    const held = await search(P.owner, { kind: "batches", status: "on_hold" });
    expect(held.kind === "batches" && held.batches.map((b) => b.batch_no)).toEqual(["F-101"]);
  });

  it("date range uses the record's date", async () => {
    const r = await search(P.owner, { kind: "records", from: day(2), to: day(2) });
    expect(r.kind === "records" && r.records.map((x) => x.form)).toEqual(["form3"]);
  });

  it("another plant finds nothing of ours", async () => {
    const other = plant();
    const r = await search(other.owner, { kind: "records", batch_no: "F-100" });
    expect(r.kind === "records" && r.records).toEqual([]);
  });
});

describe("plan history window", () => {
  it("older records are hidden from lists, pages and search, but kept, and in the owner's export", async () => {
    const H = plant();
    platform.historyMonths[H.tenantId] = 1;
    await listParameters(H.lead);
    const old = await createBatch(H.tech, { batch_no: "OLD-9", production_date: day(60) });
    const recent = await createBatch(H.tech, { batch_no: "NEW-9", production_date: day(1) });
    const oldForm = await createEntry(H.tech, { form: "form3", data: { source_of_water: "Old well", lab_name: "SGS", sample_sent_on: day(60), outcome: "pass" } });

    expect((await listBatches(H.owner)).map((b) => b.batch_no)).toEqual(["NEW-9"]);
    expect((await refused(() => getBatch(H.owner, old.id))).status).toBe(410);
    expect((await getBatch(H.owner, recent.id)).batch_no).toBe("NEW-9");
    expect((await refused(() => getEntry(H.owner, oldForm.id))).status).toBe(410);
    const s = await search(H.owner, { kind: "batches", from: day(365) });
    expect(s.cutoff! > day(32) && s.cutoff! <= day(27)).toBe(true); // about one month back
    expect(s.kind === "batches" && s.batches.map((b) => b.batch_no)).toEqual(["NEW-9"]);

    const csv = await exportBatches(H.owner);
    expect(csv).toContain("OLD-9");
    expect(await exportRecords(H.owner)).toContain("Old well");
    const stillThere = await asOwner("select count(*)::int as n from lab_records.batches where id = $1", [old.id]);
    expect(stillThere.rows[0]!.n).toBe(1);
  });
});

describe("owner's export", () => {
  it("only the owner may export", async () => {
    expect((await refused(() => exportRecords(P.lead))).status).toBe(403);
    expect((await refused(() => exportBatches(P.tech))).status).toBe(403);
  });

  it("has every version of every record, and is safe to open in Excel", async () => {
    await createEntry(P.tech, { form: "form3", data: { source_of_water: "=HYPERLINK(\"x\")", lab_name: "SGS", sample_sent_on: day(0), outcome: "pass" } });
    const csv = await exportRecords(P.owner);
    expect(csv.startsWith("﻿record_id,form,batch_no,version")).toBe(true);
    expect(csv).toMatch(/Form 2 · NABL lab testing,F-100,2,/); // the corrected Form 2, version 2 - and version 1 too
    expect(csv).toMatch(/Form 2 · NABL lab testing,F-100,1,/);
    expect(csv).not.toMatch(/,=HYPERLINK/); // a formula is never left live
    const audit = await asOwner("select action from lab_records.audit_log where tenant_id = $1 and action like 'export.%'", [P.tenantId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});

describe("printing (step 7)", () => {
  it("Form 1 prints the sheet's 16 parameter columns in the sheet's order", async () => {
    const { FORM1_PARAMETERS } = await import("@/server/parameters");
    // Headings D4:S4 of refeDocs/sheets/FSSAI STI Forms.xlsx (the sheet spells it "Anoinic"; we print "Anionic").
    const sheet = ["Barium", "Copper", "Iron", "Manganese", "Nitrate", "Nitrite", "Aluminium", "Calcium", "Sulphide", "Magnesium", "Antimony", "Borate", "Phenolic Compound", "Mineral Oil", "Zinc", "Anoinic Surface-Active Agent"];
    expect(FORM1_PARAMETERS.map((p) => p.name.replace("Anionic", "Anoinic"))).toEqual(sheet);
  });

  it("a register holds one form's records in the date range, oldest first, current versions", async () => {
    const { printRows } = await import("@/server/print");
    const R = plant();
    await listParameters(R.lead);
    const mk = (source: string, daysAgo: number) =>
      createEntry(R.tech, { form: "form3", data: { source_of_water: source, lab_name: "SGS", sample_sent_on: day(daysAgo), outcome: "pass" } });
    await mk("Well C", 1);
    const a = await mk("Well A", 5);
    await mk("Well B", 3);
    await mk("Too old", 40);
    await correctEntry(R.tech, a.id, { reason: "spelling of source", data: { source_of_water: "Well A (north)" } });
    const out = await printRows(R.owner, "form3", { from: day(10), to: day(0) });
    expect(out.rows.map((r) => r.current.data.source_of_water)).toEqual(["Well A (north)", "Well B", "Well C"]);
    expect(out.rows[0]!.current).toMatchObject({ version: 2, reason: "spelling of source" });
    expect((await printRows(R.owner, "form2", { from: day(10), to: day(0) })).rows).toEqual([]);
  });

  it("a register never goes back further than the plan's history window", async () => {
    const { printRows } = await import("@/server/print");
    const R = plant();
    platform.historyMonths[R.tenantId] = 1;
    await listParameters(R.lead);
    await createEntry(R.tech, { form: "form3", data: { source_of_water: "Old", lab_name: "SGS", sample_sent_on: day(50), outcome: "pass" } });
    const out = await printRows(R.owner, "form3", { from: day(365), to: day(0) });
    expect(out.rows).toEqual([]);
    expect(out.from).toBe(out.cutoff);
  });
});
