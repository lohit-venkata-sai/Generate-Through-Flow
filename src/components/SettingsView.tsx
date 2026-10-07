import { useState } from "react";
import { Bell, BookmarkPlus, Download, FolderPen, History, Play, Trash2, Upload } from "lucide-react";
import { checkFlowConnection } from "../lib/runQueue";
import { savePresets, uid } from "../lib/store";
import type { AutomationPrefs, FormValues, SavedPreset } from "../types";

interface SettingsViewProps {
    formValues: FormValues;
    setFormValues: React.Dispatch<React.SetStateAction<FormValues>>;
    prefs: AutomationPrefs;
    setPrefs: React.Dispatch<React.SetStateAction<AutomationPrefs>>;
    presets: SavedPreset[];
    setPresets: React.Dispatch<React.SetStateAction<SavedPreset[]>>;
    onApplyPreset: (values: FormValues, prefs: AutomationPrefs) => void;
}

type Tab = "general" | "presets" | "automation" | "advanced";

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onClick}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`}
        >
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
    );
}

export function SettingsView({ formValues, setFormValues, prefs, setPrefs, presets, setPresets, onApplyPreset }: SettingsViewProps) {
    const [tab, setTab] = useState<Tab>("general");
    const [presetName, setPresetName] = useState("");
    const [diag, setDiag] = useState<string | null>(null);
    const [diagBusy, setDiagBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const set = (patch: Partial<FormValues>) => setFormValues((p) => ({ ...p, ...patch }));
    const setP = (patch: Partial<AutomationPrefs>) => setPrefs((p) => ({ ...p, ...patch }));

    const savePreset = async () => {
        const entry: SavedPreset = {
            id: uid(),
            name: presetName.trim() || `Preset ${presets.length + 1}`,
            ts: Date.now(),
            values: { ...formValues },
            prefs: { ...prefs },
        };
        const next = [entry, ...presets];
        setPresets(next);
        await savePresets(next);
        setPresetName("");
    };

    const deletePreset = async (id: string) => {
        const next = presets.filter((p) => p.id !== id);
        setPresets(next);
        await savePresets(next);
    };

    const runDiagnostics = async () => {
        setDiagBusy(true);
        try {
            const res = await checkFlowConnection();
            setDiag("error" in res ? `Not connected — ${res.error}` : `Connected · project ${res.projectId.slice(0, 8)}…`);
        } catch {
            setDiag("Diagnostics failed.");
        } finally {
            setDiagBusy(false);
        }
    };

    const clearCache = async () => {
        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                await chrome.storage.local.remove(["flowRpcIds", "flowRpcSeedV", "flowpilot-resume"]);
            } else {
                localStorage.removeItem("flowpilot-resume");
            }
            flash("Cache cleared — latest connection settings will load fresh.");
        } catch {
            flash("Could not clear cache.");
        }
    };

    const flash = (msg: string) => {
        setNotice(msg);
        window.setTimeout(() => setNotice(null), 2500);
    };

    const exportData = async () => {
        try {
            const data: Record<string, unknown> = { formValues, prefs, presets, exportedAt: new Date().toISOString() };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "flowpilot-backup.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            flash("Backup downloaded.");
        } catch {
            flash("Export failed.");
        }
    };

    const importData = async (file: File | undefined) => {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text()) as {
                formValues?: FormValues; prefs?: AutomationPrefs; presets?: SavedPreset[];
            };
            if (parsed.formValues) setFormValues((p) => ({ ...p, ...parsed.formValues }));
            if (parsed.prefs) setPrefs((p) => ({ ...p, ...parsed.prefs }));
            if (parsed.presets) {
                setPresets(parsed.presets);
                await savePresets(parsed.presets);
            }
            flash("Backup restored.");
        } catch {
            flash("Invalid backup file.");
        }
    };

    const resetAll = async () => {
        if (!window.confirm("Reset all FlowPilot data (settings, presets, history)?")) return;
        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                await chrome.storage.local.remove([
                    "flowpilot-form-values", "flowpilot-prefs", "flowpilot-presets",
                    "flowpilot-history", "flowpilot-resume", "flowRpcIds", "flowRpcSeedV",
                ]);
            } else {
                localStorage.clear();
            }
            flash("All data cleared — reload the panel.");
        } catch {
            flash("Reset failed.");
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-1 rounded-2xl border bg-card p-1">
                {(["general", "presets", "automation", "advanced"] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        aria-pressed={tab === t}
                        className={`h-9 rounded-xl text-xs font-medium capitalize transition-colors ${tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {tab === "general" && (
                <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
                    <h2 className="text-sm font-semibold">Default Settings</h2>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Model
                        <select value={formValues.model} onChange={(e) => set({ model: e.target.value })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="nano-banana-pro">Nano Banana Pro</option>
                            <option value="nano-banana-2">Nano Banana 2</option>
                            <option value="nano-banana-2-lite">Nano Banana 2 Lite</option>
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-medium text-muted-foreground">
                            Aspect Ratio
                            <select value={formValues.aspect_ratio} onChange={(e) => set({ aspect_ratio: e.target.value })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                                <option value="9:16">9:16</option>
                                <option value="16:9">16:9</option>
                                <option value="1:1">1:1</option>
                            </select>
                        </label>
                        <label className="block text-xs font-medium text-muted-foreground">
                            Quality
                            <select value={formValues.quality} onChange={(e) => set({ quality: e.target.value as FormValues["quality"] })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                                <option value="standard">Standard</option>
                            </select>
                        </label>
                    </div>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Images per prompt
                        <select value={String(formValues.images_per_prompt)} onChange={(e) => set({ images_per_prompt: Number(e.target.value) as 1 | 2 | 3 | 4 })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                        </select>
                    </label>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Separator
                        <select value={formValues.separator} onChange={(e) => set({ separator: e.target.value as FormValues["separator"] })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="empty-line">Empty line</option>
                            <option value="new-line">New line</option>
                            <option value="numbered">Numbered</option>
                            <option value="dashes">---</option>
                        </select>
                    </label>
                    <div className="space-y-1 pt-1">
                        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Download className="size-3.5" />
                            </span>
                            <span className="text-xs">Auto save images</span>
                            <span className="ml-auto"><Toggle on={prefs.autoSave} onClick={() => setP({ autoSave: !prefs.autoSave })} label="Auto save images" /></span>
                        </div>
                        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <FolderPen className="size-3.5" />
                            </span>
                            <span className="text-xs">Use custom filename format</span>
                            <span className="ml-auto"><Toggle on={prefs.customFilename} onClick={() => setP({ customFilename: !prefs.customFilename })} label="Use custom filename format" /></span>
                        </div>
                        {prefs.customFilename && (
                            <input
                                value={prefs.filenamePattern}
                                onChange={(e) => setP({ filenamePattern: e.target.value })}
                                placeholder="flow_{index}_{date}"
                                aria-label="Filename pattern"
                                className="h-10 w-full rounded-xl border bg-background px-3 font-mono text-xs outline-none"
                            />
                        )}
                        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <History className="size-3.5" />
                            </span>
                            <span className="text-xs">Resume from last position</span>
                            <span className="ml-auto"><Toggle on={prefs.resumeLast} onClick={() => setP({ resumeLast: !prefs.resumeLast })} label="Resume from last position" /></span>
                        </div>
                        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bell className="size-3.5" />
                            </span>
                            <span className="text-xs">Notifications when complete</span>
                            <span className="ml-auto"><Toggle on={prefs.notifyDone} onClick={() => setP({ notifyDone: !prefs.notifyDone })} label="Notifications when complete" /></span>
                        </div>
                    </div>
                </section>
            )}

            {tab === "presets" && (
                <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
                    <h2 className="text-sm font-semibold">Presets</h2>
                    <div className="flex gap-2">
                        <input
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder="Preset name…"
                            aria-label="Preset name"
                            className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-xs outline-none"
                        />
                        <button type="button" onClick={savePreset} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                            <BookmarkPlus className="size-3.5" /> Save
                        </button>
                    </div>
                    {presets.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No presets yet.</p>}
                    <ul className="space-y-1.5">
                        {presets.map((p) => (
                            <li key={p.id} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">{p.name}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">{p.values.model} · {p.values.aspect_ratio || "default"} · ×{p.values.images_per_prompt}</p>
                                </div>
                                <button type="button" onClick={() => onApplyPreset(p.values, p.prefs)} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15">
                                    <Play className="size-3" /> Apply
                                </button>
                                <button type="button" onClick={() => deletePreset(p.id)} aria-label={`Delete ${p.name}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                    <Trash2 className="size-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {tab === "automation" && (
                <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
                    <h2 className="text-sm font-semibold">Automation</h2>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Parallel jobs
                        <select value={String(prefs.parallel ?? 1)} onChange={(e) => setP({ parallel: Number(e.target.value) as 1 | 2 | 3 })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="1">1 at a time (safest)</option>
                            <option value="2">2 at a time</option>
                            <option value="3">3 at a time (fastest)</option>
                        </select>
                    </label>
                    <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Google may throttle parallel generation — throttled items retry alone.
                    </p>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Retries per prompt
                        <select value={String(prefs.retries)} onChange={(e) => setP({ retries: Number(e.target.value) })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="0">0 (no retry)</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                        </select>
                    </label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs">Stop whole batch on first error</span>
                        <span className="ml-auto"><Toggle on={prefs.stopOnError} onClick={() => setP({ stopOnError: !prefs.stopOnError })} label="Stop on first error" /></span>
                    </div>
                    <label className="block text-xs font-medium text-muted-foreground">
                        Buffer between requests
                        <select value={String(prefs.bufferSec ?? 0)} onChange={(e) => setP({ bufferSec: Number(e.target.value) })} className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground outline-none">
                            <option value="0">Off</option>
                            <option value="5">5 seconds</option>
                            <option value="10">10 seconds</option>
                            <option value="15">15 seconds</option>
                        </select>
                    </label>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        No quota or rate caps are applied — every prompt runs until done, failed, or stopped.
                    </p>
                </section>
            )}

            {tab === "advanced" && (
                <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
                    <h2 className="text-sm font-semibold">Connection</h2>
                    <button
                        type="button"
                        onClick={runDiagnostics}
                        disabled={diagBusy}
                        className="h-10 w-full rounded-xl border text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                        {diagBusy ? "Checking…" : "Check Flow connection"}
                    </button>
                    {diag && <p className="rounded-xl bg-muted/60 px-3 py-2 text-[11px]">{diag}</p>}

                    <h2 className="pt-1 text-sm font-semibold">Cache</h2>
                    <button type="button" onClick={clearCache} className="h-10 w-full rounded-xl border text-xs font-medium hover:bg-accent">
                        Clear connection cache
                    </button>

                    <h2 className="pt-1 text-sm font-semibold">Backup</h2>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={exportData} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent">
                            <Download className="size-3.5" /> Export
                        </button>
                        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent">
                            <Upload className="size-3.5" /> Import
                            <input type="file" accept="application/json" hidden onChange={(e) => { void importData(e.target.files?.[0]); e.target.value = ""; }} />
                        </label>
                    </div>

                    <h2 className="pt-1 text-sm font-semibold">Danger zone</h2>
                    <button type="button" onClick={resetAll} className="h-10 w-full rounded-xl border border-destructive/40 text-xs font-medium text-destructive hover:bg-destructive/10">
                        Reset all data
                    </button>
                    {notice && <p className="rounded-xl bg-primary/10 px-3 py-2 text-[11px] text-primary">{notice}</p>}
                </section>
            )}
        </div>
    );
}
