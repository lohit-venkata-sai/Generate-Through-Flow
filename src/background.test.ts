import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness for src/background.ts — the MV3 service worker's download service.
// The module only talks to the global `chrome` object, so every test installs
// a fresh mock, re-imports the module (fresh in-memory state) and drives the
// listeners it registered.
//
// The contract under test is Chrome's onDeterminingFilename rule: each
// listener must call suggest() EXACTLY ONCE — synchronously, or asynchronously
// ONLY if the listener returns true. Violating it is what made image saves
// land flat in the Downloads root: Chrome auto-suggests its generated name
// the moment a listener returns without suggesting, so our folder path
// (GenerateThroughFlow<date>/…) never got through.

/** The DownloadItem fields the listener actually reads. */
interface ItemLike {
    id: number;
    url: string;
    finalUrl?: string;
    byExtensionId?: string;
}

interface Suggestion {
    filename?: string;
    conflictAction?: string;
}

type DeterminingListener = (item: ItemLike, suggest: (s?: Suggestion) => void) => unknown;
type MessageListener = (
    msg: unknown,
    sender: unknown,
    sendResponse: (r: unknown) => void,
) => unknown;
type ChangedListener = (delta: {
    id: number;
    state?: { current?: string };
    filename?: { current?: string };
    error?: { current?: string };
}) => void;

interface SearchState {
    state?: string;
    filename?: string;
    error?: string;
}

/** session storage survives a simulated worker restart within a test. */
let sessionStore: Map<string, string>;
/** First download's target path as reported by the mocked downloads.search. */
const COMPLETE_PATH = "/home/u/Downloads/GenerateThroughFlow091126/1-01.png";

function makeChrome() {
    const listeners = {
        determining: undefined as DeterminingListener | undefined,
        changed: undefined as ChangedListener | undefined,
        message: undefined as MessageListener | undefined,
        action: undefined as ((tab: unknown) => void) | undefined,
    };
    const calls = {
        download: [] as Array<{ url: string; filename?: string; conflictAction?: string }>,
        sessionGet: [] as string[],
        opened: 0,
    };
    let nextId = 1;
    let searchResult: SearchState = { state: "complete", filename: COMPLETE_PATH };
    let downloadError: string | undefined;
    let lastError: { message: string } | undefined;

    const api = {
        runtime: {
            id: "fp-test-ext",
            get lastError(): { message: string } | undefined {
                return lastError;
            },
            onMessage: {
                addListener: (fn: MessageListener) => {
                    listeners.message = fn;
                },
            },
        },
        action: {
            onClicked: {
                addListener: (fn: (tab: unknown) => void) => {
                    listeners.action = fn;
                },
            },
        },
        sidePanel: {
            open: () => {
                calls.opened++;
            },
        },
        storage: {
            session: {
                get: (key: string) => {
                    calls.sessionGet.push(key);
                    return Promise.resolve(
                        sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {},
                    );
                },
                set: (items: Record<string, string>) => {
                    for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
                    return Promise.resolve();
                },
                remove: (key: string) => {
                    sessionStore.delete(key);
                    return Promise.resolve();
                },
            },
        },
        downloads: {
            onDeterminingFilename: {
                addListener: (fn: DeterminingListener) => {
                    listeners.determining = fn;
                },
            },
            onChanged: {
                addListener: (fn: ChangedListener) => {
                    listeners.changed = fn;
                },
            },
            download: (
                opts: { url: string; filename?: string; conflictAction?: string },
                cb: (id?: number) => void,
            ) => {
                calls.download.push(opts);
                if (downloadError) {
                    lastError = { message: downloadError };
                    cb(undefined);
                    lastError = undefined;
                    return;
                }
                cb(nextId++);
            },
            search: (query: { id?: number }, cb: (items: Array<{ id?: number } & SearchState>) => void) => {
                cb([{ id: query.id, ...searchResult }]);
            },
        },
    };

    return {
        api,
        listeners,
        calls,
        setSearchResult: (r: SearchState) => {
            searchResult = r;
        },
        setDownloadError: (msg: string | undefined) => {
            downloadError = msg;
        },
    };
}

type ChromeMock = ReturnType<typeof makeChrome>;

/** Fresh module bound to a fresh mock (in-memory maps start empty). */
async function loadBackground(): Promise<ChromeMock> {
    const mock = makeChrome();
    (globalThis as unknown as { chrome: unknown }).chrome = mock.api;
    vi.resetModules();
    await import("./background");
    return mock;
}

