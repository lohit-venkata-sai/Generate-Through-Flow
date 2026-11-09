import { describe, expect, it, vi } from "vitest";
import { addTodayCount, defaultBatchName, loadHelpDismissed, loadTodayCount, saveHelpDismissed, todayKey, uid } from "./store";

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

  it("help card shows on first launch, stays dismissed, and can be reopened", async () => {
    // Stub chrome.storage.local — the storage the spec requires. (The
    // localStorage fallback doesn't exist in Node, so testing through it
    // would pass on a silently swallowed write.)
    const backing = new Map<string, unknown>();
    const getSpy = vi.fn(async (key: string) => ({ [key]: backing.get(key) }));
    const setSpy = vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) backing.set(k, v);
    });
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: getSpy, set: setSpy } },
    };
    try {
      // First launch: nothing stored -> the card is offered.
      expect(await loadHelpDismissed()).toBe(false);

      await saveHelpDismissed(true);

      // The dismissal reached chrome.storage.local under its pinned key,
      // so it survives a restart instead of living for one session.
      expect(setSpy).toHaveBeenCalled();
      expect(backing.get("flowpilot-help-dismissed-v1")).toBe(true);
      expect(await loadHelpDismissed()).toBe(true);

      // Settings clears the flag -> the card is offered again.
      await saveHelpDismissed(false);
      expect(backing.get("flowpilot-help-dismissed-v1")).toBe(false);
      expect(await loadHelpDismissed()).toBe(false);
    } finally {
      delete (globalThis as { chrome?: unknown }).chrome;
    }
  });
});
