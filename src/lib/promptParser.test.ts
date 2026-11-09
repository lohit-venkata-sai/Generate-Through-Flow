import { describe, expect, it } from "vitest";
import { countUnusablePrompts, parsePrompts, PROMPT_PLACEHOLDER } from "./promptParser";

describe("parsePrompts", () => {
  it("returns [] for blank input", () => {
    expect(parsePrompts("   \n  ", "empty-line")).toEqual([]);
  });

  it("splits on empty lines", () => {
    expect(parsePrompts("a\n\nb\n\n\nc", "empty-line")).toEqual(["a", "b", "c"]);
  });

  it("splits on every new line", () => {
    expect(parsePrompts("a\nb\n\nc", "new-line")).toEqual(["a", "b", "c"]);
  });

  it("strips numbered prefixes", () => {
    expect(parsePrompts("1. first\n2) second", "numbered")).toEqual(["first", "second"]);
  });

  it("splits on --- dashes", () => {
    expect(parsePrompts("a\n---\nb", "dashes")).toEqual(["a", "b"]);
  });

  it("falls back to a single prompt for unknown separators", () => {
    expect(parsePrompts("  just one  ", "")).toEqual(["just one"]);
  });
});

describe("countUnusablePrompts", () => {
  it("counts the untouched Add-row placeholder as unusable", () => {
    // The bug: Add writes this literal string into the list, parsePrompts
    // treats it as real content, and Continue used to run it as a prompt.
    expect(countUnusablePrompts([PROMPT_PLACEHOLDER])).toBe(1);
  });

  it("counts blank and whitespace-only prompts as unusable", () => {
    expect(countUnusablePrompts(["", "   ", "\n\t"])).toBe(3);
  });

  it("counts a prompt that is only the placeholder with padding", () => {
    expect(countUnusablePrompts([`  ${PROMPT_PLACEHOLDER}  `])).toBe(1);
  });

  it("returns 0 for real prompts", () => {
    expect(countUnusablePrompts(["a red sky", "a futuristic city"])).toBe(0);
    expect(countUnusablePrompts([])).toBe(0);
  });

  it("counts only the bad rows in a mixed list", () => {
    expect(countUnusablePrompts(["a red sky", PROMPT_PLACEHOLDER, "blue ocean", ""])).toBe(2);
  });

  it("does not flag prompts that merely mention placeholder-like words", () => {
    expect(countUnusablePrompts(["New prompt about edit taps", "tap to edit later"])).toBe(0);
  });
});
