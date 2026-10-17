// kit.plantByCode (Job applications' public page): cached a minute per code, "not found" too; a platform outage uses
// the last answer, or throws when there is none.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModule } from "../src/module";

const tenant = randomUUID();
let server: Server;
let url = "";
let down = false;
const asked: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    asked.push(req.url ?? "");
    const code = (req.url ?? "").split("/").pop();
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (down) return send(503, {});
    if (code === "001") return send(200, { tenant_id: tenant, name: "Bluemins" });
    send(404, { error: "This page is not available" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const kit = () =>
  createModule({
    moduleId: "job_applications",
    label: "Job applications",
    env: { platformUrl: () => url, clientSecret: () => "secret", sessionSecret: () => "x".repeat(32), secureCookies: () => false },
  });

describe("kit.plantByCode", () => {
  it("asks once a minute per code (any letter case), found or not", async () => {
    const k = kit();
    const t0 = Date.now();
    expect(await k.plantByCode("001", t0)).toEqual({ tenant_id: tenant, name: "Bluemins" });
    expect(await k.plantByCode("001", t0 + 30_000)).toEqual({ tenant_id: tenant, name: "Bluemins" });
    expect(await k.plantByCode("nope", t0)).toBeNull();
    expect(await k.plantByCode("NOPE", t0 + 30_000)).toBeNull();
    expect(asked.filter((p) => p.endsWith("/001"))).toHaveLength(1);
    expect(asked.filter((p) => p.endsWith("/NOPE"))).toHaveLength(1);
    await k.plantByCode("001", t0 + 61_000);
    expect(asked.filter((p) => p.endsWith("/001"))).toHaveLength(2);
  });

  it("platform down: the last answer if there is one, else an error", async () => {
    const k = kit();
    const t0 = Date.now() + 10 * 60_000; // past every earlier cache entry
    await k.plantByCode("001", t0);
    down = true;
    try {
      expect(await k.plantByCode("001", t0 + 120_000)).toEqual({ tenant_id: tenant, name: "Bluemins" });
      await expect(k.plantByCode("NEVERSEEN", t0)).rejects.toThrow();
    } finally {
      down = false;
    }
  });
});
