import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowRunner } from "./runQueue";
import type { RunEvents, RunOptions } from "./runQueue";
import { anchorDownload, bgDownload } from "./downloads";
import { FLOW_RPC } from "./flowRpc";
import { defaultPrefs } from "./store";
import type { LogLevel, QueueItem } from "../types";

// The runner talks to the page through chrome.scripting.executeScript, so we
// fake the chrome global and answer each injected function by NAME. Nothing
// here touches a real Flow tab, DOM canvas or downloader.
vi.mock("./downloads", () => ({
    bgDownload: vi.fn(async () => ({})),
    anchorDownload: vi.fn(),
}));

const GEN_RPCID = FLOW_RPC.generateImage.rpcid;
const IMAGE_URL = "https://flow-content.google/image/11111111-2222-3333-4444-555555555555";

type Handler = (args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
/** Counts Flow-tab reloads — the throttle-recovery path reloads before retrying. */
let reloadCount = 0;

/** Answer one injected page function by its declared name. */
function on(name: string, fn: Handler): void {
    handlers.set(name, fn);
}

function installChrome(): void {
    (globalThis as unknown as { chrome: unknown }).chrome = {
        tabs: {
            query: vi.fn(async () => [{ id: 7, url: "https://flow.google.com/project/p1" }]),
            get: vi.fn(async () => ({ status: "complete" })),
            reload: vi.fn(async () => {
                reloadCount++;
            }),
        },
        scripting: {
            executeScript: vi.fn(async (opts: { func: { name: string }; args?: unknown[] }) => {
                const handler = handlers.get(opts.func.name);
                if (!handler) return [{ result: undefined }];
                return [{ result: await handler(opts.args ?? []) }];
            }),
        },
    };
}

/** Sign-in + captcha stubs every scenario needs. */
function stubConnection(): void {
    on("flowGetProjectId", () => "proj-1");
    on("flowGetToken", () => "session-token");
    on("flowGetRecaptcha", () => "captcha-token");
}

/** Everything a fully successful generation needs. */
function stubSuccess(): void {
    stubConnection();
    on("flowBatchExecute", ([rpcid]) =>
        rpcid === GEN_RPCID ? { ok: true, data: IMAGE_URL } : { ok: true, data: [] });
    on("flowImageArtifacts", () => ({
        blobUrl: "blob:native",
        b64: "QUFBQQ==",
        width: 2048,
        height: 2048,
    }));
}

function makeItems(n: number): QueueItem[] {
    return Array.from({ length: n }, (_, i) => ({
        index: i,
        prompt: `Prompt ${i + 1}`,
        filename: "",
        status: "pending" as const,
        images: [],
        refs: [],
    }));
}

function makeOpts(over: Partial<RunOptions> = {}): RunOptions {
    return {
        model: "nano-banana-2.1",
        aspectRatio: "9:16",
        imagesPerPrompt: 1,
        quality: "standard",
        folder: "TestFlow",
        prefs: { ...defaultPrefs, retries: 0, parallel: 1, bufferSec: 0 },
        ...over,
    };
}

function collector(logs: string[]): RunEvents {
    return {
        onUpdate: () => undefined,
        onLog: (_level: LogLevel, msg: string) => {
            logs.push(msg);
        },
    };
}

/**
 * The runner paces itself with real sleeps (4-7s gaps, 120-300s cooldowns,
 * 60s chunk rests), so drive it on fake timers until it settles.
 */
async function drain(
    runner: FlowRunner,
    list: QueueItem[],
    o: RunOptions,
    ev: RunEvents,
): Promise<QueueItem[]> {
    let settled = false;
    const pending = runner.run(list, o, ev).then((r) => {
        settled = true;
        return r;
    });
    for (let i = 0; i < 6000 && !settled; i++) {
        await vi.advanceTimersByTimeAsync(1000);
    }
    if (!settled) throw new Error("run() never settled within 6000s of simulated time");
    return pending;
}

beforeEach(() => {
    // Date MUST be faked too: sleepBuffer() polls Date.now() against a target.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    handlers.clear();
    reloadCount = 0;
    installChrome();
    vi.mocked(bgDownload).mockClear();
    vi.mocked(anchorDownload).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("throttle state machine", () => {
    it("parks the rest of the batch after 3 throttle hits instead of retrying into the ban", async () => {
        stubConnection();
        on("flowBatchExecute", () => ({ error: "rpc: unusual_activity detected" }));
        const logs: string[] = [];

        const result = await drain(
            new FlowRunner(),
            makeItems(4),
            makeOpts({ prefs: { ...defaultPrefs, retries: 2, parallel: 1, bufferSec: 0 } }),
            collector(logs),
        );

        // The item that burned all its own attempts fails outright…
        expect(result[0].status).toBe("error");
        expect(result[0].detail).toContain("unusual_activity");
        // …but every item behind it is parked, not errored, so Resume picks it up.
        expect(result.slice(1).map((i) => i.status)).toEqual(["pending", "pending", "pending"]);
        // 2nd hit drops to safe mode, 3rd trips the breaker.
        expect(logs.some((l) => l.includes("dropping to safe mode"))).toBe(true);
        expect(logs.some((l) => l.includes("Run parked: Google blocked this session"))).toBe(true);
        // Recovery: the tab is reloaded between retries (sequential only).
        expect(reloadCount).toBeGreaterThanOrEqual(1);
    });

    it("stops after 8 consecutive failures and does not blame them on a Google block", async () => {
        stubConnection();
        on("flowBatchExecute", () => ({ error: "no image in reply" }));
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(12), makeOpts(), collector(logs));

        // Dead session: 8 prompts burn, the rest stay queued for a later Resume.
        expect(result.filter((i) => i.status === "error")).toHaveLength(8);
        expect(result.filter((i) => i.status === "pending")).toHaveLength(4);
        expect(logs.some((l) => l.includes("8 prompts failed in a row"))).toBe(true);
        expect(logs.some((l) => l.includes("Run ended"))).toBe(true);
        expect(logs.some((l) => l.includes("Google blocked this session"))).toBe(false);
    });

    it("keeps a >=4s gap between prompts even with the buffer set to Off", async () => {
        stubConnection();
        const stamps: number[] = [];
        on("flowBatchExecute", ([rpcid]) => {
            if (rpcid === GEN_RPCID) stamps.push(Date.now());
            return rpcid === GEN_RPCID ? { ok: true, data: IMAGE_URL } : { ok: true, data: [] };
        });
        on("flowImageArtifacts", () => ({ blobUrl: "blob:native", b64: "QUFBQQ==", width: 2048, height: 2048 }));

        const result = await drain(new FlowRunner(), makeItems(3), makeOpts(), collector([]));

        expect(result.every((i) => i.status === "done")).toBe(true);
        expect(stamps).toHaveLength(3);
        for (let i = 1; i < stamps.length; i++) {
            expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(4000);
        }
    });

    it("takes a 60s chunk rest after every 25 successes on a long batch", async () => {
        stubSuccess();
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(26), makeOpts(), collector(logs));

        expect(result.every((i) => i.status === "done")).toBe(true);
        expect(logs.some((l) => l.includes("Chunk rest: 25 done"))).toBe(true);
        // Exactly one rest: 26 items never reach the next multiple of 25.
        expect(logs.filter((l) => l.includes("Chunk rest:"))).toHaveLength(1);
    });

    it("widens the pacing gap to 8s for the rest of the run once safe mode trips", async () => {
        stubConnection();
        const stamps: number[] = [];
        let genCalls = 0;
        // First two generations get blocked (2nd trip arms safe mode), then the
        // session recovers and the rest of the batch succeeds.
        on("flowBatchExecute", ([rpcid]) => {
            if (rpcid !== GEN_RPCID) return { ok: true, data: [] };
            stamps.push(Date.now());
            genCalls++;
            if (genCalls <= 2) return { error: "rpc: unusual_activity detected" };
            return { ok: true, data: IMAGE_URL };
        });
        on("flowImageArtifacts", () => ({ blobUrl: "blob:native", b64: "QUFBQQ==", width: 2048, height: 2048 }));
        const logs: string[] = [];

        const result = await drain(
            new FlowRunner(),
            makeItems(3),
            makeOpts({ prefs: { ...defaultPrefs, retries: 2, parallel: 1, bufferSec: 0 } }),
            collector(logs),
        );

        expect(result.every((i) => i.status === "done")).toBe(true);
        expect(logs.some((l) => l.includes("dropping to safe mode"))).toBe(true);
        // stamps: item1 attempts 1-3, then item2, then item3. The last gap is
        // pure worker pacing — in safe mode it must be the 8s floor, not 4s.
        expect(stamps).toHaveLength(5);
        const pacingGap = stamps[4] - stamps[3];
        expect(pacingGap).toBeGreaterThanOrEqual(8000);
        expect(pacingGap).toBeLessThan(8000 + 3000 + 1);
    });
});

describe("quality fallbacks", () => {
    it("standard quality never calls into the page for resizing", async () => {
        stubSuccess();
        let resizeCalls = 0;
        on("flowResizeArt", () => {
            resizeCalls++;
            return { error: "should not run" };
        });

        const result = await drain(new FlowRunner(), makeItems(1), makeOpts(), collector([]));

        expect(result[0].status).toBe("done");
        expect(resizeCalls).toBe(0);
        // Native bytes download straight from the https URL — the name comes
        // from the `filename` argument, never from a blob/suggest round trip.
        expect(vi.mocked(bgDownload).mock.calls[0][0]).toBe(IMAGE_URL);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
    });

    it("1080p swaps the page blob for the fitted bytes so preview and file agree", async () => {
        stubSuccess();
        on("flowResizeArt", () => ({
            blobUrl: "blob:fitted",
            b64: "QUFB",
            width: 1920,
            height: 1080,
            resized: true,
        }));
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(1), makeOpts({ quality: "1080p" }), collector(logs));

        expect(result[0].status).toBe("done");
        // The fitted bytes differ from what the URL serves, so the URL path is
        // skipped entirely — the anchor saves the exact planned name instead.
        expect(vi.mocked(bgDownload)).not.toHaveBeenCalled();
        expect(vi.mocked(anchorDownload).mock.calls[0][1]).toBe("Prompt 1.png");
        expect(logs.some((l) => l.includes("1080p fit applied to 1 image"))).toBe(true);
        expect(result[0].images[0].width).toBe(1920);
    });

    it("1080p keeps the native bytes when the fit fails", async () => {
        stubSuccess();
        on("flowResizeArt", () => ({ error: "canvas unavailable" }));
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(1), makeOpts({ quality: "1080p" }), collector(logs));

        // A failed fit must never fail the item.
        expect(result[0].status).toBe("done");
        // Nothing was altered, so the original https URL is still the truth.
        expect(vi.mocked(bgDownload).mock.calls[0][0]).toBe(IMAGE_URL);
        expect(logs.some((l) => l.includes("1080p fit failed"))).toBe(true);
    });

    it("2K downloads standard while the upscale rpcid is still unmapped", async () => {
        stubSuccess();
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(1), makeOpts({ quality: "2k" }), collector(logs));

        expect(result[0].status).toBe("done");
        expect(vi.mocked(bgDownload).mock.calls[0][0]).toBe(IMAGE_URL);
        expect(logs.some((l) => l.includes("isn't mapped yet"))).toBe(true);
        expect(logs.some((l) => l.includes("2K upscale ready"))).toBe(false);
    });
});

