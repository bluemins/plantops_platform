// kit.notify: a notification must never break the action that caused it.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createModule, type OutboxStore } from "../src/module";

let server: Server;
let url = "";
let answer = 201;
const received: { path: string; auth: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", body: JSON.parse(raw || "{}") });
      if (/\/notifications\/unread$/.test(req.url ?? "")) {
        res.writeHead(answer === 201 ? 200 : answer, { "content-type": "application/json" });
        return res.end(JSON.stringify({ unread: 4 }));
      }
      res.writeHead(answer, { "content-type": "application/json" });
      res.end(JSON.stringify(answer === 201 ? { recipients: 2, created: 2 } : { error: "no" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const kitFor = (platformUrl: () => string) =>
  createModule({
    moduleId: "floor_stock",
    label: "Floor Stock",
    env: { platformUrl, clientSecret: () => "secret", sessionSecret: () => "x".repeat(32), secureCookies: () => false },
  });
const event = { kind: "floor_stock.count_saved", title: "Stock count saved", body: "Atharv", link: "/day/2026-10-11", dedupe_key: "count:2026-10-11:v1" };

describe("kit.notify", () => {
  it("sends the event to the platform with the module's credentials", async () => {
    const tenant = randomUUID();
    answer = 201;
    expect(await kitFor(() => url).notify(tenant, event)).toEqual({ recipients: 2, created: 2 });
    const last = received.at(-1)!;
    expect(last.path).toBe(`/api/m/tenants/${tenant}/notifications`);
    expect(last.auth).toBe("Basic " + btoa("floor_stock:secret"));
    expect(last.body).toMatchObject({ ...event, level: "push" });
  });

  it("platform error or unreachable: returns null, never throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    answer = 503;
    expect(await kitFor(() => url).notify(randomUUID(), event)).toBeNull();
    expect(await kitFor(() => "http://127.0.0.1:9").notify(randomUUID(), event)).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("bad input is refused before anything is sent (and still doesn't throw)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = received.length;
    expect(await kitFor(() => url).notify(randomUUID(), { ...event, link: "https://evil.example" })).toBeNull();
    expect(received.length).toBe(before);
    log.mockRestore();
  });
});

describe("header bell", () => {
  it("links to the platform's notifications page", () => {
    expect(kitFor(() => "https://app.example.test").notificationsUrl()).toBe("https://app.example.test/notifications");
  });

  it("unread count from the platform; null when it can't be reached", async () => {
    answer = 201;
    const tenant = randomUUID();
    const user = randomUUID();
    expect(await kitFor(() => url).unread(tenant, user)).toBe(4);
    expect(received.at(-1)!.path).toBe(`/api/m/tenants/${tenant}/users/${user}/notifications/unread`);
    expect(await kitFor(() => "http://127.0.0.1:9").unread(randomUUID(), randomUUID())).toBeNull();
  });
});

describe("outbox (N4)", () => {
  /** An in-memory store, like a module's notification_outbox table. */
  function memoryStore() {
    const rows: { id: string; tenantId: string; input: typeof event; attempts: number; createdAt: Date; sent: boolean; givenUp: boolean; error: string }[] = [];
    const store: OutboxStore = {
      async save(tenantId, input, error) {
        rows.push({ id: randomUUID(), tenantId, input: input as typeof event, attempts: 0, createdAt: new Date(), sent: false, givenUp: false, error });
      },
      async tenants() {
        return [...new Set(rows.filter((r) => !r.sent && !r.givenUp).map((r) => r.tenantId))];
      },
      async pending(tenantId) {
        return rows.filter((r) => r.tenantId === tenantId && !r.sent && !r.givenUp);
      },
      async markSent(_t, id) {
        rows.find((r) => r.id === id)!.sent = true;
      },
      async markFailed(_t, id, error, giveUp) {
        const r = rows.find((x) => x.id === id)!;
        r.attempts++;
        r.error = error;
        r.givenUp = giveUp;
      },
    };
    return { rows, store };
  }
  const kitWith = (platformUrl: () => string, store: OutboxStore) =>
    createModule({ moduleId: "floor_stock", label: "Floor Stock", outbox: store, env: { platformUrl, clientSecret: () => "secret", sessionSecret: () => "x".repeat(32), secureCookies: () => false } });

  it("unreachable: kept; invalid input or a refusal: not kept", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rows, store } = memoryStore();
    await kitWith(() => "http://127.0.0.1:9", store).notify(randomUUID(), event);
    expect(rows).toHaveLength(1);
    await kitWith(() => url, store).notify(randomUUID(), { ...event, link: "https://evil.example" });
    answer = 403;
    await kitWith(() => url, store).notify(randomUUID(), event);
    answer = 201;
    expect(rows).toHaveLength(1);
    log.mockRestore();
  });

  it("retry: sent when the platform is back; gives up after 10 tries", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rows, store } = memoryStore();
    const down = kitWith(() => "http://127.0.0.1:9", store);
    await down.notify(randomUUID(), event);
    await down.notify(randomUUID(), event);
    for (let i = 0; i < 9; i++) await down.retryOutbox();
    expect(rows.map((r) => [r.attempts, r.givenUp])).toEqual([[9, false], [9, false]]);
    expect(await down.retryOutbox()).toEqual({ sent: 0, failed: 0, given_up: 2 });
    const { rows: rows2, store: store2 } = memoryStore();
    await kitWith(() => "http://127.0.0.1:9", store2).notify(randomUUID(), event);
    answer = 201;
    expect(await kitWith(() => url, store2).retryOutbox()).toEqual({ sent: 1, failed: 0, given_up: 0 });
    expect(rows2[0]!.sent).toBe(true);
    log.mockRestore();
  });
});
