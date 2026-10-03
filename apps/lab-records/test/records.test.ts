// Step 3: parameters and limits, batches, daily tests with automatic pass/fail, corrections as new versions.
// Compliance rules from CLAUDE.md tested here: append-only lab results (also at database level), pass/fail
// computed against configurable limits, who may do what, and plant A never seeing plant B.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBatch, getBatch, listBatches } from "@/server/batches";
import { correctEntry, createDailyEntry } from "@/server/entries";
import { addDailyParameter, listParameters, updateParameter } from "@/server/parameters";
import { judge, overall } from "@/lib/verdict";
import { startFakePlatform, SKUS, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, plant, refused } from "./helpers";

let platform: FakePlatform;
let A: ReturnType<typeof plant>;
let B: ReturnType<typeof plant>;
let tds: string;
let ph: string;

const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - n * 86_400_000));

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  A = plant();
  B = plant();
  const params = await listParameters(A.lead, "daily");
  tds = params.find((p) => p.code === "tds")!.id;
  ph = params.find((p) => p.code === "ph")!.id;
  await updateParameter(A.lead, tds, { limit_max: "500" });
  await updateParameter(A.lead, ph, { limit_min: "6.5", limit_max: "8.5" });
});
afterAll(() => platform.close());

describe("pass/fail rules", () => {
  it.each<[string, string | null, string | null, string]>([
    ["620", null, "500", "fail"],
    ["500", null, "500", "pass"], // exactly on the limit passes
    ["499.9", null, "500", "pass"],
    ["6.4", "6.5", "8.5", "fail"],
    ["6.5", "6.5", "8.5", "pass"],
    ["8.6", "6.5", "8.5", "fail"],
    ["3", "2", null, "pass"],
    ["1.99", "2", null, "fail"],
    ["123", null, null, "none"], // no limit set yet: no verdict
  ])("%s against min %s / max %s = %s", (value, min, max, expected) => {
    expect(judge(value, min, max)).toBe(expected);
  });

  it("an entry fails if any value fails; none if nothing has a limit", () => {
    expect(overall(["pass", "fail", "none"])).toBe("fail");
    expect(overall(["pass", "none"])).toBe("pass");
    expect(overall(["none"])).toBe("none");
  });
});

describe("parameters and limits", () => {
  it("a new plant starts with TDS / pH / turbidity and the 16 Form 1 columns in sheet order, with no limits", async () => {
    const all = await listParameters(B.owner);
    expect(all.filter((p) => p.kind === "daily").map((p) => p.name)).toEqual(["TDS", "pH", "Turbidity"]);
    const form1 = all.filter((p) => p.kind === "form1").map((p) => p.name);
    expect(form1).toHaveLength(16);
    expect(form1[0]).toBe("Barium");
    expect(form1[15]).toBe("Anionic Surface-Active Agent");
    expect(all.every((p) => p.limit_min === null && p.limit_max === null)).toBe(true);
  });

  it("owner and lab lead set limits; a technician can't", async () => {
    const turbidity = (await listParameters(A.owner, "daily")).find((p) => p.code === "turbidity")!.id;
    expect((await updateParameter(A.owner, turbidity, { limit_max: "2" })).limit_max).toBe("2");
    expect((await refused(() => updateParameter(A.tech, turbidity, { limit_max: "9" }))).status).toBe(403);
  });

  it("refuses min above max, and renaming a Form 1 column", async () => {
    expect((await refused(() => updateParameter(A.lead, ph, { limit_min: "9" }))).status).toBe(400);
    const barium = (await listParameters(A.lead, "form1"))[0]!.id;
    expect((await refused(() => updateParameter(A.lead, barium, { name: "Something else" }))).status).toBe(400);
    expect((await updateParameter(A.lead, barium, { limit_max: "0.7" })).limit_max).toBe("0.7");
  });

  it("every limit change is audited with old and new value", async () => {
    const { rows } = await asOwner(
      "select actor, details from lab_records.audit_log where tenant_id = $1 and action = 'parameter.updated' and target = $2 order by id",
      [A.tenantId, tds],
    );
    expect(rows[0]!.details).toMatchObject({ before: { limit_max: null }, after: { limit_max: "500" } });
    expect(rows[0]!.actor).toBe(`user:${A.lead.userId}`);
  });

  it("a lab lead adds a daily check; duplicates refused", async () => {
    const p = await addDailyParameter(A.lead, { name: "Free chlorine", unit: "mg/L", limit_max: "0.2" });
    expect(p).toMatchObject({ kind: "daily", code: "free_chlorine", limit_max: "0.2" });
    expect((await refused(() => addDailyParameter(A.lead, { name: "Free Chlorine" }))).status).toBe(409);
    expect((await refused(() => addDailyParameter(A.tech, { name: "Colour" }))).status).toBe(403);
  });
});

