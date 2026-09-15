import { firstName } from "../format";
import { COLORS, type BookModel, type BookPage, type CardModel, type SheetModel } from "./compose";
import type { DirectoryEntry } from "../entries";
import { truncate, wrapText, type FontWeight, type Metrics } from "./metrics";
import {
  PAGE_SIZES,
  TAG_HEADING_SHARES,
  TAG_NAME_SIZES,
  TAG_SIZES,
  type ProjectSettings,
  type TagLogoSize,
  type Typeface,
} from "./settings";

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
 *
 * Everything about how one tag looks is worked out in planTag below, off the
 * rectangle and the settings and nothing else. placeTag then draws that plan at
 * a position. Two callers want this: the sheet, and the single tag drawn beside
 * the settings while somebody is changing them - and they draw the same tag
 * because they are the same two functions, not because two pieces of code were
 * kept in step.
 */

/** 0.25in. About as near the paper's edge as a desk printer will go. */
const MARGIN = 18;

/** The mark, as a share of the tag's height. */
const LOGO_SHARE: Record<TagLogoSize, number> = {
  none: 0,
  small: 0.14,
  medium: 0.19,
  large: 0.25,
};

/** However big the mark is asked to be, the head never takes this much tag. */
const HEAD_MAX_SHARE = 0.32;

/**
 * The name, in points.
 *
 * The ceiling is a share of the tag so a 4x3 badge sets a short name larger
 * than an Avery 5395 can, and the floor is where shrinking stops and the name
 * breaks instead. Nine is about as small as a name tag is worth printing.
 *
 * The ceiling is the largest this app will set a name, not the size it sets:
 * tagNameSize takes a share of it, and every name is fitted under whatever that
 * comes to. The floor is not for lowering - a tag nobody can read across a
 * table is not a smaller tag, it is a wasted one.
 */
const NAME_MAX_SHARE = 0.22;
const NAME_MAX = 44;
const NAME_MIN = 9;

/**
 * One tag's furniture, in points from its own top-left corner.
 *
 * Worked out once per sheet rather than once per person: every tag on the sheet
 * is the same rectangle carrying the same church name, so only the name in the
 * middle differs, and eight hundred tags would otherwise measure the same
 * heading eight hundred times.
 */
interface TagPlan {
  width: number;
  height: number;
  pad: number;
  /** The side of the square the mark is drawn in. 0 when there is none. */
  logo: number;
  /** Top of the head band, and its height. 0 when nothing is above the name. */
  headTop: number;
  headHeight: number;
  /** The filled band, when the style has one. */
  banner: { x: number; y: number; w: number; h: number } | null;
  /** The hairline under the head, when the style has one. */
  rule: number | null;
  church: { size: number; text: string; color: string } | null;
  tagline: { size: number; text: string; color: string } | null;
  /** The band the name is set in - everything between the head and the foot. */
  nameTop: number;
  nameBottom: number;
  nameMax: number;
}

