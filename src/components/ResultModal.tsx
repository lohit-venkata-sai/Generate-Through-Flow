import { Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { anchorDownload, bgDownload } from "../lib/downloads";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";
import { imageFolderName, plannedName, planNames, savedIntoFolder } from "../lib/naming";
import type { AutomationPrefs, QueueItem } from "../types";

interface ResultModalProps {
    items: QueueItem[];
    itemIndex: number;
    imgIndex: number;
    prefs: AutomationPrefs;
    imagesPerPrompt: number;
    /** Folder base the run used (file_name_pattern, defaulting in naming.ts). */
    folderBase: string;
    onNavigate: (itemIndex: number, imgIndex: number) => void;
    onClose: () => void;
}

export function ResultModal({ items, itemIndex, imgIndex, prefs, imagesPerPrompt, folderBase, onNavigate, onClose }: ResultModalProps) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    useLockBodyScroll();
    const withImages = items.filter((i) => i.images.length > 0);
    const pos = withImages.findIndex((i) => i.index === itemIndex);
    const item = pos >= 0 ? withImages[pos] : undefined;
    const safeImg = item ? Math.min(imgIndex, item.images.length - 1) : 0;
    const img = item?.images[safeImg];

    const step = (dir: 1 | -1) => {
        if (!item) return;
        let ni = safeImg + dir;
        let nItem = pos;
        if (ni >= item.images.length) {
            nItem = (pos + 1) % withImages.length;
            ni = 0;
        } else if (ni < 0) {
            nItem = (pos - 1 + withImages.length) % withImages.length;
            ni = withImages[nItem].images.length - 1;
        }
        onNavigate(withImages[nItem].index, ni);
    };

    const download = async () => {
        if (!img || !item) return;
        // Same planner the run used, so this saves the exact name the queue
        // and the ZIP use for this image (1-01.png, 1-01(1).png, …).
        const plan = planNames(items, prefs, imagesPerPrompt);
        const name = plannedName(plan, item, safeImg, prefs);
        const wanted = `${imageFolderName(folderBase)}/${name}.png`;
        const ok = (r: { savedAs?: string; error?: string }): boolean =>
            !r.error && (!r.savedAs || savedIntoFolder(r.savedAs, wanted));
        try {
            // Step 1: direct https URL + filename — Chrome applies name AND
            // folder itself. Skipped for quality-fit bytes (the URL still
            // serves the original image).
            if (!img.altered && ok(await bgDownload(img.url, wanted))) {
                setSaved(true);
                window.setTimeout(() => setSaved(false), 2000);
                return;
            }
            // Step 2: the bytes we hold, as an extension blob — same folder
            // path, so a failed or flat URL download still lands in-folder.
            const blob = await (await fetch(img.preview || img.url)).blob();
            const panelUrl = URL.createObjectURL(blob);
            const res = await bgDownload(panelUrl, wanted);
            setTimeout(() => URL.revokeObjectURL(panelUrl), 60_000);
            if (ok(res)) {
                setSaved(true);
                window.setTimeout(() => setSaved(false), 2000);
                return;
            }
            // Last resort: an anchor honors the exact name but can only
            // write to the Downloads root — never a random blob name.
            anchorDownload(blob, `${name}.png`);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
        } catch { /* nothing worked — leave the button as-is */ }
    };

    const copyImage = async () => {
        if (!img?.preview) return;
        try {
            const blob = await (await fetch(img.preview)).blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard image unsupported — ignore */ }
    };

    if (!item || !img) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="Generated result">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-3">
                    <h2 className="text-sm font-semibold">Generated Result</h2>
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-500">
                            <Check className="size-3" /> Completed
                        </span>
                        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                            <X className="size-4" />
                        </button>
                    </div>
                </div>
                <div className="relative bg-black">
                    <img src={img.preview || img.url} alt={item.prompt.slice(0, 60)} className="max-h-[50vh] w-full object-contain" />
                    {withImages.length > 1 && (
                        <>
                            <button type="button" onClick={() => step(-1)} aria-label="Previous" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
                                <ChevronLeft className="size-4" />
                            </button>
                            <button type="button" onClick={() => step(1)} aria-label="Next" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
                                <ChevronRight className="size-4" />
                            </button>
                        </>
                    )}
                </div>
                <div className="p-3">
                    <p className="truncate text-xs">
                        <span className="mr-1.5 rounded-md bg-primary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary-foreground">
                            #{String(item.index + 1).padStart(2, "0")}
                        </span>
                        {item.prompt.slice(0, 90)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                        {item.durationMs != null && <>Generated in {(item.durationMs / 1000).toFixed(1)}s</>}
                        {img.width != null && <> · {img.width} × {img.height}</>}
                    </p>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                        <a
                            href={img.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent"
                        >
                            <ExternalLink className="size-3.5" />
                            Open
                        </a>
                        <button type="button" onClick={download} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent">
                            <Download className="size-3.5" />
                            {saved ? "Saved" : "Download"}
                        </button>
                        <button
                            type="button"
                            onClick={copyImage}
                            disabled={!img.preview}
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium hover:bg-accent disabled:opacity-45"
                        >
                            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
