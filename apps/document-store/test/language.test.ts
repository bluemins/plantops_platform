import { describe, expect, it } from "vitest";
import { POST as setLanguage } from "@/app/language/route";
import { localizedExpiry, localizedStage, translate } from "@/lib/i18n";

describe("Document Store languages", () => {
  it("translates the expiry state and reminder stage", () => {
    expect(localizedExpiry("hi", "soon", 1)).toBe("एक दिन में समाप्त होगा");
    expect(localizedExpiry("or", "expired", -3)).toContain("ଦିନ");
    expect(localizedStage("hi", "d30")).toBe("30 दिन पहले");
    expect(translate("or", "title")).toContain("ପ୍ରମାଣପତ୍ର");
  });

  it("accepts only supported locales from same-origin requests and sets a protected preference cookie", async () => {
    const request = (origin: string, locale: unknown, url = "https://docs.example.test/language") =>
      new Request(url, { method: "POST", headers: { origin, host: new URL(url).host, "content-type": "application/json" }, body: JSON.stringify({ locale }) });
    expect((await setLanguage(request("https://evil.example", "hi"))).status).toBe(403);
    expect((await setLanguage(request("https://docs.example.test", "fr"))).status).toBe(400);

    const response = await setLanguage(request("https://docs.example.test", "or"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("document-store-language=or");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax; Secure");
  });
});
