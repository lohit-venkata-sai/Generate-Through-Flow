// Page-world helpers, executed inside the Flow tab via
// chrome.scripting.executeScript({ world: "MAIN", func }).
//
// CONSTRAINT: every exported function must be fully self-contained —
// executeScript stringifies the function and runs it in the page, which has
// none of the bundle scope. No imports, no closures, all inputs via params.

/** Flow session indicator (XSRF token from the page). Null = not signed in. */
export async function flowGetToken(): Promise<string | null> {
    try {
        const w = (window as unknown as { WIZ_global_data?: Record<string, string> }).WIZ_global_data || {};
        if (w.SNlM0e) return w.SNlM0e;
    } catch { /* ignore */ }
    return null;
}

/** Project id parsed from the Flow tab URL. */
export function flowGetProjectId(): string | null {
    const m = location.href.match(/project\/([a-f0-9-]+)/);
    return m ? m[1] : null;
}

/**
 * Mint a reCAPTCHA Enterprise token for IMAGE_GENERATION.
 * Prefers the genuine execute captured before Flow wraps the public one
 * (see recapCapture.ts) so the token is not stamped extension_hijack_detected.
 */
export function flowGetRecaptcha(key: string): Promise<string | null> {
    const w = window as unknown as {
        __fpRealExecute?: (key: string, opts: { action: string }) => Promise<string>;
        grecaptcha?: { enterprise?: { execute: (key: string, opts: { action: string }) => Promise<string> } };
    };
    const real = w.__fpRealExecute;
    const pub = w.grecaptcha?.enterprise?.execute?.bind(w.grecaptcha.enterprise);
    const run = (typeof real === "function" ? real : pub) as
        | ((key: string, opts: { action: string }) => Promise<string>)
        | undefined;
    if (typeof run !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
        setTimeout(() => {
            let out: unknown;
            try {
                out = run(key, { action: "IMAGE_GENERATION" });
            } catch {
                resolve(null);
                return;
            }
            Promise.resolve(out as Promise<string>).then(resolve, () => resolve(null));
        }, 0);
    });
}

export interface BatchExecuteResult {
    ok?: boolean;
    data?: unknown;
    error?: string;
    raw?: string;
}

/**
 * Generic transport for flow.google.com. Every server call goes to the single
 * batchexecute endpoint, identified by `rpcid`, authorised by page cookies +
 * the XSRF token. Returns { ok, data } or { error }.
 */
export async function flowBatchExecute(rpcid: string, argsJson: string, sourcePath: string): Promise<BatchExecuteResult> {
    try {
        const w = (window as unknown as { WIZ_global_data?: Record<string, string> }).WIZ_global_data || {};
        const at = w.SNlM0e;
        if (!at) return { error: "no at token (not signed in)" };
        const bl = w.cfb2h || "";
        const fsid = w.FdrFJe || "";
        const hl = w.NsqkG || document.documentElement.lang || "en";
        const sp = sourcePath || location.pathname || "/";
        const freq = JSON.stringify([[[rpcid, argsJson, null, "generic"]]]);
        const qs =
            "rpcids=" + encodeURIComponent(rpcid) +
            "&source-path=" + encodeURIComponent(sp) +
            "&bl=" + encodeURIComponent(bl) +
            "&f.sid=" + encodeURIComponent(fsid) +
            "&hl=" + encodeURIComponent(hl) +
            "&_reqid=" + (Math.floor(Math.random() * 900000) + 100000) +
            "&rt=c";
        const body = "f.req=" + encodeURIComponent(freq) + "&at=" + encodeURIComponent(at) + "&";
        const um = location.pathname.match(/^\/u\/(\d+)\//);
        const base = location.origin + (um ? "/u/" + um[1] : "");
        const ac = new AbortController();
        const holder = window as unknown as { __fpAborters?: Set<AbortController> };
        (holder.__fpAborters || (holder.__fpAborters = new Set())).add(ac);
        let r: Response;
        try {
            r = await window.fetch.call(window, base + "/_/AiSandboxAngularFrontend/data/batchexecute?" + qs, {
                method: "POST",
                credentials: "include",
                signal: ac.signal,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1",
                },
                body,
            });
        } catch (e) {
            const err = e as Error;
            return { error: err.name === "AbortError" ? "aborted" : err.message };
        } finally {
            try {
                holder.__fpAborters.delete(ac);
            } catch { /* ignore */ }
        }
        if (!r.ok) return { error: "HTTP " + r.status };
        const txt = await r.text();
        let data: unknown = null;
        let rpcErr: string | null = null;
        for (const line of txt.replace(/^\)\]\}'/, "").split("\n")) {
            const s = line.trim();
            if (!s || s[0] !== "[") continue;
            let arr: unknown;
            try {
                arr = JSON.parse(s);
            } catch {
                continue;
            }
            const rows = (Array.isArray(arr) && Array.isArray(arr[0]) ? arr : [arr]) as unknown[][];
            for (const row of rows) {
                if (row[0] === "wrb.fr" && row[1] === rpcid) {
                    if (row[2] != null) {
                        try {
                            data = JSON.parse(row[2] as string);
                        } catch {
                            data = row[2];
                        }
                    } else if (row[5]) {
                        rpcErr = "rpc " + JSON.stringify(row[5]).slice(0, 2000);
                    }
                } else if (row[0] === "er") {
                    rpcErr = (row[2] as string) || "rpc error";
                }
            }
        }
        if (data == null && rpcErr) {
            const raw = txt.replace(/^\)\]\}'/, "").replace(/\s+/g, " ").slice(0, 2000);
            return { error: "rpc: " + JSON.stringify(rpcErr).slice(0, 2000) + " | raw: " + raw, raw };
        }
        return { ok: true, data };
    } catch (e) {
        return { error: (e as Error).message };
    }
}

