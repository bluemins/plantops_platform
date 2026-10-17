// jobs_app never deletes and never changes what it saved: an application's details, history, resume files, the file
// queue, support views and the audit log. Only the database functions may remove applications (functions.test.ts).
// Enforced by the database: jobs_app simply has no permission, whatever the app code does. Plus the database checks.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asApp, dbError, plant, seedPlant, TABLES } from "./helpers";

const a = plant();
let ids: Awaited<ReturnType<typeof seedPlant>>;
const t = a.tenantId;

describe("append-only for jobs_app", () => {
  it("setup", async () => {
    ids = await seedPlant(t);
  });

  /** Every statement here must be refused with "permission denied". */
  const refusedStatements = () => [
    // nothing is ever deleted by the app itself
    ...TABLES.map((tbl) => `delete from job_applications.${tbl}`),
    ...TABLES.map((tbl) => `truncate job_applications.${tbl}`),
    // an application's details never change once sent
    ...["name = 'Someone else'", "phone = '9000000000'", "place = 'Elsewhere'", `opening_id = '${ids.opening}'`, "opening_title = 'Other'",
      "ref_no = 99", "consent_version = 'v0'", "consent_at = now()", "request_key = 'another-key'", "created_at = now()", "tenant_id = gen_random_uuid()",
    ].map((set) => `update job_applications.applications set ${set} where id = '${ids.application}'`),
    // history, resume files, the file queue, support views and the audit log never change
    `update job_applications.application_events set text = 'rewritten' where id = '${ids.event}'`,
    `update job_applications.application_events set kind = 'status' where id = '${ids.event}'`,
    `update job_applications.application_files set storage_key = 'x' where id = '${ids.file}'`,
    `update job_applications.application_files set application_id = '${ids.application}' where id = '${ids.file}'`,
    `update job_applications.file_removals set storage_key = 'x'`,
    `update job_applications.support_views set path = '/x'`,
    `update job_applications.audit_log set action = 'x'`,
    // an opening's history fields never change
    `update job_applications.openings set created_by = gen_random_uuid() where id = '${ids.opening}'`,
    `update job_applications.openings set tenant_id = gen_random_uuid() where id = '${ids.opening}'`,
    // only the database functions queue file removals
    `insert into job_applications.file_removals (tenant_id, storage_key) values ('${t}', 'tenant/${t}/sneaky')`,
  ];

  it("refuses every delete, truncate and change of saved details", async () => {
    for (const stmt of refusedStatements()) expect(await dbError(asApp(t, stmt)), stmt).toMatch(/permission denied/);
  });

  it("allows only what the screens need: status / first opened, opening fields, the page message, outbox retries", async () => {
    expect((await asApp(t, `update job_applications.applications set status = 'called', status_changed_at = now(), seen_at = now(), seen_by = gen_random_uuid() where id = '${ids.application}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update job_applications.openings set title = 'Lab assistant (B.Sc.)', status = 'off', sort_order = 2, updated_at = now() where id = '${ids.opening}'`)).rowCount).toBe(1);
    expect((await asApp(t, `update job_applications.page_settings set message = 'Join us', updated_at = now()`)).rowCount).toBe(1);
    expect((await asApp(t, `update job_applications.notification_outbox set attempts = 1, last_error = 'x', sent_at = now() where id = '${ids.outbox}'`)).rowCount).toBe(1);
  });
});

describe("database checks on what a row may hold", () => {
  const app = (cols: Record<string, string> = {}) => {
    const row = { tenant_id: `'${t}'`, ref_no: "500", name: "'Ramesh'", phone: "'9876543210'", place: "'Bargarh'", consent_version: "'v1'", consent_at: "now()", request_key: `'${randomUUID()}'`, ...cols };
    return `insert into job_applications.applications (${Object.keys(row).join(", ")}) values (${Object.values(row).join(", ")})`;
  };
  const file = (cols: Record<string, string>) => {
    const row = { tenant_id: `'${t}'`, application_id: `'${ids.application}'`, page_no: "2", storage_key: `'${randomUUID()}'`, content_type: "'image/jpeg'", size_bytes: "1000", sha256: `'${"d".repeat(64)}'`, ...cols };
    return `insert into job_applications.application_files (${Object.keys(row).join(", ")}) values (${Object.values(row).join(", ")})`;
  };

  const cases = (): [string, string][] => [
    ["a phone that is not an Indian mobile", app({ phone: "'5876543210'" })],
    ["a phone with +91", app({ phone: "'+919876543210'" })],
    ["a one-letter name", app({ name: "'R'" })],
    ["a 101-letter name", app({ name: `'${"a".repeat(101)}'` })],
    ["a one-letter place", app({ place: "'B'" })],
    ["an unknown status", app({ status: "'maybe'" })],
    ["no consent", app({ consent_at: "null" })],
    ["an opening without its title", app({ opening_id: "gen_random_uuid()" })],
    ["a title without an opening", app({ opening_title: "'Driver'" })],
    ["opened without who opened it", app({ seen_at: "now()" })],
    ["a resume PDF as page 2", file({ content_type: "'application/pdf'" })],
    ["a 4th resume page", file({ page_no: "4" })],
    ["an SVG", file({ content_type: "'image/svg+xml'" })],
    ["an HTML file", file({ content_type: "'text/html'" })],
    ["a file over 5 MB", file({ size_bytes: "5242881" })],
    ["an empty file", file({ size_bytes: "0" })],
    ["a bad checksum", file({ sha256: "'abc'" })],
    ["a note without text", `insert into job_applications.application_events (tenant_id, application_id, kind, text, user_id, user_name) values ('${t}', '${ids.application}', 'note', '  ', gen_random_uuid(), 'x')`],
    ["a status change without from / to", `insert into job_applications.application_events (tenant_id, application_id, kind, user_id, user_name) values ('${t}', '${ids.application}', 'status', gen_random_uuid(), 'x')`],
    ["a 301-character note", `insert into job_applications.application_events (tenant_id, application_id, kind, text, user_id, user_name) values ('${t}', '${ids.application}', 'note', '${"n".repeat(301)}', gen_random_uuid(), 'x')`],
    ["an opening in an unknown group", `insert into job_applications.openings (tenant_id, title, grp, description, min_qualification, created_by, created_by_name) values ('${t}', 'Driver', 'transport', 'x', 'x', gen_random_uuid(), 'x')`],
    ["a 41-character tag", `insert into job_applications.openings (tenant_id, title, grp, tag, description, min_qualification, created_by, created_by_name) values ('${t}', 'Driver', 'other', '${"t".repeat(41)}', 'x', 'x', gen_random_uuid(), 'x')`],
    ["a 301-character page message", `update job_applications.page_settings set message = '${"m".repeat(301)}'`],
  ];

  it("refuses rows the rules don't allow", async () => {
    for (const [what, stmt] of cases()) expect(await dbError(asApp(t, stmt)), what).toMatch(/check constraint|not-null|violates|foreign key/);
  });

  it("the same reference or the same request key twice in one plant is refused", async () => {
    const key = randomUUID();
    await asApp(t, app({ ref_no: "900", request_key: `'${key}'` }));
    expect(await dbError(asApp(t, app({ ref_no: "900" })))).toMatch(/unique/);
    expect(await dbError(asApp(t, app({ ref_no: "901", request_key: `'${key}'` })))).toMatch(/unique/);
  });
});
