/**
 * A minimal ZIP writer, so a backup downloads as one file.
 *
 * Entries are stored uncompressed. Almost everything in a backup is either
 * already-compressed JPEG or a few kilobytes of text, so deflate would cost
 * time and buy close to nothing - and "stored" keeps this to a page of code
 * instead of a dependency.
 *
 * Produces a standard archive that Windows Explorer, macOS Archive Utility,
 * unzip and Python's zipfile all read. No ZIP64, so the practical ceiling is
 * 4 GB and 65,535 files - far beyond any congregation.
 */

export interface ZipEntry {
  /** Path inside the archive, e.g. "photos/people/abc.jpg". */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP stores timestamps in the DOS format: 2-second resolution, from 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(now);
  const body = new Writer();

  const records = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = body.length;

    body.u32(0x04034b50); // local file header
    body.u16(20); // version needed
    body.u16(0x0800); // flags: names are UTF-8
    body.u16(0); // compression: stored
    body.u16(stamp.time);
    body.u16(stamp.date);
    body.u32(crc);
    body.u32(entry.data.length); // compressed size
    body.u32(entry.data.length); // uncompressed size
    body.u16(name.length);
    body.u16(0); // extra field length
    body.push(name);
    body.push(entry.data);

    return { name, crc, size: entry.data.length, offset };
  });

  const directory = new Writer();
  for (const record of records) {
    directory.u32(0x02014b50); // central directory header
    directory.u16(20); // version made by
    directory.u16(20); // version needed
    directory.u16(0x0800);
    directory.u16(0);
    directory.u16(stamp.time);
    directory.u16(stamp.date);
    directory.u32(record.crc);
    directory.u32(record.size);
    directory.u32(record.size);
    directory.u16(record.name.length);
    directory.u16(0); // extra
    directory.u16(0); // comment
    directory.u16(0); // disk number
    directory.u16(0); // internal attributes
    directory.u32(0); // external attributes
    directory.u32(record.offset);
    directory.push(record.name);
  }

  const end = new Writer();
  end.u32(0x06054b50); // end of central directory
  end.u16(0); // this disk
  end.u16(0); // disk with the directory
  end.u16(records.length);
  end.u16(records.length);
  end.u32(directory.length);
  end.u32(body.length);
  end.u16(0); // comment length

  const out = new Uint8Array(body.length + directory.length + end.length);
  out.set(body.toBytes(), 0);
  out.set(directory.toBytes(), body.length);
  out.set(end.toBytes(), body.length + directory.length);
  return out;
}
