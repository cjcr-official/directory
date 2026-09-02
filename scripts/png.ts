import zlib from "node:zlib";

/**
 * A minimal PNG writer, so the sample book can carry stand-in portraits
 * without adding an image library to the project.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export type PixelFn = (x: number, y: number) => [number, number, number];

export function encodePng(width: number, height: number, pixel: PixelFn): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0; // no per-scanline filter
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A soft, silhouette-ish portrait stand-in. Deliberately not a real face - it
 * exists to prove that photo scaling, cropping and embedding behave.
 */
export function placeholderPortrait(seed: number, width = 320, height = 400): Buffer {
  const hue = (seed * 47) % 360;
  const [br, bg, bb] = hslToRgb(hue, 0.28, 0.86);
  const [fr, fg, fb] = hslToRgb(hue, 0.34, 0.58);

  const headR = width * 0.22;
  const headX = width / 2;
  const headY = height * 0.36;
  const bodyR = width * 0.42;
  const bodyY = height * 1.02;

  return encodePng(width, height, (x, y) => {
    const inHead = (x - headX) ** 2 + (y - headY) ** 2 < headR ** 2;
    const inBody = (x - headX) ** 2 / bodyR ** 2 + (y - bodyY) ** 2 / (height * 0.72) ** 2 < 1;
    return inHead || inBody ? [fr, fg, fb] : [br, bg, bb];
  });
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
