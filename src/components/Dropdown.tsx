import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
    value: string;
    label: string;
}

interface DropdownProps {
    value: string;
    options: DropdownOption[];
    onChange: (value: string) => void;
    aria: string;
    size?: "sm" | "md";
}

/**
 * Themed dropdown replacing native <select> (whose open menu is
 * OS-rendered and clashes with the dark theme). Button + popover menu
 * fully styled with theme tokens, keyboarddismissable.
 */
export function Dropdown({ value, options, onChange, aria, size = "md" }: DropdownProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = options.find((o) => o.value === value) ?? options[0];

    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [open ]);

    const btnH = size === "sm" ? "h-8 text-xs" : "h-10 text-sm";

    return (
        <div ref={rootRef} className="relative w-full">
            <button
                type="button"
                aria-label={aria}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className={`flex ${btnH} w-full items-center justify-between gap-2 rounded-xl border bg-background px-3 font-normal text-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring ${open ? "border-primary/60 ring-2 ring-ring" : ""}`}
            >
                <span className="truncate">{selected?.label ?? ""}</span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-label={aria}
                    className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl"
                >
                    {options.map((o) => {
                        const active = o.value === value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    onChange(o.value);
                                    setOpen(false);
                                }}
                                className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors ${active ? "bg-primary/15 text-primary" : "text-foreground hover:bg-accent hover:text-accent-foreground"}`}
                            >
                                <span className="truncate">{o.label}</span>
                                {active && <Check className="size-3.5 shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
