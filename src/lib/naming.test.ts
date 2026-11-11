import { describe, expect, it } from "vitest";
import {
    allocateName, buildBaseName, desiredBaseName, ddmmyy, imageFolderName,
    plannedName, planNames, sanitizeFileName, savedIntoFolder, zipFileName,
} from "./naming";
import { defaultPrefs } from "./store";
import type { AutomationPrefs } from "../types";

// Fixed dates so the assertions never depend on the wall clock:
// 9 Nov 2026 and 5 Jan 2026 (both single-digit components — padding matters).
const NOV9 = new Date(2026, 10, 9);
const JAN5 = new Date(2026, 0, 5);

const prefs: AutomationPrefs = { ...defaultPrefs };

describe("ddmmyy", () => {
    it("is day-first with zero padding", () => {
        expect(ddmmyy(NOV9)).toBe("091126");
        expect(ddmmyy(JAN5)).toBe("050126");
    });
});

describe("imageFolderName", () => {
    it("defaults to GenerateThroughFlow + the date, one level deep", () => {
        expect(imageFolderName(undefined, NOV9)).toBe("GenerateThroughFlow091126");
        expect(imageFolderName("", NOV9)).toBe("GenerateThroughFlow091126");
    });

    it("appends the date to a custom base", () => {
        expect(imageFolderName("TestFlow", NOV9)).toBe("TestFlow091126");
    });

    it("sanitizes path characters out of the base", () => {
        expect(imageFolderName("a/b:c", NOV9)).toBe("a_b_c091126");
    });
});

describe("zipFileName", () => {
    it("is GTF_ddmmyy.zip", () => {
        expect(zipFileName(NOV9)).toBe("GTF_091126.zip");
        expect(zipFileName(JAN5)).toBe("GTF_050126.zip");
    });
});

describe("sanitizeFileName", () => {
    it("replaces characters Windows rejects", () => {
        expect(sanitizeFileName("my/pic:")).toBe("my_pic_");
        expect(sanitizeFileName('a<b>c"d|e')).toBe("a_b_c_d_e");
    });

    it("collapses whitespace (including newlines) to single spaces", () => {
        expect(sanitizeFileName("a\n  b\t c")).toBe("a b c");
    });

    it("caps the length", () => {
        expect(sanitizeFileName("x".repeat(200))).toHaveLength(80);
    });

    it("never returns an empty or dot-only name", () => {
        expect(sanitizeFileName("   ")).toBe("flow-image");
        expect(sanitizeFileName("...")).toBe("flow-image");
        expect(sanitizeFileName("///")).not.toBe("");
    });
});

describe("allocateName", () => {
    it("keeps the first claim and increments repeats", () => {
        const used = new Set<string>();
        expect(allocateName("1-01", used)).toBe("1-01");
        expect(allocateName("1-01", used)).toBe("1-01(1)");
        expect(allocateName("1-01", used)).toBe("1-01(2)");
    });

    it("suffixed a literal desired name that collides with an issued suffix", () => {
        const used = new Set<string>();
        allocateName("x", used);
        allocateName("x", used); // issues x(1)
        // A prompt that literally wants "x(1)" must not duplicate it.
        expect(allocateName("x(1)", used)).toBe("x(1)(1)");
        expect(new Set(["x", "x(1)", "x(1)(1)"]).size).toBe(3);
    });
});

describe("desiredBaseName", () => {
    const item = (over: Partial<{ index: number; filename: string; prompt: string; flowName?: string }> = {}) => ({
        index: 0, filename: "", prompt: "", ...over,
    });

    it("lets the #name marker win over pattern and Flow title", () => {
        const on: AutomationPrefs = { ...prefs, customFilename: true, filenamePattern: "flow_{index}" };
        expect(desiredBaseName(item({ filename: "1-01", flowName: "Scene 7", prompt: "ignored" }), on)).toBe("1-01");
    });

    it("uses the custom pattern only when enabled and no #name", () => {
        const on: AutomationPrefs = { ...prefs, customFilename: true, filenamePattern: "img-{index}" };
        expect(desiredBaseName(item({ index: 2, prompt: "ignored" }), on)).toBe("img-003");
        // Disabled: the pattern must not leak in.
        expect(desiredBaseName(item({ index: 2, prompt: "A Red Sky!" }), prefs)).toBe("A Red Sky!");
    });

    it("prefers Flow's own title over the prompt text", () => {
        expect(desiredBaseName(item({ flowName: " Scene 7 ", prompt: "a red sky" }), prefs)).toBe("Scene 7");
    });

    it("falls back to prompt text, then to image-00N", () => {
        expect(desiredBaseName(item({ prompt: "A Red Sky!" }), prefs)).toBe("A Red Sky!");
        expect(desiredBaseName(item(), prefs)).toBe("image-001");
    });
});

