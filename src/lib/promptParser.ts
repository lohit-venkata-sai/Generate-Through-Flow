import type { PromptSeparator } from "../types";

/**
 * Text the "Add" button writes into a brand-new row. It is a hint to the
 * user, not prompt content — a row still holding it must never be run.
 * Kept here so the Add button and the Continue gate can't drift apart.
 */
export const PROMPT_PLACEHOLDER = "New prompt — tap to edit";

/** How many prompts are blank or still the untouched Add-row placeholder. */
export function countUnusablePrompts(prompts: string[]): number {
    return prompts.filter((p) => {
        const t = p.trim();
        return t.length === 0 || t === PROMPT_PLACEHOLDER;
    }).length;
}

export function parsePrompts(value: string, separator: PromptSeparator) {
    if (!value.trim()) return [];

    switch (separator) {
        case "empty-line":
            return value
                .split(/\n\s*\n/)
                .map((prompt) => prompt.trim())
                .filter(Boolean);
        case "new-line":
            return value
                .split("\n")
                .map((prompt) => prompt.trim())
                .filter(Boolean);
        case "numbered":
            return value
                .split(/\n(?=\d+[.)]\s*)/)
                .map((prompt) => prompt.replace(/^\d+[.)]\s*/, "").trim())
                .filter(Boolean);
        case "dashes":
            return value
                .split(/^\s*-{3,}\s*$/m)
                .map((prompt) => prompt.trim())
                .filter(Boolean);
        default:
            return [value.trim()];
    }
}
