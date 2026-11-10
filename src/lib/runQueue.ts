// Unlimited Flow automation runner — no quotas, no backend calls.
// Direct page calls only: find tab -> token/project -> recaptcha ->
// batchexecute(generateImage) -> preview bytes -> download. Stops only on
// user Stop (or stopOnError). Emits timestamped logs for the Logs view.

import { flowAbort, flowAgentPost, flowBatchExecute, flowGetProjectId, flowGetRecaptcha, flowGetToken, flowImageArtifacts, flowListWorkflows, flowRevokeUrl, flowScrapeLibrary, flowThumb, flowB64ToBlobUrl, flowResizeArt } from "./flowPage";
import { bgDownload, anchorDownload } from "./downloads";
import { buildCharIndex, extractTags, handleVariants, splitPromptParts, type CharIndex, type ResolvedRef } from "./flowRefs";
import { FLOW_ASPECT_CODES, FLOW_MODEL_CODES, FLOW_RECAPTCHA_KEY, FLOW_TAB_URLS } from "./flowModels";
import { FLOW_RPC, extractFlowImageUrls, mineAgentToken, resolveRpcid } from "./flowRpc";
import { imageFolderName, plannedName, planNames, savedIntoFolder } from "./naming";
import type { AutomationPrefs, GeneratedImage, ImageQuality, LogEntry, LogLevel, QueueItem, QueueStatus } from "../types";

export { buildBaseName } from "./naming";
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

/** Google-side throttling signals: these mean "slow down", not "broken". */
export function isThrottleError(msg: string): boolean {
    const t = (msg || "").toLowerCase();
    return t.includes("unusual_activity") || t.includes("unusual activity")
        || t.includes("high_traffic") || t.includes("high traffic")
        || t.includes("rate limited") || t.includes("rate_limit")
        || t.includes("429") || t.includes("resource_exhausted")
        || t.includes("try again later") || t.includes("try again shortly");
}

/**
 * Google refused the prompt on content-safety grounds
 * (google.rpc.ErrorInfo / PUBLIC_ERROR_UNSAFE_GENERATION).
 *
 * Unlike a throttle, this verdict is reached on the prompt text we sent,
 * so replaying the identical prompt cannot pass — it must not consume
 * retries, and it says nothing about session health.
 */
export function isUnsafeError(msg?: string): boolean {
    return (msg || "").toLowerCase().includes("unsafe_generation");
}

/** Cooldown before retrying a throttled request (escalates per attempt).
 * First entry is deliberately "a few minutes": a 45s retry after a long
 * burst just re-trips the block and makes it sticky. Note: in-run retries
 * are now capped by the circuit breaker below — after 3 hits the run parks
 * remaining items instead of burning more retries into a hard block. */
export const THROTTLE_COOLDOWNS_MS = [120_000, 180_000, 300_000];

/** Always-on floor between ANY two Flow requests, even when buffer = Off.
 * A fixed 0s gap looks bot-regular and trips abuse detection fast.
 * Mirrors Whisk Automator's human-like delays (default 3–8s random). */
const MIN_REQUEST_GAP_MS = 4_000;
/** Extra random spread so request timing isn't metronomic. */
const GAP_JITTER_MS = 3_000;
/** Gap forced once safe mode trips (sequential + slow). */
const SAFE_MODE_GAP_MS = 8_000;
/** Throttle hits before the run drops to 1× sequential safe mode. */
const SAFE_MODE_AFTER_HITS = 2;
/** Throttle hits before the run parks remaining items (circuit breaker). */
const CIRCUIT_BREAKER_HITS = 3;
/** Consecutive failures (any kind) before the batch stops — same as
 * Whisk Automator's 8-in-a-row rule. Prevents burning a dead session. */
const CONSEC_FAIL_STOP = 8;
/** Rest every N successes on long batches so a 125-prompt run isn't one burst. */
const CHUNK_SIZE = 25;
const CHUNK_REST_MS = 60_000;

/** Reload the Flow tab and wait until it answers again (best effort).
 * Ported from Whisk Automator's recovery level 1: a reload clears the
 * transient "rejected" state often enough that the retry succeeds. Only
 * safe with 1× sequential (no sibling in-flight requests). */
