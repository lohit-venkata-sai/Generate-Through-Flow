// chrome.storage.local persistence for presets, history, prefs, resume state.
// Free build: no accounts, no plans, no usage tracking — everything is local.
import type { AutomationPrefs, BatchRecord, FormValues, SavedPreset } from "../types";

const PRESETS_KEY = "flowpilot-presets";
const HISTORY_KEY = "flowpilot-history";
const PREFS_KEY = "flowpilot-prefs";
const RESUME_KEY = "flowpilot-resume";
const TOUR_SEEN_KEY = "flowpilot-tour-seen-v1";

export const defaultPrefs: AutomationPrefs = {
    autoSave: true,
    customFilename: false,
    filenamePattern: "flow_{index}_{date}",
    resumeLast: true,
    notifyDone: false,
    stopOnError: false,
    retries: 1,
    parallel: 1,
    bufferSec: 0,
};

async function get<T>(key: string): Promise<T | null> {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const r = await chrome.storage.local.get(key);
            return (r[key] as T | undefined) ?? null;
        }
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

async function set(key: string, value: unknown): Promise<void> {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.set({ [key]: value });
            return;
        }
        localStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota or unavailable — non-fatal */ }
}

export const loadPrefs = () => get<AutomationPrefs>(PREFS_KEY);
export const savePrefs = (p: AutomationPrefs) => set(PREFS_KEY, p);

export const loadPresets = () => get<SavedPreset[]>(PRESETS_KEY);
export const savePresets = (p: SavedPreset[]) => set(PRESETS_KEY, p);

export const loadHistory = () => get<BatchRecord[]>(HISTORY_KEY);
export const saveHistory = (h: BatchRecord[]) => set(HISTORY_KEY, h.slice(0, 30));

/** Tour seen flag (single local flag — no account). */
export const loadTourSeen = async (): Promise<boolean> => {
    const seen = await get<boolean>(TOUR_SEEN_KEY);
    return seen === true;
};
export const saveTourSeen = (): Promise<void> => set(TOUR_SEEN_KEY, true);

export function todayKey(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local count of images generated today (resets on date change, this browser only). */
const TODAY_COUNT_KEY = "flowpilot-today-count";

export interface TodayCount {
    date: string;
    count: number;
}

/** In-memory mirror so the count stays correct even if storage writes fail. */
let memToday: TodayCount | null = null;

export const loadTodayCount = async (): Promise<number> => {
    const today = todayKey();
    if (memToday && memToday.date === today) return memToday.count;
    const rec = await get<TodayCount>(TODAY_COUNT_KEY);
    const count = rec && rec.date === today ? rec.count : 0;
    memToday = { date: today, count };
    return count;
};

/** Serialized read-modify-write so parallel completions never lose increments. */
let todayChain: Promise<unknown> = Promise.resolve();
export const addTodayCount = (n: number): Promise<number> => {
    const run = todayChain.then(async () => {
        const today = todayKey();
        const rec = await get<TodayCount>(TODAY_COUNT_KEY);
        const stored = rec && rec.date === today ? rec.count : 0;
        const mem = memToday && memToday.date === today ? memToday.count : 0;
        const next: TodayCount = { date: today, count: Math.max(stored, mem) + n };
        memToday = next;
        await set(TODAY_COUNT_KEY, next);
        return next.count;
    });
    todayChain = run.catch(() => undefined);
    return run;
};

export interface ResumeState {
    prompts: string[];
    settingsKey: string;
    items: { index: number; status: string; detail?: string }[];
    ts: number;
}
export const loadResume = () => get<ResumeState>(RESUME_KEY);
export const saveResume = (r: ResumeState | null) =>
    typeof chrome !== "undefined" && chrome.storage?.local
        ? (r ? chrome.storage.local.set({ [RESUME_KEY]: r }) : chrome.storage.local.remove(RESUME_KEY)).catch(() => undefined)
        : Promise.resolve(r ? localStorage.setItem(RESUME_KEY, JSON.stringify(r)) : localStorage.removeItem(RESUME_KEY));

export function uid(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return String(Date.now()) + Math.random().toString(36).slice(2);
}

export function defaultBatchName(prompts: string[]): string {
    const first = (prompts[0] || "Untitled batch").split("\n").pop() || "Untitled batch";
    return first.trim().slice(0, 42) || "Untitled batch";
}

export type { FormValues };
