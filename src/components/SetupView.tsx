import { useEffect, useState } from "react";
import { ArrowRight, BookmarkPlus, Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { parsePrompts } from "../lib/promptParser";
import type { FormValues } from "../types";

interface SetupViewProps {
    formValues: FormValues;
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
    onSavePreset: () => void;
    onContinue: () => void;
}

const MODELS = [
    { value: "nano-banana-pro", label: "Nano Banana Pro" },
    { value: "nano-banana-2", label: "Nano Banana 2" },
    { value: "nano-banana-2-lite", label: "Nano Banana 2 Lite" },
];

const ASPECTS = ["9:16", "16:9", "1:1"];
const QUALITIES = [
    { value: "standard", label: "Standard" },
];
const SEPARATORS = [
    { value: "empty-line", label: "Empty line" },
    { value: "new-line", label: "New line" },
    { value: "numbered", label: "Numbered" },
    { value: "dashes", label: "---" },
];

function NativeSelect({ value, onChange, options, aria }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    aria: string;
}) {
    return (
        <select
            value={value}
            aria-label={aria}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    );
}

export function SetupView({ formValues, setFormValues, onSavePreset, onContinue }: SetupViewProps) {
    const prompts = parsePrompts(formValues.user_prompts, formValues.separator);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        setSaved(false);
    }, [formValues]);
    const set = (patch: Partial<FormValues>) => setFormValues((p) => ({ ...p, ...patch }));

    const setPrompts = (next: string[]) => {
        const joiner = formValues.separator === "new-line" ? "\n" : "\n\n";
        const text = next.join(joiner);
        setFormValues((p) => ({ ...p, user_prompts: text, total_prompts: next.length }));
    };

    const move = (i: number, dir: -1 | 1) => {
        const next = [...prompts];
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        setPrompts(next);
    };

    const remove = (i: number) => setPrompts(prompts.filter((_, k) => k !== i));

    const add = () => {
        const joiner = formValues.separator === "new-line" ? "\n" : "\n\n";
        const text = formValues.user_prompts.trim()
            ? formValues.user_prompts.replace(/\s+$/, "") + joiner + "New prompt — tap to edit"
            : "New prompt — tap to edit";
        const parsed = parsePrompts(text, formValues.separator);
        setFormValues((p) => ({ ...p, user_prompts: text, total_prompts: parsed.length }));
    };

    const editRow = (i: number, value: string) => {
        const next = [...prompts];
        next[i] = value;
        setPrompts(next.filter((p) => p.trim()));
    };

    return (
        <div className="flex flex-col gap-4">
            <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Generation Settings</h2>
                    <button
                        type="button"
                        onClick={() => { onSavePreset(); setSaved(true); }}
                        className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                        {saved ? <Check className="size-3.5" /> : <BookmarkPlus className="size-3.5" />}
                        {saved ? "Saved" : "Save Preset"}
                    </button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Model</label>
                        <NativeSelect aria="Model" value={formValues.model} onChange={(v) => set({ model: v })} options={MODELS} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Aspect Ratio</label>
                        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Aspect Ratio">
                            {ASPECTS.map((a) => (
                                <button
                                    key={a}
                                    type="button"
                                    aria-pressed={formValues.aspect_ratio === a}
                                    onClick={() => set({ aspect_ratio: a })}
                                    className={`h-10 rounded-xl border text-sm font-medium transition-colors ${formValues.aspect_ratio === a ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Quality</label>
                        <NativeSelect aria="Quality" value={formValues.quality} onChange={(v) => set({ quality: v as FormValues["quality"] })} options={QUALITIES} />
                        <p className="mt-1 text-[11px] text-muted-foreground">Flow generates standard resolution for direct automation.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Images per prompt</label>
                            <NativeSelect
                                aria="Images per prompt"
                                value={String(formValues.images_per_prompt)}
                                onChange={(v) => set({ images_per_prompt: Number(v) as 1 | 2 | 3 | 4 })}
                                options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Separator</label>
                            <NativeSelect aria="Separator" value={formValues.separator} onChange={(v) => set({ separator: v as FormValues["separator"] })} options={SEPARATORS} />
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Prompt List</h2>
                    <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {prompts.length} prompts
                        </span>
                        {prompts.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setFormValues((p) => ({ ...p, user_prompts: "", total_prompts: 0 }))}
                                aria-label="Clear all prompts"
                                title="Clear all prompts"
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={add}
                            className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            <Plus className="size-3.5" />
                            Add
                        </button>
                    </div>
                </div>
                {prompts.length === 0 && (
                    <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                        No prompts yet — paste them below or tap Add.
                    </p>
                )}
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                    {prompts.map((p, i) => (
                        <li key={`${i}-${p.slice(0, 12)}`} className="flex items-center gap-1.5 rounded-xl border bg-background px-2 py-1.5">
                            <span className="flex flex-col text-muted-foreground">
                                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="px-0.5 text-[10px] leading-none disabled:opacity-30">▲</button>
                                <GripVertical className="size-3.5" />
                                <button type="button" aria-label="Move down" disabled={i === prompts.length - 1} onClick={() => move(i, 1)} className="px-0.5 text-[10px] leading-none disabled:opacity-30">▼</button>
                            </span>
                            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                            <input
                                value={p}
                                onChange={(e) => editRow(i, e.target.value)}
                                aria-label={`Prompt ${i + 1}`}
                                className="min-w-0 flex-1 truncate bg-transparent text-xs outline-none focus:border-b focus:border-primary"
                            />
                            <button type="button" onClick={() => remove(i)} aria-label={`Delete prompt ${i + 1}`} className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                <Trash2 className="size-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="mt-3">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Bulk paste / edit</label>
                    <textarea
                        value={formValues.user_prompts}
                        onChange={(e) => {
                            const v = e.target.value;
                            const parsed = parsePrompts(v, formValues.separator);
                            setFormValues((p) => ({ ...p, user_prompts: v, total_prompts: parsed.length }));
                        }}
                        placeholder={"A serene mountain landscape at sunset\n\nA futuristic city with flying cars"}
                        className="h-28 w-full resize-y rounded-xl border bg-background p-3 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
            </section>

            <button
                type="button"
                onClick={onContinue}
                disabled={prompts.length === 0}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
            >
                Continue
                <ArrowRight className="size-4" />
            </button>
        </div>
    );
}
