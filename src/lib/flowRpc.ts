// Flow RPC registry (subset needed for image automation).
// rpcids are the method ids the Flow frontend sends to batchexecute.
// Local override slot lets tests simulate a server map rotation with no backend.

export interface RpcDef {
    rpcid: string;
    build: (args: Record<string, unknown>) => unknown[];
    parse: (data: unknown) => { urls: string[]; ids: string[]; workflowId: string | null };
}

/** Local override for simulating a server-side rpcid rotation (no backend). */
export const LOCAL_RPC_OVERRIDES: Record<string, string | null> = {
    generateImage: null,
    createWorkflow: null,
    renameWorkflow: null,
    agentInit: null,
};

function uuid(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().toUpperCase();
    return String(Date.now()) + Math.random().toString(36).slice(2).toUpperCase();
}

/**
 * Experiment-flag string sent with agent calls, copied verbatim from a live
 * capture (Oct 2026 build). If agent calls start failing after a Flow
 * update, re-capture this string from DevTools and replace it.
 */
export const AGENT_EXPERIMENTS =
    "1706538,106751568,106104244,106262194,1714247,106430287,106430149,106077941,106299202,106556077,106238955,106225453,105950000,106592798,106676866,106577881,105746691,106681111,106714532,106577170,106762067,106536611,106802691,106281924,106486771,119157484,106184493,106667487,106747630,106322568,106432686,106625630,106599983,106585383,105484652,106501717,106615367,106437280,106312926,106751560,106430279,106430141,106299194,106556069,106592790,106676858,106577873,106681103,106714524,106762059,106536603,106802683,106486763,106667479,106747622,106625362,106599975,106585375,106615359";

export const FLOW_RPC: Record<string, RpcDef> = {
    loadProject: {
        rpcid: "nzlxg",
        build: () => [],
        parse: () => ({ urls: [], ids: [], workflowId: null }),
    },
    createWorkflow: {
        rpcid: "jHPbke",
        build: (e) => [
            "projects/*",
            [null, [(e.name as string) || new Date().toISOString().slice(0, 16).replace("T", " ")]],
            [null, 22],
        ],
        parse: (e) => ({ urls: [], ids: [], workflowId: Array.isArray(e) ? (e[0] as string) : null }),
    },
    generateImage: {
        rpcid: "ogiZ0b",
        build: (e) => {
            const seed = (e.seed as number) ?? Math.floor(Math.random() * 33554432);
            const refs = (e.refs as { mediaId: string; name: string }[] | undefined) || [];
            const imageInputs = refs.length
                ? refs.map((r) => [r.mediaId, null, null, null, 1])
                : (e.imageInputs as string[] | undefined)?.length
                    ? (e.imageInputs as string[]).map((o) => [o, null, null, null, 1])
                    : null;
            const recaptchaBlock = [null, 22, null, null, null, e.workflowId, null, null, null, null, [e.recaptcha, 1]];
            // Structured prompt: text chunks stay inline, resolved @tags become
            // reference objects so Flow conditions on the character's media.
            const parts = (e.parts as (string | { mediaId: string; name: string })[] | undefined) || [];
            const structured = parts.length
                ? parts.map((p) => (typeof p === "string" ? [p] : [null, [[p.mediaId, p.name]]]))
                : (e.structured as string[][] | undefined)?.length
                    ? (e.structured as string[][])
                    : [[(e.prompt as string) || ""]];
            return [
                null,
                [[null, null, imageInputs, seed, e.aspect ?? 3, e.model || "BELUGA", null, recaptchaBlock, [structured], null, null, null, uuid(), uuid()]],
                (e.count as number) || 1,
                recaptchaBlock,
                [(e.projectSessionId as string) || uuid()],
            ];
        },
        parse: (e) => {
            const found: string[] = [];
            JSON.stringify(e).replace(
                /https:\/\/flow-content\.google\/image\/[^"\\?]+(\?[^"\\]*)?/g,
                (r) => (found.push(r), r),
            );
            const ids = found
                .map((r) => (r.match(/\/image\/([a-f0-9-]+)/) || [])[1])
                .filter(Boolean);
            const first = (e as unknown[][])?.[0]?.[0] as { [k: number]: unknown } | undefined;
            return { urls: found, ids, workflowId: (first?.[2] as string) ?? null };
        },
    },
    renameWorkflow: {
        rpcid: "mYWVGd",
        build: (e) => [
            [e.workflowId, null, null, [e.name], e.projectId],
            [["metadata.display_name"]],
        ],
        parse: () => ({ urls: [], ids: [], workflowId: null }),
    },
    /**
     * Agent session init (same batchexecute channel as everything else).
     * Captured shape: [[["PROMPT_BOX_SUBMISSION",[uuid,[sec,nanos],null,env,experiments]]]].
     * The response is mined for the opaque session token StreamChat needs.
     */
    agentInit: {
        rpcid: "WuwhI",
        build: (e) => [[["PROMPT_BOX_SUBMISSION", [
            (e.requestId as string) || uuid(),
            agentTimestamp(),
            null,
            agentEnv(
                (e.userAgent as string) || "",
                (e.projectId as string) || "",
                (e.paygate as string) || "PAYGATE_TIER_NOT_PAID",
            ),
            AGENT_EXPERIMENTS,
        ]]]],
        parse: () => ({ urls: [], ids: [], workflowId: null }),
    },
    /**
     * Agent message send. NOT a batchexecute call — POST the built body to
     * the FlowCreationAgentService/StreamChat data URL (see flowAgentPost).
     * Body: [null, JSON["reqId",[[[[text]]]],["projects/pid",null,[token,1],null,null,1]]].
     */
    agentChat: {
        rpcid: "StreamChat",
        build: (e) => [null, JSON.stringify([
            (e.requestId as string) || newUuid(),
            [[[[(e.messageText as string) || ""]]]],
            [`projects/${e.projectId}`, null, [(e.token as string) || "", 1], null, null, 1],
        ])],
        parse: () => ({ urls: [], ids: [], workflowId: null }),
    },
};

