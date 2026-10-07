import { describe, expect, it } from "vitest";
import { parsePrompts } from "./promptParser";

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
