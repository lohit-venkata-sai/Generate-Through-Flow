import { describe, expect, it } from "vitest";
import { effectiveLimit, migratePlan, planDef, tierDiff } from "./store";

describe("plans", () => {
  it("free allows 50 images a day", () => {
    expect(planDef("free").dailyLimit).toBe(50);
    expect(effectiveLimit({ base: "free", pass: null })).toBe(50);
  });

  it("an active pass means unlimited", () => {
    const plan = {
      base: "free" as const,
      pass: { id: "p7" as const, startedAt: Date.now(), expiresAt: Date.now() + 10_000 },
    };
    expect(effectiveLimit(plan)).toBeNull();
  });

  it("an expired pass falls back to the base limit", () => {
    const plan = {
      base: "p4" as const,
      pass: { id: "p7" as const, startedAt: 0, expiresAt: 1 },
    };
    expect(effectiveLimit(plan)).toBe(300);
  });

  it("tierDiff prices upgrades correctly", () => {
    expect(tierDiff("free", "p4")).toBe(4);
    expect(tierDiff("p4", "p3")).toBeLessThan(0);
  });

  it("migratePlan handles legacy shapes", () => {
    expect(migratePlan({ id: "p4" })).toEqual({ base: "p4", pass: null });
    expect(migratePlan(null)).toBeNull();
  });
});
