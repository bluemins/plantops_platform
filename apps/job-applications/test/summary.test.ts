// The launcher tile (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Launcher tile") and the owner's Support access page.
import { describe, expect, it } from "vitest";
import { createOpening, OpeningInput } from "@/server/openings";
import { summaryFor } from "@/server/summary";
import { describeView, listSupportViews } from "@/server/support";
import { requirePageUser } from "@/server/session";
import { addApplication, asApp, asOwner, plant, refused } from "./helpers";

describe("tile badges", () => {
  it("an empty plant: no new applications; the owner also sees that the public page has no openings", async () => {
    const p = plant();
    expect(await summaryFor(p.tenantId, "owner")).toEqual({ badges: [{ text: "No new applications", tone: "ok" }, { text: "Public page has no openings", tone: "info" }] });
    expect(await summaryFor(p.tenantId, "staff")).toEqual({ badges: [{ text: "No new applications", tone: "ok" }] });
  });

  it("new ones (warn when one waited unopened over 3 days) and this week's count", async () => {
    const p = plant();
    await createOpening(p.owner, OpeningInput.parse({ title: "Operator", grp: "production", tag: null, description: "x", minQualification: "x", goodToHave: null, status: "active" }));
    await addApplication(p.tenantId);
    const old = await addApplication(p.tenantId, { days: 4 });
    const called = await addApplication(p.tenantId, { days: 1 });
    await asApp(p.tenantId, `update job_applications.applications set status = 'called' where id = '${called.id}'`);
    await addApplication(p.tenantId, { days: 20 });
    await asApp(p.tenantId, `update job_applications.applications set status = 'hired' where created_at < now() - interval '10 days'`);
    expect(await summaryFor(p.tenantId, "owner")).toEqual({ badges: [{ text: "2 new", tone: "warn" }, { text: "3 this week", tone: "info" }] });
    await asOwner("update job_applications.applications set seen_at = now(), seen_by = gen_random_uuid() where id = $1", [old.id]);
    expect((await summaryFor(p.tenantId, "owner")).badges[0]).toEqual({ text: "2 new", tone: "info" });
  });
});

describe("support access (owner)", () => {
  it("each support view in plain words, newest first; owner only", async () => {
    const p = plant();
    const a = await addApplication(p.tenantId);
    const { kit } = await import("@/server/kit");
    const { vi } = await import("vitest");
    const spy = vi.spyOn(kit, "currentSession").mockResolvedValue({ kind: "support", support: { tenant_id: p.tenantId, super_admin_id: p.support.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never);
    try {
      await requirePageUser("/applications");
      await requirePageUser(`/applications/${a.id}`);
      await requirePageUser("/openings");
    } finally {
      spy.mockRestore();
    }
    const views = (await listSupportViews(p.owner)).map((v) => v.what).sort();
    expect(views).toEqual([`application J-${String(a.ref).padStart(4, "0")}`, "the applications list", "the openings"].sort());
    expect(describeView(`/applications/${crypto.randomUUID()}`)).toBe("an application (since removed)");
    expect(describeView(`/files/${crypto.randomUUID()}`)).toBe("a resume page");
    for (const u of [p.hr, p.support]) expect((await refused(() => listSupportViews(u))).status).toBe(403);
  });
});