describe("file naming", () => {
    it("saves #name images into the dated folder with (1) incrementing duplicates", async () => {
        stubSuccess();
        // Two prompts sharing the same #name — the batch plan must hand out
        // 1-01 to the first and 1-01(1) to the second, not both 1-01.
        const items: QueueItem[] = [
            { index: 0, prompt: "a red sky", filename: "1-01", status: "pending", images: [], refs: [] },
            { index: 1, prompt: "a blue sea", filename: "1-01", status: "pending", images: [], refs: [] },
        ];

        const result = await drain(new FlowRunner(), items, makeOpts({ folder: "" }), collector([]));

        expect(result.every((i) => i.status === "done")).toBe(true);
        const calls = vi.mocked(bgDownload).mock.calls;
        expect(calls).toHaveLength(2);
        // Direct https URL first: Chrome applies name AND subfolder itself.
        expect(calls[0][0]).toBe(IMAGE_URL);
        expect(calls[0][1]).toMatch(/^GenerateThroughFlow\d{6}\/1-01\.png$/);
        expect(calls[1][1]).toMatch(/^GenerateThroughFlow\d{6}\/1-01\(1\)\.png$/);
        // Folder names never collide between the two calls.
        expect(calls[0][1]).not.toBe(calls[1][1]);
    });

    it("falls back to the prompt text when there is no #name and no Flow title", async () => {
        stubSuccess();

        const result = await drain(new FlowRunner(), makeItems(1), makeOpts({ folder: "" }), collector([]));

        expect(result[0].status).toBe("done");
        const calls = vi.mocked(bgDownload).mock.calls;
        // makeItems prompts are "Prompt 1" — that exact text becomes the name.
        expect(calls[0][1]).toMatch(/^GenerateThroughFlow\d{6}\/Prompt 1\.png$/);
    });
});

