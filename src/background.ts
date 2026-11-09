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

// Re-suggest our filename when Chrome derives its own (blob:/data: URLs get a
// generated UUID name and the `filename` param is ignored for them). Relative
// subfolders (GenerateThroughFlow/GTF_<date>/…) are honored here.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
        suggest();
        return;
    }
    // Async storage lookup is fine — suggest() may be called asynchronously.
    void findWanted(item).then((wanted) => {
        if (wanted) {
            rememberId(item.id, wanted);
            forgetUrl(item.url);
            if (item.finalUrl) forgetUrl(item.finalUrl);
            suggest({ filename: wanted, conflictAction: "uniquify" });
        } else {
            suggest();
        }
    });
});

// Drop per-download state once Chrome finishes — otherwise memById grows
// for the whole browser session (Whisk does the same via onChanged).
chrome.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    if (state === "complete" || state === "interrupted") {
        const id = delta.id;
        memById.delete(id);
        sessWrite("i:" + id, null);
    }
});

// Central download service (background context).
// Direct https URLs + explicit filename is the only combination Chrome
// honors with subfolders — blob:/data: URLs get a generated name instead,
// which is why the filename is re-suggested above.
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
            // Verify what Chrome actually saved (proves the name/folders applied).
            chrome.downloads.search({ id: downloadId }, (results) => {
                sendResponse({ id: downloadId, savedAs: results?.[0]?.filename || null });
            });
        },
    );
    return true;
});
