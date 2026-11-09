import { X } from "lucide-react";
import { DISCORD_INVITE } from "../lib/helpLinks";

/**
 * Discord mark, inlined rather than referenced from public/icons.svg —
 * `<use href="icons.svg#...">` resolves against the extension's own base
 * URL, which is fragile across popup/side-panel/tab surfaces.
 */
function DiscordMark({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 20 19"
            aria-hidden="true"
            focusable="false"
            className={className}
            fill="currentColor"
        >
            <path d="M16.224 3.768a14.5 14.5 0 0 0-3.67-1.153c-.158.286-.343.67-.47.976a13.5 13.5 0 0 0-4.067 0c-.128-.306-.317-.69-.476-.976A14.4 14.4 0 0 0 3.868 3.77C1.546 7.28.916 10.703 1.231 14.077a14.7 14.7 0 0 0 4.5 2.306q.545-.748.965-1.587a9.5 9.5 0 0 1-1.518-.74q.191-.14.372-.293c2.927 1.369 6.107 1.369 8.999 0q.183.152.372.294-.723.437-1.52.74.418.838.963 1.588a14.6 14.6 0 0 0 4.504-2.308c.37-3.911-.63-7.302-2.644-10.309m-9.13 8.234c-.878 0-1.599-.82-1.599-1.82 0-.998.705-1.82 1.6-1.82.894 0 1.614.82 1.599 1.82.001 1-.705 1.82-1.6 1.82m5.91 0c-.878 0-1.599-.82-1.599-1.82 0-.998.705-1.82 1.6-1.82.893 0 1.614.82 1.599 1.82 0 1-.706 1.82-1.6 1.82" />
        </svg>
    );
}

interface HelpFeedbackCardProps {
    onDismiss: () => void;
}

export function HelpFeedbackCard({ onDismiss }: HelpFeedbackCardProps) {
    return (
        <section
            aria-label="Help and feedback"
            className="relative mb-4 rounded-2xl border bg-card p-4 shadow-sm"
        >
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss help and feedback"
                title="Don't show this again"
                className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
                <X className="size-4" />
            </button>

            <div className="flex items-center gap-2.5 pr-8">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <DiscordMark className="size-4" />
                </span>
                <h2 className="text-sm font-semibold tracking-tight">Help &amp; Feedback</h2>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Found a bug or have an idea? Join us on Discord — that's where issues get
                reported and feature requests land.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                <a
                    href={DISCORD_INVITE}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-accent px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:text-primary active:scale-[0.98]"
                >
                    <DiscordMark className="size-3.5 shrink-0" />
                    Join Discord
                </a>
            </div>
        </section>
    );
}
