import { useMemo, useState } from "react";
import { FileText, Sparkles } from "lucide-react";

import { Textarea } from "../../@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../@/components/ui/select";

interface FormValues {
    model: string;
    aspect_ratio: string;
    file_name_pattern: string;
    separator: string;
    user_prompts: string;
    total_prompts: number;
}

interface PromptInputProps {
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
}

const parsePrompts = (value: string, separator: string) => {
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
                .map((prompt) =>
                    prompt.replace(/^\d+[.)]\s*/, "").trim()
                )
                .filter(Boolean);

        default:
            return [value.trim()];
    }
};

export function PromptInput({ setFormValues }: PromptInputProps) {
    const [prompts, setPrompts] = useState("");
    const [separator, setSeparator] = useState("empty-line");

    const detectedPrompts = useMemo(
        () => parsePrompts(prompts, separator),
        [prompts, separator]
    );

    const handlePromptsChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
        const value = event.target.value;
        const parsed = parsePrompts(value, separator);

        setPrompts(value);

        setFormValues((prev) => ({
            ...prev,
            user_prompts: value,
            total_prompts: parsed.length,
        }));
    };

    const handleSeparatorChange = (value: string | null) => {
        if (value === null) return;

        const parsed = parsePrompts(prompts, value);

        setSeparator(value);

        setFormValues((prev) => ({
            ...prev,
            separator: value,
            total_prompts: parsed.length,
        }));
    };

    return (
        <div className="w-full rounded-xl border bg-background p-4 shadow-sm">
            {/* Header */}
            <div className="mb-3 flex items-center gap-2">
                <FileText className="size-5" />

                <h2 className="text-sm font-semibold">
                    Prompt Input
                </h2>
            </div>

            {/* Description */}
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Paste your prompts below. Separate them with empty
                lines, numbering, or a custom separator.
            </p>

            {/* Prompt textarea */}
            <Textarea
                value={prompts}
                onChange={handlePromptsChange}
                placeholder={`Example:

A serene mountain landscape at sunset

A futuristic city with flying cars

A close-up portrait of a wise old robot`}
                className="min-h-32 resize-y text-sm"
            />

            {/* Bottom controls */}
            <div className="mt-4 grid grid-cols-2 gap-4">
                {/* Separator */}
                <div className="space-y-2">
                    <label className="text-xs font-medium">
                        Separator
                    </label>

                    <Select
                        value={separator}
                        onValueChange={handleSeparatorChange}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                            <SelectItem value="empty-line">
                                Empty line (recommended)
                            </SelectItem>

                            <SelectItem value="new-line">
                                New line
                            </SelectItem>

                            <SelectItem value="numbered">
                                Numbered
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {separator === "empty-line"
                            ? "Prompts will be split by blank lines."
                            : separator === "new-line"
                                ? "Each new line will be treated as a prompt."
                                : "Numbered prompts will be detected automatically."}
                    </p>
                </div>

                {/* Detected prompts */}
                <div className="space-y-2">
                    <label className="text-xs font-medium">
                        Detected Prompts
                    </label>

                    <div className="flex h-12 items-center justify-center rounded-lg bg-primary/10">
                        <span className="text-lg font-semibold text-primary">
                            {detectedPrompts.length}
                        </span>
                    </div>
                </div>
            </div>

            {/* Generate button */}
            <button
                type="button"
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
                <Sparkles className="size-4" />

                Generate Agent Prompt
            </button>

            {/* Footer */}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Creates a complete instruction for Flow Agent
            </p>
        </div>
    );
}