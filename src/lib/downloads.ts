// Panel-side download helpers.

/** Download an https URL with folders via the background service worker. */
export async function bgDownload(url: string, filename: string): Promise<{ savedAs?: string; error?: string }> {
    try {
        const res = (await chrome.runtime.sendMessage({ type: "FP_DOWNLOAD", url, filename })) as {
            id?: number; savedAs?: string | null; error?: string;
        };
        if (!res || res.error) return { error: res?.error || "download failed" };
        return { savedAs: res.savedAs || undefined };
    } catch (e) {
        return { error: (e as Error).message };
    }
}

/** Save a Blob with an exact flat filename (anchor honors blob names; folders aren't possible). */
export function anchorDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
