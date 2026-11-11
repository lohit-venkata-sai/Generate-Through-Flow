// Open the side panel when the user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.sidePanel.open({ windowId: tab.windowId });
    }
});

interface DownloadRequest {
    type: "FP_DOWNLOAD";
    url: string;
    filename: string;
}

// Filename intents must survive service-worker restarts. MV3 kills the worker
// after ~30s idle, and real batches idle for minutes between downloads — by
// the time Chrome asks for the filename, a fresh worker with empty maps would
// fall back to a generated flat name (no folders). chrome.storage.session
// survives restarts (cleared on browser exit); in-memory maps stay as cache.
const memPending = new Map<string, string>();
const memById = new Map<number, string>();

async function sessRead(key: string): Promise<string | undefined> {
    try {
        const r = await chrome.storage.session.get(key);
        const v = (r as Record<string, unknown>)[key];
        if (typeof v === "string") return v;
    } catch { /* session storage unavailable — memory only */ }
    return undefined;
}

function sessWrite(key: string, value: string | null): void {
    try {
        if (value == null) void chrome.storage.session.remove(key).catch(() => undefined);
        else void chrome.storage.session.set({ [key]: value }).catch(() => undefined);
    } catch { /* ignore */ }
}

function rememberUrl(url: string, name: string): void {
    memPending.set(url, name);
    sessWrite("u:" + url, name);
    setTimeout(() => {
        memPending.delete(url);
        sessWrite("u:" + url, null);
    }, 10 * 60_000);
}

function rememberId(id: number, name: string): void {
    memById.set(id, name);
    sessWrite("i:" + id, name);
    setTimeout(() => {
        memById.delete(id);
        sessWrite("i:" + id, null);
    }, 10 * 60_000);
}

function forgetUrl(url: string): void {
    memPending.delete(url);
    sessWrite("u:" + url, null);
}

async function findWanted(item: { id: number; url: string; finalUrl?: string }): Promise<string | undefined> {
    return memById.get(item.id)
        ?? memPending.get(item.url)
        ?? (item.finalUrl ? memPending.get(item.finalUrl) : undefined)
        ?? await sessRead("i:" + item.id)
        ?? await sessRead("u:" + item.url)
        ?? (item.finalUrl ? await sessRead("u:" + item.finalUrl) : undefined);
}

// Bind a resolved name to the download id and drop the URL entry (the id is
// the stable key from here on; redirects can change finalUrl).
function bindWanted(item: { id: number; url: string; finalUrl?: string }, wanted: string): void {
    rememberId(item.id, wanted);
    forgetUrl(item.url);
    if (item.finalUrl) forgetUrl(item.finalUrl);
}

// Chrome's contract (downloads.onDeterminingFilename): EVERY listener must call
// suggest() EXACTLY ONCE — synchronously, or asynchronously ONLY if it returns
// true. If it neither suggests synchronously nor returns true, Chrome calls
// suggest() itself, immediately, with the tentative name — which is where the
// folder went. The previous implementation suggested inside a promise callback
// and returned undefined: Chrome auto-answered (flat, generated name) and our
// late suggestion arrived second, against the exactly-once rule. Whisk Automator
// (the reference extension) keeps this synchronous: map hit → suggest now, map
// miss → no call, letting download()'s `filename` stand.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
        // Another extension's download: hand straight back, never hijack it.
        suggest();
        return;
    }
    // Synchronous fast path. rememberUrl() runs in the same message handler
    // BEFORE chrome.downloads.download() is called, and rememberId() in its
    // callback — so a live worker always knows the name before Chrome asks.
    const wanted =
        memById.get(item.id) ??
        memPending.get(item.url) ??
        (item.finalUrl ? memPending.get(item.finalUrl) : undefined);
    if (wanted !== undefined) {
        bindWanted(item, wanted);
        suggest({ filename: wanted, conflictAction: "uniquify" });
        return;
    }
    // Slow path: the worker restarted between download() and filename
    // determination, so only chrome.storage.session still holds the name.
    // Returning true tells Chrome to wait for our one and only suggest().
    void findWanted(item)
        .then((stored) => {
            if (stored !== undefined) {
                bindWanted(item, stored);
                suggest({ filename: stored, conflictAction: "uniquify" });
            } else {
                // Nothing stored anywhere: defer to the name download()
                // provided (or Chrome's own), instead of inventing one.
                suggest();
            }
        })
        // findWanted cannot reject (storage reads are guarded), but a download
        // must never hang waiting on a listener that stops answering.
        .catch(() => suggest());
    return true;
});