describe("retry bookkeeping", () => {
    it("a failed attempt's images never leak into item.images — ZIP/modal see only the final attempt", async () => {
        stubSuccess();
        // Attempt 1 pulls its image (pushed into the local `images` array),
        // then the save itself dies: the folder download errors and the flat
        // anchor fallback throws. Attempt 2 saves cleanly.
        vi.mocked(bgDownload).mockResolvedValueOnce({ error: "network down" });
        vi.mocked(anchorDownload).mockImplementationOnce(() => {
            throw new Error("no anchor");
        });

        const result = await drain(
            new FlowRunner(),
            makeItems(1),
            makeOpts({ prefs: { ...defaultPrefs, retries: 1, parallel: 1, bufferSec: 0 } }),
            collector([]),
        );

        expect(result[0].status).toBe("done");
        // item.images is REPLACED on success, never appended: attempt 1's
        // pushed image must be gone. An accumulating implementation would
        // report 2 here — and the ZIP/modal read exactly this array.
        expect(result[0].images).toHaveLength(1);
        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(anchorDownload)).toHaveBeenCalledTimes(1);
    });

    it("re-running a not-done item replaces its images instead of stacking them", async () => {
        stubSuccess();
        // Contract behind "the ZIP packs only the latest images": a non-done
        // item fed back into run() (error → re-run) must come out with ONLY
        // the fresh attempt's images. Stale ones stacking up would multiply
        // every ZIP entry and modal page.
        const seeded: QueueItem[] = [{
            index: 0,
            prompt: "Prompt 1",
            filename: "",
            status: "error",
            images: [{ url: "https://flow-content.google/image/stale" }],
            refs: [],
        }];

        const result = await drain(new FlowRunner(), seeded, makeOpts(), collector([]));

        expect(result[0].status).toBe("done");
        expect(result[0].images).toHaveLength(1);
        // The one image present is the fresh one, not the seeded stale one.
        expect(result[0].images[0].url).toBe(IMAGE_URL);
    });
});