/** Lowercase v4 uuid for agent request ids (matches captured traffic). */
function newUuid(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now().toString(16)}-xxxx-4xxx-yxxx`.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/** Protobuf-timestamp pair [seconds, nanos] (matches captured traffic). */
function agentTimestamp(): [number, number] {
    const ms = Date.now();
    return [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
}

function agentEnv(userAgent: string, projectId: string, paygate: string): unknown[][] {
    const str = (v: string) => ["type.googleapis.com/google.protobuf.StringValue", [v]];
    const flag = (on: boolean) => ["type.googleapis.com/google.protobuf.BoolValue", on ? [1] : []];
    return [
        ["IS_MOBILE", flag(false)],
        ["IS_TABLET", flag(false)],
        ["IS_DESKTOP", flag(true)],
        ["IS_ANGULAR", flag(true)],
        ["USER_AGENT", str(userAgent)],
        ["TOOL_NAME", str("PINHOLE")],
        ["SOURCE", str("CREATIVE_AGENT")],
        ["PROJECT_ID", str(projectId)],
        ["MEDIA_GENERATION_PAYGATE_TIER", str(paygate)],
    ];
}

/**
 * Heuristic: the agent session token is by far the longest opaque string in
 * the init response. Returns the longest [A-Za-z0-9_-]{100,} string found.
 */
export function mineAgentToken(data: unknown): string | null {
    const found: string[] = [];
    const walk = (n: unknown): void => {
        if (typeof n === "string") {
            if (/^[A-Za-z0-9_-]{100,}$/.test(n)) found.push(n);
            return;
        }
        if (Array.isArray(n)) {
            for (const el of n) walk(el);
            return;
        }
        if (n && typeof n === "object") {
            for (const k of Object.keys(n)) walk((n as Record<string, unknown>)[k]);
        }
    };
    walk(data);
    found.sort((a, b) => b.length - a.length);
    return found[0] ?? null;
}

/** Pull flow-content image URLs out of arbitrary response text (deduped). */
export function extractFlowImageUrls(text: string): string[] {
    const found: string[] = [];
    (text || "").replace(
        /https:\/\/flow-content\.google\/image\/[^"\\\s?]+(\?[^"\\\s]*)?/g,
        (r) => (found.push(r), r),
    );
    return [...new Set(found)];
}

export function resolveRpcid(op: string): string | null {
    return LOCAL_RPC_OVERRIDES[op] || FLOW_RPC[op]?.rpcid || null;
}
