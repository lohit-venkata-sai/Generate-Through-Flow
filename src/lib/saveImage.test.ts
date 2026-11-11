import { beforeEach, describe, expect, it, vi } from "vitest";
import { anchorDownload, bgDownload } from "./downloads";
import { saveImage } from "./saveImage";
import type { SaveEvent, SaveResult } from "./saveImage";

// The chain is the shared per-image save path for the queue AND the modal.
// Its contract: ONE save action writes AT MOST ONE file. Each step runs only
// when the previous one genuinely failed — a download that completed but
// landed outside the folder is reported, never retried. Before this was
// shared, the modal retried on "wrong folder" and fired URL save + blob save
// + flat anchor on every click: three popups, three copies.
vi.mock("./downloads", () => ({
    bgDownload: vi.fn(async () => ({})),
    anchorDownload: vi.fn(),
}));

const URL_ = "https://lh3.googleusercontent.com/img.png";
const PREVIEW = "data:image/png;base64,iVBORw0KGgo=";
const WANTED = "GenerateThroughFlow111126/0-00.png";

/** Drive saveImage with an event collector. */
async function run(altered = false): Promise<{ events: SaveEvent[]; result: SaveResult }> {
    const events: SaveEvent[] = [];
    const result = await saveImage({
        url: URL_,
        preview: PREVIEW,
        altered,
        wanted: WANTED,
        flatName: "0-00.png",
        onEvent: (e) => events.push(e),
    });
    return { events, result };
}

beforeEach(() => {
    vi.mocked(bgDownload).mockClear().mockResolvedValue({});
    vi.mocked(anchorDownload).mockClear();
});

describe("saveImage (one action, one file)", () => {
    it("does NOT re-download when the file completed outside the folder (the 3-popup regression)", async () => {
        // Chrome wrote it, just flat — retrying cannot change where it goes,
        // it can only add copies. This is what produced three popups per click.
        vi.mocked(bgDownload).mockResolvedValue({ savedAs: "/home/u/Downloads/0-00.png" });

        const { events, result } = await run();

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
        expect(result.step).toBe("url");
        expect(result.flat).toBe(true);
        expect(result.savedAs).toBe("/home/u/Downloads/0-00.png");
        expect(events).toEqual([{ type: "flat", detail: "/home/u/Downloads/0-00.png" }]);
    });

    it("stops after one download when the file landed in the folder", async () => {
        vi.mocked(bgDownload).mockResolvedValue({
            savedAs: "/home/u/Downloads/GenerateThroughFlow111126/0-00.png",
        });

        const { events, result } = await run();

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
        expect(result.flat).toBe(false);
        expect(events).toEqual([
            { type: "saved", detail: "/home/u/Downloads/GenerateThroughFlow111126/0-00.png" },
        ]);
    });

    it("treats Chrome's uniquified repeat name inside the folder as a success", async () => {
        // Second click on the same image: Chrome writes "0-00 (1).png" — inside
        // the folder, so it must not be mistaken for a root save and retried.
        vi.mocked(bgDownload).mockResolvedValue({
            savedAs: "/home/u/Downloads/GenerateThroughFlow111126/0-00 (1).png",
        });

        const { events, result } = await run();

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
        expect(result.flat).toBe(false);
        expect(events[0]?.type).toBe("saved");
    });

    it("falls back to the held bytes only when the URL download genuinely failed", async () => {
        vi.mocked(bgDownload)
            .mockResolvedValueOnce({ error: "SERVER_FORBIDDEN" })
            .mockResolvedValueOnce({ savedAs: "/home/u/Downloads/GenerateThroughFlow111126/0-00.png" });

        const { events } = await run();

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
        expect(events.map((e) => e.type)).toEqual(["url-failed", "saved"]);
    });

    it("runs the anchor only when both downloads failed to write anything", async () => {
        vi.mocked(bgDownload)
            .mockResolvedValueOnce({ error: "SERVER_FORBIDDEN" })
            .mockResolvedValueOnce({ error: "NETWORK_FAILED" });

        const { events, result } = await run();

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(anchorDownload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(anchorDownload)).toHaveBeenCalledWith(expect.any(Blob), "0-00.png");
        expect(result.step).toBe("anchor");
        expect(result.flat).toBe(true);
        expect(result.anchorFailed).toBeUndefined();
        expect(events.map((e) => e.type)).toEqual(["url-failed", "bytes-failed"]);
    });

    it("skips the URL step for quality-fit bytes (the URL still serves the original)", async () => {
        vi.mocked(bgDownload).mockResolvedValue({ savedAs: "/d/GenerateThroughFlow111126/0-00.png" });

        await run(true);

        expect(vi.mocked(bgDownload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(bgDownload).mock.calls[0][0]).toMatch(/^blob:/);
        expect(vi.mocked(anchorDownload)).not.toHaveBeenCalled();
    });

    it("reports an anchor failure so the caller can fail the item instead of claiming success", async () => {
        vi.mocked(bgDownload)
            .mockResolvedValueOnce({ error: "SERVER_FORBIDDEN" })
            .mockResolvedValueOnce({ error: "NETWORK_FAILED" });
        vi.mocked(anchorDownload).mockImplementationOnce(() => {
            throw new Error("no anchor");
        });

        const { result } = await run();

        expect(result.anchorFailed).toBe(true);
        expect(result.error).toBe("NETWORK_FAILED");
    });

    it("emits started when Chrome accepted the download but reported no path yet", async () => {
        vi.mocked(bgDownload).mockResolvedValue({});

        const { events, result } = await run();

        expect(events).toEqual([{ type: "started" }]);
        expect(result.flat).toBe(false);
        expect(result.savedAs).toBeUndefined();
    });

    it("keeps the URL failure reason when the held bytes can't be fetched either", async () => {
        vi.mocked(bgDownload).mockResolvedValue({ error: "SERVER_FORBIDDEN" });
        // No preview and an un-fetchable URL (bad scheme, no network involved):
        // fetch fails, the anchor retry fails too, and the surfaced reason
        // must be the URL failure rather than a generic one.
        const events: SaveEvent[] = [];
        const result = await saveImage({
            url: "nope://unreachable",
            altered: false,
            wanted: WANTED,
            flatName: "0-00.png",
            onEvent: (e) => events.push(e),
        });

        expect(result.anchorFailed).toBe(true);
        expect(result.error).toBe("SERVER_FORBIDDEN");
        expect(events.map((e) => e.type)).toEqual(["url-failed", "bytes-failed"]);
    });
});