export function planTag(settings: ProjectSettings, metrics: Metrics): TagPlan {
  const tag = TAG_SIZES[settings.tagSize];
  const width = tag.w;
  const height = tag.h;

  // Inside the tag's own edge, so nothing sits under the holder's lip. Scaled,
  // because 13pt is a comfortable margin on a 4x3 badge and a tenth of the
  // width of an Avery 5395.
  const pad = clamp(Math.min(width, height) * 0.062, 9, 16);

  const smallFace = settings.tagSmallFont;
  const inner = width - 2 * pad;
  const hasHead = settings.tagStyle !== "plain";
  const logoPath = settings.coverLogoPath.trim();
  const accent = settings.tagAccent;

  const logo =
    hasHead && logoPath ? Math.min(LOGO_SHARE[settings.tagLogoSize] * height, height * 0.3) : 0;

  // On a band, the church's name is reversed out of the colour; on paper it is
  // printed in it, darkened if the colour is too pale to read small.
  const banner = hasHead && settings.tagStyle === "banner";
  const churchColor = banner ? readableOn(accent) : COLORS.strong;
  const church =
    hasHead && settings.churchName.trim()
      ? fitOneLine(
          settings.churchName.trim(),
          // Beside a mark the church's name has what is left of the width; on
          // its own it has all of it.
          inner - (logo ? logo + pad * 0.6 : 0),
          clamp(width * TAG_HEADING_SHARES[settings.tagHeadingSize], 8, 22),
          6.5,
          "bold",
          smallFace,
          metrics,
        )
      : null;

  const headHeight = Math.min(
    Math.max(logo, church ? metrics.lineHeight(church.size) : 0),
    height * HEAD_MAX_SHARE,
  );

  // Bold, like the line on every printed badge this was measured against: at
  // seven or eight point in a colour, regular weight goes thin enough on a
  // laser printer to read as a smudge rather than as words.
  const tagline = settings.tagLine.trim()
    ? fitOneLine(
        settings.tagLine.trim(),
        inner,
        clamp(width * 0.03, 6.5, 10),
        5.5,
        "bold",
        smallFace,
        metrics,
      )
    : null;

  // The band is inset rather than run to the paper's edge. These are cut apart
  // with scissors, and a cut that wanders by a millimetre leaves a stripe of
  // somebody else's colour along the top of the tag below it; inset, the same
  // wandering cut only takes white.
  const bleed = pad * 0.4;
  const bandHeight = headHeight ? headHeight + pad * 1.1 : 0;

  const headTop = headHeight ? (banner ? bleed + pad * 0.55 : pad) : 0;
  const headBottom = headHeight ? headTop + headHeight : 0;

  const nameTop = headHeight
    ? banner
      ? bleed + bandHeight + pad * 0.7
      : headBottom + pad * 0.75
    : pad;
  const nameBottom = height - pad - (tagline ? metrics.lineHeight(tagline.size) + pad * 0.35 : 0);

  return {
    width,
    height,
    pad,
    logo,
    headTop,
    headHeight,
    banner:
      banner && headHeight ? { x: bleed, y: bleed, w: width - 2 * bleed, h: bandHeight } : null,
    // Asked for, and only where there is something above it to underline. Never
    // under a band - the band is already the line.
    rule: headHeight && !banner && settings.tagHeadRule ? headBottom + pad * 0.42 : null,
    church: church ? { ...church, color: churchColor } : null,
    tagline: tagline ? { ...tagline, color: inkOn(accent, COLORS.paper) } : null,
    nameTop,
    nameBottom,
    // To the hundredth of a point, which is finer than any printer resolves and
    // stops a share of a share of a rectangle writing 25.129209600000003 into
    // the font size of every tag on the sheet.
    //
    // Never under the floor the fitting stops at: below it fitName's loop would
    // not run at all and the fallback would set the name larger than the
    // ceiling that was asked for, which is the one direction this must not
    // fail in.
    nameMax: Math.max(
      NAME_MIN,
      round2(
        Math.min(NAME_MAX, height * NAME_MAX_SHARE) * TAG_NAME_SIZES[settings.tagNameSize].share,
      ),
    ),
  };
}

/**
 * Draws one tag at (x, y), adding to the page it is given.
 *
 * The mark goes in the page's own picture list rather than on the card, because
 * renderPdf draws a hairline round a card's photograph - right for a portrait,
 * wrong for a logo.
 */
