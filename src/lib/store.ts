// chrome.storage.local persistence for presets, history, prefs, resume state.
import type { ActivePlan, AutomationPrefs, BatchRecord, DailyUsage, FormValues, GoogleSession, PassState, PlanDef, PlanId, SavedPreset } from "../types";

const PRESETS_KEY = "flowpilot-presets";
const HISTORY_KEY = "flowpilot-history";
const PREFS_KEY = "flowpilot-prefs";
const RESUME_KEY = "flowpilot-resume";
const SESSION_KEY = "flowpilot-session";
const PLAN_KEY = "flowpilot-plan";
const USAGE_KEY = "flowpilot-usage";

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

export const loadSession = () => get<GoogleSession>(SESSION_KEY);
export const saveSession = (s: GoogleSession | null) => set(SESSION_KEY, s);

export const loadPlan = () => get<ActivePlan>(PLAN_KEY);
export const savePlan = (p: ActivePlan) => set(PLAN_KEY, p);

export const loadUsage = () => get<DailyUsage>(USAGE_KEY);
export const saveUsage = (u: DailyUsage) => set(USAGE_KEY, u);

export const PLANS: PlanDef[] = [
    { id: "free", price: 0, dailyLimit: 50, term: "Free forever", blurb: "50 images per day" },
    { id: "p3", price: 3, dailyLimit: 100, term: "Lifetime", blurb: "100 images per day, forever" },
    { id: "p4", price: 4, dailyLimit: 300, term: "Lifetime", blurb: "300 images per day, forever" },
    { id: "p5", price: 5, dailyLimit: 500, term: "Lifetime", blurb: "500 images per day, forever" },
    { id: "p7", price: 7, dailyLimit: null, term: "6 months", blurb: "Unlimited images per day for 6 months" },
    { id: "p10", price: 10, dailyLimit: null, term: "1 year", blurb: "Unlimited images per day for 1 year" },
];

export function planDef(id: PlanId): PlanDef {
    return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function planName(id: "free" | "p3" | "p4" | "p5"): string {
    return id === "free" ? "Free Plan" : id === "p3" ? "Starter Plan" : id === "p4" ? "Plus Plan" : "Pro Plan";
}

/** Effective plan: expired time-boxed plans fall back to free. */
export function effectivePlan(plan: ActivePlan | null): ActivePlan {
    if (!plan) return { base: "free", pass: null };
    const pass = plan.pass && plan.pass.expiresAt > Date.now() ? plan.pass : plan.pass;
    return { base: plan.base ?? "free", pass: pass ?? null };
}

/** Pass lifecycle: active (counts down), expired (ended, base resumed), none. */
export function passStatus(plan: ActivePlan): "active" | "expired" | "none" {
    if (!plan.pass) return "none";
    return plan.pass.expiresAt > Date.now() ? "active" : "expired";
}

/** Effective daily image limit: null = unlimited (active pass). */
export function effectiveLimit(plan: ActivePlan): number | null {
    if (passStatus(plan) === "active") return null;
    return planDef(plan.base).dailyLimit;
}

/** Migrate the old single-plan shape to base + pass. */
export function migratePlan(raw: unknown): ActivePlan | null {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as { base?: unknown; pass?: unknown; id?: unknown; startedAt?: unknown; expiresAt?: unknown };
    if (typeof p.base === "string") {
        const base = (["free", "p3", "p4", "p5"] as const).includes(p.base as "free") ? (p.base as ActivePlan["base"]) : "free";
        const pass = p.pass && typeof p.pass === "object" ? (p.pass as PassState) : null;
        return { base, pass };
    }
    if (p.id === "p7" || p.id === "p10") {
        const startedAt = typeof p.startedAt === "number" ? p.startedAt : Date.now();
        return {
            base: "free",
            pass: {
                id: p.id,
                startedAt,
                expiresAt: typeof p.expiresAt === "number" ? p.expiresAt : planExpiry(p.id, startedAt) ?? startedAt,
            },
        };
    }
    if (typeof p.id === "string") {
        const base = (["free", "p3", "p4", "p5"] as const).includes(p.id as "free") ? (p.id as ActivePlan["base"]) : "free";
        return { base, pass: null };
    }
    return null;
}

export function todayKey(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function planExpiry(id: PlanId, from = Date.now()): number | null {
    if (id === "p7") return from + 182 * 86_400_000;
    if (id === "p10") return from + 365 * 86_400_000;
    return null;
}

export const PASS_RENEW_DAYS = 15;
const SIX_MO_MS = 182 * 86_400_000;
const ONE_YR_MS = 365 * 86_400_000;

/** Renewal price inside the final 15 days: always the $3 difference. */
export const PASS_RENEW_PRICE = 3;

export function passDaysLeft(pass: PassState): number {
    return Math.max(0, Math.ceil((pass.expiresAt - Date.now()) / 86_400_000));
}

/** Unlimited-pass purchase state: fresh buy, locked, or renewal window. */
export type PassOffer = "fresh" | "locked" | "renew";

export function passOffer(plan: ActivePlan): PassOffer {
    if (passStatus(plan) !== "active" || !plan.pass) return "fresh";
    return passDaysLeft(plan.pass) <= PASS_RENEW_DAYS ? "renew" : "locked";
}

/** Prorated tier upgrade cost (new − current). Zero/negative = not an upgrade. */
export function tierDiff(from: ActivePlan["base"], to: ActivePlan["base"]): number {
    const prices: Record<ActivePlan["base"], number> = { free: 0, p3: 3, p4: 4, p5: 5 };
    return prices[to] - prices[from];
}

/** The single upgrade offered from a base tier (null = top tier / free shows all). */
export function nextTier(base: ActivePlan["base"]): ActivePlan["base"] | null {
    if (base === "free") return null;
    if (base === "p3") return "p4";
    if (base === "p4") return "p5";
    return null;
}

export { SIX_MO_MS, ONE_YR_MS };

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
