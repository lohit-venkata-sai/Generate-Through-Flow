// Unlimited Flow automation runner — no quotas, no backend calls.
// Direct page calls only: find tab -> token/project -> recaptcha ->
// batchexecute(generateImage) -> preview bytes -> download. Stops only on
// user Stop (or stopOnError). Emits timestamped logs for the Logs view.

import { flowAbort, flowBatchExecute, flowGetProjectId, flowGetRecaptcha, flowGetToken, flowImageArtifacts, flowListWorkflows, flowRevokeUrl, flowScrapeLibrary, flowThumb } from "./flowPage";
import { bgDownload, anchorDownload } from "./downloads";
import { buildCharIndex, extractTags, handleVariants, splitPromptParts, type CharIndex, type ResolvedRef } from "./flowRefs";
import { FLOW_ASPECT_CODES, FLOW_MODEL_CODES, FLOW_RECAPTCHA_KEY, FLOW_TAB_URLS } from "./flowModels";
import { FLOW_RPC, resolveRpcid } from "./flowRpc";
import type { AutomationPrefs, GeneratedImage, LogEntry, LogLevel, QueueItem, QueueStatus } from "../types";

export type { QueueItem, QueueStatus };

async function exec<T>(tabId: number, func: (...args: never[]) => T, args: unknown[] = []): Promise<T | undefined> {
    try {
        const res = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: func as (...args: unknown[]) => T,
            args,
        });
        return res?.[0]?.result as T | undefined;
    } catch {
        return undefined;
    }
}

export async function findFlowTab(): Promise<chrome.tabs.Tab | null> {
    try {
        const tabs = await chrome.tabs.query({ url: FLOW_TAB_URLS });
        return tabs.find((t) => /\/project\//.test(t.url || "")) || tabs[0] || null;
    } catch {
        return null;
    }
}

/** Split a "#name" first line off the visual prompt (same rule as the agent prompt). */
export function splitFilename(raw: string): { filename: string; prompt: string } {
    const lines = raw.split("\n");
    const first = (lines[0] || "").trim();
    if (/^#+/.test(first)) {
        return {
            filename: first.replace(/^#+/, "").trim(),
            prompt: lines.slice(1).join("\n").trim(),
        };
    }
    return { filename: "", prompt: raw.trim() };
}

export async function checkFlowConnection(): Promise<{ tabId: number; projectId: string } | { error: string }> {
    const tab = await findFlowTab();
    if (!tab?.id) return { error: "Open a Google Flow project tab to begin" };
    const projectId = await exec(tab.id, flowGetProjectId);
    if (!projectId) return { error: "Open a Flow project (no project found)" };
    const token = await exec(tab.id, flowGetToken);
    if (!token) return { error: "Flow is not signed in — sign in on the Flow tab" };
    return { tabId: tab.id, projectId };
}

/** Index the project's named characters (workflows) for @tag resolution. */
export async function indexProjectCharacters(tabId: number, projectId: string): Promise<{ index: CharIndex; debug: string }> {
    const res = await exec(tabId, flowListWorkflows, [projectId]) as
        | { items?: { handle: string; mediaId: string; createTime: string }[]; archived?: string[]; debug?: string }
        | undefined;
    const base = buildCharIndex(res?.items || [], res?.archived || []);
    // DOM fallback: scrape the rendered Library grid (titles + tile media ids).
    let tiles = 0;
    try {
        const scraped = await exec(tabId, flowScrapeLibrary, []) as
            | { tiles?: { title: string; mediaId: string }[] }
            | undefined;
        for (const t of scraped?.tiles || []) {
            if (!t.title || !t.mediaId) continue;
            tiles++;
            for (const variant of handleVariants(t.title)) {
                const list = base.get(variant) || [];
                if (!list.some((e) => e.mediaId === t.mediaId)) {
                    list.push({ handle: t.title, mediaId: t.mediaId, createTime: "" });
                }
                base.set(variant, list);
            }
        }
    } catch { /* scraper best-effort */ }
    return {
        index: base,
        debug: (res?.debug || "no-debug") + ` tiles:${tiles}`,
    };
}

/** Probe the project via the working batchexecute channel and summarize the shape. */
export async function probeProjectShape(tabId: number, projectId: string): Promise<string> {
    const rpcid = resolveRpcid("loadProject");
    if (!rpcid) return "probe: loadProject unmapped";
    const res = await exec(tabId, flowBatchExecute, [rpcid, JSON.stringify(FLOW_RPC.loadProject.build({})), `/project/${projectId}`]) as
        | { ok?: boolean; data?: unknown; error?: string }
        | undefined;
    if (!res || res.error) return "probe-error: " + (res?.error || "no response").slice(0, 200);
    return summarizeShape(res.data);
}

function summarizeShape(data: unknown): string {
    const hits: string[] = [];
    const walk = (node: unknown, path: string, depth: number): void => {
        if (hits.length >= 6 || depth > 4 || node == null) return;
        if (Array.isArray(node)) {
            if (path) hits.push(path + "#[" + node.length + "]");
            for (const el of node.slice(0, 4)) walk(el, path, depth + 1);
            return;
        }
        if (typeof node === "object") {
            const rec = node as Record<string, unknown>;
            const keys = Object.keys(rec);
            if (path) hits.push(path + "{" + keys.slice(0, 8).join(",") + "}");
            if (typeof rec.displayName === "string" && rec.displayName) {
                hits.push(path + ".displayName=" + rec.displayName.slice(0, 24));
            }
            for (const k of keys.slice(0, 10)) walk(rec[k], path ? path + "." + k : k, depth + 1);
        }
    };
    walk(data, "root", 0);
    return ("probe-shape: " + hits.join(" | ")).slice(0, 600);
}
async function sleepBuffer(ms: number, isStopped: () => boolean): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (isStopped()) return;
        await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
    }
}