function placeTag(
  page: BookPage,
  plan: TagPlan,
  x: number,
  y: number,
  person: { id: string; name: string },
  settings: ProjectSettings,
  metrics: Metrics,
): void {
  const { pad, width, height } = plan;
  const inner = width - 2 * pad;
  const logoPath = settings.coverLogoPath.trim();
  const nameFace = settings.tagNameFont;
  const smallFace = settings.tagSmallFont;

  // The scissor line. Pale enough to disappear inside a holder, dark enough to
  // follow.
  page.fills.push({
    x,
    y,
    w: width,
    h: height,
    color: null,
    borderColor: COLORS.rule,
  });

  if (plan.banner) {
    page.fills.push({
      x: x + plan.banner.x,
      y: y + plan.banner.y,
      w: plan.banner.w,
      h: plan.banner.h,
      color: settings.tagAccent,
    });
  }

  const card: CardModel = {
    entryId: person.id,
    entryType: "person",
    box: { x, y, w: width, h: height },
    style: "none",
    photo: null,
    runs: [],
    rules: [],
  };

  if (plan.logo && logoPath) {
    const box = {
      x: x + pad,
      y: y + plan.headTop + (plan.headHeight - plan.logo) / 2,
      w: plan.logo,
      h: plan.logo,
    };
    // A white tile under the mark on a coloured band: most church logos are a
    // JPEG with a white background, and a white rectangle sitting on the colour
    // reads as a mistake unless it is plainly on purpose.
    if (plan.banner) {
      const chip = 2;
      page.fills.push({
        x: box.x - chip,
        y: box.y - chip,
        w: box.w + 2 * chip,
        h: box.h + 2 * chip,
        color: COLORS.paper,
      });
    }
    page.photos.push({ box, path: logoPath, fit: "fit", initials: "" });
  }

  if (plan.church) {
    const left = x + pad + (plan.logo ? plan.logo + pad * 0.6 : 0);
    card.runs.push({
      x: left,
      y: y + plan.headTop + (plan.headHeight - metrics.lineHeight(plan.church.size)) / 2,
      w: x + width - pad - left,
      size: plan.church.size,
      weight: "bold",
      color: plan.church.color,
      // Beside a mark it sits against the far edge, as it does on a letterhead;
      // with no mark to balance, the middle of the tag is the only place for it.
      align: plan.logo ? "right" : "center",
      text: plan.church.text,
      face: smallFace,
    });
  }

  if (plan.rule !== null) {
    card.rules.push({
      x: x + pad,
      y: y + plan.rule,
      w: inner,
      color: settings.tagAccent,
    });
  }

  // The only part of the tag anybody reads across a room.
  const fitted = fitName(
    person.name,
    inner,
    plan.nameBottom - plan.nameTop,
    plan.nameMax,
    nameFace,
    metrics,
  );
  const nameHeight = fitted.lines.length * metrics.lineHeight(fitted.size);
  let lineY = y + plan.nameTop + (plan.nameBottom - plan.nameTop - nameHeight) / 2;

  for (const line of fitted.lines) {
    card.runs.push({
      x: x + pad,
      y: lineY,
      w: inner,
      size: fitted.size,
      weight: "bold",
      color: COLORS.ink,
      align: "center",
      text: line,
      face: nameFace,
    });
    lineY += metrics.lineHeight(fitted.size);
  }

  if (plan.tagline) {
    card.runs.push({
      x: x + pad,
      y: y + height - pad - metrics.lineHeight(plan.tagline.size),
      w: inner,
      size: plan.tagline.size,
      weight: "bold",
      color: plan.tagline.color,
      align: "center",
      text: plan.tagline.text,
      face: smallFace,
    });
  }

  page.cards.push(card);
}

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
  maxSize: number,
  face: Typeface,
  metrics: Metrics,
): { size: number; lines: string[] } {
  for (let size = maxSize; size >= NAME_MIN; size -= 0.5) {
    const lines = wrapText(name, maxWidth, size, "bold", metrics, face);
    if (lines.length > 2) continue;
    if (lines.length * metrics.lineHeight(size) <= maxHeight) return { size, lines };
  }
  return {
    size: NAME_MIN,
    lines: [truncate(name, maxWidth, NAME_MIN, "bold", metrics, face)],
  };
}

/**
 * Small print, shrunk to fit on one line rather than cut short.
 *
 * "We are a Christ-centered Acts 1:8 Family" is forty characters across a tag
 * two and a third inches wide. An ellipsis in the middle of a congregation's
 * own words is worse than half a point smaller, so it shrinks first and is only
 * cut when it has run out of shrinking.
 */
