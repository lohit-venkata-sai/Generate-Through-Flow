// Minimal ZIP writer (stored, no compression) — dependency-free.
// Enough for bundling generated PNGs into one download.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function encodeName(name: string): Uint8Array {
    return new TextEncoder().encode(name);
}

/** Build a .zip Blob from filename -> bytes entries (stored method). */
export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    const pushU16 = (arr: number[], v: number) => { arr.push(v & 0xff, (v >>> 8) & 0xff); };
    const pushU32 = (arr: number[], v: number) => {
        arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    };

    for (const file of files) {
        const nameBytes = encodeName(file.name);
        const crc = crc32(file.data);
        const local: number[] = [];
        pushU32(local, 0x04034b50); // local file header signature
        pushU16(local, 20); // version needed
        pushU16(local, 0x0800); // UTF-8 flag
        pushU16(local, 0); // method: stored
        pushU16(local, 0); // mod time
        pushU16(local, 0); // mod date
        pushU32(local, crc);
        pushU32(local, file.data.length);
        pushU32(local, file.data.length);
        pushU16(local, nameBytes.length);
        pushU16(local, 0); // extra length
        const localHeader = new Uint8Array([...local, ...nameBytes]);
        chunks.push(localHeader, file.data);

        const centralEntry: number[] = [];
        pushU32(centralEntry, 0x02014b50); // central directory signature
        pushU16(centralEntry, 20); // version made by
        pushU16(centralEntry, 20); // version needed
        pushU16(centralEntry, 0x0800);
        pushU16(centralEntry, 0);
        pushU16(centralEntry, 0);
        pushU16(centralEntry, 0);
        pushU32(centralEntry, crc);
        pushU32(centralEntry, file.data.length);
        pushU32(centralEntry, file.data.length);
        pushU16(centralEntry, nameBytes.length);
        pushU16(centralEntry, 0);
        pushU16(centralEntry, 0);
        pushU16(centralEntry, 0);
        pushU16(centralEntry, 0);
        pushU32(centralEntry, 0); // external attrs
        pushU32(centralEntry, offset);
        central.push(new Uint8Array([...centralEntry, ...nameBytes]));
        offset += localHeader.length + file.data.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end: number[] = [];
    pushU32(end, 0x06054b50); // end of central directory
    pushU16(end, 0);
    pushU16(end, 0);
    pushU16(end, files.length);
    pushU16(end, files.length);
    pushU32(end, centralSize);
    pushU32(end, offset);
    pushU16(end, 0);

    return new Blob(
        [...chunks, ...central, new Uint8Array(end)] as BlobPart[],
        { type: "application/zip" },
    );
}

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    try {
        await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
}
