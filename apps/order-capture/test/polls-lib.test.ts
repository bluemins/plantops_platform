// Drop poll rules (src/lib/polls.ts): open / closed, the week (Monday–Sunday, India), poll points, buying size, results.
import { describe, expect, it } from "vitest";
import { answerPoints, OTHER, pollResults, pollState, sizeOf, weekStart } from "@/lib/polls";

const at = (s: string) => new Date(`${s}+05:30`);

describe("polls", () => {
  it("open between its times; closed early stays closed", () => {
    const p = { opens_at: at("2026-11-10T00:00:00"), closes_at: at("2026-11-17T00:00:00"), closed_early_at: null };
    expect(pollState(p, at("2026-11-09T23:59:59"))).toBe("scheduled");
    expect(pollState(p, at("2026-11-10T00:00:00"))).toBe("open");
    expect(pollState(p, at("2026-11-16T23:59:59"))).toBe("open");
    expect(pollState(p, at("2026-11-17T00:00:00"))).toBe("closed");
    expect(pollState({ ...p, closed_early_at: at("2026-11-12T10:00:00") }, at("2026-11-12T11:00:00"))).toBe("closed");
  });

  it("the week starts on Monday (1 Jan 2024 was a Monday)", () => {
    expect(weekStart("2024-01-01")).toBe("2024-01-01");
    expect(weekStart("2024-01-03")).toBe("2024-01-01");
    expect(weekStart("2024-01-07")).toBe("2024-01-01"); // Sunday
    expect(weekStart("2024-01-08")).toBe("2024-01-08");
  });

  it("poll points: the week's first answer of a shop with an order delivered in the last 30 days", () => {
    const base = { pointsOn: true, pollPoints: 10, today: "2024-01-08", countedOn: [] as string[], lastDeliveredOn: "2024-01-02" };
    expect(answerPoints(base)).toEqual({ points: 10, reason: "counted" });
    // last Sunday's counted answer is last week's
    expect(answerPoints({ ...base, countedOn: ["2024-01-07"] })).toEqual({ points: 10, reason: "counted" });
    expect(answerPoints({ ...base, today: "2024-01-14", countedOn: ["2024-01-08"] })).toEqual({ points: 0, reason: "week_used" });
    expect(answerPoints({ ...base, lastDeliveredOn: "2023-12-09" })).toEqual({ points: 10, reason: "counted" }); // 30 days before
    expect(answerPoints({ ...base, lastDeliveredOn: "2023-12-08" })).toEqual({ points: 0, reason: "no_recent_order" });
    expect(answerPoints({ ...base, lastDeliveredOn: null })).toEqual({ points: 0, reason: "no_recent_order" });
    expect(answerPoints({ ...base, pointsOn: false })).toEqual({ points: 0, reason: "points_off" });
    expect(answerPoints({ ...base, pollPoints: 0 })).toEqual({ points: 0, reason: "points_off" });
  });

  it("buying size: under 10, 10–49, 50+", () => {
    expect([0, 9, 9.5, 10, 49, 49.9, 50, 4000].map(sizeOf)).toEqual(["small", "small", "small", "medium", "medium", "medium", "large", "large"]);
  });

  it("results: counts per choice and Other, the Other texts, split by place and buying size", () => {
    const r = pollResults(["1L", "500ml"], true, [
      { choice: 0, other_text: null, place: "Bijepur", boxes: 60 },
      { choice: 0, other_text: null, place: "Bargarh", boxes: 12 },
      { choice: 1, other_text: null, place: "Bijepur", boxes: 3 },
      { choice: OTHER, other_text: "20L jar", place: " ", boxes: 0 },
    ]);
    expect(r).toMatchObject({ labels: ["1L", "500ml", "Other"], total: 4, counts: [2, 1, 1], others: ["20L jar"] });
    expect(r.by_place).toEqual([
      { place: "Bijepur", total: 2, counts: [1, 1, 0] },
      { place: "Bargarh", total: 1, counts: [1, 0, 0] },
      { place: "—", total: 1, counts: [0, 0, 1] },
    ]);
    expect(r.by_size).toEqual([
      { size: "small", total: 2, counts: [0, 1, 1] },
      { size: "medium", total: 1, counts: [1, 0, 0] },
      { size: "large", total: 1, counts: [1, 0, 0] },
    ]);
    expect(pollResults(["a", "b"], false, []).labels).toEqual(["a", "b"]);
  });
});