function fitOneLine(
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight: FontWeight,
  face: Typeface,
  metrics: Metrics,
): { size: number; text: string } {
  for (let size = maxSize; size >= minSize; size -= 0.25) {
    if (metrics.widthOf(text, size, weight, face) <= maxWidth) return { size, text };
  }
  return { size: minSize, text: truncate(text, maxWidth, minSize, weight, metrics, face) };
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
  const plan = planTag(settings, metrics);
  const logo = plan.logo ? settings.coverLogoPath.trim() : "";

  const sheets: SheetModel[] = [];

  for (let start = 0; start < people.length; start += perSheet) {
    const slice = people.slice(start, start + perSheet);
    const page = blankSheet(sheets.length + 1, width, height);

    slice.forEach((person, index) => {
      placeTag(
        page,
        plan,
        originX + (index % columns) * tag.w,
        originY + Math.floor(index / columns) * tag.h,
        { id: person.id, name: `${firstName(person)} ${person.last_name}`.trim() },
        settings,
        metrics,
      );
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
    typeface: settings.tagNameFont,
  };
}

/**
 * One tag on its own, at its own size.
 *
 * For the settings screen, where the question is only ever "what does this look
 * like" and a whole sheet of the same tag answers it eight times over. It is
 * the same plan and the same drawing the sheet uses, so it is a proof of the
 * print rather than an impression of one.
 */
export function composeTagPreview(
  settings: ProjectSettings,
  metrics: Metrics,
  name: string,
): {
  page: BookPage;
  width: number;
  height: number;
  photoPaths: string[];
  typeface: Typeface;
} {
  const plan = planTag(settings, metrics);
  const page = blankSheet(1, plan.width, plan.height);
  placeTag(page, plan, 0, 0, { id: "preview", name }, settings, metrics);

  return {
    page,
    width: plan.width,
    height: plan.height,
    photoPaths: [...new Set(page.photos.map((slot) => slot.path).filter((p): p is string => !!p))],
    typeface: settings.tagNameFont,
  };
}

function blankSheet(number: number, width: number, height: number): BookPage {
  return {
    kind: "records",
    number,
    box: { x: 0, y: 0, w: width, h: height },
    cards: [],
    runs: [],
    rules: [],
    fills: [],
    photos: [],
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

// ---------------------------------------------------------------------------
// Colour
//
// The accent is the one thing here a person picks by eye, on a phone, from a
// colour wheel - so it is the one thing that can be picked badly. Neither of
// these asks whether the choice was wise; they only make sure the words on top
// of it can still be read.
// ---------------------------------------------------------------------------

/** Relative luminance, the WCAG one. */
export function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.replace(/./g, "$&$&") : raw;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const value = parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two colours, either way round. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * White or ink, whichever can be read on a band of this colour.
 *
 * The better of two, which is not the same as a good one: a mid grey is too
 * dark for white and too light for ink, and no choice made here fixes that -
 * only a different band colour does. So the settings screen says so, against
 * this same arithmetic, while the colour is being picked.
 */
export function readableOn(background: string): string {
  return contrastRatio(COLORS.paper, background) >= contrastRatio(COLORS.ink, background)
    ? COLORS.paper
    : COLORS.ink;
}

/** What the church's name on a band of this colour would come to. */
export function bandContrast(accent: string): number {
  return contrastRatio(readableOn(accent), accent);
}

/**
 * The accent, dark enough to set small text in on the paper.
 *
 * A pale mint picked off a colour wheel looks right on the band, where it is a
 * field of colour with white on top, and is close to invisible as a seven point
 * line under a name. Rather than refuse the colour or print it unreadably, this
 * walks it towards black until it passes AA, so the band keeps exactly the
 * colour that was chosen and the small print keeps its footing.
 */
export function inkOn(accent: string, paper: string): string {
  let colour = accent;
  for (let step = 0; step < 24 && contrastRatio(colour, paper) < 4.5; step += 1) {
    colour = darken(colour, 0.88);
  }
  return colour;
}

function darken(hex: string, by: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.replace(/./g, "$&$&") : raw;
  const parts = [0, 2, 4].map((at) =>
    Math.round(parseInt(full.slice(at, at + 2), 16) * by)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