async function callRpc(tabId: number, op: string, args: Record<string, unknown>, projectId: string) {
    const def = FLOW_RPC[op];
    if (!def) return { error: `unknown op "${op}"` };
    const rpcid = resolveRpcid(op);
    if (!rpcid) return { error: `"${op}" is not mapped yet` };
    const payload = def.build(args);
    const res = await exec(tabId, flowBatchExecute, [rpcid, JSON.stringify(payload), `/project/${projectId}`]) as
        | { ok?: boolean; data?: unknown; error?: string }
        | undefined;
    if (!res || res.error) return { error: res?.error || "batchexecute failed" };
    return { ok: true as const, data: def.parse(res.data) };
}

function sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "flow-image";
}

export function buildBaseName(index: number, filename: string, prompt: string, prefs: AutomationPrefs): string {
    // A #name marker is authoritative — it always wins over the custom pattern.
    if (filename) return sanitize(filename);
    if (prefs.customFilename) {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const idx = String(index + 1).padStart(3, "0");
        return sanitize(
            prefs.filenamePattern
                .replaceAll("{index}", idx)
                .replaceAll("{date}", date)
                .replaceAll("{name}", `prompt-${idx}`),
        );
    }
    const firstLine = prompt.split("\n").pop()?.trim() || "";
    const slug = firstLine.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return sanitize(slug ? `${String(index + 1).padStart(3, "0")}-${slug}` : `prompt-${String(index + 1).padStart(3, "0")}`);
}