// Track what Chrome ACTUALLY does with each download. chrome.downloads.download()
// only reports "started" — the file can still be renamed or interrupted later
// (expired URL, overwritten suggestion, "ask where to save"), and the panel
// needs the real outcome to verify the folder path landed.
const finalState = new Map<number, { filename?: string; error?: string }>();
const waiters = new Map<number, (r: { filename?: string; error?: string }) => void>();

function settle(id: number, rec: { filename?: string; error?: string }): void {
    finalState.set(id, rec);
    const resolve = waiters.get(id);
    if (resolve) {
        waiters.delete(id);
        resolve(rec);
    }
}

/** Resolve once Chrome reaches a terminal state (complete/interrupted) or the timeout hits. */
function waitForDownload(id: number, timeoutMs: number): Promise<{ filename?: string; error?: string }> {
    return new Promise((resolve) => {
        const finish = (rec: { filename?: string; error?: string }): void => {
            clearTimeout(timer);
            resolve(rec);
        };
        const timer = setTimeout(() => {
            waiters.delete(id);
            // Best effort: report whatever Chrome knows right now.
            chrome.downloads.search({ id }, (results) => {
                const it = results?.[0];
                if (!it) {
                    resolve({ error: "download not found" });
                    return;
                }
                resolve({
                    filename: it.filename || undefined,
                    error: it.error || (it.state === "interrupted" ? "interrupted" : undefined),
                });
            });
        }, timeoutMs);
        waiters.set(id, finish);
        // Race guard: the download may have finished before the waiter existed.
        chrome.downloads.search({ id }, (results) => {
            const it = results?.[0];
            if (!it) {
                waiters.delete(id);
                clearTimeout(timer);
                resolve({ error: "download not found" });
                return;
            }
            if (it.state === "complete" || it.state === "interrupted") {
                const w = waiters.get(id);
                if (w) {
                    waiters.delete(id);
                    w({ filename: it.filename || undefined, error: it.error || undefined });
                }
            }
        });
    });
}

// Drop per-download state once Chrome finishes — otherwise memById grows
// for the whole browser session (Whisk does the same via onChanged).
chrome.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    const id = delta.id;
    if (state === "complete" || state === "interrupted") {
        const rec = finalState.get(id) ?? {};
        if (delta.filename?.current) rec.filename = delta.filename.current;
        if (delta.error?.current) rec.error = delta.error.current;
        settle(id, rec);
        memById.delete(id);
        sessWrite("i:" + id, null);
        setTimeout(() => finalState.delete(id), 10 * 60_000);
        return;
    }
    if (delta.filename?.current || delta.error?.current) {
        const rec = finalState.get(id) ?? {};
        if (delta.filename?.current) rec.filename = delta.filename.current;
        if (delta.error?.current) rec.error = delta.error.current;
        finalState.set(id, rec);
    }
});

// Central download service (background context).
// Direct https URLs + explicit filename is the only combination Chrome
// honors with subfolders — blob:/data: URLs get a generated name instead,
// which is why the filename is re-suggested above. The response waits for
// the download's terminal state so the panel gets the REAL final path
// (folder proof) or the REAL failure reason, never a false "started".
chrome.runtime.onMessage.addListener((msg: DownloadRequest, _sender, sendResponse: (r: unknown) => void) => {
    if (!msg || msg.type !== "FP_DOWNLOAD") return false;
    rememberUrl(msg.url, msg.filename);
    chrome.downloads.download(
        { url: msg.url, filename: msg.filename, saveAs: false, conflictAction: "uniquify" },
        (downloadId) => {
            if (chrome.runtime.lastError || downloadId == null) {
                sendResponse({ error: chrome.runtime.lastError?.message || "download failed" });
                return;
            }
            rememberId(downloadId, msg.filename);
            void waitForDownload(downloadId, 30_000).then((final) => {
                if (final.error) {
                    sendResponse({ error: final.error });
                    return;
                }
                sendResponse({ id: downloadId, savedAs: final.filename || null });
            });
        },
    );
    return true;
});
