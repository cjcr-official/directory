import {
  PDFDocument,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { toWinAnsi } from "../format";
import { COLORS, type BookModel, type Box, type PhotoSlot, type TextRun } from "./compose";
import {
  STANDARD_FONTS,
  makeMetrics,
  type FontWeight,
  type Metrics,
  type Typeface,
} from "./metrics";

/** Loads the bytes for one photo, or null when it cannot be fetched. */
export type PhotoLoader = (path: string) => Promise<Uint8Array | null>;

export interface RenderOptions {
  /** Faint crop marks and a dashed fold line, to help with trimming. */
  showFoldGuides?: boolean;
  title?: string;
  onProgress?: (done: number, total: number) => void;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3 ? clean.replace(/./g, "$&$&") : clean, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/**
 * Draws a run of text.
 *
 * The composer works top-left down; PDF works bottom-left up. The flip happens
 * here and nowhere else. `y` names the top of the line box, so the baseline
 * sits one ascender below it.
 */
function drawRun(
  page: PDFPage,
  run: TextRun,
  fonts: Record<FontWeight, PDFFont>,
  pageHeight: number,
) {
  const font = fonts[run.weight];
  const text = toWinAnsi(run.text);
  if (!text) return;

  const width = font.widthOfTextAtSize(text, run.size);
  let x = run.x;
  if (run.align === "center") x = run.x + (run.w - width) / 2;
  else if (run.align === "right") x = run.x + run.w - width;

  // Helvetica's ascender is ~0.718em; this puts the visual top of the glyphs
  // where the composer said the line box starts.
  const baseline = pageHeight - (run.y + run.size * 0.8);

  page.drawText(text, {
    x,
    y: baseline,
    size: run.size,
    font,
    color: hexToRgb(run.color),
  });
}

function drawBox(
  page: PDFPage,
  box: Box,
  pageHeight: number,
  options: Parameters<PDFPage["drawRectangle"]>[0],
) {
  page.drawRectangle({
    ...options,
    x: box.x,
    y: pageHeight - box.y - box.h,
    width: box.w,
    height: box.h,
  });
}

/**
 * Places an image inside its slot.
 *
 * "fill" scales the photo to cover the slot and crops the overflow, so every
 * card carries an identically shaped portrait - the thing that makes a
 * directory page look tidy when the photos arrive at a dozen different sizes.
 * "fit" shows the whole photo, letterboxed.
 *
 * The crop is a real PDF clipping path pushed around the draw, rather than
 * painting over the spill, because a wide landscape photo can overflow far
 * enough to cover the text beside it.
 */
function drawPhoto(page: PDFPage, slot: PhotoSlot, image: PDFImage, pageHeight: number): void {
  const { box, fit } = slot;
  const scale =
    fit === "fill"
      ? Math.max(box.w / image.width, box.h / image.height)
      : Math.min(box.w / image.width, box.h / image.height);

  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const slotBottom = pageHeight - box.y - box.h;
  const offsetX = box.x + (box.w - drawWidth) / 2;
  const offsetY = slotBottom + (box.h - drawHeight) / 2;

  if (fit === "fill") {
    page.pushOperators(
      pushGraphicsState(),
      moveTo(box.x, slotBottom),
      lineTo(box.x + box.w, slotBottom),
      lineTo(box.x + box.w, slotBottom + box.h),
      lineTo(box.x, slotBottom + box.h),
      closePath(),
      clip(),
      endPath(),
    );
  }

  page.drawImage(image, { x: offsetX, y: offsetY, width: drawWidth, height: drawHeight });

  if (fit === "fill") {
    page.pushOperators(popGraphicsState());
  }
}

function drawPlaceholder(
  page: PDFPage,
  slot: PhotoSlot,
  fonts: Record<FontWeight, PDFFont>,
  pageHeight: number,
): void {
  drawBox(page, slot.box, pageHeight, { color: hexToRgb(COLORS.placeholder) });
  const size = Math.min(slot.box.w, slot.box.h) * 0.32;
  const font = fonts.bold;
  const text = toWinAnsi(slot.initials || "?");
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: slot.box.x + (slot.box.w - width) / 2,
    y: pageHeight - slot.box.y - slot.box.h / 2 - size * 0.35,
    size,
    font,
    color: hexToRgb(COLORS.soft),
  });
}

