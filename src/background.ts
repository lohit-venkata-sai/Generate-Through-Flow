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

// filename maps: url -> wanted name (registered before starting the download),
// then download id -> wanted name (for post-download verification).
const pendingNames = new Map<string, string>();
const byId = new Map<number, string>();

// Re-suggest our filename when Chrome derives its own (blob:/data: URLs get a
// generated UUID name and the `filename` param is ignored for them). Relative
// subfolders (GenerateThroughFlow/GTF_<date>/…) are honored here.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
        suggest();
        return;
    }
    const wanted = byId.get(item.id) ?? pendingNames.get(item.url) ?? pendingNames.get(item.finalUrl ?? "");
    if (wanted) {
        byId.set(item.id, wanted);
        pendingNames.delete(item.url);
        if (item.finalUrl) pendingNames.delete(item.finalUrl);
        suggest({ filename: wanted, conflictAction: "uniquify" });
    } else {
        suggest();
    }
});

// Central download service (background context).
// Direct https URLs + explicit filename is the only combination Chrome
// honors with subfolders — blob:/data: URLs get a generated name instead,
// so zips are assembled in the panel and saved via anchor download there.
chrome.runtime.onMessage.addListener((msg: DownloadRequest, _sender, sendResponse: (r: unknown) => void) => {
    if (!msg || msg.type !== "FP_DOWNLOAD") return false;
    pendingNames.set(msg.url, msg.filename);
    setTimeout(() => pendingNames.delete(msg.url), 60_000);
    chrome.downloads.download(
        { url: msg.url, filename: msg.filename, saveAs: false, conflictAction: "uniquify" },
        (downloadId) => {
            if (chrome.runtime.lastError || downloadId == null) {
                sendResponse({ error: chrome.runtime.lastError?.message || "download failed" });
                return;
            }
            byId.set(downloadId, msg.filename);
            setTimeout(() => byId.delete(downloadId), 120_000);
            // Verify what Chrome actually saved (proves the name/folders applied).
            chrome.downloads.search({ id: downloadId }, (results) => {
                sendResponse({ id: downloadId, savedAs: results?.[0]?.filename || null });
            });
        },
    );
    return true;
});
