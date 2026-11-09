import { encode } from "uqr";

/**
 * A link as a QR code, in the shape the back cover stores it: rows of "1"
 * and "0", dark and light.
 *
 * Worked out where the link is typed and saved with the directory, rather
 * than every time the book is drawn, so the encoder is only ever downloaded
 * by the screen that sets it - the book, the preview and the PDF only draw
 * squares. Medium error correction, which survives a scuff or a fold across
 * the corner of a printed page; no border, because the composer leaves the
 * quiet zone round it itself.
 */
export function qrModules(link: string): string[] {
  const text = link.trim();
  if (!text) return [];
  const { data } = encode(text, { ecc: "M", border: 0 });
  return data.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));
}
