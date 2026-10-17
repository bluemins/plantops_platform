// The login callback's "next" path: only paths inside the module; anything else lands on the module's home page.
import { describe, expect, it } from "vitest";
import { safeNext } from "../src/safe-next";

describe("safeNext", () => {
  it("keeps a path inside the module", () => {
    expect(safeNext("/new?x=1")).toBe("/new?x=1");
    expect(safeNext("/openings", "/applications")).toBe("/openings");
  });

  it.each([null, undefined, "", "//evil.example", "https://evil.example", "/\\evil.example", "/a b", "evil", `/${"a".repeat(500)}`])(
    "%j goes to the home page: '/' by default, or the module's own",
    (v) => {
      expect(safeNext(v)).toBe("/");
      expect(safeNext(v, "/applications")).toBe("/applications");
    },
  );
});
