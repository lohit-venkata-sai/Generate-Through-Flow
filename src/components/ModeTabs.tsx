import { Workflow, Zap } from "lucide-react";
import type { Mode } from "../types";

interface ModeTabsProps {
    mode: Mode;
    onChange: (mode: Mode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
    const card = (m: Mode, title: string, sub: string, tip: string, icon: React.ReactNode) => (
        <button
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={mode === m}
            title={tip}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border p-2.5 text-left transition-all active:scale-[0.99] ${
                mode === m
                    ? "border-primary bg-primary text-primary-foreground shadow-md"
                    : "border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
        >
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${mode === m ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{title}</span>
                <span className={`block truncate text-[10px] leading-tight ${mode === m ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{sub}</span>
            </span>
        </button>
    );

    return (
        <div className="flex min-w-0 gap-2">
            {card("prompt", "Prompt Mode", "For Flow Agent", "Builds a copy-paste instruction pack: enable Agent mode in Google Flow and paste it in — Flow generates everything for you.", <Workflow className="size-3.5" />)}
            {card("auto", "Automated", "Auto-generate", "Generates images directly inside your open Flow project tab, one prompt after another — no copy-paste needed.", <Zap className="size-3.5" />)}
        </div>
    );
}
