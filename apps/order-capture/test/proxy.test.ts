// Which addresses skip the login proxy (src/proxy.ts matcher). The order phone's call address must: MacroDroid has a
// key, never a session. The Calls screens' own APIs must not.
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// Next turns each matcher into a regular expression over the path; this is the same pattern, anchored
const behindLogin = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("the login proxy", () => {
  it("skips the phone's call address and the bot API", () => {
    expect(behindLogin("/api/calls/v1")).toBe(false);
    expect(behindLogin("/api/bot/v1/context")).toBe(false);
    expect(behindLogin("/health")).toBe(false);
  });

  it("covers the pages and every other API, including the Calls screens'", () => {
    for (const path of ["/", "/calls", "/api/calls/attend", "/api/calls/v1/extra", "/api/orders", "/customers"]) expect(behindLogin(path), path).toBe(true);
  });
});
