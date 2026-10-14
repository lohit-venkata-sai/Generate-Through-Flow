import { describe, expect, it } from "vitest";
import { addTodayCount, defaultBatchName, loadTodayCount, todayKey, uid } from "./store";

describe("store utils", () => {
  it("todayKey formats the local date", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uid returns a non-empty id", () => {
    expect(uid().length).toBeGreaterThan(0);
  });

  it("defaultBatchName falls back to Untitled batch", () => {
    expect(defaultBatchName([])).toBe("Untitled batch");
    expect(defaultBatchName(["#hero-shot\nA red sky"])).toBe("A red sky");
  });

  it("today counter loads a number and accumulates adds", async () => {
    const before = await loadTodayCount();
    expect(typeof before).toBe("number");
    const after = await addTodayCount(2);
    expect(after).toBe(before + 2);
    expect(await loadTodayCount()).toBe(after);
  });
});