/**
 * Writes the composed book to a real PDF.
 *
 * Photos are fetched once each and embedded once each, however many cards use
 * them, which keeps a 300-family directory from ballooning.
 */
export async function renderPdf(
  book: BookModel,
  loadPhoto: PhotoLoader,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(options.title ?? book.settings.coverTitle ?? "Church Directory");
  doc.setProducer("Church Directory");
  doc.setCreator("Church Directory");

  const family = STANDARD_FONTS[book.typeface];
  const fonts: Record<FontWeight, PDFFont> = {
    regular: await doc.embedFont(family.regular),
    bold: await doc.embedFont(family.bold),
    italic: await doc.embedFont(family.italic),
  };

  const images = new Map<string, PDFImage | null>();
  const total = book.photoPaths.length + book.sheets.length;
  let done = 0;

  for (const path of book.photoPaths) {
    try {
      const bytes = await loadPhoto(path);
      if (!bytes) {
        images.set(path, null);
      } else {
        // Every upload is normalised to JPEG on the way in, but a photo added
        // straight to the bucket might not be, so try both.
        const image = isPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        images.set(path, image);
      }
    } catch {
      images.set(path, null);
    }
    done += 1;
    options.onProgress?.(done, total);
  }

  for (const sheet of book.sheets) {
    const page = doc.addPage([book.width, book.height]);
    const h = book.height;

    if (options.showFoldGuides) {
      for (const x of sheet.foldX) {
        page.drawLine({
          start: { x, y: 14 },
          end: { x, y: h - 14 },
          thickness: 0.4,
          color: hexToRgb(COLORS.rule),
          dashArray: [3, 4],
        });
      }
    }

    for (const bookPage of sheet.pages) {
      for (const rule of bookPage.rules) {
        page.drawLine({
          start: { x: rule.x, y: h - rule.y },
          end: { x: rule.x + rule.w, y: h - rule.y },
          thickness: 0.5,
          color: hexToRgb(rule.color),
        });
      }

      for (const fill of bookPage.fills) {
        page.drawRectangle({
          x: fill.x,
          y: h - fill.y - fill.h,
          width: fill.w,
          height: fill.h,
          color: fill.color ? hexToRgb(fill.color) : undefined,
          borderColor: fill.borderColor ? hexToRgb(fill.borderColor) : undefined,
          borderWidth: fill.borderColor ? 0.5 : undefined,
        });
      }

      for (const card of bookPage.cards) {
        if (card.style === "box") {
          drawBox(page, card.box, h, {
            borderColor: hexToRgb(COLORS.border),
            borderWidth: 0.5,
          });
        }
        for (const rule of card.rules) {
          page.drawLine({
            start: { x: rule.x, y: h - rule.y },
            end: { x: rule.x + rule.w, y: h - rule.y },
            thickness: 0.5,
            color: hexToRgb(rule.color),
          });
        }
        if (card.photo) {
          const image = card.photo.path ? images.get(card.photo.path) : null;
          if (image) drawPhoto(page, card.photo, image, h);
          else drawPlaceholder(page, card.photo, fonts, h);
          // A hairline so a pale portrait does not float on white paper.
          drawBox(page, card.photo.box, h, {
            borderColor: hexToRgb(COLORS.photoEdge),
            borderWidth: 0.4,
          });
        }
        for (const run of card.runs) drawRun(page, run, fonts, h);
      }

      for (const run of bookPage.runs) drawRun(page, run, fonts, h);
    }

    done += 1;
    options.onProgress?.(done, total);
  }

  return doc.save();
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

/** Metrics backed by a fresh document - used by tests and scripts. */
export async function pdfMetrics(typeface: Typeface = "sans"): Promise<Metrics> {
  const doc = await PDFDocument.create();
  const family = STANDARD_FONTS[typeface];
  return makeMetrics({
    regular: await doc.embedFont(family.regular),
    bold: await doc.embedFont(family.bold),
    italic: await doc.embedFont(family.italic),
  });
}
