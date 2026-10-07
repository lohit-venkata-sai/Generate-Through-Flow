import { describe, expect, it } from "vitest";
import { buildCharIndex, extractTags, resolveTag, splitPromptParts } from "./flowRefs";

describe("extractTags", () => {
  it("finds bare and bracketed tags deduped case-insensitively", () => {
    expect(extractTags("a @hero and @[Side Kick] plus @HERO")).toEqual(["hero", "Side Kick"]);
  });

  it("returns [] when there are no tags", () => {
    expect(extractTags("plain prompt")).toEqual([]);
  });
});

describe("character index + resolution", () => {
  const index = buildCharIndex(
    [
      { handle: "Hero", mediaId: "m1", createTime: "2024-01-01" },
      { handle: "Hero", mediaId: "m2", createTime: "2024-06-01" },
      { handle: "Old", mediaId: "m9", createTime: "" },
    ],
    ["m9"],
  );

  it("excludes archived media", () => {
    expect(resolveTag(index, "Old")).toBeNull();
  });

  it("newest entry wins", () => {
    expect(resolveTag(index, "hero")?.mediaId).toBe("m2");
  });

  it("leaves unresolved tags as plain text", () => {
    const { parts, refs } = splitPromptParts("a @nobody tale", index);
    expect(refs).toEqual([]);
    expect(parts).toEqual(["a @nobody tale"]);
  });

  it("splits resolved tags into reference objects", () => {
    const { parts, refs } = splitPromptParts("a @hero tale", index);
    expect(refs).toEqual([{ tag: "hero", mediaId: "m2" }]);
    expect(parts).toContainEqual({ mediaId: "m2", name: "hero" });
  });
});