/** Abort every in-flight batchexecute call (Stop button). */
export function flowAbort(): void {
    try {
        const holder = window as unknown as { __fpAborters?: Set<AbortController> };
        const s = holder.__fpAborters;
        if (s) {
            for (const ac of s) {
                try {
                    ac.abort();
                } catch { /* ignore */ }
            }
            s.clear();
        }
    } catch { /* ignore */ }
}

/**
 * Pull an image URL into bytes as base64 (in-page, so the CDN's
 * Cross-Origin-Resource-Policy does not block the read). Returns PNG b64.
 */
export function flowImageToB64(url: string): Promise<{ b64?: string; width?: number; height?: number; error?: string }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext("2d")?.drawImage(img, 0, 0);
                resolve({
                    b64: c.toDataURL("image/png").split(",")[1],
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                });
            } catch (e) {
                resolve({ error: (e as Error).message });
            }
        };
        img.onerror = () => resolve({ error: "image load failed" });
        img.src = url;
    });
}

/** Downscaled JPEG dataURL thumbnail (for batch history, keeps storage small). */
export function flowThumb(url: string, maxW = 96): Promise<{ dataUrl?: string; error?: string }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const scale = Math.min(1, maxW / img.naturalWidth);
                const c = document.createElement("canvas");
                c.width = Math.max(1, Math.round(img.naturalWidth * scale));
                c.height = Math.max(1, Math.round(img.naturalHeight * scale));
                c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
                resolve({ dataUrl: c.toDataURL("image/jpeg", 0.7) });
            } catch (e) {
                resolve({ error: (e as Error).message });
            }
        };
        img.onerror = () => resolve({ error: "thumb load failed" });
        img.src = url;
    });
}

export interface FlowWorkflowRef {
    handle: string;
    mediaId: string;
    createTime: string;
}

/**
 * List the project's named workflows (character keeps) + archived media ids.
 * Names live on workflows (metadata.displayName), not on raw media, so every
 * array in projectContents is scanned for workflow-shaped objects.
 */
