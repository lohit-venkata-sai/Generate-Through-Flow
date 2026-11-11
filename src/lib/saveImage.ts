// Shared per-image save chain, used by the run queue AND the result modal.
//
// ONE save action must produce AT MOST ONE file. Each step only runs when the
// previous one genuinely failed to write anything — a download that COMPLETED
// but landed outside the requested folder is reported, never retried: retrying
// cannot change where Chrome puts a file, and it used to fire all three steps
// on every click (URL save + blob save + flat anchor = three download popups
// and three copies of the same image).

import { anchorDownload, bgDownload } from "./downloads";
import { savedIntoFolder } from "./naming";

export type SaveEvent =
    | { type: "url-failed"; detail: string }
    | { type: "bytes-failed"; detail: string }
    | { type: "saved"; detail: string }
    | { type: "flat"; detail: string }
    | { type: "started" };

export interface SaveResult {
    /** Which step wrote the file. */
    step: "url" | "bytes" | "anchor";
    /** Absolute path Chrome reported, when it reported one. */
    savedAs?: string;
    /** The file is outside the requested folder (root save, or no path yet). */
    flat: boolean;
    /** The anchor fallback itself threw — nothing was written. */
    anchorFailed?: boolean;
    /** Last failure reason (the queue turns it into its error message). */
    error?: string;
}

export interface SaveImageOptions {
    /** Original (usually https) URL. */
    url: string;
    /** Bytes we hold — preview / quality-fit; also the retry source. */
    preview?: string;
    /** Quality-fit bytes differ from what `url` serves — skip the URL step. */
    altered: boolean;
    /** Relative target path, e.g. GenerateThroughFlow111126/0-00.png. */
    wanted: string;
    /** Flat name for the anchor fallback, e.g. 0-00.png. */
    flatName: string;
    /** Optional sink for the queue's log lines, in order. */
    onEvent?: (e: SaveEvent) => void;
}

/** Write one image, falling back only on genuine failure. One file max. */
export async function saveImage(o: SaveImageOptions): Promise<SaveResult> {
    const emit = (e: SaveEvent): void => o.onEvent?.(e);
    const src = o.preview || o.url;
    let lastError: string | undefined;

    // Step 1: direct https URL + wanted path — Chrome applies name AND folder.
    if (!o.altered) {
        const r = await bgDownload(o.url, o.wanted);
        if (!r.error) return report("url", r.savedAs, o.wanted, emit);
        lastError = r.error;
        emit({ type: "url-failed", detail: r.error });
    }

    // Step 2: the bytes we actually hold, through the same folder path —
    // covers quality-fit images AND a failed URL download.
    let blob: Blob | undefined;
    try {
        blob = await (await fetch(src)).blob();
    } catch { /* the anchor below retries the fetch */ }
    if (blob) {
        const panelUrl = URL.createObjectURL(blob);
        // bgDownload resolves at the download's terminal state, so the panel
        // blob URL stays alive for the whole download and is revoked after.
        const r = await bgDownload(panelUrl, o.wanted);
        setTimeout(() => URL.revokeObjectURL(panelUrl), 60_000);
        if (!r.error) return report("bytes", r.savedAs, o.wanted, emit);
        lastError = r.error;
        emit({ type: "bytes-failed", detail: r.error });
    } else {
        lastError = lastError ?? "image bytes unavailable";
        emit({ type: "bytes-failed", detail: lastError });
    }

    // Step 3: anchor — exact name, but only the Downloads root is reachable.
    try {
        anchorDownload(blob ?? (await (await fetch(src)).blob()), o.flatName);
        return { step: "anchor", flat: true, error: lastError };
    } catch {
        return { step: "anchor", flat: false, error: lastError, anchorFailed: true };
    }
}

/** Turn a completed download into a result + its log event. */
function report(
    step: "url" | "bytes",
    savedAs: string | undefined,
    wanted: string,
    emit: (e: SaveEvent) => void,
): SaveResult {
    if (!savedAs) {
        // Chrome took the file but hasn't reported a path (still placing it).
        emit({ type: "started" });
        return { step, flat: false };
    }
    const flat = !savedIntoFolder(savedAs, wanted);
    emit(flat ? { type: "flat", detail: savedAs } : { type: "saved", detail: savedAs });
    return { step, savedAs, flat };
}
