// Distances and pasted points (src/lib/geo.ts) and the IN / OUT rules (src/lib/punch.ts): pure, no database.
import { describe, expect, it } from "vitest";
import { distanceM, fmtDistance, parseLatLng } from "@/lib/geo";
import { isDoubleTap, nextKind, stateText } from "@/lib/punch";
import { northOf } from "./helpers";

describe("distance (haversine)", () => {
  it("matches known distances", () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, 0); // one degree of latitude
    // Bhubaneswar - Cuttack, about 21 km
    expect(distanceM({ lat: 20.2961, lng: 85.8245 }, { lat: 20.4625, lng: 85.883 }) / 1000).toBeCloseTo(19.5, 0);
    const plant = { lat: 21.347, lng: 83.627 };
    expect(distanceM(plant, northOf(plant, 199))).toBeCloseTo(199, 6);
  });

  it("is written as metres or km", () => {
    expect(fmtDistance(40.4)).toBe("40 m");
    expect(fmtDistance(1400)).toBe("1.4 km");
    expect(fmtDistance(23_456)).toBe("23 km");
  });
});

describe("a pasted point", () => {
  it.each([
    ["21.347, 83.627", { lat: 21.347, lng: 83.627 }],
    ["  21.347,83.627 ", { lat: 21.347, lng: 83.627 }],
    ["21.347 83.627", { lat: 21.347, lng: 83.627 }],
    ["(21.347, 83.627)", { lat: 21.347, lng: 83.627 }],
    ["-33.86, 151.2", { lat: -33.86, lng: 151.2 }],
    ["https://www.google.com/maps/place/Plant/@21.3470123,83.6270456,17z/data=x", { lat: 21.3470123, lng: 83.6270456 }],
  ])("reads %s", (text, expected) => {
    expect(parseLatLng(text)).toEqual(expected);
  });

  it.each(["", "plant", "91, 83", "21.3, 181", "21.3", "21.3, 83.6, 10"])("refuses %s", (text) => {
    expect(parseLatLng(text)).toBeNull();
  });
});

describe("IN or OUT", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const H = 3600_000;

  it("no mark yet, or the last was an OUT: IN", () => {
    expect(nextKind(null, now)).toBe("in");
    expect(nextKind({ kind: "out", at: ago(H) }, now)).toBe("in");
  });

  it("an IN less than 16 hours ago: OUT; 16 hours or more: IN again", () => {
    expect(nextKind({ kind: "in", at: ago(16 * H - 60_000) }, now)).toBe("out");
    expect(nextKind({ kind: "in", at: ago(16 * H) }, now)).toBe("in");
    expect(nextKind({ kind: "in", at: ago(16 * H + 60_000) }, now)).toBe("in");
  });

  it("a second mark within 2 minutes is a double tap", () => {
    expect(isDoubleTap({ kind: "in", at: ago(119_000) }, now)).toBe(true);
    expect(isDoubleTap({ kind: "in", at: ago(120_000) }, now)).toBe(false);
    expect(isDoubleTap(null, now)).toBe(false);
  });

  it("the state line uses India time", () => {
    expect(stateText({ kind: "in", at: new Date("2026-10-15T03:32:00Z") }, now)).toBe("IN since 9:02");
    expect(stateText(null, now)).toBe("You are OUT");
  });
});
