// The public job page's data (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Which plant a public page belongs to", mock-ups 1
// and 2): the plant comes only from the address, one "not available" for every refusal, only the switched-on openings
// of that plant, and no login cookie anywhere near it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as publicLogo } from "@/app/api/public/logo/[code]/route";
import { DEFAULT_MESSAGE } from "@/lib/groups";
import { kit } from "@/server/kit";
import { createOpening, OpeningInput, publicOpening, publicPage, setPageMessage } from "@/server/openings";
import { basePath, PlatformUnavailable, publicLink, resolvePublicPlant } from "@/server/public";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

/** A plant the platform knows under a fresh code (the module caches lookups a minute, so every test uses new codes). */
function knownPlant(opts: { logo?: boolean } = {}) {
  const p = plant();
  const code = `P${randomUUID().slice(0, 6).toUpperCase()}`;
  platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
  platform.branding.set(p.tenantId, { name: "Bluemins", brand_color: "#0b6e99", logo: Boolean(opts.logo), code });
  return { ...p, code };
}
const opening = (over: Record<string, unknown> = {}) =>
  OpeningInput.parse({ title: "Lab Assistant", grp: "lab_quality", tag: "B.Sc.", description: "Water tests", minQualification: "10th pass", goodToHave: null, status: "active", ...over });

describe("which plant", () => {
  it("/<code> finds the plant (any letter case) with its name, colour and logo", async () => {
    const p = knownPlant({ logo: true });
    expect(await resolvePublicPlant(p.code.toLowerCase())).toEqual({ tenantId: p.tenantId, name: "Bluemins", code: p.code, isDefault: false, brandColor: "#0b6e99", hasLogo: true });
  });

  it("the bare address uses JOBS_DEFAULT_PLANT; links then leave the code out", async () => {
    const p = knownPlant();
    process.env.JOBS_DEFAULT_PLANT = p.code.toLowerCase();
    try {
      const found = await resolvePublicPlant(null);
      expect(found).toMatchObject({ tenantId: p.tenantId, isDefault: true });
      expect(basePath(found!)).toBe("");
      expect(publicLink("https://jobs.example", found!)).toBe("https://jobs.example");
      delete process.env.JOBS_DEFAULT_PLANT;
      expect(await resolvePublicPlant(null)).toBeNull(); // no default set: not available
    } finally {
      delete process.env.JOBS_DEFAULT_PLANT;
    }
    expect(publicLink("https://jobs.example", { code: p.code, isDefault: false })).toBe(`https://jobs.example/${p.code}`);
  });

  it("unknown, suspended or switched-off (the platform's one 404) and malformed codes: all just 'not available'", async () => {
    for (const code of ["NOSUCH1", "ab", "x".repeat(33), "a b", "../tenants", "001;drop", ""]) expect(await resolvePublicPlant(code), code).toBeNull();
    // malformed codes never even reach the platform
    expect(platform.plantLookups.filter((c) => c.length < 3 || c.includes(" ") || c.includes("/") || c.includes(";"))).toEqual([]);
  });

  it("the platform down: 'try again later', never 'not available'", async () => {
    platform.plantLookupDown = true;
    try {
      await expect(resolvePublicPlant("NEVERSEEN1")).rejects.toBeInstanceOf(PlatformUnavailable);
    } finally {
      platform.plantLookupDown = false;
    }
  });

  it("asks the platform once a minute per code, 'not found' too", async () => {
    const before = platform.plantLookups.filter((c) => c === "PROBE01").length;
    await resolvePublicPlant("probe01");
    await resolvePublicPlant("PROBE01");
    expect(platform.plantLookups.filter((c) => c === "PROBE01").length - before).toBe(1);
  });

  it("never looks at a login cookie", async () => {
    const spy = vi.spyOn(kit, "currentSession");
    try {
      const p = knownPlant();
      await resolvePublicPlant(p.code);
      await publicPage(p.tenantId);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("what the page shows", () => {
  it("only this plant's switched-on openings, in page order, and the page message", async () => {
    const p = knownPlant();
    const q = knownPlant();
    await createOpening(p.owner, opening({ title: "Security", grp: "delivery_security" }));
    await createOpening(p.owner, opening({ title: "Operator", grp: "production", tag: null }));
    await createOpening(p.owner, opening({ title: "Hidden job", grp: "production", status: "off" }));
    await createOpening(q.owner, opening({ title: "Other plant's job", grp: "production" }));
    const page = await publicPage(p.tenantId);
    expect(page.openings.map((o) => [o.title, o.grp, o.tag])).toEqual([
      ["Operator", "production", null],
      ["Security", "delivery_security", "B.Sc."],
    ]);
    expect(Object.keys(page.openings[0]!).sort()).toEqual(["grp", "id", "tag", "title"]); // nothing else leaves the server
    expect(page.message).toBe(DEFAULT_MESSAGE);
    await setPageMessage(p.owner, "Join us");
    expect((await publicPage(p.tenantId)).message).toBe("Join us");
  });

  it("no opening switched on: an empty list (the page then shows only 'Send your resume')", async () => {
    const p = knownPlant();
    await createOpening(p.owner, opening({ status: "off" }));
    expect((await publicPage(p.tenantId)).openings).toEqual([]);
  });

  it("one position: only a switched-on one of this plant; anything else is 'not available'", async () => {
    const p = knownPlant();
    const q = knownPlant();
    const on = await createOpening(p.owner, opening({ goodToHave: "ERP" }));
    const off = await createOpening(p.owner, opening({ title: "Old job", status: "off" }));
    const other = await createOpening(q.owner, opening({ title: "Other plant's job" }));
    expect(await publicOpening(p.tenantId, on.id)).toEqual({ id: on.id, title: "Lab Assistant", grp: "lab_quality", description: "Water tests", minQualification: "10th pass", goodToHave: "ERP" });
    expect(await publicOpening(p.tenantId, off.id)).toBeNull();
    expect(await publicOpening(p.tenantId, other.id)).toBeNull();
    expect(await publicOpening(p.tenantId, "not-a-uuid")).toBeNull();
  });
});

describe("public logo", () => {
  const logo = (code: string) => publicLogo(new Request(`http://localhost/api/public/logo/${code}`), { params: Promise.resolve({ code }) });

  it("the plant's logo, as a picture only, cached an hour", async () => {
    const p = knownPlant({ logo: true });
    const res = await logo(p.code);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("no logo, unknown or malformed code: 404", async () => {
    const p = knownPlant({ logo: false });
    for (const code of [p.code, "NOSUCH2", "a b"]) expect((await logo(code)).status, code).toBe(404);
  });
});
