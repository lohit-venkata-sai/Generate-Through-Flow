import { useEffect, useMemo, useRef, useState } from "react";
import {
    Check, CircleAlert, CircleCheck, Copy, Download, Image as ImageIcon, Loader2, OctagonX,
    Play, RotateCcw, Trash2,
} from "lucide-react";
import { parsePrompts } from "../lib/promptParser";
import {
    buildBaseName, checkFlowConnection, FlowRunner, friendlyError, indexProjectCharacters, splitFilename,
} from "../lib/runQueue";
import { extractTags, resolveTag, type CharIndex } from "../lib/flowRefs";
import { buildZip } from "../lib/zipStore";
import { bgDownload } from "../lib/downloads";
import { loadResume, saveResume } from "../lib/store";
import { ResultModal } from "./ResultModal";
import type { AutomationPrefs, FormValues, LogEntry, LogLevel, QueueItem } from "../types";

interface AutomateViewProps {
    formValues: FormValues;
    prefs: AutomationPrefs;
    setPrefs: React.Dispatch<React.SetStateAction<AutomationPrefs>>;
    items: QueueItem[];
    setItems: React.Dispatch<React.SetStateAction<QueueItem[]>>;
    logs: LogEntry[];
    pushLog: (level: LogLevel, msg: string) => void;
    dailyLimit: number | null;
    usedToday: number;
    onConsume: (images: number) => void;
    onNeedUpgrade: () => void;
    onComplete: (items: QueueItem[], elapsedMs: number) => void;
}

// Module-level handle so a view switch mid-run never orphans the Stop control.
let activeRunner: FlowRunner | null = null;
// Run start timestamp shared across mounts so the elapsed timer survives them.
let activeRunStart: number | null = null;

