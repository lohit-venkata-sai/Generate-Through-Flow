import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, FileOutput, Sparkles } from "lucide-react";

interface GeneratedPromptProps {
    prompt: string;
}

export function GeneratedPrompt({ prompt }: GeneratedPromptProps) {
    const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
    const promptRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const textarea = promptRef.current;
        if (textarea) textarea.scrollTop = textarea.scrollHeight;
    }, [prompt]);

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 2_000);
        } catch {
            setCopyState("error");
        }
    };

    return (
        <section className="generated-prompt rounded-2xl border border-primary/25 bg-card p-4 shadow-sm sm:p-5" aria-live="polite">
            <div className="mb-3 flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileOutput className="size-4" />
                </div>
                <div>
                    <h2 className="text-sm font-semibold">Generated Agent Prompt</h2>
                    <p className="text-xs text-muted-foreground">Ready to paste into Flow Agent</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                    <Sparkles className="size-3" />
                    Updated
                </span>
            </div>

            <textarea
                ref={promptRef}
                readOnly
                value={prompt}
                aria-label="Generated Agent Prompt"
                className="prompt-textarea min-h-56 w-full resize-y rounded-xl border bg-muted/40 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            />

            <button
                type="button"
                onClick={copyPrompt}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99]"
            >
                {copyState === "copied" ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
                {copyState === "copied" ? "Copied to Clipboard" : "Copy to Clipboard"}
            </button>

            {copyState === "error" && (
                <p className="mt-2 text-center text-xs text-destructive">
                    Copy failed. Select the text above and copy it manually.
                </p>
            )}
        </section>
    );
}
