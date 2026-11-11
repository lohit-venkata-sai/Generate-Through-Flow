// Naming rules for saved images and ZIPs.
//
// Everything here is deterministic — no chrome.*, no Math.random, no
// dependence on Chrome's filename-suggest listener — so the queue run, a
// later ZIP build and the single-image modal all derive the same name for
// the same image.

import type { AutomationPrefs } from "../types";

/** Day-first stamp shared by folder and ZIP names: 9 Nov 2026 → "091126". */
export function ddmmyy(now = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(now.getDate())}${p(now.getMonth() + 1)}${p(now.getFullYear() % 100)}`;
}

/** Characters Windows rejects in file/folder names (+ control chars). */
function sanitizeSegment(name: string): string {
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim();
}

/**
 * Folder every image save lands in: base + date, one level deep —
 * `GenerateThroughFlow091126`. The base defaults to GenerateThroughFlow
 * (the folder setting has no UI input, but keep honoring it if set).
 */
export function imageFolderName(base: string | undefined, now = new Date()): string {
    return `${sanitizeSegment(base || "") || "GenerateThroughFlow"}${ddmmyy(now)}`;
}

/** ZIP file name: `GTF_091126.zip`, flat in the Downloads root. */
export function zipFileName(now = new Date()): string {
    return `GTF_${ddmmyy(now)}.zip`;
}

/**
 * Make a string safe for a file name: invalid characters → "_", whitespace
 * collapsed, trailing dots/spaces stripped (Windows), length capped.
 * Never returns an empty string.
 */
export function sanitizeFileName(name: string, maxLen = 80): string {
    const oneLine = sanitizeSegment(name.replace(/\s+/g, " "));
    const noDirs = oneLine.replace(/\.{2,}/g, ".");
    return noDirs.slice(0, maxLen).replace(/[. ]+$/, "") || "flow-image";
}

/**
 * In-batch dedupe: the first image keeps the name, repeats become
 * `name(1)`, `name(2)`… A literal desired name that collides with an
 * already-issued suffix gets suffixed too, never a duplicate.
 */
export function allocateName(desired: string, used: Set<string>): string {
    if (!used.has(desired)) {
        used.add(desired);
        return desired;
    }
    let i = 1;
    while (used.has(`${desired}(${i})`)) i++;
    const out = `${desired}(${i})`;
    used.add(out);
    return out;
}

export interface NamedItem {
    index: number;
    filename: string;
    prompt: string;
    /** What Flow titled this generation (mined from its response), if any. */
    flowName?: string;
}

function applyPattern(index: number, prefs: AutomationPrefs): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const idx = String(index + 1).padStart(3, "0");
    return sanitizeFileName(
        prefs.filenamePattern
            .replaceAll("{index}", idx)
            .replaceAll("{date}", date)
            .replaceAll("{name}", `prompt-${idx}`),
    );
}

/**
 * The name an image wants BEFORE dedupe:
 *
 *   #name marker  >  custom pattern (opt-in setting)  >  Flow's own title  >  prompt text
 *
 * The #name stays authoritative (same as it always was); the fallback
 * changed from a `001-slug` to whatever Flow called the generation, and
 * finally the prompt itself so a name is always derivable.
 */
export function desiredBaseName(item: NamedItem, prefs: AutomationPrefs): string {
    if (item.filename) return sanitizeFileName(item.filename);
    if (prefs.customFilename) return applyPattern(item.index, prefs);
    if (item.flowName) return sanitizeFileName(item.flowName);
    const prompt = item.prompt.trim();
    if (prompt) return sanitizeFileName(prompt);
    return `image-${String(item.index + 1).padStart(3, "0")}`;
}

/** Compat wrapper kept for runQueue's public surface (see re-export). */
export function buildBaseName(
    index: number,
    filename: string,
    prompt: string,
    prefs: AutomationPrefs,
    flowName?: string,
): string {
    return desiredBaseName({ index, filename, prompt, flowName }, prefs);
}

/**
 * Name plan for a whole batch: iterate items in order and allocate every
 * image slot, so two prompts sharing `#1-01` become `1-01` and `1-01(1)`
 * — and the ZIP, recomputed later from the same inputs, agrees exactly.
 */
export function planNames(
    items: NamedItem[],
    prefs: AutomationPrefs,
    imagesPerPrompt: number,
): Map<number, string[]> {
    const used = new Set<string>();
    const plan = new Map<number, string[]>();
    const count = Math.max(1, Math.floor(imagesPerPrompt) || 1);
    for (const item of items) {
        const base = desiredBaseName(item, prefs);
        const names: string[] = [];
        for (let n = 0; n < count; n++) names.push(allocateName(base, used));
        plan.set(item.index, names);
    }
    return plan;
}

/** Planned name for image `n` of `item`, falling back to a solo plan. */
export function plannedName(
    plan: Map<number, string[]> | undefined,
    item: NamedItem,
    n: number,
    prefs: AutomationPrefs,
): string {
    return plan?.get(item.index)?.[n] ?? desiredBaseName(item, prefs);
}

/**
 * Did Chrome actually place the file INSIDE the requested folder? Compares the
 * folder part of the requested path against the absolute path it reports:
 * basename-only comparison can't tell "folder/1-01.png" from a flat
 * "Downloads/1-01.png". Requiring the exact basename would be too strict
 * though — Chrome's uniquify writes "folder/1-01 (1).png" on a repeat save,
 * which is inside the folder and must not be mistaken for a root save (that
 * misread used to trigger a second, redundant download).
 */
export function savedIntoFolder(savedAs: string, wanted: string): boolean {
    const norm = savedAs.replace(/\\/g, "/");
    const folder = wanted.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    if (!folder) return true; // nothing requested outside the root
    return norm.startsWith(`${folder}/`) || norm.includes(`/${folder}/`);
}
