import { describe, expect, it } from "vitest";
import { buildBaseName, friendlyError, isThrottleError, isUnsafeError, splitFilename, THROTTLE_COOLDOWNS_MS } from "./runQueue";
import type { AutomationPrefs } from "../types";

const prefs: AutomationPrefs = {
  autoSave: true,
  customFilename: false,
  filenamePattern: "flow_{index}_{date}",
  resumeLast: true,
  notifyDone: false,
  stopOnError: false,
  retries: 1,
  parallel: 2,
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

  it("falls back to the prompt text when there is no #name", () => {
    // Was a `001-a-red-sky` slug; the fallback is now what the prompt (or
    // Flow's own title, when present) actually says.
    expect(buildBaseName(0, "", "A Red Sky!", prefs)).toBe("A Red Sky!");
    expect(buildBaseName(2, "", "", prefs)).toBe("image-003");
    expect(buildBaseName(0, "", "A Red Sky!", prefs, "Scene 7")).toBe("Scene 7");
  });

  it("applies the custom pattern when enabled", () => {
    const p = { ...prefs, customFilename: true, filenamePattern: "flow_{index}_{date}" };
    expect(buildBaseName(0, "", "ignored", p)).toMatch(/^flow_001_\d{8}$/);
  });
});

describe("throttle handling", () => {
  it("detects Google throttling signals", () => {
    expect(isThrottleError("rpc: unusual_activity detected")).toBe(true);
    expect(isThrottleError("Blocked: Unusual Activity, try again later")).toBe(true);
    expect(isThrottleError("HTTP 429 rate limited")).toBe(true);
    expect(isThrottleError("high_traffic, retry")).toBe(true);
    expect(isThrottleError("no image in reply")).toBe(false);
    expect(isThrottleError("")).toBe(false);
  });

  it("cooldowns escalate", () => {
    expect(THROTTLE_COOLDOWNS_MS.length).toBeGreaterThan(0);
    for (let i = 1; i < THROTTLE_COOLDOWNS_MS.length; i++) {
      expect(THROTTLE_COOLDOWNS_MS[i]).toBeGreaterThan(THROTTLE_COOLDOWNS_MS[i - 1]);
    }
  });

  it("friendlyError guides throttled users to slow down", () => {
    expect(friendlyError("unusual_activity")).toContain("1×");
    expect(friendlyError("HTTP 429")).toContain("2×");
  });
});

// The exact payload a user pasted from a rejected generation. Everything
// readable in it lives in the ErrorInfo reason; the rest is transport.
const UNSAFE_RAW = `rpc: "rpc [3,null,[[\\"type.googleapis.com/google.rpc.ErrorInfo\\",[\\"PUBLIC_ERROR_UNSAFE_GENERATION\\"]]]]" | raw: 196 [["wrb.fr","ogiZ0b",null,null,null,[3,null,[["type.googleapis.com/google.rpc.ErrorInfo",["PUBLIC_ERROR_UNSAFE_GENERATION"]]]],"generic"],["di",5254],["af.httprm",5253,"-3446539333232816591",37]] 25 [["e",4,null,null,232]]`;

describe("safety-filter detection", () => {
  it("recognizes the real PUBLIC_ERROR_UNSAFE_GENERATION payload", () => {
    expect(isUnsafeError(UNSAFE_RAW)).toBe(true);
    expect(isUnsafeError("PUBLIC_ERROR_UNSAFE_GENERATION")).toBe(true);
    expect(isUnsafeError("error: unsafe_generation")).toBe(true);
  });

  it("does not fire on other errors", () => {
    expect(isUnsafeError("unusual_activity")).toBe(false);
    expect(isUnsafeError("no image in reply")).toBe(false);
    expect(isUnsafeError("")).toBe(false);
    expect(isUnsafeError(undefined)).toBe(false);
  });

  it("is not a throttle — backoff cannot pass a content verdict", () => {
    // The two must stay disjoint: throttle gets cooldowns, unsafe gets none.
    expect(isThrottleError(UNSAFE_RAW)).toBe(false);
  });

  it("friendlyError tells the user to reword instead of dumping raw bytes", () => {
    const msg = friendlyError(UNSAFE_RAW);
    expect(msg).toContain("safety filter");
    expect(msg).toContain("reword");
    // It replaces the old raw dump — the whole point is readable, short text.
    expect(msg.length).toBeLessThan(160);
    expect(msg).not.toContain("google.rpc.ErrorInfo");
  });
});
