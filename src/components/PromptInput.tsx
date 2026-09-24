import { useMemo } from "react";
import { FileText, Sparkles, X } from "lucide-react";

import { Textarea } from "../../@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../@/components/ui/select";
import { parsePrompts } from "../lib/promptParser";
import type { FormValues, PromptSeparator } from "../types";

interface PromptInputProps {
    formValues: FormValues;
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
    onGenerate: () => void;
}

export function PromptInput({ formValues, setFormValues, onGenerate }: PromptInputProps) {
    const detectedPrompts = useMemo(
        () => parsePrompts(formValues.user_prompts, formValues.separator),
        [formValues.separator, formValues.user_prompts]
    );

    const handlePromptsChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
        const value = event.target.value;
        const parsed = parsePrompts(value, formValues.separator);

        setFormValues((prev) => ({
            ...prev,
            user_prompts: value,
            total_prompts: parsed.length,
        }));
    };

    const handleSeparatorChange = (value: string | null) => {
        if (value === null) return;

        const nextSeparator = value as PromptSeparator;
        const parsed = parsePrompts(formValues.user_prompts, nextSeparator);

        setFormValues((prev) => ({
            ...prev,
            separator: nextSeparator,
            total_prompts: parsed.length,
        }));
    };

    const clearPrompts = () => {
        setFormValues((prev) => ({
            ...prev,
            user_prompts: "",
            total_prompts: 0,
        }));
    };

    return (
        <div className="w-full rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            {/* Header */}
            <div className="mb-3 flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" />
                </div>

                <div>
                    <h2 className="text-sm font-semibold">Prompt Input</h2>
                    <p className="text-xs text-muted-foreground">One idea per prompt</p>
                </div>

                <button
                    type="button"
                    onClick={clearPrompts}
                    disabled={!formValues.user_prompts}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                    <X className="size-3.5" />
                    Clear
                </button>
            </div>

            {/* Description */}
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Paste your prompts below. Separate them with empty
                lines, numbering, or a custom separator.
            </p>

            {/* Prompt textarea */}
            <Textarea
                value={formValues.user_prompts}
                onChange={handlePromptsChange}
                placeholder={`Example:

A serene mountain landscape at sunset

A futuristic city with flying cars

A close-up portrait of a wise old robot`}
                className="prompt-textarea h-40 min-h-40 max-h-72 resize-y overflow-y-scroll bg-background text-sm"
            />

            {/* Bottom controls */}
            <div className="mt-4 flex items-start gap-3">
                {/* Separator */}
                <div className="min-w-0 flex-1 space-y-2">
                    <label className="text-xs font-medium">
                        Separator
                    </label>

                    <Select
                        value={formValues.separator}
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
                        {formValues.separator === "empty-line"
                            ? "Prompts will be split by blank lines."
                            : formValues.separator === "new-line"
                                ? "Each new line will be treated as a prompt."
                                : "Numbered prompts will be detected automatically."}
                    </p>
                </div>

                {/* Detected prompts */}
                <div className="space-y-2">
                    <span className="block text-xs font-medium">Detected</span>

                    <div className="flex h-10 min-w-24 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-primary-foreground shadow-sm">
                        <span className="text-base font-semibold tabular-nums">{detectedPrompts.length}</span>
                        <span className="text-xs font-medium">{detectedPrompts.length === 1 ? "prompt" : "prompts"}</span>
                    </div>
                </div>
            </div>

            {/* Generate button */}
            <button
                type="button"
                onClick={onGenerate}
                disabled={detectedPrompts.length === 0}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
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
