import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetLinksResponse, staffAppFingerprints, STAFF_APP_DEFAULT_PACKAGE } from "../src";

const A = Array.from({ length: 32 }, () => "AB").join(":");
const B = Array.from({ length: 32 }, () => "0f").join(":");

describe("assetLinksResponse (staff app)", () => {
  it("404 when no fingerprint is set", async () => {
    expect(assetLinksResponse({}).status).toBe(404);
    expect(assetLinksResponse({ STAFF_APP_SHA256: " " }).status).toBe(404);
  });

  it("names the default package and one fingerprint", async () => {
    const res = assetLinksResponse({ STAFF_APP_SHA256: A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: STAFF_APP_DEFAULT_PACKAGE, sha256_cert_fingerprints: [A] },
      },
    ]);
  });

  it("takes several fingerprints (upper-cased) and a package override", async () => {
    const body = await assetLinksResponse({ STAFF_APP_SHA256: `${A}, ${B}`, STAFF_APP_PACKAGE: "x.y.z" }).json();
    expect(body[0].target).toEqual({ namespace: "android_app", package_name: "x.y.z", sha256_cert_fingerprints: [A, B.toUpperCase()] });
  });

  it("a broken value is refused loudly, never half-served", () => {
    expect(staffAppFingerprints("nope")).toHaveProperty("error");
    expect(assetLinksResponse({ STAFF_APP_SHA256: `${A},nope` }).status).toBe(404);
  });
});

// Every app the staff app opens must serve the file, outside its login gate (a new module can't forget it).
describe("every app serves /.well-known/assetlinks.json", () => {
  const apps = path.resolve(__dirname, "../../../apps");
  const served = readdirSync(apps).filter((a) => existsSync(path.join(apps, a, "src/proxy.ts")) || a === "platform");
  const PATH = "/.well-known/assetlinks.json";

  it.each(served)("%s has the route", (app) => {
    expect(existsSync(path.join(apps, app, "src/app/.well-known/assetlinks.json/route.ts"))).toBe(true);
  });

  it.each(served.filter((a) => existsSync(path.join(apps, a, "src/proxy.ts"))))("%s lets it past the login gate", (app) => {
    const src = readFileSync(path.join(apps, app, "src/proxy.ts"), "utf8");
    const matchers = [...src.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1] ?? "").filter((m) => m.includes("(?!") || m.includes(":path"));
    expect(matchers.length).toBeGreaterThan(0);
    for (const m of matchers) {
      const hit = m.includes("(?!") ? new RegExp(`^${m}$`).test(PATH) : PATH.startsWith(m.split(":")[0] ?? m);
      expect(hit, `${app}: ${m}`).toBe(false);
    }
  });
});