describe("batches", () => {
  it("a technician creates a batch with a product from the platform", async () => {
    const b = await createBatch(A.tech, { batch_no: "B-1001", production_date: daysAgo(0), sku_id: SKUS[0]!.id });
    expect(b).toMatchObject({ batch_no: "B-1001", status: "pending", product_name: "Bisleri-style 500 (500 ml × 24)", created_by_name: "Atharv" });
    const detail = await getBatch(A.owner, b.id);
    expect(detail.events).toEqual([expect.objectContaining({ event: "created", by_name: "Atharv" })]);
  });

  it("batch numbers are unique per plant, ignoring case; another plant may reuse one", async () => {
    expect((await refused(() => createBatch(A.lead, { batch_no: "b-1001", production_date: daysAgo(0) }))).status).toBe(409);
    expect((await createBatch(B.tech, { batch_no: "B-1001", production_date: daysAgo(0) })).batch_no).toBe("B-1001");
  });

  it("refuses: the owner (views only), a future date, an inactive or unknown product, odd characters", async () => {
    expect((await refused(() => createBatch(A.owner, { batch_no: "B-9", production_date: daysAgo(0) }))).status).toBe(403);
    expect((await refused(() => createBatch(A.tech, { batch_no: "B-9", production_date: daysAgo(-2) }))).status).toBe(400);
    expect((await refused(() => createBatch(A.tech, { batch_no: "B-9", production_date: daysAgo(0), sku_id: SKUS[1]!.id }))).status).toBe(400);
  });
});

describe("daily tests: saved, judged and locked", () => {
  it("a failing TDS is stored with the limit that applied, and the entry fails", async () => {
    const b = await createBatch(A.tech, { batch_no: "B-1002", production_date: daysAgo(0) });
    const e = await createDailyEntry(A.tech, { batch_id: b.id, remark: "morning", results: [{ parameter_id: tds, value: "620" }, { parameter_id: ph, value: "7.2" }] });
    expect(e.versions).toHaveLength(1);
    expect(e.current).toMatchObject({ version: 1, verdict: "fail", entered_by_name: "Atharv", reason: null, remark: "morning" });
    expect(e.current.results.find((r) => r.name === "TDS")).toMatchObject({ value: "620", limit_max: "500", verdict: "fail" });
    expect(e.current.results.find((r) => r.name === "pH")).toMatchObject({ value: "7.2", limit_min: "6.5", verdict: "pass" });
    expect((await getBatch(A.owner, b.id)).tests).toBe(1);
  });

  it("a test without a batch (general check) is allowed", async () => {
    const e = await createDailyEntry(A.lead, { results: [{ parameter_id: tds, value: "300" }] });
    expect(e).toMatchObject({ batch_id: null, current: { verdict: "pass" } });
  });

  it("refuses: owner entering data, a Form 1 or switched-off parameter, another plant's parameter, a future time, a duplicate", async () => {
    const barium = (await listParameters(A.lead, "form1"))[0]!.id;
    const bTds = (await listParameters(B.lead, "daily"))[0]!.id;
    const off = (await addDailyParameter(A.lead, { name: "Old check" })).id;
    await updateParameter(A.lead, off, { active: false });
    const one = (parameter_id: string) => ({ results: [{ parameter_id, value: "1" }] });
    expect((await refused(() => createDailyEntry(A.owner, one(tds)))).status).toBe(403);
    expect((await refused(() => createDailyEntry(A.tech, one(barium)))).status).toBe(400);
    expect((await refused(() => createDailyEntry(A.tech, one(off)))).status).toBe(400);
    expect((await refused(() => createDailyEntry(A.tech, one(bTds)))).status).toBe(400);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await refused(() => createDailyEntry(A.tech, { ...one(tds), tested_at: future }))).status).toBe(400);
    expect((await refused(() => createDailyEntry(A.tech, { results: [{ parameter_id: tds, value: "1" }, { parameter_id: tds, value: "2" }] }))).status).toBe(400);
  });

  it("no more tests on a rejected batch", async () => {
    const b = await createBatch(A.tech, { batch_no: "B-REJ", production_date: daysAgo(1) });
    await asOwner("update lab_records.batches set status = 'rejected' where id = $1", [b.id]);
    expect((await refused(() => createDailyEntry(A.tech, { batch_id: b.id, results: [{ parameter_id: tds, value: "1" }] }))).status).toBe(409);
  });
});

