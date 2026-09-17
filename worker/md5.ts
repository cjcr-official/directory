/**
 * MD5, because Mailchimp addresses a contact by one.
 *
 * Every per-contact path in the Marketing API is
 * /lists/{list}/members/{subscriber_hash}, and the subscriber hash is the MD5
 * of the lower-cased email address. There is no endpoint that takes the
 * address itself, so the tag calls cannot be built without it.
 *
 * It is written out here rather than installed because WebCrypto - the only
 * hashing a Worker has - deliberately does not implement MD5, and pulling a
 * package into the deploy for sixty lines of arithmetic is a supply chain for
 * nothing. Nothing is being protected by it: it is Mailchimp's key for a row,
 * and its weakness as a hash is irrelevant to using it as one.
 *
 * Checked against the RFC 1321 test vectors in scripts/mailchimp-check.ts.
 */

/** Per-round left-rotation amounts. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(2^32 * abs(sin(i + 1))), the constant table from the RFC. */
const K = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  return table;
})();

function rotateLeft(value: number, by: number): number {
  return ((value << by) | (value >>> (32 - by))) >>> 0;
}

export function md5(text: string): string {
  const message = new TextEncoder().encode(text);

  // A 0x80 byte, zeros up to 56 mod 64, then the length in bits as a
  // little-endian 64-bit number.
  const padded = new Uint8Array((((message.length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[message.length] = 0x80;
  const bits = message.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      // Every add is taken back to 32 bits: JavaScript numbers are wide enough
      // to hold the overflow, and carrying it into the next round is the
      // classic way this comes out almost right.
      const sum = (f + a + K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const out = new DataView(digest.buffer);
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** How Mailchimp names one contact in a URL. */
export function subscriberHash(email: string): string {
  return md5(email.trim().toLowerCase());
}
