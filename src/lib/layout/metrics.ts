import type { PDFFont, StandardFonts } from "pdf-lib";
import { toWinAnsi } from "../format";

export type FontWeight = "regular" | "bold" | "italic";

export interface Metrics {
  widthOf(text: string, size: number, weight: FontWeight): number;
  lineHeight(size: number): number;
}

export type Typeface = "sans" | "serif";

/**
 * The six faces, written as the names themselves.
 *
 * Not read off pdf-lib's StandardFonts enum, because reading a value off an
 * enum is a real import of the module it lives in - and pdf-lib is 176 kB
 * gzipped, which is the whole thing loadMetrics below goes to trouble to keep
 * off a first page load.
 *
 * The type import costs nothing at runtime and still does the checking. The
 * assertion underneath compares these names against that enum's own values, so
 * a misspelling here fails the build rather than the print.
 */
export type StandardFontName =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic";

/** Fails to compile if any name above is not one pdf-lib actually knows. */
type NamesAreReal = StandardFontName extends `${StandardFonts}` ? true : never;
const _namesAreReal: NamesAreReal = true;
void _namesAreReal;

/**
 * Both families are among the PDF standard fourteen, so neither embeds a font
 * file: a serif directory costs nothing in file size and prints identically
 * everywhere.
 */
export const STANDARD_FONTS: Record<Typeface, Record<FontWeight, StandardFontName>> = {
  sans: {
    regular: "Helvetica",
    bold: "Helvetica-Bold",
    italic: "Helvetica-Oblique",
  },
  serif: {
    regular: "Times-Roman",
    bold: "Times-Bold",
    italic: "Times-Italic",
  },
};

/** CSS stacks the preview uses, chosen to match the PDF metrics closely. */
export const CSS_FONT_STACKS: Record<Typeface, string> = {
  sans: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
};

const cached = new Map<Typeface, Promise<Metrics>>();

/**
 * Text measurement for the layout composer.
 *
 * Both the PDF writer and the on-screen preview measure with the very same
 * Helvetica metrics, which is what makes the preview trustworthy: if a name
 * wraps on screen it wraps in print, character for character.
 *
 * The throwaway document exists only to embed the fonts; it is never saved.
 */
export function loadMetrics(typeface: Typeface = "sans"): Promise<Metrics> {
  let pending = cached.get(typeface);
  if (!pending) {
    pending = (async () => {
      // Imported here rather than at the top of the file, and that placement is
      // the point. This module is reached from the preview, which is reached
      // from the app shell, so a static import put all 176 kB (gzipped) of
      // pdf-lib on the critical path of every page load - the family list
      // downloaded a PDF writer before it could show a name. It is a large
      // dependency that only two screens need, and it now arrives when one of
      // them is opened.
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      const family = STANDARD_FONTS[typeface];
      const fonts: Record<FontWeight, PDFFont> = {
        regular: await doc.embedFont(family.regular),
        bold: await doc.embedFont(family.bold),
        italic: await doc.embedFont(family.italic),
      };
      return makeMetrics(fonts);
    })();
    cached.set(typeface, pending);
  }
  return pending;
}

/**
 * Beyond this many measurements the cache starts again.
 *
 * Composing a book of 460 records asks about 2,400 distinct strings, so this
 * is several books' worth. The cap exists because the app is a page that can
 * stay open for weeks on a phone and previews many projects in that time; a
 * map that only grows is a leak however slowly it does it. Clearing outright
 * rather than evicting one entry keeps this to two lines - the next compose
 * simply pays full price once.
 */
const WIDTH_CACHE_LIMIT = 20_000;

export function makeMetrics(fonts: Record<FontWeight, PDFFont>): Metrics {
  /**
   * Measured widths, keyed by the exact question asked.
   *
   * Wrapping is greedy, so it measures "John", then "John Smith", then "John
   * Smith - 216" and so on, and the same names come back again for the index
   * and the running head. Two thirds of the measurements a real book asks for
   * repeat a string that has already been measured, and each one costs a
   * WinAnsi fold - six regexes and a pass over every character - before
   * pdf-lib even starts adding up glyph widths.
   */
  const widths = new Map<string, number>();

  return {
    widthOf(text, size, weight) {
      if (!text) return 0;

      const key = `${weight}|${size}|${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;

      const width = fonts[weight].widthOfTextAtSize(toWinAnsi(text), size);
      if (widths.size >= WIDTH_CACHE_LIMIT) widths.clear();
      widths.set(key, width);
      return width;
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
