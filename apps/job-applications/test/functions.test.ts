// The only deletes in any PlantOps module (owner, 2026-10-17): applications are kept 12 months (the applicant's
// consent) and the owner may remove one now. jobs_app can't delete; only these locked-down database functions can,
// and each removes exactly what it should and nothing of another plant.
import { describe, expect, it } from "vitest";
import { addApplication, asApp, asOwner, dbError, plant, seedPlant } from "./helpers";

const count = async (tenantId: string, table: string, where = "true") =>
  Number(((await asOwner(`select count(*) from job_applications.${table} where tenant_id = $1 and ${where}`, [tenantId])).rows[0] as { count: string }).count);
const queued = async (tenantId: string) => count(tenantId, "file_removals");
const withFile = async (tenantId: string, applicationId: string, key: string) =>
  asApp(tenantId, `insert into job_applications.application_files (tenant_id, application_id, page_no, storage_key, content_type, size_bytes, sha256)
    values ('${tenantId}', '${applicationId}', 1, '${key}', 'image/jpeg', 100, '${"e".repeat(64)}')`);

describe("purge_applications: older than 12 months", () => {
  it("removes exactly the applications sent more than 12 months ago (boundary day), with their history and files", async () => {
    const a = plant();
    const b = plant();
    // 12 months = 365 or 366 days, depending on the calendar: one day either side of it is certain
    const old = await addApplication(a.tenantId, { days: 367 });
    const recent = await addApplication(a.tenantId, { days: 364 });
    const otherPlantRecent = await addApplication(b.tenantId, { days: 300 });
    const otherPlantOld = await addApplication(b.tenantId, { days: 400 });
    await asApp(a.tenantId, `insert into job_applications.application_events (tenant_id, application_id, kind, text, user_id, user_name) values ('${a.tenantId}', '${old.id}', 'note', 'Called', gen_random_uuid(), 'Meera')`);
    await withFile(a.tenantId, old.id, `purge-old-${old.id}`);
    await withFile(a.tenantId, recent.id, `purge-recent-${recent.id}`);

    const { rows } = await asApp(a.tenantId, "select job_applications.purge_applications(now()) as n");
    expect((rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2); // a's old one + b's old one (+ any left by other tests)

    expect(await count(a.tenantId, "applications", `id = '${old.id}'`)).toBe(0);
    expect(await count(a.tenantId, "application_events", `application_id = '${old.id}'`)).toBe(0);
    expect(await count(a.tenantId, "application_files", `application_id = '${old.id}'`)).toBe(0);
    expect(await count(a.tenantId, "applications", `id = '${recent.id}'`)).toBe(1);
    expect(await count(a.tenantId, "application_files", `application_id = '${recent.id}'`)).toBe(1);
    expect(await count(b.tenantId, "applications", `id = '${otherPlantRecent.id}'`)).toBe(1);
    expect(await count(b.tenantId, "applications", `id = '${otherPlantOld.id}'`)).toBe(0);
    // the old file waits for deletion from storage; one anonymous audit line per plant (no name, no phone)
    expect((await asOwner("select storage_key from job_applications.file_removals where tenant_id = $1", [a.tenantId])).rows).toEqual([{ storage_key: `purge-old-${old.id}` }]);
    const audit = (await asOwner("select actor, action, details from job_applications.audit_log where tenant_id = $1", [a.tenantId])).rows;
    expect(audit).toEqual([{ actor: "system", action: "applications.purged", details: { count: 1 } }]);
  });

  it("a date in the future never removes recent applications", async () => {
    const a = plant();
    const recent = await addApplication(a.tenantId, { days: 10 });
    await asApp(a.tenantId, "select job_applications.purge_applications(now() + interval '5 years')");
    expect(await count(a.tenantId, "applications", `id = '${recent.id}'`)).toBe(1);
  });
});

describe("remove_application: the owner's Remove now", () => {
  it("removes one application of the current plant with its history and files, queues the files, returns its reference", async () => {
    const a = plant();
    const ids = await seedPlant(a.tenantId);
    const before = await queued(a.tenantId);
    const { rows } = await asApp(a.tenantId, `select job_applications.remove_application('${a.tenantId}', '${ids.application}', 'Applicant asked') as ref`);
    expect(typeof (rows[0] as { ref: number }).ref).toBe("number");
    expect(await count(a.tenantId, "applications", `id = '${ids.application}'`)).toBe(0);
    expect(await count(a.tenantId, "application_events", `application_id = '${ids.application}'`)).toBe(0);
    expect(await count(a.tenantId, "application_files", `application_id = '${ids.application}'`)).toBe(0);
    expect(await queued(a.tenantId)).toBe(before + 1);
    expect(await count(a.tenantId, "openings")).toBe(1); // the opening stays
  });

  it("needs a reason of 3-300 characters", async () => {
    const a = plant();
    const app = await addApplication(a.tenantId);
    for (const reason of ["null", "''", "'ok'", `'${"r".repeat(301)}'`]) {
      expect(await dbError(asApp(a.tenantId, `select job_applications.remove_application('${a.tenantId}', '${app.id}', ${reason})`)), reason).toMatch(/reason/);
    }
    expect(await count(a.tenantId, "applications", `id = '${app.id}'`)).toBe(1);
  });

  it("refuses another plant: a plant id that isn't the transaction's plant, or another plant's application", async () => {
    const a = plant();
    const b = plant();
    const app = await addApplication(a.tenantId);
    // working in plant B but naming plant A
    expect(await dbError(asApp(b.tenantId, `select job_applications.remove_application('${a.tenantId}', '${app.id}', 'Applicant asked')`))).toMatch(/not the current plant/);
    // plant B naming itself but A's application: nothing found, nothing removed
    const { rows } = await asApp(b.tenantId, `select job_applications.remove_application('${b.tenantId}', '${app.id}', 'Applicant asked') as ref`);
    expect((rows[0] as { ref: number | null }).ref).toBeNull();
    expect(await count(a.tenantId, "applications", `id = '${app.id}'`)).toBe(1);
  });
});

describe("clear_file_removal: after the file is gone from storage and the backup", () => {
  it("clears only the current plant's queued file", async () => {
    const a = plant();
    const b = plant();
    await seedPlant(a.tenantId); // leaves one queued file
    const key = ((await asOwner("select storage_key from job_applications.file_removals where tenant_id = $1", [a.tenantId])).rows[0] as { storage_key: string }).storage_key;
    expect(await dbError(asApp(b.tenantId, `select job_applications.clear_file_removal('${a.tenantId}', '${key}')`))).toMatch(/not the current plant/);
    expect(((await asApp(b.tenantId, `select job_applications.clear_file_removal('${b.tenantId}', '${key}') as ok`)).rows[0] as { ok: boolean }).ok).toBe(false);
    expect(await queued(a.tenantId)).toBe(1);
    expect(((await asApp(a.tenantId, `select job_applications.clear_file_removal('${a.tenantId}', '${key}') as ok`)).rows[0] as { ok: boolean }).ok).toBe(true);
    expect(await queued(a.tenantId)).toBe(0);
  });
});
