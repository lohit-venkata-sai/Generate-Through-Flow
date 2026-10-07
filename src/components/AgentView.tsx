import { useState } from "react";
import { ClipboardCopy, Copy, Download, FileText, Info, Trash2 } from "lucide-react";
import { buildAgentPrompt } from "../lib/promptBuilder";
import { parsePrompts } from "../lib/promptParser";
import { splitFilename } from "../lib/runQueue";
import type { FormValues } from "../types";

interface AgentViewProps {
    formValues: FormValues;
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
}

export function AgentView({ formValues, setFormValues }: AgentViewProps) {
    const [tab, setTab] = useState<"instructions" | "preview">("instructions");
    const [copied, setCopied] = useState(false);
    const instructions = buildAgentPrompt(formValues);
    const previewPrompts = parsePrompts(formValues.user_prompts, formValues.separator);

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch { /* manual copy fallback below */ }
    };

    const saveTxt = () => {
        const blob = new Blob([instructions], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "flow-agent-instructions.txt";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    const clear = () => setFormValues((p) => ({ ...p, user_prompts: "", total_prompts: 0 }));

    return (
        <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-3 text-[11px] leading-relaxed text-primary">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Enable Agent mode in Google Flow, then paste the copied text into it.
            </p>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border bg-card p-1">
                {(["instructions", "preview"] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        aria-pressed={tab === t}
                        className={`h-9 rounded-xl text-[13px] font-medium capitalize transition-colors ${tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold">Generated Instructions</h2>
                        <p className="text-[11px] text-muted-foreground">Ready to copy and send to Flow Agent</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => copy(instructions)}
                        disabled={!instructions}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
                    >
                        <Copy className="size-3.5" />
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
                {tab === "instructions" ? (
                    <textarea
                        readOnly
                        value={instructions}
                        aria-label="Generated instructions"
                        placeholder="Add prompts on the main screen first."
                        className="min-h-72 w-full resize-y rounded-xl border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed outline-none"
                    />
                ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                        <li className="rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                            Model {formValues.model} · {formValues.aspect_ratio || "project default"} · ×{formValues.images_per_prompt} per prompt
                        </li>
                        {previewPrompts.length === 0 && (
                            <li className="rounded-xl border border-dashed p-4 text-center text-[11px] text-muted-foreground">
                                Add prompts on the main screen first.
                            </li>
                        )}
                        {previewPrompts.map((raw, i) => {
                            const { filename, prompt } = splitFilename(raw);
                            return (
                                <li key={i} className="rounded-xl border bg-background px-3 py-2">
                                    <p className="text-[11px] font-semibold">
                                        <span className="mr-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{i + 1}</span>
                                        {filename ? <span className="font-mono text-primary">#{filename}</span> : <span className="text-muted-foreground">auto filename</span>}
                                    </p>
                                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{prompt}</p>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <h2 className="mb-2.5 text-sm font-semibold">Quick Actions</h2>
                <div className="grid grid-cols-3 gap-2">
                    <button
                        type="button"
                        onClick={() => copy(instructions)}
                        disabled={!instructions}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent disabled:opacity-45"
                    >
                        <ClipboardCopy className="size-3.5" />
                        Copy All
                    </button>
                    <button
                        type="button"
                        onClick={saveTxt}
                        disabled={!instructions}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent disabled:opacity-45"
                    >
                        <Download className="size-3.5" />
                        Save as .txt
                    </button>
                    <button
                        type="button"
                        onClick={clear}
                        disabled={!formValues.user_prompts}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-45"
                    >
                        {formValues.user_prompts ? <Trash2 className="size-3.5" /> : <FileText className="size-3.5" />}
                        Clear
                    </button>
                </div>
            </section>
        </div>
    );
}
