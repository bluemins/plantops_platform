// fetchPlantByCode (Job applications' public page): found → { tenant_id, name }, 404 → null, platform failing → throws.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPlantByCode, PlatformRequestError, type ModuleCredentials } from "../src";

const tenant = randomUUID();
let server: Server;
let creds: ModuleCredentials;
const seen: { path: string; auth: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization ?? "" });
    const code = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (code === "001") return send(200, { tenant_id: tenant, name: "Bluemins" });
    if (code === "BROKEN") return send(503, { error: "down" });
    send(404, { error: "This page is not available" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  creds = { platformUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, moduleId: "job_applications", clientSecret: "jobs-secret" };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("fetchPlantByCode", () => {
  it("returns the plant, asking with the module's own credentials", async () => {
    expect(await fetchPlantByCode(creds, "001")).toEqual({ tenant_id: tenant, name: "Bluemins" });
    expect(seen.at(-1)).toEqual({ path: "/api/m/plants/by-code/001", auth: `Basic ${btoa("job_applications:jobs-secret")}` });
  });

  it("404 means no such plant for this page", async () => {
    expect(await fetchPlantByCode(creds, "NOPE")).toBeNull();
  });

  it("a code is sent as one path part, never as a path", async () => {
    expect(await fetchPlantByCode(creds, "../tenants")).toBeNull();
    expect(seen.at(-1)!.path).toBe("/api/m/plants/by-code/..%2Ftenants");
  });

  it("a failing platform throws (the page says 'try again later', not 'not available')", async () => {
    await expect(fetchPlantByCode(creds, "BROKEN")).rejects.toBeInstanceOf(PlatformRequestError);
  });
});
