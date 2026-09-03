/**
 * A minimal ZIP reader, so a backup can be loaded back in.
 *
 * The other half of zip.ts. That writer stores everything uncompressed, so
 * reading our own archives needs no inflate at all - but a person who has had
 * the file for a year may well have opened it, added a note and let Windows or
 * macOS re-zip it, and both of those deflate. So method 8 is handled too, using
 * the browser's own DecompressionStream rather than a copy of inflate.
 *
 * Entries are found through the central directory at the end of the file
 * rather than by walking local headers from the front. That is the part of a
 * ZIP that is authoritative: it survives the leading junk that self-extracting
 * archives carry, and it is how every other reader does it.
 */

export interface UnzipEntry {
  name: string;
  /** Uncompressed bytes. */
  data: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The end record is 22 bytes plus a comment of up to 64 KB. */
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

function findEndRecord(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - EOCD_MIN - MAX_COMMENT);
  for (let at = view.byteLength - EOCD_MIN; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot read compressed archives. Use the backup file exactly as it " +
        "was downloaded, without re-zipping it.",
    );
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads every file in an archive.
 *
 * Directory entries are skipped: they carry no data, and a caller asking for
 * "photos/x.jpg" has no use for a "photos/" of length zero.
 */
export async function readZip(bytes: Uint8Array): Promise<UnzipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const end = findEndRecord(view);
  if (end < 0) {
    throw new Error("That does not look like a ZIP file — no end-of-archive record was found.");
  }

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: UnzipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error("This archive is damaged — its list of files does not read.");
    }

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;

    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new Error(`This archive is damaged — ${name} could not be found inside it.`);
    }
    // The local header repeats the name and carries its own extra field, which
    // is routinely a different length from the central one. Both have to be
    // stepped over using the local header's own numbers.
    const dataAt =
      localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);

    if (method === 0) entries.push({ name, data: raw });
    else if (method === 8) entries.push({ name, data: await inflateRaw(raw) });
    else throw new Error(`${name} is compressed in a way this app cannot read (method ${method}).`);
  }

  return entries;
}
