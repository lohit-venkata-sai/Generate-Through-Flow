// @character reference resolution (project characters = named workflows).
// A tag resolves only to a non-archived workflow in the current project;
// unresolved tags stay plain text and get no chip, no reference payload.

export interface CharEntry {
    handle: string;
    mediaId: string;
    createTime: string;
}

export interface ResolvedRef {
    tag: string;
    mediaId: string;
}

const TAG_RE = /@\[([^\]]+)\]|@([\p{L}0-9_-]+)/gu;

/** Raw @tags in reading order, deduplicated (case-insensitive). */
export function extractTags(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) {
        const raw = (m[1] || m[2]).trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(raw);
    }
    return out;
}

/** Normalization variants for a handle (bare + without image extension). */
export function handleVariants(handle: string): string[] {
    const t = handle.trim().toLowerCase();
    const bare = t.replace(/\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i, "");
    return bare && bare !== t ? [t, bare] : [t];
}

export type CharIndex = Map<string, CharEntry[]>;

/** Build a lookup index from workflow refs, excluding archived media. */
export function buildCharIndex(
    items: { handle: string; mediaId: string; createTime: string }[],
    archived: string[],
): CharIndex {
    const index: CharIndex = new Map();
    for (const item of items) {
        if (!item.handle || !item.mediaId) continue;
        if (archived.includes(item.mediaId)) continue;
        for (const variant of handleVariants(item.handle)) {
            const list = index.get(variant) || [];
            if (!list.some((e) => e.mediaId === item.mediaId)) {
                list.push({ handle: item.handle, mediaId: item.mediaId, createTime: item.createTime });
            }
            index.set(variant, list);
        }
    }
    return index;
}

/** Newest entry wins (same rule as the reference implementation). */
export function resolveTag(index: CharIndex, tag: string): CharEntry | null {
    for (const variant of handleVariants(tag)) {
        const list = index.get(variant);
        if (list?.length) {
            return [...list].sort((a, b) => (b.createTime || "").localeCompare(a.createTime || ""))[0];
        }
    }
    return null;
}

/** Split a prompt into text/reference parts for the structured payload. */
export function splitPromptParts(
    prompt: string,
    index: CharIndex,
): { parts: (string | { mediaId: string; name: string })[]; refs: ResolvedRef[] } {
    const parts: (string | { mediaId: string; name: string })[] = [];
    const refs: ResolvedRef[] = [];
    const seen = new Set<string>();
    TAG_RE.lastIndex = 0;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(prompt)) !== null) {
        const raw = (m[1] || m[2]).trim();
        const hit = raw ? resolveTag(index, raw) : null;
        if (!hit) continue; // unresolved: leave the text untouched
        if (cursor < m.index) parts.push(prompt.slice(cursor, m.index));
        parts.push({ mediaId: hit.mediaId, name: raw });
        const key = raw.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            refs.push({ tag: raw, mediaId: hit.mediaId });
        }
        cursor = m.index + m[0].length;
    }
    const tail = prompt.slice(cursor);
    if (tail) parts.push(tail);
    if (!parts.length) parts.push(prompt);
    return { parts, refs };
}