async function refreshFlowTab(tabId: number, isStopped: () => boolean, log?: (level: LogLevel, msg: string) => void): Promise<boolean> {
    try {
        await chrome.tabs.reload(tabId);
    } catch {
        return false;
    }
    // Wait for the tab to finish loading (up to ~20s), then for the Flow
    // session token to reappear (up to ~10s).
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
        if (isStopped()) return false;
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.status === "complete") {
                const token = await exec(tabId, flowGetToken);
                if (token) return true;
            }
        } catch { /* tab mid-reload — keep polling */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    log?.("error", "Flow tab reloaded but session didn't come back — retrying anyway.");
    return false;
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
    quality: ImageQuality;
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

    /** Abort page requests in flight (Stop button helper). */
    async abortTab(tabId: number) {
        try {
            await exec(tabId, flowAbort);
        } catch { /* ignore */ }
    }

    /**
     * Quality step applied to freshly pulled images, before rename/download.
     * - standard: native bytes untouched.
     * - 1080p: in-page downscale-fit inside 1920×1080 (never upscales —
     *   smaller natives are saved as-is).
     * - 2k: Flow server-side upscale per image (Whisk-style: upscale RPC with
     *   a fresh captcha, base64 reply → page blob). Unmapped RPC, quota hits
     *   and per-image failures all fall back to standard, never fail the item.
     */
    private async applyQuality(
        tag: string,
        images: GeneratedImage[],
        pageBlobs: string[],
        rawB64: (string | undefined)[],
        ids: string[],
        ctx: {
            tabId: number; projectId: string;
            log: (level: LogLevel, msg: string) => void;
            opts: RunOptions; shared: { upscaleUnmappedWarned: boolean; upscaleDowngraded: boolean };
        },
    ): Promise<void> {
        const { tabId, projectId, log, opts, shared } = ctx;
        const quality = opts.quality ?? "standard";
        if (quality === "standard" || this.stopped) return;
        if (quality === "1080p") {
            let fitted = 0;
            for (let n = 0; n < images.length; n++) {
                if (this.stopped) break;
                const src = rawB64[n];
                if (!src) continue;
                const r = await exec(tabId, flowResizeArt, [src]) as
                    | { blobUrl?: string; b64?: string; width?: number; height?: number; error?: string; resized?: boolean }
                    | undefined;
                if (!r || r.error || !r.b64) {
                    log("error", `${tag}: 1080p fit failed for image ${n + 1} — saving native resolution.`);
                    continue;
                }
                if (r.resized) {
                    // Keep the preview and the saved file in step: swap the
                    // page blob for the fitted bytes. toBlob can fail, so
                    // rebuild one from the resized bytes rather than letting
                    // the download silently keep the native resolution.
                    let fittedUrl = r.blobUrl;
                    if (!fittedUrl) {
                        const made = await exec(tabId, flowB64ToBlobUrl, [r.b64]) as { blobUrl?: string } | undefined;
                        fittedUrl = made?.blobUrl;
                    }
                    if (fittedUrl) {
                        if (pageBlobs[n]?.startsWith("blob:")) {
                            void exec(tabId, flowRevokeUrl, [pageBlobs[n]]).catch(() => undefined);
                        }
                        pageBlobs[n] = fittedUrl;
                    }
                    // The https URL now differs from the bytes we hold — the
                    // save path must not re-download it (see runOne).
                    images[n].altered = true;
                }
                images[n].preview = await b64ToPreviewUrl(r.b64).catch(() => images[n].preview);
                images[n].width = r.width;
                images[n].height = r.height;
                if (r.resized) fitted++;
            }
            if (fitted) log("info", `${tag}: 1080p fit applied to ${fitted} image${fitted === 1 ? "" : "s"} (fit inside 1920×1080).`);
            return;
        }
        if (quality === "2k") {
            if (shared.upscaleDowngraded) return;
            for (let n = 0; n < images.length; n++) {
                if (this.stopped) break;
                if (shared.upscaleDowngraded) break;
                const mediaId = ids[n];
                if (!mediaId) {
                    log("error", `${tag}: no media id for 2K upscale (image ${n + 1}) — saving standard.`);
                    continue;
                }
                const captcha = await exec(tabId, flowGetRecaptcha, [FLOW_RECAPTCHA_KEY]);
                if (!captcha) {
                    log("error", `${tag}: reCAPTCHA not ready for 2K upscale — saving standard for image ${n + 1}.`);
                    continue;
                }
                if (this.stopped) break;
                const up = await callRpc(tabId, "upscaleImage", { mediaId, resolution: 1, recaptcha: captcha }, projectId);
                if (!up.ok || !up.data?.b64) {
                    const msg = up.error || "upscale returned no bytes";
                    if (msg.includes("not mapped yet")) {
                        if (!shared.upscaleUnmappedWarned) {
                            shared.upscaleUnmappedWarned = true;
                            log("error", `${tag}: 2K upscale call isn't mapped yet — downloading standard. Capture the upscale rpcid from DevTools batchexecute traffic and set LOCAL_RPC_OVERRIDES.upscaleImage.`);
                        }
                        break;
                    }
                    if (isThrottleError(msg) || /quota|limit|resource/i.test(msg)) {
                        shared.upscaleDowngraded = true;
                        log("error", `${tag}: 2K limit hit (${msg.slice(0, 120)}) — rest of this run downloads standard.`);
                        break;
                    }
                    log("error", `${tag}: 2K upscale failed for image ${n + 1} — saving standard. (${msg.slice(0, 160)})`);
                    continue;
                }
                const made = await exec(tabId, flowB64ToBlobUrl, [up.data.b64]) as
                    | { blobUrl?: string; error?: string }
                    | undefined;
                if (!made?.blobUrl) {
                    log("error", `${tag}: 2K bytes unusable for image ${n + 1} — saving standard.`);
                    continue;
                }
                if (pageBlobs[n]?.startsWith("blob:")) {
                    void exec(tabId, flowRevokeUrl, [pageBlobs[n]]).catch(() => undefined);
                }
                pageBlobs[n] = made.blobUrl;
                images[n].altered = true;
                images[n].preview = await b64ToPreviewUrl(up.data.b64).catch(() => images[n].preview);
                log("info", `${tag}: 2K upscale ready (image ${n + 1}).`);
            }
        }
    }

    private async runOne(
        item: QueueItem,
        ctx: {
            tabId: number; projectId: string; modelCode: string; aspectCode: number;
            folder: string; attempts: number; opts: RunOptions; chars: CharIndex;
            namePlan: Map<number, string[]>;
            log: (level: LogLevel, msg: string) => void;
            touch: () => void;
            onItemDone: (images: number) => void;
            shared: { throttleUntil: number; lastStart: number; throttleHits: number; safeMode: boolean; circuitBroken: boolean; doneCount: number; consecFails: number; upscaleUnmappedWarned: boolean; upscaleDowngraded: boolean };
        },
    ): Promise<void> {
        const { tabId, projectId, modelCode, aspectCode, folder, attempts, opts, chars, namePlan, log, touch, onItemDone, shared } = ctx;
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
            // Global throttle gate: if any worker got flagged, every worker
            // waits out the same window instead of hammering and extending
            // the block.
            if (shared.throttleUntil > Date.now()) {
                const remain = shared.throttleUntil - Date.now();
                log("info", `${tag}: waiting out Google cooldown (${Math.round(remain / 1000)}s left)…`);
                await sleepBuffer(remain, () => this.stopped);
                if (this.stopped) break;
            }
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
                // Remember what Flow titled this generation — the filename
                // fallback when the prompt carries no #name. Only overwrite
                // when present, so a retry without the field keeps the last one.
                if (res.data.flowName) item.flowName = res.data.flowName;
                // Pull bytes in-page: the page blob tracks quality-pass swaps
                // (1080p/2K), base64 feeds the sidepanel preview — which is
                // also what the flat save path writes to disk.
                const images: GeneratedImage[] = [];
                const pageBlobs: string[] = [];
                const rawB64: (string | undefined)[] = [];
                for (const url of res.data.urls) {
                    if (this.stopped) break;
                    const art = await exec(tabId, flowImageArtifacts, [url]) as
                        | { blobUrl?: string; b64?: string; width?: number; height?: number; error?: string }
                        | undefined;
                    if (!art || (!art.blobUrl && !art.b64)) {
                        throw new Error(art?.error || "image pull failed");
                    }
                    pageBlobs.push(art.blobUrl || url);
                    rawB64.push(art.b64);
                    images.push({
                        url,
                        preview: art.b64 ? await b64ToPreviewUrl(art.b64).catch(() => undefined) : undefined,
                        width: art.width,
                        height: art.height,
                    });
                }
                if (this.stopped) break;
                // Quality step: standard downloads native bytes as-is.
                await this.applyQuality(tag, images, pageBlobs, rawB64, res.data.ids || [], ctx);
                if (this.stopped) break;
                if (item.filename && res.data.workflowId) {
                    const renamed = await callRpc(tabId, "renameWorkflow", {
                        workflowId: res.data.workflowId, projectId, name: item.filename,
                    }, projectId);
                    if (renamed.ok) log("info", `Named in Flow as "${item.filename}" (${tag})`);
                    else log("error", `Flow rename failed for "${item.filename}" (${tag}): ${renamed.error}`);
                }
                if (opts.prefs.autoSave) {
                    for (let n = 0; n < images.length; n++) {
                        if (this.stopped) break;
                        // Whisk-style pacing (Gt=300ms): don't fire
                        // back-to-back downloads for multi-image prompts.
                        if (n > 0) await sleepBuffer(300, () => this.stopped);
                        if (this.stopped) break;
                        const name = plannedName(namePlan, item, n, opts.prefs);
                        const wanted = `${folder}/${name}.png`;
                        log("info", `Downloading image… (${name}.png)`);
                        // Step 1: direct https URL + filename — Chrome applies
                        // name AND subfolder itself. Skipped for quality-fit
                        // images: the URL still serves the ORIGINAL bytes, so
                        // downloading it would silently undo the fit.
                        let dl: { savedAs?: string; error?: string } = {};
                        if (!images[n].altered) dl = await bgDownload(images[n].url, wanted);
                        if (dl.error) {
                            // Name the URL failure BEFORE the retry — without
                            // this line a fallback save hides its own cause.
                            log("error", `Direct URL save failed (${dl.error}) — saving the held bytes instead…`);
                        }
                        // Step 2: the bytes we actually hold (preview or
                        // quality-fit) as an extension blob, same folder path —
                        // covers altered images AND a failed URL download, so
                        // neither case has to drop to the flat root.
                        if (images[n].altered || dl.error) {
                            try {
                                const src = images[n].preview || images[n].url;
                                const blob = await (await fetch(src)).blob();
                                const panelUrl = URL.createObjectURL(blob);
                                dl = await bgDownload(panelUrl, wanted);
                                // bgDownload resolves only at the download's
                                // terminal state, so revoke safely after it.
                                setTimeout(() => URL.revokeObjectURL(panelUrl), 60_000);
                            } catch {
                                dl = { error: dl.error || "image bytes unavailable" };
                            }
                        }
                        if (dl.error) {
                            // Last resort: an anchor honors the exact name but
                            // can only write to the Downloads root.
                            log("error", `Folder save failed (${dl.error}) — saving flat…`);
                            try {
                                const src = images[n].preview || images[n].url;
                                anchorDownload(await (await fetch(src)).blob(), `${name}.png`);
                            } catch {
                                throw new Error(`download failed: ${dl.error}`);
                            }
                        } else if (dl.savedAs && !savedIntoFolder(dl.savedAs, wanted)) {
                            // Right name, wrong place: something rewrote the
                            // path between our suggestion and the final file.
                            log("error", `Chrome saved ${name}.png to the Downloads ROOT, not ${folder}/ — something is overriding our path (another extension's filename listener, or Chrome's "Ask where to save each file" setting).`);
                        } else if (dl.savedAs) {
                            log("info", `Saved as ${dl.savedAs}`);
                        } else {
                            log("info", `Save started for ${name}.png (Chrome still placing it).`);
                        }
                    }
                    if (this.stopped) break;
                    log("success", `Saved images to ${folder}/`);
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
                if (isUnsafeError(lastError)) {
                    // The safety verdict is about the prompt itself, so the
                    // identical retry can never pass — fail fast and say so
                    // instead of burning every remaining attempt.
                    const saved = attempts - attempt;
                    log("error", `${tag}: Google's safety filter rejected this prompt${saved > 0 ? ` — skipping ${saved} remaining retr${saved === 1 ? "y" : "ies"}` : ""}. Reword the prompt to continue.`);
                    break;
                }
                if (attempt < attempts) {
                    if (isThrottleError(lastError)) {
                        shared.throttleHits++;
                        // Circuit breaker: 3rd hit in one run means Google has
                        // hard-blocked this session. Parking (pending, not
                        // error) beats retrying into a longer ban — Resume
                        // picks these up in ~10 min at 1× + buffer.
                        if (shared.throttleHits >= CIRCUIT_BREAKER_HITS) {
                            shared.circuitBroken = true;
                            item.status = "pending";
                            item.detail = "Paused — Google unusual-activity block. Wait ~10 min, then Resume at 1× + 5–10s buffer.";
                            log("error", `${tag}: Google blocked this session ${shared.throttleHits}× — parking remaining items instead of retrying into a longer ban. Wait ~10 min, then Resume at 1× + buffer.`);
                            touch();
                            return;
                        }
                        // Auto safe mode: 2nd hit drops the whole run to 1×
                        // sequential + 8s gap for the remainder.
                        if (!shared.safeMode && shared.throttleHits >= SAFE_MODE_AFTER_HITS) {
                            shared.safeMode = true;
                            log("error", `${tag}: 2nd block — dropping to safe mode (1× sequential + 8s gap) for the rest of this run.`);
                        }
                        // Google flagged the burst: pause EVERYTHING with
                        // backoff instead of hammering, or the block just
                        // extends itself. Publish the window to shared state
                        // so sibling workers also back off (Math.max keeps
                        // the longest window when several workers trip).
                        const waitMs = THROTTLE_COOLDOWNS_MS[Math.min(attempt - 1, THROTTLE_COOLDOWNS_MS.length - 1)];
                        const jitter = Math.floor(Math.random() * 10_000);
                        shared.throttleUntil = Math.max(shared.throttleUntil, Date.now() + waitMs + jitter);
                        log("error", `${tag}: Google flagged unusual activity — cooling down ${Math.round(waitMs / 1000)}s before retry (${attempt}/${attempts}). Tip: 1× sequential + a buffer avoids this.`);
                        await sleepBuffer(waitMs + jitter, () => this.stopped);
                        if (this.stopped) break;
                        // Whisk-style recovery: reload the tab before retrying
                        // so a transient rejected-state doesn't fail the retry.
                        // Safe only when sequential — with parallel workers the
                        // reload would kill siblings' in-flight requests.
                        if (!this.stopped && (shared.safeMode || (opts.prefs.parallel ?? 1) <= 1) && !shared.circuitBroken) {
                            log("info", `${tag}: reloading Flow tab before retry…`);
                            await refreshFlowTab(tabId, () => this.stopped, log);
                            if (this.stopped) break;
                        }
                    } else {
                        log("error", `Error ${tag}: ${lastError} — retrying (${attempt}/${attempts})…`);
                    }
                } else {
                    log("error", `Error ${tag}: ${lastError}`);
                    if (isThrottleError(lastError)) {
                        shared.throttleHits++;
                        if (shared.throttleHits >= CIRCUIT_BREAKER_HITS) shared.circuitBroken = true;
                        log("error", `${tag}: wait ~10 min, then retry at 1× sequential with a 5–10s buffer.`);
                    }
                }
            }
        }
        if (item.status !== "done") {
            // Circuit-parked items are already pending with guidance — don't
            // overwrite them with a generic error.
            if ((item.status as QueueStatus) !== "pending") {
                item.status = this.stopped ? "pending" : "error";
                item.detail = this.stopped ? undefined : lastError;
                touch();
            }
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
        // One folder per day, base + date first: GenerateThroughFlow091126.
        // The ZIP and the single-image modal derive the same string.
        const folder = imageFolderName(opts.folder);
        const attempts = 1 + Math.max(0, opts.prefs.retries);
        const parallel = Math.min(10, Math.max(1, opts.prefs.parallel ?? 1));
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

        log("info", `Starting ${state.length} prompts on ${opts.model} (${parallel} at a time${bufferMs ? `, ${bufferMs / 1000}s buffer` : ""}${opts.quality && opts.quality !== "standard" ? `, ${opts.quality}` : ""})…`);

        let cursor = 0;
        // Shared across workers: throttleUntil pauses all launches after a
        // block; lastStart enforces the gap globally (not per-worker);
        // throttleHits drives safe-mode + circuit breaker; doneCount drives
        // chunk rests on long batches; stopReason says WHY the breaker fired
        // so the closing log doesn't blame Google for a dead session.
        const shared = { throttleUntil: 0, lastStart: 0, throttleHits: 0, safeMode: false, circuitBroken: false, stopReason: null as null | "block" | "session", doneCount: 0, consecFails: 0, upscaleUnmappedWarned: false, upscaleDowngraded: false };
        // No mid-run tab refresh: the Flow tab stays untouched for the whole
        // batch so in-flight API calls are never interrupted.
        // Names are planned for the whole batch up front: parallel workers
        // and a later ZIP build must agree on who gets "1-01" vs "1-01(1)".
        const namePlan = planNames(state, opts.prefs, opts.imagesPerPrompt);
        const ctx = { tabId, projectId, modelCode, aspectCode, folder, attempts, opts, chars, log, touch, onItemDone: (n: number) => ev.onItemDone?.(n), shared, namePlan };
        const worker = async (slot: number) => {
            // Stagger worker starts so the opening burst doesn't trip Google's
            // abuse detection ("unusual activity").
            if (slot > 0) {
                await sleepBuffer(slot * 1500, () => this.stopped);
                if (this.stopped) return;
            }
            while (!this.stopped) {
                if (this.stopped || shared.circuitBroken) break;
                // Safe mode drains extras: after 2 blocks only slot 0 keeps
                // going (1× sequential) instead of all workers hammering.
                if (shared.safeMode && slot > 0) return;
                // Respect a global cooldown before claiming the next item.
                if (shared.throttleUntil > Date.now()) {
                    await sleepBuffer(shared.throttleUntil - Date.now(), () => this.stopped);
                    if (this.stopped) break;
                }
                const next = state.find((_, k) => k >= cursor && state[k].status !== "done");
                if (!next) break;
                cursor = state.indexOf(next) + 1;
                if (opts.prefs.stopOnError && state.some((i) => i.status === "error")) break;
                // Human pacing: always ≥4s (+0–3s jitter) between ANY two
                // requests, user buffer or 8s safe-mode gap when larger.
                {
                    const floor = shared.safeMode ? SAFE_MODE_GAP_MS : Math.max(bufferMs, MIN_REQUEST_GAP_MS);
                    const wait = shared.lastStart + floor + Math.floor(Math.random() * GAP_JITTER_MS) - Date.now();
                    if (wait > 0) {
                        await sleepBuffer(wait, () => this.stopped);
                        if (this.stopped) break;
                    }
                }
                if (shared.circuitBroken) {
                    // Give the slot back — item stays pending for Resume.
                    cursor--;
                    break;
                }
                shared.lastStart = Date.now();
                await this.runOne(next, ctx);
                if (shared.circuitBroken) break;
                if (next.status === "done") {
                    shared.doneCount++;
                    shared.consecFails = 0;
                    if (shared.doneCount % CHUNK_SIZE === 0 && state.some((i) => i.status === "pending")) {
                        log("info", `Chunk rest: ${shared.doneCount} done — pausing 60s so Google doesn't see one long burst…`);
                        await sleepBuffer(CHUNK_REST_MS, () => this.stopped);
                        if (this.stopped) break;
                    }
                } else if (next.status === "error") {
                    // Whisk-style 8-in-a-row rule: a dead session fails every
                    // prompt — stop the batch instead of burning all retries.
                    // Safety-filter rejections are excluded: they are a verdict
                    // on the prompt, not the session, so counting them would
                    // park the batch behind advice ("check your VPN / refresh")
                    // that cannot fix a prompt Google simply won't render.
                    if (!isUnsafeError(next.detail) && ++shared.consecFails >= CONSEC_FAIL_STOP) {
                        shared.circuitBroken = true;
                        shared.stopReason = "session";
                        log("error", `${CONSEC_FAIL_STOP} prompts failed in a row — stopping batch. Check the Flow tab (try one manual generation; if that fails too, turn off VPN / refresh / new project) and Resume later.`);
                        break;
                    }
                }
                if (!this.stopped && next.status === "error" && opts.prefs.stopOnError) {
                    log("error", "Stopping on first error (Automation setting).");
                    this.stop();
                    break;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, state.length) }, (_, slot) => worker(slot)));
        if (shared.circuitBroken) {
            const parked = state.filter((i) => i.status === "pending").length;
            if (shared.stopReason === "session") {
                // The 8-in-a-row rule already logged why — don't follow it up
                // with a Google-block message it didn't earn.
                log("info", `Run ended — ${parked} item(s) left pending (see the failure above). Resume once the Flow tab generates one image manually.`);
            } else {
                log("error", `Run parked: Google blocked this session. ${parked} item(s) left pending — generate one image manually in the Flow tab; if that fails too it's Flow itself (VPN off, refresh or new project), then Resume in a few minutes at 1× + 5–10s buffer.`);
            }
        } else if (this.stopped) {
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

const AGENT_SERVICE_PATH = "/_/AiSandboxAngularFrontend/data/google.internal.labs.aisandbox.proto.flow.agent.v1.FlowCreationAgentService/StreamChat";

export interface AgentSubmitResult {
    /** Session token mined from the init response (null when mining failed). */
    token: string | null;
    /** Raw StreamChat response text (may be large — slice before displaying). */
    text: string;
    /** flow-content image URLs harvested from the response. */
    urls: string[];
    error?: string;
}

/**
 * EXPERIMENTAL agent-path submission: init via batchexecute (WuwhI) to mine
 * the session token, then POST the message to StreamChat. Returns raw text +
 * any image URLs found. The agent may reply asking for confirmation instead
 * of generating — that shows up in `text` for the caller to handle.
 */
export async function submitAgentMessage(
    tabId: number,
    projectId: string,
    messageText: string,
    userAgent: string,
    log?: (level: LogLevel, msg: string) => void,
): Promise<AgentSubmitResult> {
    const say = (level: LogLevel, msg: string) => log?.(level, msg);
    const initRpc = resolveRpcid("agentInit");
    if (!initRpc) return { token: null, text: "", urls: [], error: '"agentInit" is not mapped yet' };
    say("info", "Agent path: opening session…");
    const initPayload = FLOW_RPC.agentInit.build({ projectId, userAgent });
    const init = await exec(tabId, flowBatchExecute, [initRpc, JSON.stringify(initPayload), `/project/${projectId}`]) as
        | { ok?: boolean; data?: unknown; error?: string }
        | undefined;
    if (!init || init.error) {
        return { token: null, text: "", urls: [], error: init?.error || "agent init failed" };
    }
    const token = mineAgentToken(init.data);
    if (!token) {
        say("error", "Agent path: no session token in init response — paste it from DevTools so the miner can learn it.");
        return { token: null, text: JSON.stringify(init.data).slice(0, 2000), urls: [], error: "no agent token in init response" };
    }
    say("info", "Agent path: session open, sending message…");
    const chatPayload = FLOW_RPC.agentChat.build({ projectId, token, messageText });
    const res = await exec(tabId, flowAgentPost, [AGENT_SERVICE_PATH, JSON.stringify(chatPayload)]) as
        | { status?: number; text?: string; error?: string }
        | undefined;
    if (!res || res.error) {
        return { token, text: res?.text || "", urls: [], error: res?.error || "agent post failed" };
    }
    const text = res.text || "";
    const urls = extractFlowImageUrls(text);
    say(urls.length ? "success" : "info", urls.length
        ? `Agent path: ${urls.length} image URL(s) in response.`
        : "Agent path: sent, no image URLs in response yet — read the transcript.");
    return { token, text, urls };
}

/** Short human-readable label for a raw RPC/queue error (full text stays in the tooltip). */
export function friendlyError(detail?: string): string {
    if (!detail) return "Failed";
    const t = detail.toLowerCase();
    if (t.includes("high_traffic")) return "Google is busy (high traffic) — wait, then retry at 1×";
    if (t.includes("unusual_activity") || t.includes("unusual activity")) return "Blocked by Google (unusual activity) — test 1 manual gen in Flow tab; if that fails, VPN off + refresh/new project, Resume at 1× + buffer";
    if (t.includes("paused — google")) return "Parked (Google block) — wait ~10 min, then Resume at 1× + buffer";
    if (t.includes("per_model_daily_quota") || t.includes("daily_quota")) return "Daily limit — switch model";
    if (t.includes("rate limited") || t.includes("429")) return "Rate limited — auto-cooling down, or retry at 2×";
    if (t.includes("permission") || t.includes("403") || t.includes("auth") || t.includes("sign in")) return "Session expired — reload the Flow tab";
    if (t.includes("recaptcha")) return "reCAPTCHA blocked — reload the Flow tab";
    if (t.includes("unsafe_generation")) return "Google's safety filter rejected this prompt — reword it; retrying as-is can't pass";
    if (t.includes("no image in reply")) return "Flow returned no image — retry";
    if (t.includes("aborted") || t.includes("stopped")) return "Stopped";
    const oneLine = detail.replace(/\s+/g, " ").trim();
    return oneLine.length > 120 ? oneLine.slice(0, 120) + "…" : oneLine;
}
