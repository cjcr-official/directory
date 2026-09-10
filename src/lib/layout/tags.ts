import { firstName } from "../format";
import { COLORS, type BookModel, type BookPage, type CardModel, type SheetModel } from "./compose";
import type { DirectoryEntry } from "../entries";
import { truncate, wrapText, type Metrics } from "./metrics";
import { PAGE_SIZES, TAG_SIZES, type ProjectSettings } from "./settings";

/**
 * A sheet of name tags, composed into the same model the book uses.
 *
 * Everything downstream is already general: renderPdf draws sheets of cards,
 * runs and pictures without asking what they are, and BookPreview draws the
 * same model to the screen. So a name tag is a composer, not a second printing
 * pipeline - which is why this file is short and why the preview, the download
 * and the progress bar all work without being told about it.
 *
 * The book prints landscape and folds down the middle. Tags do neither: they
 * print portrait, in as many columns and rows of a fixed rectangle as the paper
 * holds, and are cut apart to go into holders. So the page size is transposed
 * rather than reused, and none of the book's geometry applies.
 */

/** 0.25in. About as near the paper's edge as a desk printer will go. */
const MARGIN = 18;

/** Inside the tag's own edge, so nothing sits under the holder's lip. */
const PAD = 13;

/** The mark at the top, and the height of the band it shares with the name. */
const LOGO = 26;

const NAME_MAX = 30;
const NAME_MIN = 9;
const CHURCH_SIZE = 9.5;
const TAGLINE_SIZE = 7.5;

/**
 * The largest the name can be printed and still fit.
 *
 * Two lines, not one: "Madison Johnston" on a 3in tag has to break somewhere,
 * and breaking it is better than shrinking every tag in the run to whatever
 * the longest name in the congregation allows. Three would leave a tag that is
 * mostly name, so at that point it shrinks instead.
 */
function fitName(
  name: string,
  maxWidth: number,
  maxHeight: number,
  metrics: Metrics,
): { size: number; lines: string[] } {
  for (let size = NAME_MAX; size >= NAME_MIN; size -= 0.5) {
    const lines = wrapText(name, maxWidth, size, "bold", metrics);
    if (lines.length > 2) continue;
    if (lines.length * metrics.lineHeight(size) <= maxHeight) return { size, lines };
  }
  return { size: NAME_MIN, lines: [truncate(name, maxWidth, NAME_MIN, "bold", metrics)] };
}

/** One per person - a household prints its members, not one tag for the family. */
function peopleOf(entries: DirectoryEntry[]) {
  return entries.flatMap((entry) =>
    entry.type === "household" ? entry.household.members : [entry.person],
  );
}

export function composeTags(
  entries: DirectoryEntry[],
  settings: ProjectSettings,
  metrics: Metrics,
): BookModel {
  // PAGE_SIZES is landscape, because that is what the book wants. Tags are the
  // other way up.
  const paper = PAGE_SIZES[settings.pageSize];
  const width = paper.height;
  const height = paper.width;

  const tag = TAG_SIZES[settings.tagSize];
  const columns = Math.max(1, Math.floor((width - 2 * MARGIN) / tag.w));
  const rows = Math.max(1, Math.floor((height - 2 * MARGIN) / tag.h));
  const perSheet = columns * rows;

  // Centred on the paper rather than pushed into a corner, so the tags are cut
  // out of the middle of the sheet and any drift at the edges is shared.
  const originX = (width - columns * tag.w) / 2;
  const originY = (height - rows * tag.h) / 2;

  const people = peopleOf(entries);
  const logo = settings.coverLogoPath.trim();
  const church = settings.churchName.trim();
  const tagline = settings.tagLine.trim();

  const sheets: SheetModel[] = [];

  for (let start = 0; start < people.length; start += perSheet) {
    const slice = people.slice(start, start + perSheet);
    const page: BookPage = {
      kind: "records",
      number: sheets.length + 1,
      box: { x: 0, y: 0, w: width, h: height },
      cards: [],
      runs: [],
      rules: [],
      fills: [],
      photos: [],
    };

    slice.forEach((person, index) => {
      const x = originX + (index % columns) * tag.w;
      const y = originY + Math.floor(index / columns) * tag.h;
      const inner = tag.w - 2 * PAD;

      // The scissor line. Pale enough to disappear inside a holder, dark enough
      // to follow.
      page.fills.push({
        x,
        y,
        w: tag.w,
        h: tag.h,
        color: null,
        borderColor: COLORS.rule,
      });

      // The mark sits in the page's own picture list rather than on the card,
      // because renderPdf draws a hairline round a card's photograph - right
      // for a portrait, wrong for a logo.
      const headLeft = logo ? x + PAD + LOGO + 8 : x + PAD;
      if (logo) {
        page.photos.push({
          box: { x: x + PAD, y: y + PAD, w: LOGO, h: LOGO },
          path: logo,
          fit: "fit",
          initials: "",
        });
      }

      const card: CardModel = {
        entryId: person.id,
        entryType: "person",
        box: { x, y, w: tag.w, h: tag.h },
        style: "none",
        photo: null,
        runs: [],
        rules: [],
      };

      if (church) {
        card.runs.push({
          x: headLeft,
          y: y + PAD + (LOGO - metrics.lineHeight(CHURCH_SIZE)) / 2,
          w: x + tag.w - PAD - headLeft,
          size: CHURCH_SIZE,
          weight: "bold",
          color: COLORS.strong,
          align: "right",
          text: church,
        });
      }

      // What is left between the head and the tagline, which is where the name
      // goes and the only part of the tag anybody reads across a room.
      const bandTop = y + PAD + LOGO + 6;
      const bandBottom = y + tag.h - PAD - (tagline ? metrics.lineHeight(TAGLINE_SIZE) + 6 : 0);
      const name = `${firstName(person)} ${person.last_name}`.trim();
      const fitted = fitName(name, inner, bandBottom - bandTop, metrics);
      const nameHeight = fitted.lines.length * metrics.lineHeight(fitted.size);
      let lineY = bandTop + (bandBottom - bandTop - nameHeight) / 2;

      for (const line of fitted.lines) {
        card.runs.push({
          x: x + PAD,
          y: lineY,
          w: inner,
          size: fitted.size,
          weight: "bold",
          color: COLORS.ink,
          align: "center",
          text: line,
        });
        lineY += metrics.lineHeight(fitted.size);
      }

      if (tagline) {
        card.runs.push({
          x: x + PAD,
          y: y + tag.h - PAD - metrics.lineHeight(TAGLINE_SIZE),
          w: inner,
          size: TAGLINE_SIZE,
          weight: "regular",
          color: COLORS.accent,
          align: "center",
          text: truncate(tagline, inner, TAGLINE_SIZE, "regular", metrics),
        });
      }

      page.cards.push(card);
    });

    sheets.push({ index: sheets.length, pages: [page], foldX: [] });
  }

  return {
    width,
    height,
    sheets,
    pageCount: sheets.length,
    recordCount: people.length,
    index: [],
    photoPaths: logo ? [logo] : [],
    settings,
    typeface: settings.typeface,
  };
}

/** How many tags one sheet of paper holds, for the line that says so on screen. */
export function tagsPerSheet(settings: ProjectSettings): number {
  const paper = PAGE_SIZES[settings.pageSize];
  const tag = TAG_SIZES[settings.tagSize];
  const columns = Math.max(1, Math.floor((paper.height - 2 * MARGIN) / tag.w));
  const rows = Math.max(1, Math.floor((paper.width - 2 * MARGIN) / tag.h));
  return columns * rows;
}
