export type PromptSeparator = "empty-line" | "new-line" | "numbered" | "dashes" | "";

export type ModelId = "nano-banana-pro" | "nano-banana-2" | "nano-banana-2-lite";

export type AspectRatio = "16:9" | "9:16" | "1:1" | "";

export type ImageQuality = "standard" | "1080p" | "2k";

export interface FormValues {
    model: string;
    aspect_ratio: string;
    quality: ImageQuality;
    file_name_pattern: string;
    images_per_prompt: 1 | 2 | 3 | 4;
    separator: PromptSeparator;
    user_prompts: string;
    total_prompts: number;
}

export interface AutomationPrefs {
    autoSave: boolean;
    customFilename: boolean;
    filenamePattern: string;
    resumeLast: boolean;
    notifyDone: boolean;
    stopOnError: boolean;
    retries: number;
    parallel: 1 | 2 | 3;
    bufferSec: number;
}

export type QueueStatus = "pending" | "running" | "done" | "error";

export interface GeneratedImage {
    url: string;
    preview?: string;
    width?: number;
    height?: number;
}

export interface QueueItem {
    index: number;
    prompt: string;
    filename: string;
    status: QueueStatus;
    detail?: string;
    images: GeneratedImage[];
    durationMs?: number;
    refs: { tag: string; mediaId: string }[];
}

export type LogLevel = "info" | "success" | "error";

export interface LogEntry {
    ts: number;
    level: LogLevel;
    msg: string;
}

export interface BatchRecord {
    id: string;
    name: string;
    ts: number;
    total: number;
    done: number;
    failed: number;
    thumb?: string;
    settings: Pick<FormValues, "model" | "aspect_ratio" | "quality" | "images_per_prompt">;
    prompts: string[];
}

export interface SavedPreset {
    id: string;
    name: string;
    ts: number;
    values: FormValues;
    prefs: AutomationPrefs;
}

export type AppView = "main" | "prompt" | "auto" | "settings";
export type Mode = "prompt" | "auto";

export interface GoogleSession {
    sub: string;
    email: string;
    name: string;
    picture: string;
    accessToken: string;
    exp: number;
}

export type PlanId = "free" | "p3" | "p4" | "p5" | "p7" | "p10";

export interface PlanDef {
    id: PlanId;
    price: number;
    /** Images per day; null = unlimited. */
    dailyLimit: number | null;
    term: string;
    blurb: string;
}

/** Time-boxed Unlimited Pass stacked on top of a lifetime base plan. */
export interface PassState {
    id: "p7" | "p10";
    startedAt: number;
    expiresAt: number;
}

export interface ActivePlan {
    /** Lifetime base plan (daily limit when no pass is active). */
    base: "free" | "p3" | "p4" | "p5";
    pass: PassState | null;
}

export interface DailyUsage {
    date: string;
    used: number;
}
