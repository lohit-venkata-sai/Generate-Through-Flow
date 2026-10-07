import { describe, expect, it } from "vitest";
import { buildBaseName, splitFilename } from "./runQueue";
import type { AutomationPrefs } from "../types";

const prefs: AutomationPrefs = {
  autoSave: true,
  customFilename: false,
  filenamePattern: "flow_{index}_{date}",
  resumeLast: true,
  notifyDone: false,
  stopOnError: false,
  retries: 1,
  parallel: 1,
  bufferSec: 0,
};

describe("splitFilename", () => {
  it("splits a #name first line off the prompt", () => {
    expect(splitFilename("#sunset\na red sky")).toEqual({ filename: "sunset", prompt: "a red sky" });
  });

  it("leaves plain prompts untouched", () => {
    expect(splitFilename("just a prompt")).toEqual({ filename: "", prompt: "just a prompt" });
  });
});

describe("buildBaseName", () => {
  it("prefers the #name marker and sanitizes it", () => {
    expect(buildBaseName(0, "my:pic?", "ignored", prefs)).toBe("my_pic_");
  });

  it("slugs the last prompt line otherwise", () => {
    expect(buildBaseName(0, "", "A Red Sky!", prefs)).toBe("001-a-red-sky");
  });

  it("applies the custom pattern when enabled", () => {
    const p = { ...prefs, customFilename: true, filenamePattern: "flow_{index}_{date}" };
    expect(buildBaseName(0, "", "ignored", p)).toMatch(/^flow_001_\d{8}$/);
  });
});
