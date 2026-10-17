// Local file removal (Job applications only) and the public form's rate limit / sender address.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clientIp, HttpError, rateLimit, resetRateLimits } from "../src/http";
import { localStorage, newStorageKey } from "../src/storage";

describe("local storage remove", () => {
  it("removes one file; a missing file counts as removed; a bad key is refused", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kit-remove-"));
    const files = localStorage(dir);
    const key = newStorageKey("00000000-0000-4000-8000-000000000001");
    const other = newStorageKey("00000000-0000-4000-8000-000000000001");
    await files.put(key, Buffer.from("cv"), "application/pdf");
    await files.put(other, Buffer.from("cv2"), "application/pdf");
    await files.remove(key);
    expect(existsSync(path.join(dir, key))).toBe(false);
    expect(await files.list()).toEqual([other]);
    await files.remove(key);
    await expect(files.remove("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("rateLimit", () => {
  it("allows `max` per window, then 429 with the message; a new window starts again", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("apply:1.2.3.4", 5, 3_600_000, "Too many", t0 + i);
    let err: unknown;
    try {
      rateLimit("apply:1.2.3.4", 5, 3_600_000, "Too many", t0 + 10);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, message: "Too many" });
    rateLimit("apply:5.6.7.8", 5, 3_600_000, "Too many", t0 + 10); // another sender is not affected
    rateLimit("apply:1.2.3.4", 5, 3_600_000, "Too many", t0 + 3_600_001); // next hour
  });
});

describe("clientIp", () => {
  const ip = (headers: Record<string, string>) => clientIp(new Request("http://x", { headers }));
  it("Railway's X-Real-IP first, else the LAST forwarded address (the one our proxy added), else unknown", () => {
    expect(ip({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 1.2.3.4" })).toBe("1.2.3.4");
    expect(ip({ "x-forwarded-for": "6.6.6.6 , 1.2.3.4" })).toBe("1.2.3.4"); // a typed-in first entry is ignored
    expect(ip({})).toBe("unknown");
  });
});