export function AutomateView({ formValues, prefs, setPrefs, items, setItems, logs, pushLog, dailyLimit, usedToday, onConsume, onNeedUpgrade, onComplete }: AutomateViewProps) {
    const prompts = useMemo(
        () => parsePrompts(formValues.user_prompts, formValues.separator),
        [formValues.user_prompts, formValues.separator],
    );
    const [conn, setConn] = useState<string>("Checking Flow tab…");
    const [running, setRunning] = useState(false);
    const [tab, setTab] = useState<"queue" | "logs">("queue");
    const [level, setLevel] = useState<"all" | LogLevel>("all");
    const [showAll, setShowAll] = useState(false);
    const [logsCopied, setLogsCopied] = useState(false);
    const [charIndex, setCharIndex] = useState<CharIndex>(new Map());
    const [modal, setModal] = useState<{ item: number; img: number } | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [resume, setResume] = useState<QueueItem[] | null>(null);
    const runnerRef = useRef<FlowRunner | null>(null);
    const runStartRef = useRef(0);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        void refreshIndex();
        const tagged = prompts
            .map((raw, i) => ({ i, tags: extractTags(splitFilename(raw).prompt) }))
            .filter((p) => p.tags.length);
        for (const p of tagged) {
            pushLog("info", `Prompt #${String(p.i + 1).padStart(2, "0")} mentions ${p.tags.map((t) => `@${t}`).join(", ")}`);
        }
        const settingsKey = JSON.stringify([formValues.model, formValues.aspect_ratio, formValues.images_per_prompt]);
        loadResume().then((s) => {
            if (!s || !prefs.resumeLast) return;
            if (JSON.stringify(s.prompts) !== JSON.stringify(prompts)) return;
            if (s.settingsKey !== settingsKey) return;
            const remaining = s.items.filter((i) => i.status !== "done");
            if (!remaining.length) return;
            setResume(s.items.map((i) => ({
                index: i.index,
                prompt: splitFilename(prompts[i.index] ?? "").prompt,
                filename: splitFilename(prompts[i.index] ?? "").filename,
                status: i.status === "done" ? "done" as const : "pending" as const,
                detail: i.detail,
                images: [],
                refs: [],
            })));
        }).catch(() => undefined);
        // Reattach to an in-flight run after a view switch: the single sync
        // interval below keeps timer + Stop alive from module state.
        if (activeRunner && activeRunStart != null) {
            runnerRef.current = activeRunner;
            runStartRef.current = activeRunStart;
            setElapsed(Date.now() - activeRunStart);
            setRunning(true);
        }
        timerRef.current = window.setInterval(() => {
            if (activeRunner && activeRunStart != null) {
                runnerRef.current = activeRunner;
                setElapsed(Date.now() - activeRunStart);
                setRunning(true);
            } else {
                setRunning(false);
            }
        }, 500);
        return () => {
            if (timerRef.current) window.clearInterval(timerRef.current);
            timerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshIndex = async () => {
        try {
            const r = await checkFlowConnection();
            setConn("error" in r ? r.error : "Flow tab connected");
            if (!("error" in r)) {
                const { index: idx, debug } = await indexProjectCharacters(r.tabId, r.projectId);
                setCharIndex(idx);
                pushLog("info", `Project shape: ${debug}`);
                const names = [...idx.values()].map((l) => l[0]?.handle).filter(Boolean) as string[];
                pushLog(
                    names.length ? "success" : "info",
                    names.length
                        ? `Character index ready: ${names.length} named (${names.slice(0, 8).join(", ")})`
                        : "No named characters in this project — @tags will stay plain text.",
                );
            }
        } catch {
            setConn("Flow check failed");
        }
    };

    const hasRun = items.length > 0;
    const displayItems: QueueItem[] = hasRun ? items : prompts.map((raw, index) => {
        const { filename, prompt } = splitFilename(raw);
        return { index, prompt, filename, status: "pending" as const, images: [], refs: [] };
    });
    /** Resolved @character tags for a prompt (empty = show no chip). */
    const chipsFor = (prompt: string): string[] => {
        const out: string[] = [];
        for (const tag of extractTags(prompt)) {
            if (resolveTag(charIndex, tag)) out.push(tag);
        }
        return out;
    };
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "error").length;
    const pct = displayItems.length ? Math.round((done / displayItems.length) * 100) : 0;
    const current = hasRun
        ? (items.find((i) => i.status === "running") ?? items.find((i) => i.status === "pending"))
        : undefined;
    const currentImg = current?.images[0];
    const allDone = hasRun && displayItems.every((i) => i.status === "done" && i.images.length > 0);

    const startTimer = () => {
        activeRunStart = Date.now();
        runStartRef.current = activeRunStart;
        setElapsed(0);
    };
    const stopTimer = () => {
        activeRunStart = null;
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
    };

    const fmt = (ms: number) => {
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };

    const runItems = async (initial: QueueItem[]) => {
        // Daily-limit gate (null = unlimited plan): cap this run to what is left.
        let queue = initial;
        if (dailyLimit != null) {
            const remaining = dailyLimit - usedToday;
            if (remaining <= 0) {
                pushLog("error", `Daily limit reached (${dailyLimit} images) — upgrade for more.`);
                onNeedUpgrade();
                return;
            }
            const perPrompt = Math.max(1, formValues.images_per_prompt);
            const allowed = Math.max(1, Math.floor(remaining / perPrompt));
            const runnable = initial.filter((i) => i.status !== "done");
            if (runnable.length > allowed) {
                queue = [
                    ...initial.filter((i) => i.status === "done"),
                    ...runnable.slice(0, allowed),
                ];
                pushLog("info", `Daily limit: running ${allowed} of ${runnable.length} remaining prompts (${remaining} images left today).`);
            }
        }
        const runner = new FlowRunner();
        runnerRef.current = runner;
        activeRunner = runner;
        setRunning(true);
        setItems(queue.map((i) => ({ ...i, status: i.status === "done" ? "done" as const : "pending" as const })));
        startTimer();
        try {
            const settingsKey = JSON.stringify([formValues.model, formValues.aspect_ratio, formValues.images_per_prompt]);
            const final = await runner.run(queue, {
                model: formValues.model,
                aspectRatio: formValues.aspect_ratio,
                imagesPerPrompt: formValues.images_per_prompt,
                folder: formValues.file_name_pattern || "GenerateThroughFlow",
                prefs,
            }, {
                onUpdate: (snap) => {
                    // Merge back so prompts trimmed by the daily cap are not lost.
                    setItems((prev) => {
                        const byIndex = new Map(snap.map((s) => [s.index, s]));
                        return prev.map((p) => byIndex.get(p.index) ?? p);
                    });
                },
                onLog: pushLog,
                onItemDone: (n) => onConsume(n),
                onSnapshot: (snap) => {
                    saveResume({
                        prompts,
                        settingsKey,
                        items: snap.map((i) => ({ index: i.index, status: i.status, detail: i.detail })),
                        ts: Date.now(),
                    }).catch(() => undefined);
                },
            });
            setItems((prev) => {
                const byIndex = new Map(final.map((s) => [s.index, s]));
                return prev.map((p) => byIndex.get(p.index) ?? p);
            });
            await saveResume(null).catch(() => undefined);
            setResume(null);
            onComplete(final, Date.now() - runStartRef.current);
        } finally {
            stopTimer();
            setRunning(false);
            runnerRef.current = null;
            if (activeRunner === runner) activeRunner = null;
        }
    };

    const handleStart = () => {
        const initial: QueueItem[] = prompts.map((raw, index) => {
            const { filename, prompt } = splitFilename(raw);
            return { index, prompt, filename, status: "pending" as const, images: [], refs: [] };
        });
        setResume(null);
        void runItems(initial);
    };

    const handleResume = () => {
        if (!resume) return;
        const initial = resume;
        setResume(null);
        void runItems(initial);
    };

    const handleRetry = (index: number) => {
        // Retry ONLY this item: run it in isolation and merge the result back,
        // so every other item keeps its real state (never faked to done).
        const target = items.find((i) => i.index === index);
        if (!target || running) return;
        if (dailyLimit != null && usedToday >= dailyLimit) {
            pushLog("error", `Daily limit reached (${dailyLimit} images) — upgrade for more.`);
            onNeedUpgrade();
            return;
        }
        const solo: QueueItem = { ...target, status: "pending" as const, detail: undefined, images: [] };
        setItems((list) => list.map((i) => (i.index === index ? solo : i)));
        const merge = (snap: QueueItem[]) => {
            const update = snap[0];
            if (!update) return;
            setItems((list) => list.map((i) => (i.index === index ? { ...update } : i)));
        };
        void (async () => {
            const runner = new FlowRunner();
            runnerRef.current = runner;
            activeRunner = runner;
            setRunning(true);
            startTimer();
            try {
                await runner.run([solo], {
                    model: formValues.model,
                    aspectRatio: formValues.aspect_ratio,
                    imagesPerPrompt: formValues.images_per_prompt,
                    folder: formValues.file_name_pattern || "GenerateThroughFlow",
                    prefs,
                }, {
                    onUpdate: merge,
                    onLog: pushLog,
                    onItemDone: (n) => onConsume(n),
                    onSnapshot: merge,
                });
            } finally {
                stopTimer();
                setRunning(false);
                runnerRef.current = null;
                if (activeRunner === runner) activeRunner = null;
            }
        })();
    };

    const handleRemove = (index: number) => {
        setItems((list) => list.filter((i) => i.index !== index));
    };

    const downloadAll = async () => {
        if (!allDone) return;
        pushLog("info", "Packing all images into a ZIP…");
        const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const files: { name: string; data: Uint8Array }[] = [];
        for (const item of items) {
            const base = buildBaseName(item.index, item.filename, item.prompt, prefs);
            for (let n = 0; n < item.images.length; n++) {
                const suffix = item.images.length > 1 ? (n === 0 ? "" : ` (${n})`) : "";
                const img = item.images[n];
                try {
                    const src = img.preview || img.url;
                    const buf = await (await fetch(src)).arrayBuffer();
                    files.push({ name: `${base}${suffix}.png`, data: new Uint8Array(buf) });
                } catch {
                    pushLog("error", `Skipped #${String(item.index + 1).padStart(2, "0")} (bytes unavailable)`);
                }
            }
        }
        if (!files.length) {
            pushLog("error", "Nothing to zip — no image bytes available.");
            return;
        }
        // Routed through the background downloader (flat exact name, no nested
        // folder) so the filename suggester forces the name for blob: URLs.
        const zipName = `GTF_${dateStamp}.zip`;
        const zipUrl = URL.createObjectURL(buildZip(files));
        try {
            const res = await bgDownload(zipUrl, zipName);
            if (res.error) throw new Error(res.error);
            pushLog("success", `Downloaded ${zipName} with ${files.length} images.`);
        } catch {
            pushLog("error", "ZIP download failed.");
        } finally {
            setTimeout(() => URL.revokeObjectURL(zipUrl), 120_000);
        }
    };

    const visible = showAll ? displayItems : displayItems.slice(0, 6);
    const filteredLogs = logs.filter((l) => level === "all" || l.level === level);

    const copyLogs = async () => {
        const text = filteredLogs
            .map((l) => `${new Date(l.ts).toTimeString().slice(0, 8)} [${l.level}] ${l.msg}`)
            .join("\n");
        try {
            await navigator.clipboard.writeText(text);
            setLogsCopied(true);
            window.setTimeout(() => setLogsCopied(false), 2000);
        } catch { /* clipboard unavailable — ignore */ }
    };

    return (
        <div className="flex flex-col gap-4">
            <section className="rounded-2xl border bg-card p-3 shadow-sm">
                <div className="flex items-center gap-2">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${running ? "bg-green-500/15 text-green-500" : done > 0 && failed === 0 && items.length > 0 ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground"}`}>
                    {running ? <Loader2 className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{running ? "Running…" : items.length ? (failed ? `${failed} failed` : done ? "Done" : "Ready") : "Automated Flow"}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{fmt(elapsed)}</span>
                {running || activeRunner ? (
                    <button
                        type="button"
                        onClick={() => (runnerRef.current ?? activeRunner)?.stop()}
                        className="h-9 shrink-0 rounded-xl bg-destructive px-4 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleStart}
                        disabled={prompts.length === 0}
                        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-45 ${prompts.length > 0 ? "start-glow" : ""}`}
                    >
                        <Play className="size-3.5" />
                        {items.length ? "Restart" : "Start"}
                    </button>
                )}
                </div>
                {failed > 0 && !running && hasRun && (
                    <button
                        type="button"
                        onClick={() => void runItems(items)}
                        className="mt-2 inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 text-xs font-semibold whitespace-nowrap text-primary hover:bg-primary/15"
                    >
                        <RotateCcw className="size-3.5 shrink-0" />
                        Retry failed ({failed})
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => void refreshIndex()}
                    title="Re-check Flow tab and character index"
                    className="mt-2 w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
                >
                    {conn} · tap to refresh
                </button>
                {!running && (
                    <>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Parallel jobs</span>
                        <div className="grid flex-1 grid-cols-3 gap-1.5" role="group" aria-label="Parallel jobs">
                            {([1, 2, 3] as const).map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    aria-pressed={(prefs.parallel ?? 1) === n}
                                    onClick={() => setPrefs((p) => ({ ...p, parallel: n }))}
                                    className={`h-8 rounded-lg border text-xs font-medium transition-colors ${(prefs.parallel ?? 1) === n ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
                                >
                                    {n}×
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Buffer between requests</span>
                        <select
                            value={String(prefs.bufferSec ?? 0)}
                            onChange={(e) => setPrefs((p) => ({ ...p, bufferSec: Number(e.target.value) }))}
                            aria-label="Buffer time between requests"
                            className="h-8 flex-1 rounded-lg border bg-background px-2 text-xs text-foreground outline-none"
                        >
                            <option value="0">Off</option>
                            <option value="5">5 seconds</option>
                            <option value="10">10 seconds</option>
                            <option value="15">15 seconds</option>
                        </select>
                    </div>
                    </>
                )}
            </section>

            {resume && !running && (
                <button
                    type="button"
                    onClick={handleResume}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 text-sm font-medium text-primary hover:bg-primary/15"
                >
                    <RotateCcw className="size-4" />
                    Resume from last position ({resume.filter((i) => i.status !== "done").length} left)
                </button>
            )}

            {items.length > 0 && (
                <section className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Progress</span>
                        <span className="tabular-nums">{done} / {items.length} · {pct}%{failed > 0 && <span className="text-destructive"> · {failed} failed</span>}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                </section>
            )}

            {current && (
                <section className="rounded-2xl border bg-card p-4 shadow-sm">
                    <h2 className="mb-2 text-sm font-semibold">Current Generation</h2>
                    <div className="overflow-hidden rounded-xl border bg-muted">
                        {currentImg?.preview || currentImg?.url ? (
                            <button type="button" onClick={() => setModal({ item: current.index, img: 0 })} className="block w-full">
                                <img src={currentImg.preview || currentImg.url} alt={`Prompt ${current.index + 1}`} className="max-h-64 w-full object-cover" />
                            </button>
                        ) : (
                            <div className="flex h-40 items-center justify-center text-muted-foreground">
                                <ImageIcon className="size-8" />
                            </div>
                        )}
                        <div className="flex items-center gap-2 p-2.5">
                            <span className="rounded-lg bg-primary px-2 py-0.5 font-mono text-[11px] font-semibold text-primary-foreground">
                                #{String(current.index + 1).padStart(2, "0")}
                            </span>
                            <p className="min-w-0 flex-1 truncate text-xs">{current.prompt.slice(0, 80)}</p>
                        </div>
                        {current.status === "running" && (
                            <div className="px-2.5 pb-2.5">
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground">Generating image…</p>
                            </div>
                        )}
                    </div>
                </section>
            )}

            <div className="grid grid-cols-2 gap-1 rounded-2xl border bg-card p-1">
                {(["queue", "logs"] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        aria-pressed={tab === t}
                        className={`h-9 rounded-xl text-[13px] font-medium capitalize transition-colors ${tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        {t}{t === "queue" && displayItems.length > 0 && ` (${displayItems.length})`}
                    </button>
                ))}
            </div>

            {tab === "queue" ? (
                <section className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-semibold">Queue{displayItems.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({displayItems.length} prompts)</span>}</h2>
                        {displayItems.length > 6 && (
                            <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-medium text-primary hover:underline">
                                {showAll ? "Show less" : "Show all"}
                            </button>
                        )}
                    </div>
                    {displayItems.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No prompts loaded — add some on the main screen.</p>}
                    <ul className="space-y-1.5">
                        {visible.map((item) => (
                            <li key={item.index} className="flex items-center gap-2 rounded-xl border bg-background p-2">
                                {(item.images[0]?.preview || item.images[0]?.url) ? (
                                    <button type="button" onClick={() => setModal({ item: item.index, img: 0 })} className="size-11 shrink-0 overflow-hidden rounded-lg border">
                                        <img src={item.images[0].preview || item.images[0].url} alt="" className="size-full object-cover" />
                                    </button>
                                ) : (
                                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                                        <ImageIcon className="size-4" />
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">
                                        #{String(item.index + 1).padStart(2, "0")} {(item.filename || item.prompt).slice(0, 42)}
                                    </p>
                                    <p className="text-[11px] capitalize text-muted-foreground">
                                        {item.status === "done" && <span className="text-green-500">Finished{item.durationMs != null && ` · ${(item.durationMs / 1000).toFixed(1)}s`}</span>}
                                        {item.status === "running" && <span className="text-blue-500">Generating…</span>}
                                        {item.status === "pending" && (hasRun ? "Waiting" : "Not started")}
                                        {item.status === "error" && <span className="block truncate text-destructive" title={item.detail}>{friendlyError(item.detail)}</span>}
                                    </p>
                                    {(() => {
                                        const chips = item.refs.length
                                            ? item.refs.map((r) => r.tag)
                                            : chipsFor(item.prompt);
                                        return chips.length > 0 && (
                                            <p className="mt-1 flex flex-wrap gap-1">
                                                {chips.map((c) => (
                                                    <span key={c} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">@{c}</span>
                                                ))}
                                            </p>
                                        );
                                    })()}
                                </div>
                                {(item.status === "error" || item.status === "done") && hasRun && !running && (
                                    <button type="button" onClick={() => handleRetry(item.index)} aria-label="Regenerate" title="Regenerate" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                        <RotateCcw className="size-3.5" />
                                    </button>
                                )}
                                {hasRun && !running && (
                                    <button type="button" onClick={() => handleRemove(item.index)} aria-label="Remove" className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                        <Trash2 className="size-3.5" />
                                    </button>
                                )}
                                {item.status === "pending" && <OctagonX className="size-4 shrink-0 text-muted-foreground" />}
                                {item.status === "running" && <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />}
                                {item.status === "done" && <CircleCheck className="size-4 shrink-0 text-green-500" />}
                                {item.status === "error" && <CircleAlert className="size-4 shrink-0 text-destructive" />}
                            </li>
                        ))}
                    </ul>
                    {hasRun && (
                        <button
                            type="button"
                            onClick={downloadAll}
                            disabled={!allDone || running}
                            title={allDone ? "Download every generated image as one ZIP" : "Available once all images are generated"}
                            className="mt-2.5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Download className="size-3.5" />
                            Download All as ZIP
                        </button>
                    )}
                </section>
            ) : (
                <section className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-semibold">Logs</h2>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={copyLogs}
                                disabled={filteredLogs.length === 0}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-45"
                            >
                                {logsCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                                {logsCopied ? "Copied" : "Copy"}
                            </button>
                        <select
                            value={level}
                            aria-label="Log level"
                            onChange={(e) => setLevel(e.target.value as "all" | LogLevel)}
                            className="h-8 rounded-lg border bg-background px-2 text-xs outline-none"
                        >
                            <option value="all">All Levels</option>
                            <option value="info">Info</option>
                            <option value="success">Success</option>
                            <option value="error">Errors</option>
                        </select>
                        </div>
                    </div>
                    {filteredLogs.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No logs yet.</p>}
                    <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-[11px]">
                        {filteredLogs.map((l, k) => (
                            <li key={`${l.ts}-${k}`} className="flex items-start gap-2 rounded-lg bg-background px-2 py-1.5">
                                <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(l.ts).toTimeString().slice(0, 8)}</span>
                                <span className={`size-1.5 shrink-0 translate-y-1.5 rounded-full ${l.level === "success" ? "bg-green-500" : l.level === "error" ? "bg-red-500" : "bg-blue-500"}`} />
                                <span className={`break-words ${l.level === "success" ? "text-green-500" : l.level === "error" ? "text-red-500" : "text-muted-foreground"}`}>{l.msg}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {modal && (
                <ResultModal
                    items={items}
                    itemIndex={modal.item}
                    imgIndex={modal.img}
                    onNavigate={(item, img) => setModal({ item, img })}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}
