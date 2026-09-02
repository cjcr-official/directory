import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { toWinAnsi } from "../format";

export type FontWeight = "regular" | "bold" | "italic";

export interface Metrics {
  widthOf(text: string, size: number, weight: FontWeight): number;
  lineHeight(size: number): number;
}

export const STANDARD_FONTS: Record<FontWeight, StandardFonts> = {
  regular: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
  italic: StandardFonts.HelveticaOblique,
};

let cached: Promise<Metrics> | null = null;

/**
 * Text measurement for the layout composer.
 *
 * Both the PDF writer and the on-screen preview measure with the very same
 * Helvetica metrics, which is what makes the preview trustworthy: if a name
 * wraps on screen it wraps in print, character for character.
 *
 * The throwaway document exists only to embed the fonts; it is never saved.
 */
export function loadMetrics(): Promise<Metrics> {
  if (!cached) {
    cached = (async () => {
      const doc = await PDFDocument.create();
      const fonts: Record<FontWeight, PDFFont> = {
        regular: await doc.embedFont(STANDARD_FONTS.regular),
        bold: await doc.embedFont(STANDARD_FONTS.bold),
        italic: await doc.embedFont(STANDARD_FONTS.italic),
      };
      return makeMetrics(fonts);
    })();
  }
  return cached;
}

export function makeMetrics(fonts: Record<FontWeight, PDFFont>): Metrics {
  return {
    widthOf(text, size, weight) {
      if (!text) return 0;
      return fonts[weight].widthOfTextAtSize(toWinAnsi(text), size);
    },
    lineHeight(size) {
      return size * 1.22;
    },
  };
}

/** Greedy word wrap. Words longer than the line are broken mid-word. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  weight: FontWeight,
  metrics: Metrics,
): string[] {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];
  if (metrics.widthOf(source, size, weight) <= maxWidth) return [source];

  const lines: string[] = [];
  let line = "";

  for (const word of source.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (metrics.widthOf(candidate, size, weight) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (metrics.widthOf(word, size, weight) <= maxWidth) {
      line = word;
      continue;
    }
    // A single unbreakable run - an email address, usually - gets split.
    let chunk = "";
    for (const char of word) {
      if (metrics.widthOf(chunk + char, size, weight) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }

  if (line) lines.push(line);
  return lines;
}

/** Shortens to one line, ending in an ellipsis when something was cut. */
export function truncate(
  text: string,
  maxWidth: number,
  size: number,
  weight: FontWeight,
  metrics: Metrics,
): string {
  if (metrics.widthOf(text, size, weight) <= maxWidth) return text;

  const ellipsis = "...";
  const budget = maxWidth - metrics.widthOf(ellipsis, size, weight);
  if (budget <= 0) return ellipsis;

  let out = "";
  for (const char of text) {
    if (metrics.widthOf(out + char, size, weight) > budget) break;
    out += char;
  }
  return `${out.trimEnd()}${ellipsis}`;
}
