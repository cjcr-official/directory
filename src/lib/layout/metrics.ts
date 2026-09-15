import type { PDFFont, StandardFonts } from "pdf-lib";
import { toWinAnsi } from "../format";

export type FontWeight = "regular" | "bold" | "italic";

export interface Metrics {
  /**
   * How wide `text` sets.
   *
   * `face` names the family to measure in, and defaults to the one these
   * metrics were loaded for. It exists because a name tag sets its two halves
   * in two different families - the name in one, the church and the line under
   * it in another - so a single composition has to be able to ask about both.
   * Everything that sets one document in one family carries on passing three
   * arguments and never notices.
   */
  widthOf(text: string, size: number, weight: FontWeight, face?: Typeface): number;
  lineHeight(size: number): number;
}

export type Typeface = "sans" | "serif" | "mono";

/**
 * The nine faces, written as the names themselves.
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
  | "Times-Italic"
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique";

/** Fails to compile if any name above is not one pdf-lib actually knows. */
type NamesAreReal = StandardFontName extends `${StandardFonts}` ? true : never;
const _namesAreReal: NamesAreReal = true;
void _namesAreReal;

/**
 * All three families are among the PDF standard fourteen, so none of them
 * embeds a font file: a serif directory costs nothing in file size and prints
 * identically everywhere.
 *
 * Three is also all there is. The standard fourteen are Helvetica, Times,
 * Courier, Symbol and Dingbats, and a fourth family would mean shipping a real
 * font file and the code to subset it - a megabyte or so, downloaded by
 * everyone, to set the four words at the top of a name tag. So this is the
 * whole choice on offer, and the tag composer spends it where it shows: the
 * name in one family, the small print in another.
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
  mono: {
    regular: "Courier",
    bold: "Courier-Bold",
    italic: "Courier-Oblique",
  },
};

/** Every family, for the places that have to walk them. */
export const TYPEFACES = Object.keys(STANDARD_FONTS) as Typeface[];

/** What each family is called on screen, in words rather than font names. */
export const TYPEFACE_LABELS: Record<Typeface, string> = {
  sans: "Sans serif",
  serif: "Serif",
  mono: "Typewriter",
};

/** CSS stacks the preview uses, chosen to match the PDF metrics closely. */
export const CSS_FONT_STACKS: Record<Typeface, string> = {
  sans: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

const cached = new Map<Typeface, Promise<Metrics>>();

/**
 * Embeds every weight of every family into one document.
 *
 * All nine are standard fonts, so this carries no font files about - it is nine
 * width tables, and measuring cost about 20ms the first time it was timed. That
 * is cheap enough not to be worth choosing between, and choosing would mean
 * knowing which families a composition wants before it has run.
 */
export async function embedFamilies(doc: {
  embedFont(name: StandardFontName): Promise<PDFFont>;
}): Promise<Record<Typeface, Record<FontWeight, PDFFont>>> {
  const families = {} as Record<Typeface, Record<FontWeight, PDFFont>>;
  for (const face of TYPEFACES) {
    const family = STANDARD_FONTS[face];
    families[face] = {
      regular: await doc.embedFont(family.regular),
      bold: await doc.embedFont(family.bold),
      italic: await doc.embedFont(family.italic),
    };
  }
  return families;
}

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
      return makeMetrics(await embedFamilies(doc), typeface);
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

export function makeMetrics(
  families: Record<Typeface, Record<FontWeight, PDFFont>>,
  base: Typeface = "sans",
): Metrics {
  /**
   * Measured widths, keyed by the exact question asked.
   *
   * Wrapping is greedy, so it measures "John", then "John Smith", then "John
   * Smith - 216" and so on, and the same names come back again for the index
   * and the running head. Two thirds of the measurements a real book asks for
   * repeat a string that has already been measured, and each one costs a
   * WinAnsi fold - six regexes and a pass over every character - before
   * pdf-lib even starts adding up glyph widths.
   *
   * The family is part of the key, because the same name in Courier is not the
   * same width as in Helvetica and a tag can ask for both.
   */
  const widths = new Map<string, number>();

  return {
    widthOf(text, size, weight, face) {
      if (!text) return 0;

      const family = face ?? base;
      const key = `${family}|${weight}|${size}|${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;

      const width = families[family][weight].widthOfTextAtSize(toWinAnsi(text), size);
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
  face?: Typeface,
): string[] {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];
  if (metrics.widthOf(source, size, weight, face) <= maxWidth) return [source];

  const lines: string[] = [];
  let line = "";

  for (const word of source.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (metrics.widthOf(candidate, size, weight, face) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (metrics.widthOf(word, size, weight, face) <= maxWidth) {
      line = word;
      continue;
    }
    // A single unbreakable run - an email address, usually - gets split.
    let chunk = "";
    for (const char of word) {
      if (metrics.widthOf(chunk + char, size, weight, face) > maxWidth && chunk) {
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
  face?: Typeface,
): string {
  if (metrics.widthOf(text, size, weight, face) <= maxWidth) return text;

  const ellipsis = "...";
  const budget = maxWidth - metrics.widthOf(ellipsis, size, weight, face);
  if (budget <= 0) return ellipsis;

  let out = "";
  for (const char of text) {
    if (metrics.widthOf(out + char, size, weight, face) > budget) break;
    out += char;
  }
  return `${out.trimEnd()}${ellipsis}`;
}