/** Drain enough microtasks for the listener's async branches to settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

const URL_ = "https://lh3.googleusercontent.com/img.png";
const WANTED = "GenerateThroughFlow091126/1-01.png";

function fpDownload(url = URL_, filename = WANTED): unknown {
    return { type: "FP_DOWNLOAD", url, filename };
}

beforeEach(() => {
    // rememberUrl/rememberId schedule 10-minute cleanup timers and
    // waitForDownload a 30s timeout — fake timers keep them from leaking.
    vi.useFakeTimers();
    sessionStore = new Map();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("onDeterminingFilename (Chrome's exactly-once contract)", () => {
    it("suggests the planned folder path synchronously without claiming the async path", async () => {
        const mock = await loadBackground();
        const message = mock.listeners.message;
        expect(message).toBeDefined();
        message!(fpDownload(), {}, vi.fn());

        const suggest = vi.fn();
        // Memory hit (rememberUrl ran before download()) ⇒ suggest NOW.
        const ret = mock.listeners.determining!(
            { id: 1, url: URL_, byExtensionId: "fp-test-ext" },
            suggest,
        );

        // Asserted with no await in between: a late suggestion loses to
        // Chrome's automatic one, which is how the folder disappeared.
        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith({ filename: WANTED, conflictAction: "uniquify" });
        // Synchronous ⇒ must NOT return true (returning true without ever
        // suggesting would stall the download).
        expect(ret).toBeUndefined();
    });

    it("applies the planned path to panel blob URLs too (quality-fit saves)", async () => {
        const mock = await loadBackground();
        const blobUrl = "blob:https://flow.google.com/8f1c-aaaa";
        mock.listeners.message!(fpDownload(blobUrl, WANTED), {}, vi.fn());

        const suggest = vi.fn();
        mock.listeners.determining!(
            { id: 1, url: blobUrl, byExtensionId: "fp-test-ext" },
            suggest,
        );

        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith({ filename: WANTED, conflictAction: "uniquify" });
    });

    it("returns true and suggests once when only session storage knows the name (worker restart)", async () => {
        const first = await loadBackground();
        first.listeners.message!(fpDownload(), {}, vi.fn());
        await flush();
        expect(sessionStore.get("u:" + URL_)).toBe(WANTED);

        // Simulate the MV3 restart: fresh module ⇒ empty in-memory maps,
        // only chrome.storage.session survives.
        const restarted = await loadBackground();
        const suggest = vi.fn();
        const ret = restarted.listeners.determining!(
            { id: 77, url: URL_, byExtensionId: "fp-test-ext" },
            suggest,
        );

        // Async branch: must claim ownership, must not have answered yet.
        expect(ret).toBe(true);
        expect(suggest).not.toHaveBeenCalled();

        await flush();
        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith({ filename: WANTED, conflictAction: "uniquify" });
        // Proves the slow path really read session storage (not memory).
        expect(restarted.calls.sessionGet).toContain("u:" + URL_);
    });

    it("returns true and defers to Chrome's own name when nothing is stored anywhere", async () => {
        const mock = await loadBackground();
        const suggest = vi.fn();

        const ret = mock.listeners.determining!(
            { id: 42, url: "https://example.com/unknown.bin" },
            suggest,
        );
        expect(ret).toBe(true);
        await flush();

        // Exactly once, no arguments: allow download() to keep its filename
        // instead of inventing (or hanging on) a replacement.
        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith();
        expect(mock.calls.sessionGet).toContain("i:42");
    });

    it("never hijacks another extension's download", async () => {
        const mock = await loadBackground();
        const suggest = vi.fn();

        const ret = mock.listeners.determining!(
            { id: 3, url: "https://example.com/other.zip", byExtensionId: "someone.else" },
            suggest,
        );

        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith();
        expect(ret).toBeUndefined();
        // Answered without touching our stored intents.
        expect(mock.calls.sessionGet).toHaveLength(0);
    });
});

describe("FP_DOWNLOAD responses (what the panel log reports)", () => {
    it("reports the real final absolute path once the download completes", async () => {
        const mock = await loadBackground();
        const sendResponse = vi.fn();

        mock.listeners.message!(fpDownload(), {}, sendResponse);
        await flush();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ id: 1, savedAs: COMPLETE_PATH });
        expect(mock.calls.download[0]).toMatchObject({ url: URL_, filename: WANTED, conflictAction: "uniquify" });
    });

    it("reports the interrupt reason instead of a false success", async () => {
        const mock = await loadBackground();
        mock.setSearchResult({ state: "interrupted", error: "SERVER_FORBIDDEN" });
        const sendResponse = vi.fn();

        mock.listeners.message!(fpDownload(), {}, sendResponse);
        await flush();

        expect(sendResponse).toHaveBeenCalledWith({ error: "SERVER_FORBIDDEN" });
    });

    it("waits for the terminal state instead of answering 'started'", async () => {
        const mock = await loadBackground();
        mock.setSearchResult({ state: "in_progress" });
        const sendResponse = vi.fn();

        mock.listeners.message!(fpDownload(), {}, sendResponse);
        await flush();
        // The race-guard search says "still going" — no premature answer,
        // or the panel would log a path Chrome hasn't produced yet.
        expect(sendResponse).not.toHaveBeenCalled();

        mock.listeners.changed!({
            id: 1,
            state: { current: "complete" },
            filename: { current: COMPLETE_PATH },
        });
        await flush();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ id: 1, savedAs: COMPLETE_PATH });
    });

    it("reports a download that never started (runtime.lastError)", async () => {
        const mock = await loadBackground();
        mock.setDownloadError("Invalid url");
        const sendResponse = vi.fn();

        mock.listeners.message!(fpDownload(), {}, sendResponse);
        await flush();

        expect(sendResponse).toHaveBeenCalledWith({ error: "Invalid url" });
    });
});
