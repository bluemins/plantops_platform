// Which paths the proxy guards: only the plant's own screens and APIs. The public job page, the public send and logo,
// login callbacks, tile numbers, health and scheduled jobs never need a login (docs/JOB_APPLICATIONS_PHASE_PLAN.md
// "Standard pieces"). Checked with Next's own matcher test helper against the real proxy config.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

describe("public and protected paths", () => {
  const guarded = (path: string) => unstable_doesMiddlewareMatch({ config, url: `http://localhost:3007${path}` });

  it("the proxy guards the plant's screens and APIs", () => {
    for (const path of ["/applications", "/applications/abc", "/openings", "/openings/new", "/changes", "/support-access", "/api/app/files/x", "/api/app/applications/x/status"]) {
      expect(guarded(path), path).toBe(true);
    }
  });

  it("the public job page, the public send and logo, callbacks, tile numbers, health and jobs need no login", () => {
    for (const path of ["/", "/002", "/bluemins", "/002/openings/abc", "/api/apply/002", "/api/public/logo/002", "/sso/callback", "/sso/support", "/api/plantops/summary", "/api/cron/daily", "/health", "/plant-logo", "/applicationsx", "/_next/static/x.js"]) {
      expect(guarded(path), path).toBe(false);
    }
  });
});