async function b64ToPreviewUrl(b64: string): Promise<string> {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

export interface RunOptions {
    model: string;
    aspectRatio: string;
    imagesPerPrompt: number;
    folder: string;
    prefs: AutomationPrefs;
}

export interface RunEvents {
    onUpdate: (items: QueueItem[]) => void;
    onLog: (level: LogLevel, msg: string) => void;
    onSnapshot?: (items: QueueItem[]) => void;
    onItemDone?: (images: number) => void;
}

export class FlowRunner {
    private stopped = false;
    private tabId: number | null = null;

    stop() {
        this.stopped = true;
        // Abort in-flight page requests immediately instead of waiting for
        // them to finish — this is what makes Stop feel instant.
        if (this.tabId != null) void this.abortTab(this.tabId).catch(() => undefined);
    }

    async abortTab(tabId: number) {
        try {
            await exec(tabId, flowAbort);
        } catch { /* ignore */ }
    }

    private async runOne(
        item: QueueItem,
        ctx: {
            tabId: number; projectId: string; modelCode: string; aspectCode: number;
            folder: string; attempts: number; opts: RunOptions; chars: CharIndex;
            log: (level: LogLevel, msg: string) => void;
            touch: () => void;
            onItemDone: (images: number) => void;
        },
    ): Promise<void> {
        const { tabId, projectId, modelCode, aspectCode, folder, attempts, opts, chars, log, touch, onItemDone } = ctx;
        item.status = "running";
        item.detail = undefined;
        touch();
        const started = Date.now();
        const tag = `#${String(item.index + 1).padStart(2, "0")}`;
        // Resolve @character tags against the project index. Unresolved tags
        // stay as plain text (no chip, no reference payload — like the ref impl).
        const { parts, refs } = splitPromptParts(item.prompt, chars);
        const resolved: ResolvedRef[] = refs;
        item.refs = resolved;
        if (resolved.length) log("info", `${tag} references ${resolved.map((r) => `@${r.tag}`).join(", ")}`);
        else {
            const tags = extractTags(item.prompt);
            if (tags.length) log("error", `${tag} has @tags (${tags.map((t) => `@${t}`).join(", ")}) but none matched project characters — check spelling.`);
        }
        let lastError = "";
        for (let attempt = 1; attempt <= attempts; attempt++) {
            if (this.stopped) break;
            try {
                log("info", `Sending request to Flow… (${tag}${attempts > 1 ? ` attempt ${attempt}/${attempts}` : ""})`);
                const recaptcha = await exec(tabId, flowGetRecaptcha, [FLOW_RECAPTCHA_KEY]);
                if (!recaptcha) throw new Error("reCAPTCHA not ready — reload the Flow tab");
                if (this.stopped) break;
                log("info", `Waiting for completion… (${tag})`);
                    const res = await callRpc(tabId, "generateImage", {
                        prompt: item.prompt,
                        parts,
                        refs: resolved,
                        recaptcha,
                        workflowId: projectId,
                        model: modelCode,
                        aspect: aspectCode,
                        count: opts.imagesPerPrompt,
                    }, projectId);
                    if (!res.ok || !res.data?.urls?.length) throw new Error(res.error || "no image in reply");
                    // Pull bytes in-page: page blob URLs for the background
                    // download (folders honored), base64 for sidepanel preview.
                    const images: GeneratedImage[] = [];
                    const pageBlobs: string[] = [];
                    for (const url of res.data.urls) {
                        if (this.stopped) break;
                        const art = await exec(tabId, flowImageArtifacts, [url]) as
                            | { blobUrl?: string; b64?: string; width?: number; height?: number; error?: string }
                            | undefined;
                        if (!art || (!art.blobUrl && !art.b64)) {
                            throw new Error(art?.error || "image pull failed");
                        }
                        pageBlobs.push(art.blobUrl || url);
                        images.push({
                            url,
                            preview: art.b64 ? await b64ToPreviewUrl(art.b64).catch(() => undefined) : undefined,
                            width: art.width,
                            height: art.height,
                        });
                    }
                    if (this.stopped) break;
                if (this.stopped) break;
                if (item.filename && res.data.workflowId) {
                    const renamed = await callRpc(tabId, "renameWorkflow", {
                        workflowId: res.data.workflowId, projectId, name: item.filename,
                    }, projectId);
                    if (renamed.ok) log("info", `Named in Flow as "${item.filename}" (${tag})`);
                    else log("error", `Flow rename failed for "${item.filename}" (${tag}): ${renamed.error}`);
                }
                    if (opts.prefs.autoSave) {
                        const base = buildBaseName(item.index, item.filename, item.prompt, opts.prefs);
                        for (let n = 0; n < images.length; n++) {
                            if (this.stopped) break;
                            const suffix = images.length > 1 ? (n === 0 ? "" : ` (${n})`) : "";
                            const wanted = `${folder}/${base}${suffix}.png`;
                            log("info", `Downloading image… (${base}${suffix}.png)`);
                            // Page-blob first (proven path with the filename
                            // suggester), https URL as fallback.
                            const dl = await bgDownload(pageBlobs[n] || images[n].url, wanted);
                            if (dl.error) {
                                log("error", `Folder save failed (${dl.error}) — saving flat…`);
                                try {
                                    const src = images[n].preview || images[n].url;
                                    anchorDownload(await (await fetch(src)).blob(), `${base}${suffix}.png`);
                                } catch {
                                    throw new Error(`download failed: ${dl.error}`);
                                }
                            } else if (dl.savedAs) {
                                const savedBase = dl.savedAs.split(/[\\/]/).pop();
                                const wantedBase = `${base}${suffix}.png`;
                                if (savedBase !== wantedBase) {
                                    log("error", `Chrome renamed the file to "${savedBase}" (wanted "${wantedBase}") — check for downloader/renamer extensions or Chrome's ask-where-to-save setting.`);
                                } else {
                                    log("info", `Saved as ${dl.savedAs}`);
                                }
                            }
                        }
                        if (this.stopped) break;
                        log("success", `Saved ${base}.png`);
                    }
                    for (const b of pageBlobs) {
                        setTimeout(() => {
                            exec(tabId, flowRevokeUrl, [b]).catch(() => undefined);
                        }, 60_000);
                    }
                item.images = images;
                item.status = "done";
                item.durationMs = Date.now() - started;
                log("success", `Image generated successfully (${tag})`);
                touch();
                onItemDone(images.length);
                return;
            } catch (e) {
                lastError = (e as Error).message;
                if (this.stopped) break;
                log("error", `Error ${tag}: ${lastError}${attempt < attempts ? ` — retrying (${attempt}/${attempts})…` : ""}`);
            }
        }
        if (item.status !== "done") {
            item.status = this.stopped ? "pending" : "error";
            item.detail = this.stopped ? undefined : lastError;
            touch();
        }
    }

    async run(initial: QueueItem[], opts: RunOptions, ev: RunEvents): Promise<QueueItem[]> {
        this.stopped = false;
        this.tabId = null;
        const state: QueueItem[] = initial.map((i) => ({ ...i, images: [...i.images] }));
        const log = (level: LogLevel, msg: string) => ev.onLog(level, msg);
        const touch = () => {
            ev.onUpdate([...state]);
            ev.onSnapshot?.([...state]);
        };

        const conn = await checkFlowConnection();
        if ("error" in conn) {
            const detail = conn.error;
            log("error", detail);
            return state.map((i) => (i.status === "done" ? i : { ...i, status: "error" as QueueStatus, detail }));
        }
        const { tabId, projectId } = conn;
        this.tabId = tabId;
        if (this.stopped) {
            log("info", "Stopped by user.");
            return state;
        }
        const modelCode = FLOW_MODEL_CODES[opts.model] ?? "BELUGA";
        const aspectCode = FLOW_ASPECT_CODES[opts.aspectRatio] ?? 3;
        const baseFolder = sanitize(opts.folder || "GenerateThroughFlow");
        const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const folder = `${baseFolder}/GTF_${dateStamp}`;
        const attempts = 1 + Math.max(0, opts.prefs.retries);
        const parallel = Math.min(3, Math.max(1, opts.prefs.parallel ?? 1));
        const bufferMs = Math.min(120_000, Math.max(0, opts.prefs.bufferSec ?? 0)) * 1000;

        // Index project characters for @tag resolution (best effort — the run
        // proceeds with plain text if indexing fails).
        let chars: CharIndex = new Map();
        try {
            const indexed = await indexProjectCharacters(tabId, projectId);
            chars = indexed.index;
            log("info", `Project shape: ${indexed.debug}`);
            if (chars.size) log("info", `Found ${chars.size} named character${chars.size === 1 ? "" : "s"} in this project.`);
        } catch {
            log("error", "Character index failed — @tags will stay plain text.");
        }
        if (this.stopped) {
            log("info", "Stopped by user.");
            return state;
        }

        log("info", `Starting ${state.length} prompts on ${opts.model} (${parallel} at a time${bufferMs ? `, ${bufferMs / 1000}s buffer` : ""})…`);

        let cursor = 0;
        let launched = 0;
        const ctx = { tabId, projectId, modelCode, aspectCode, folder, attempts, opts, chars, log, touch, onItemDone: (n: number) => ev.onItemDone?.(n) };
        const worker = async () => {
            while (!this.stopped) {
                const next = state.find((_, k) => k >= cursor && state[k].status !== "done");
                if (!next) break;
                cursor = state.indexOf(next) + 1;
                if (opts.prefs.stopOnError && state.some((i) => i.status === "error")) break;
                if (launched++ > 0 && bufferMs > 0) {
                    await sleepBuffer(bufferMs, () => this.stopped);
                    if (this.stopped) break;
                }
                await this.runOne(next, ctx);
                if (!this.stopped && next.status === "error" && opts.prefs.stopOnError) {
                    log("error", "Stopping on first error (Automation setting).");
                    this.stop();
                    break;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, state.length) }, () => worker()));
        if (this.stopped) {
            log("info", "Stopped by user.");
        }
        this.tabId = null;
        return state;
    }

    async makeThumb(tabId: number, url: string): Promise<string | undefined> {
        const res = await exec(tabId, flowThumb, [url, 96]);
        return res?.dataUrl;
    }
}

export function logEntry(level: LogLevel, msg: string): LogEntry {
    return { ts: Date.now(), level, msg };
}

/** Short human-readable label for a raw RPC/queue error (full text stays in the tooltip). */
export function friendlyError(detail?: string): string {
    if (!detail) return "Failed";
    const t = detail.toLowerCase();
    if (t.includes("high_traffic")) return "Google is busy (high traffic) — retry later";
    if (t.includes("unusual_activity") || t.includes("unusual activity")) return "Blocked by Google (unusual activity)";
    if (t.includes("per_model_daily_quota") || t.includes("daily_quota")) return "Daily limit — switch model";
    if (t.includes("rate limited") || t.includes("429")) return "Rate limited — try again shortly";
    if (t.includes("permission") || t.includes("403") || t.includes("auth") || t.includes("sign in")) return "Session expired — reload the Flow tab";
    if (t.includes("recaptcha")) return "reCAPTCHA blocked — reload the Flow tab";
    if (t.includes("no image in reply")) return "Flow returned no image — retry";
    if (t.includes("aborted") || t.includes("stopped")) return "Stopped";
    const oneLine = detail.replace(/\s+/g, " ").trim();
    return oneLine.length > 120 ? oneLine.slice(0, 120) + "…" : oneLine;
}