// Real payload from a rejected generation: Google refused the PROMPT text,
// so replaying the identical prompt cannot pass — no retry, no breaker blame.
const UNSAFE_RAW = `rpc: "rpc [3,null,[[\\"type.googleapis.com/google.rpc.ErrorInfo\\",[\\"PUBLIC_ERROR_UNSAFE_GENERATION\\"]]]]" | raw: 196 [["wrb.fr","ogiZ0b",null,null,null,[3,null,[["type.googleapis.com/google.rpc.ErrorInfo",["PUBLIC_ERROR_UNSAFE_GENERATION"]]]],"generic"],["di",5254],["af.httprm",5253,"-3446539333232816591",37]] 25 [["e",4,null,null,232]]`;

describe("safety-filter rejections", () => {
    it("fails fast instead of burning retries on an identical safety verdict", async () => {
        stubConnection();
        let genCalls = 0;
        on("flowBatchExecute", ([rpcid]) => {
            if (rpcid === GEN_RPCID) genCalls++;
            return { error: UNSAFE_RAW };
        });
        const logs: string[] = [];

        const result = await drain(
            new FlowRunner(),
            makeItems(1),
            makeOpts({ prefs: { ...defaultPrefs, retries: 3, parallel: 1, bufferSec: 0 } }),
            collector(logs),
        );

        // 4 attempts were allowed; the first rejection ends it — the other 3
        // are pure waste because the verdict is about the prompt, not timing.
        expect(genCalls).toBe(1);
        expect(result[0].status).toBe("error");
        expect(result[0].detail).toContain("PUBLIC_ERROR_UNSAFE_GENERATION");
        expect(logs.some((l) => l.includes("skipping 3 remaining retries"))).toBe(true);
        expect(logs.some((l) => l.includes("safety filter"))).toBe(true);
    });

    it("does not let content rejections trip the 8-in-a-row session breaker", async () => {
        stubConnection();
        on("flowBatchExecute", () => ({ error: UNSAFE_RAW }));
        const logs: string[] = [];

        const result = await drain(new FlowRunner(), makeItems(10), makeOpts(), collector(logs));

        // Every prompt is rejected on content grounds — all 10 must run (the
        // session itself is healthy) and none may stay queued for Resume.
        expect(result).toHaveLength(10);
        expect(result.every((i) => i.status === "error")).toBe(true);
        expect(result.filter((i) => i.status === "pending")).toHaveLength(0);
        // The breaker's VPN/refresh advice must stay out of a prompt problem.
        expect(logs.some((l) => l.includes("8 prompts failed in a row"))).toBe(false);
        expect(logs.some((l) => l.includes("Run parked"))).toBe(false);
        expect(logs.some((l) => l.includes("turn off VPN"))).toBe(false);
    });
});
