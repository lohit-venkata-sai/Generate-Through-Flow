import { History, Play, Trash2, Upload, X } from "lucide-react";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";
import type { BatchRecord } from "../types";

interface HistoryViewProps {
    history: BatchRecord[];
    onReplayTour: () => void;
    onClose: () => void;
    onClearHistory: () => void;
    onDeleteBatch: (id: string) => void;
    onLoadBatch: (batch: BatchRecord) => void;
}

export function HistoryView({
    history,
    onReplayTour, onClose,
    onClearHistory, onDeleteBatch, onLoadBatch,
}: HistoryViewProps) {
    useLockBodyScroll();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="History">
            <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl border bg-card shadow-2xl">
                <div className="flex items-start justify-between p-4 pb-0">
                    <div className="flex items-center gap-2">
                        <History className="size-6 shrink-0 text-indigo-300" />
                        <div>
                            <h2 className="text-lg font-extrabold tracking-tight">History</h2>
                            <p className="text-[11px] text-muted-foreground">Past batches, stored only in this browser.</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close history" className="rounded-xl border p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" />
                    </button>
                </div>

                <div className="px-4 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-bold">
                            Batches{history.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({history.length})</span>}
                        </h3>
                        {history.length > 0 && (
                            <button type="button" onClick={onClearHistory} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                <Trash2 className="size-3.5" />
                                Clear all
                            </button>
                        )}
                    </div>
                    {history.length === 0 && (
                        <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                            No batches yet.
                        </p>
                    )}
                    <ul className="max-h-96 space-y-2 overflow-y-auto">
                        {history.map((b) => (
                            <li key={b.id} className="flex items-center gap-2.5 rounded-2xl border bg-background p-2.5">
                                {b.thumb ? (
                                    <img src={b.thumb} alt="" className="size-11 shrink-0 rounded-xl border object-cover" />
                                ) : (
                                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-muted text-xs font-bold text-muted-foreground">
                                        {b.name.slice(0, 1).toUpperCase()}
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">{b.name}</p>
                                    <p className="text-[11px] tabular-nums text-muted-foreground">
                                        {b.done}/{b.total}{b.failed > 0 && <span className="text-destructive"> · {b.failed} failed</span>} · {new Date(b.ts).toLocaleDateString()} · {new Date(b.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                    </p>
                                </div>
                                <button type="button" onClick={() => onLoadBatch(b)} aria-label={`Reload ${b.name}`} title="Reload prompts" className="rounded-xl bg-primary/10 p-2 text-primary hover:bg-primary/20">
                                    <Upload className="size-4" />
                                </button>
                                <button type="button" onClick={() => onDeleteBatch(b.id)} aria-label={`Delete ${b.name}`} className="rounded-xl bg-muted p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                    <Trash2 className="size-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex gap-2.5 p-4">
                    <button
                        type="button"
                        onClick={onReplayTour}
                        className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold hover:bg-accent"
                    >
                        <Play className="size-4" />
                        Replay tour
                    </button>
                </div>
            </div>
        </div>
    );
}