export async function flowListWorkflows(pid: string): Promise<{
    items: FlowWorkflowRef[];
    archived: string[];
    debug: string;
    error?: string;
}> {
    try {
        const input = encodeURIComponent(JSON.stringify({ json: { projectId: pid } }));
        let r: Response | null = null;
        for (const base of ["/fx/api/trpc", "/api/trpc"]) {
            try {
                const rr = await fetch(base + "/flow.projectInitialData?input=" + input, {
                    credentials: "include",
                    headers: {
                        "X-Same-Domain": "1",
                        Accept: "application/json",
                    },
                });
                // Skip SPA-shell HTML fallbacks — only take real JSON.
                const ct = rr.headers.get("content-type") || "";
                if (rr.ok && ct.includes("application/json")) {
                    r = rr;
                    break;
                }
            } catch { /* try next base */ }
        }
        if (!r || !r.ok) return { items: [], archived: [], debug: "no-json-trpc-response" };
        const j = await r.json();
        const json = j?.result?.data?.json;
        const root = json?.projectContents;
        const contentKeys: string[] = [];
        if (root && typeof root === "object") {
            for (const k of Object.keys(root)) {
                const v = (root as Record<string, unknown>)[k];
                contentKeys.push(k + ":" + (Array.isArray(v) ? v.length : typeof v));
            }
        }
        // Sample metadata keys from the first workflow-shaped object found.
        let sampleKeys = "";
        const findSample = (node: unknown, depth: number): void => {
            if (sampleKeys || depth > 3 || !node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                for (const el of node.slice(0, 8)) findSample(el, depth + 1);
                return;
            }
            const rec = node as Record<string, unknown>;
            if (rec.metadata && typeof rec.metadata === "object") {
                sampleKeys = Object.keys(rec.metadata as object).slice(0, 10).join(",");
                return;
            }
            for (const k of Object.keys(rec).slice(0, 20)) findSample(rec[k], depth + 1);
        };
        findSample(root, 0);
        const debug = "json:[" + Object.keys(json || {}).slice(0, 12).join(",") + "] contents:[" +
            contentKeys.slice(0, 14).join(",") + "] metasample:[" + sampleKeys + "]";
        const out: FlowWorkflowRef[] = [];
        const archived: string[] = [];
        const scan = (arr: unknown) => {
            if (!Array.isArray(arr)) return;
            for (const w of arr) {
                const md = (w as { metadata?: { displayName?: string; primaryMediaId?: string; archived?: boolean; createTime?: string; updateTime?: string } }).metadata;
                if (!md?.displayName || !md.primaryMediaId) continue;
                if (md.archived) {
                    archived.push(md.primaryMediaId);
                    continue;
                }
                out.push({ handle: md.displayName, mediaId: md.primaryMediaId, createTime: md.createTime || md.updateTime || "" });
            }
        };
        if (root) for (const k of Object.keys(root)) scan((root as Record<string, unknown>)[k]);
        return { items: out, archived, debug };
    } catch (e) {
        const msg = e instanceof Error ? e.name + ": " + e.message : String(e);
        return { items: [], archived: [], debug: "exception:" + msg.slice(0, 160) };
    }
}

export interface ImageArtifacts {
    blobUrl?: string;
    b64?: string;
    width?: number;
    height?: number;
    error?: string;
}

/**
 * Load an image in-page and return BOTH a page-context blob: URL (for
 * background download with folders) and PNG base64 (for sidepanel preview).
 * One call, no extra roundtrips.
 */
export function flowImageArtifacts(url: string): Promise<ImageArtifacts> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext("2d")?.drawImage(img, 0, 0);
                const b64 = c.toDataURL("image/png").split(",")[1];
                c.toBlob((b) => {
                    if (!b) {
                        resolve({ b64, width: img.naturalWidth, height: img.naturalHeight });
                        return;
                    }
                    resolve({
                        blobUrl: URL.createObjectURL(b),
                        b64,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                    });
                }, "image/png");
            } catch (e) {
                resolve({ error: (e as Error).message });
            }
        };
        img.onerror = () => resolve({ error: "image load failed" });
        img.src = url;
    });
}

/** Free a page-context blob: URL created by flowImageArtifacts. */
export function flowRevokeUrl(url: string): void {
    try {
        URL.revokeObjectURL(url);
    } catch { /* ignore */ }
}

export interface LibraryTile {
    title: string;
    mediaId: string;
    thumb: string;
}

/**
 * Scrape the Flow library grid: workflow title + media id per tile.
 * Fallback character source when the trpc endpoint is unavailable —
 * reading what the page itself rendered needs no API at all.
 */
export function flowScrapeLibrary(): { tiles: LibraryTile[] } {
    const out: LibraryTile[] = [];
    try {
        const imgs = document.querySelectorAll("flow-image-tile img.image[data-media-id]");
        for (const img of Array.from(imgs).slice(0, 100)) {
            const el = img as HTMLImageElement;
            const tile = el.closest("flow-image-tile");
            const label = tile?.querySelector(".footer-title")?.textContent?.trim() || "";
            const mid = el.getAttribute("data-media-id") || "";
            if (!mid) continue;
            if (out.some((t) => t.mediaId === mid)) continue;
            out.push({ title: label, mediaId: mid, thumb: el.currentSrc || el.src || "" });
        }
    } catch { /* ignore */ }
    return { tiles: out };
}
