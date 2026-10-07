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
};

function uuid(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().toUpperCase();
    return String(Date.now()) + Math.random().toString(36).slice(2).toUpperCase();
}

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
};

export function resolveRpcid(op: string): string | null {
    return LOCAL_RPC_OVERRIDES[op] || FLOW_RPC[op]?.rpcid || null;
}
