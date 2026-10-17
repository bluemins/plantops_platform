// Files are written first, then the rows in one transaction. If the save fails half-way, no row stays and the files
// already written are removed again (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Sending an application").
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// a storage that refuses the 2nd file while `failSecond` is on
const state = vi.hoisted(() => ({ failSecond: false, puts: 0 }));
vi.mock("@/server/storage", async (orig) => {
  const real = await orig<typeof import("@/server/storage")>();
  return {
    ...real,
    fileStorage: () => {
      const s = real.fileStorage();
      return {
        ...s,
        put: async (key: string, data: Buffer, type: string) => {
          if (state.failSecond && ++state.puts === 2) throw new Error("disk full");
          return s.put(key, data, type);
        },
      };
    },
  };
});

import { newRequestKey } from "@/lib/apply";
import { submitApplication } from "@/server/apply";
import { resolvePublicPlant } from "@/server/public";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, JPEG, plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

describe("a send that fails half-way", () => {
  it("leaves no application, no file row and no file; the next try works", async () => {
    const p = plant();
    const code = `C${randomUUID().slice(0, 6).toUpperCase()}`;
    platform.plants.set(code, { tenant_id: p.tenantId, name: "Bluemins" });
    const view = (await resolvePublicPlant(code))!;
    const fields = { position: "any", name: "Priya", phone: "9876543210", place: "Bargarh", consent: "yes", request_key: newRequestKey() };
    state.failSecond = true;
    await expect(submitApplication(view, { fields, files: [JPEG, JPEG], ip: "x" })).rejects.toThrow(/disk full/);
    state.failSecond = false;
    expect((await asOwner("select count(*)::int as n from job_applications.applications where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 0 });
    expect((await asOwner("select count(*)::int as n from job_applications.application_files where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 0 });
    const dir = path.join(process.env.JOBS_STORAGE_DIR!, "tenant", p.tenantId);
    expect(readdirSync(dir)).toEqual([]);
    expect((await submitApplication(view, { fields, files: [JPEG, JPEG], ip: "x" })).ref).toBe("J-0001");
    expect(readdirSync(dir)).toHaveLength(2);
  });
});
