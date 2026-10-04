// File storage drivers: local disk (never overwrites) and S3-compatible (signed requests), the latter
// against a small fake S3 server - real S3 is verified at deployment.
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileStorage, localStorage, newStorageKey, s3Storage, sniffType } from "@/server/storage";
import { PDF, PNG } from "./helpers";

describe("local disk", () => {
  it("stores and reads back; never overwrites an existing file; refuses odd keys", async () => {
    const store = localStorage(mkdtempSync(path.join(tmpdir(), "docs-local-")));
    const key = newStorageKey(crypto.randomUUID());
    await store.put(key, PDF, "application/pdf");
    expect((await store.get(key)).equals(PDF)).toBe(true);
    await expect(store.put(key, PNG, "image/png")).rejects.toThrow(/EEXIST/);
    await expect(store.put("../../etc/passwd", PDF, "application/pdf")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("S3-compatible", () => {
  let server: Server;
  const objects = new Map<string, Buffer>();
  const seen: { method: string; url: string; auth: string; sha: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? "", sha: String(req.headers["x-amz-content-sha256"] ?? "") });
        if (!/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(req.headers.authorization ?? "")) {
          res.writeHead(403);
          return res.end();
        }
        if (req.method === "PUT") objects.set(req.url!, Buffer.concat(chunks));
        const body = req.method === "GET" ? objects.get(req.url!) : undefined;
        res.writeHead(req.method === "GET" && !body ? 404 : 200);
        res.end(body);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("signs each request (AWS SigV4) and round-trips a file, path-style", async () => {
    const store = s3Storage({ endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, region: "ap-south-1", bucket: "plantops-docs", accessKey: "AKIDTEST", secretKey: "secret" });
    const key = newStorageKey(crypto.randomUUID());
    await store.put(key, PDF, "application/pdf");
    expect((await store.get(key)).equals(PDF)).toBe(true);
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ["PUT", `/plantops-docs/${key}`],
      ["GET", `/plantops-docs/${key}`],
    ]);
    expect(seen[0]!.sha).toMatch(/^[0-9a-f]{64}$/);
    await expect(store.get(newStorageKey(crypto.randomUUID()))).rejects.toThrow(/404/);
  });

  it("rejects incomplete S3 settings instead of silently falling back to local storage", () => {
    const keys = ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"] as const;
    const before = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.STORAGE_BUCKET = "plantops-docs";
      delete process.env.STORAGE_ACCESS_KEY_ID;
      delete process.env.STORAGE_SECRET_ACCESS_KEY;
      expect(() => fileStorage()).toThrow(/STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY/);
      delete process.env.STORAGE_BUCKET;
      process.env.STORAGE_ACCESS_KEY_ID = "configured";
      expect(() => fileStorage()).toThrow(/Set STORAGE_BUCKET/);
    } finally {
      for (const key of keys) {
        const value = before.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("file type by content", () => {
  it("never trusts the name", () => {
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(Buffer.from("<svg/>"))).toBeNull();
    expect(sniffType(Buffer.from("PK\x03\x04 word document"))).toBeNull();
  });
});