describe("corrections are new versions; nothing is overwritten", () => {
  it("version 2 carries the reason and who/when; version 1 stays exactly as it was", async () => {
    const e = await createDailyEntry(A.tech, { results: [{ parameter_id: tds, value: "620" }] });
    const v1 = e.current;
    const fixed = await correctEntry(A.lead, e.id, { reason: "typed 620, meter showed 420", results: [{ parameter_id: tds, value: "420" }] });
    expect(fixed.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(fixed.versions[0]).toEqual(v1);
    expect(fixed.current).toMatchObject({ version: 2, verdict: "pass", reason: "typed 620, meter showed 420", entered_by_name: "Priya" });
  });

  it("a correction keeps the limit from the original test, even after the limit changed", async () => {
    const e = await createDailyEntry(A.tech, { results: [{ parameter_id: tds, value: "450" }] });
    await updateParameter(A.lead, tds, { limit_max: "400" });
    try {
      const fixed = await correctEntry(A.tech, e.id, { reason: "re-read the meter", results: [{ parameter_id: tds, value: "460" }] });
      expect(fixed.current.results[0]).toMatchObject({ value: "460", limit_max: "500", verdict: "pass" });
      expect(fixed.versions[0]!.results[0]).toMatchObject({ value: "450", limit_max: "500", verdict: "pass" });
    } finally {
      await updateParameter(A.lead, tds, { limit_max: "500" });
    }
  });

  it("refuses: no real change, different checks than the original, the owner", async () => {
    const e = await createDailyEntry(A.tech, { results: [{ parameter_id: tds, value: "100" }] });
    expect((await refused(() => correctEntry(A.tech, e.id, { reason: "no change", results: [{ parameter_id: tds, value: "100.0" }] }))).status).toBe(400);
    expect((await refused(() => correctEntry(A.tech, e.id, { reason: "add pH", results: [{ parameter_id: ph, value: "7" }] }))).status).toBe(400);
    expect((await refused(() => correctEntry(A.owner, e.id, { reason: "owner fix", results: [{ parameter_id: tds, value: "90" }] }))).status).toBe(403);
  });

  it("the database refuses a correction without a reason, even if the app forgot to check", async () => {
    const e = await createDailyEntry(A.tech, { results: [{ parameter_id: tds, value: "100" }] });
    const msg = await dbError(
      asApp(A.tenantId, `insert into lab_records.entry_versions (tenant_id, entry_id, version, verdict, tested_at, entered_by, entered_by_name)
                         values ('${A.tenantId}', '${e.id}', 2, 'pass', now(), '${A.tech.userId}', 'x')`),
    );
    expect(msg).toMatch(/check constraint/);
  });
});

describe("append-only at the database level (lab_app login)", () => {
  it.each([
    ["change a result", "update lab_records.entry_results set value = 1"],
    ["change a version", "update lab_records.entry_versions set verdict = 'pass'"],
    ["delete a version", "delete from lab_records.entry_versions"],
    ["delete an entry", "delete from lab_records.entries"],
    ["move an entry to another batch", "update lab_records.entries set batch_id = null"],
    ["delete a batch", "delete from lab_records.batches"],
    ["rename a batch", "update lab_records.batches set batch_no = 'X'"],
    ["rewrite batch history", "update lab_records.batch_events set note = 'x'"],
    ["remove a corrective action", "delete from lab_records.corrective_actions"],
    ["remove a verification", "delete from lab_records.verifications"],
    ["edit the audit log", "delete from lab_records.audit_log"],
    ["change a parameter's kind", "update lab_records.parameters set kind = 'form1'"],
    ["delete a parameter", "delete from lab_records.parameters"],
  ])("refused: %s", async (_name, statement) => {
    expect(await dbError(asApp(A.tenantId, statement))).toMatch(/permission denied/);
  });
});

describe("plant isolation (row-level security)", () => {
  it("plant B can't open, list or count plant A's batches and tests", async () => {
    const a = await createBatch(A.tech, { batch_no: "B-ISO", production_date: daysAgo(0) });
    expect((await refused(() => getBatch(B.owner, a.id))).status).toBe(404);
    expect((await listBatches(B.owner)).map((b) => b.batch_no)).not.toContain("B-ISO");
    const seen = await asApp(B.tenantId, `select count(*)::int as n from lab_records.entries where tenant_id = '${A.tenantId}'`);
    expect(seen.rows[0]).toEqual({ n: 0 });
  });

  it("can't write rows for another plant", async () => {
    const msg = await dbError(
      asApp(B.tenantId, `insert into lab_records.batches (tenant_id, batch_no, production_date, created_by, created_by_name)
                         values ('${A.tenantId}', 'SNEAKY', current_date, '${B.tech.userId}', 'x')`),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("a query without a plant set fails instead of returning everyone's rows", async () => {
    const { labDb } = await import("@/server/db");
    // Fresh connection: "unrecognized configuration parameter app.tenant_id"; a pooled one that ran an
    // earlier transaction: the setting is empty, which isn't a valid id. Either way: refused, no rows.
    expect(await dbError(labDb().execute("select * from lab_records.batches" as never))).toMatch(/app\.tenant_id|invalid input syntax for type uuid/);
  });

  it("every Lab Records table has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ relname: string; force: boolean; has_tenant: boolean }>(`
      select c.relname, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'lab_records' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'lab_records' and c.relkind = 'r' and c.relname <> 'schema_migrations'`);
    expect(rows.length).toBeGreaterThanOrEqual(11);
    for (const r of rows) expect({ table: r.relname, force: r.force, tenant: r.has_tenant }).toEqual({ table: r.relname, force: true, tenant: true });
  });
});

describe("launcher tile numbers", () => {
  it("owner sees on hold, awaiting approval and tests today; staff don't see the approval count", async () => {
    const { summaryFor } = await import("@/server/summary");
    const C = plant();
    const cTds = (await listParameters(C.lead, "daily")).find((p) => p.code === "tds")!.id;
    const b1 = await createBatch(C.tech, { batch_no: "C-1", production_date: daysAgo(0) });
    await createBatch(C.tech, { batch_no: "C-2", production_date: daysAgo(0) });
    await createDailyEntry(C.tech, { batch_id: b1.id, results: [{ parameter_id: cTds, value: "100" }] });
    await asOwner("update lab_records.batches set status = 'on_hold' where id = $1", [b1.id]);
    expect((await summaryFor(C.tenantId, "owner")).badges).toEqual([
      { text: "1 on hold", tone: "danger" },
      { text: "1 awaiting approval", tone: "warn" },
      { text: "1 test today", tone: "ok" },
    ]);
    expect((await summaryFor(C.tenantId, "staff")).badges.map((b) => b.text)).toEqual(["1 on hold", "1 test today"]);
  });
});