describe("planNames", () => {
    it("hands a shared #name to the first image and (1) to the next item", () => {
        const plan = planNames(
            [
                { index: 0, filename: "1-01", prompt: "a" },
                { index: 1, filename: "1-01", prompt: "b" },
            ],
            prefs, 1,
        );
        expect(plan.get(0)).toEqual(["1-01"]);
        expect(plan.get(1)).toEqual(["1-01(1)"]);
    });

    it("numbers multiple images of one item as x / x(1) / x(2)", () => {
        const plan = planNames([{ index: 0, filename: "x", prompt: "a" }], prefs, 3);
        expect(plan.get(0)).toEqual(["x", "x(1)", "x(2)"]);
    });

    it("is deterministic — the same inputs plan the same names", () => {
        const items = [
            { index: 0, filename: "1-01", prompt: "a" },
            { index: 1, filename: "1-01", prompt: "b" },
            { index: 2, filename: "", prompt: "A red sky" },
        ];
        const a = planNames(items, prefs, 2);
        const b = planNames(items, prefs, 2);
        expect([...a.entries()]).toEqual([...b.entries()]);
    });
});

describe("plannedName", () => {
    const item = { index: 4, filename: "1-01", prompt: "a red sky" };

    it("reads from the plan when it covers the item", () => {
        const plan = planNames([item], prefs, 2);
        expect(plannedName(plan, item, 1, prefs)).toBe("1-01(1)");
    });

    it("falls back to a solo derivation when there is no plan entry", () => {
        expect(plannedName(undefined, item, 0, prefs)).toBe("1-01");
        expect(plannedName(new Map(), item, 0, prefs)).toBe("1-01");
    });
});

describe("buildBaseName (compat surface)", () => {
    it("matches desiredBaseName for the same inputs", () => {
        expect(buildBaseName(0, "1-01", "ignored", prefs)).toBe("1-01");
        expect(buildBaseName(0, "", "A Red Sky!", prefs, "Scene 7")).toBe("Scene 7");
    });
});

describe("savedIntoFolder", () => {
    const wanted = "GenerateThroughFlow091126/1-01.png";

    it("accepts an absolute path that ends with the wanted relative path", () => {
        expect(savedIntoFolder("C:\\Users\\u\\Downloads\\GenerateThroughFlow091126\\1-01.png", wanted)).toBe(true);
        expect(savedIntoFolder("/home/u/Downloads/GenerateThroughFlow091126/1-01.png", wanted)).toBe(true);
    });

    it("rejects a flat save in the Downloads root", () => {
        expect(savedIntoFolder("C:\\Users\\u\\Downloads\\1-01.png", wanted)).toBe(false);
        expect(savedIntoFolder("/home/u/Downloads/1-01.png", wanted)).toBe(false);
    });

    it("accepts Chrome's uniquified repeat name inside the folder", () => {
        // A second save of the same image becomes "1-01 (1).png" — still in
        // the folder, so it must not be mistaken for a root save (that misread
        // triggered a redundant second download).
        expect(savedIntoFolder("C:\\Users\\u\\Downloads\\GenerateThroughFlow091126\\1-01 (1).png", wanted)).toBe(true);
        expect(savedIntoFolder("/home/u/Downloads/GenerateThroughFlow091126/1-01 (1).png", wanted)).toBe(true);
    });

    it("is not fooled by a different folder that shares the basename", () => {
        expect(savedIntoFolder("/d/OtherFolder/1-01.png", wanted)).toBe(false);
    });
});
