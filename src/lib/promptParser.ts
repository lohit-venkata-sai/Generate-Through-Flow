import type { PromptSeparator } from "../types";

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
        default:
            return [value.trim()];
    }
}
