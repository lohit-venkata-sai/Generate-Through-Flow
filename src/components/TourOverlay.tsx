import { useState } from "react";
import { ArrowRight, AtSign, Hash, Play, Settings2, Sparkles, X } from "lucide-react";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";

const STEPS = [
    {
        icon: <Sparkles className="size-5" />,
        title: "Welcome to Generate Through Flow",
        body: "Batch-generate images through your Google Flow project — type prompts once, get every image auto-named and downloaded.",
    },
    {
        icon: <Settings2 className="size-5" />,
        title: "1 · Set up prompts",
        body: "Pick a model and aspect ratio, then paste prompts separated by blank lines. Reorder or delete rows any time.",
    },
    {
        icon: <Hash className="size-5" />,
        title: "2 · Name with #",
        body: "Start a prompt's first line with #name (e.g. #hero-shot) and the file saves with exactly that name.",
    },
    {
        icon: <AtSign className="size-5" />,
        title: "3 · Reference with @",
        body: "Mention @character to condition on a named keep in your Flow project — resolved tags appear as chips under the queue row.",
    },
    {
        icon: <Play className="size-5" />,
        title: "4 · Generate",
        body: "Open a Flow project tab, press Start, and watch the queue. Everything runs locally — no servers, no quotas beyond your daily limit.",
    },
];

export function TourOverlay({ onDone }: { onDone: () => void }) {
    const [step, setStep] = useState(0);
    const last = step === STEPS.length - 1;
    const s = STEPS[step];
    useLockBodyScroll();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Product tour">
            <div className="w-full max-w-xs overflow-hidden rounded-3xl border bg-card shadow-2xl">
                <div className="flex items-center justify-between p-4 pb-0">
                    <div className="flex gap-1.5">
                        {STEPS.map((_, i) => (
                            <span key={i} className={`h-1.5 w-5 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
                        ))}
                    </div>
                    <button type="button" onClick={onDone} aria-label="Skip tour" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" />
                    </button>
                </div>
                <div className="flex flex-col items-center px-5 pb-5 pt-3 text-center">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        {s.icon}
                    </div>
                    <h2 className="mt-3 text-sm font-bold">{s.title}</h2>
                    <p className="mt-1.5 min-h-16 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                    <div className="mt-4 flex w-full gap-2">
                        {step > 0 && (
                            <button
                                type="button"
                                onClick={() => setStep(step - 1)}
                                className="h-10 flex-1 rounded-xl border text-xs font-medium hover:bg-accent"
                            >
                                Back
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => (last ? onDone() : setStep(step + 1))}
                            className="inline-flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            {last ? "Start generating" : "Next"}
                            {!last && <ArrowRight className="size-3.5" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
