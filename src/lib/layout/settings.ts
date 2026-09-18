import { TYPEFACES, type Typeface } from "./metrics";

export type PageSizeName = "letter" | "a4" | "legal";
export type PhotoFit = "fill" | "fit";
export type MemberStyle = "compact" | "detailed";
export type TextScale = "compact" | "normal" | "large";
/**
 * Passed along rather than written out again.
 *
 * It was declared here and in metrics.ts, a copy each, and the two had to agree
 * for the composer to hand the renderer a face it could find. Type-only, so
 * nothing about what this module costs to import changes.
 */
export type { Typeface };
/** How one record is set off from the next on the page. */
export type CardStyle = "rule" | "box" | "none";
export type TagSizeName = "badge4x3" | "badge3x4" | "avery5395";

/**
 * How a name tag is furnished above the name.
 *
 * Only the head changes: every style leaves the name the same band in the
 * middle of the tag and the same line at the foot, so switching between them
 * cannot make a name that fitted stop fitting.
 *
 *  - `classic` the logo at the left, the church's name at the right, a hairline
 *    under both.
 *  - `banner`  the same two on a band of colour across the top, reversed out.
 *  - `plain`   neither: the name has the whole tag. For holders and lanyards
 *    that already carry the church's own artwork.
 */
export type TagStyle = "classic" | "banner" | "plain";

/** How big the logo is printed, as a share of the tag's height. */
export type TagLogoSize = "none" | "small" | "medium" | "large";

/**
 * Type sizes on a tag, in points, as they are typed in.
 *
 * Every text on a tag is set in points now, because that is the unit the
 * person setting it already has: a church that has been printing its own
 * badges has them in Word, in points, and "medium" is not a size anybody can
 * compare against the thing on their desk.
 *
 * Points are a promise this app can nearly keep and not quite. The name is
 * still fitted - a size that would run a long surname off the card is stepped
 * down until it fits, because a tag that reads "Bartholomew Vanderst..." is a
 * tag nobody can use. So the number is the size when the name fits at it, and
 * the largest it will be set when it does not; the screen says which happened.
 *
 * Half a point is the smallest step, as it is in Word's own box.
 */
export const TAG_PT_MIN = 6;
export const TAG_PT_MAX = 96;

/** Word's own ladder, offered beside the box that any number can be typed into. */
export const TAG_PT_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/**
 * The parts of a cover that can be picked up and moved, in the order they
 * print down the page.
 *
 * Five of them are named for the setting they are drawn from, because that is
 * the name the composer already marks those runs with and a part is best named
 * after the thing somebody reads on the cover. The two pictures have no
 * setting of their own to be named after - theirs hold a storage path, not
 * words - so they are named for what they are.
 */
export const COVER_PARTS = [
  "coverLogo",
  "churchName",
  "coverPhoto",
  "coverTitle",
  "coverSubtitle",
  "coverStatement",
  "coverContact",
] as const;

export type CoverPart = (typeof COVER_PARTS)[number];

/** Where one part of the cover sits, against where the composer put it. */
export type CoverPlacement = {
  /** Points right and down from the composed position. */
  dx: number;
  dy: number;
  /** A multiple of the size the composer gave it. Pictures only. */
  scale: number;
};

/** Only the parts somebody has actually moved: a part missing here is where it was composed. */
export type CoverPlacements = Partial<Record<CoverPart, CoverPlacement>>;

/** A part exactly where the composer put it, which is what an absent one means. */
export const AS_COMPOSED: CoverPlacement = { dx: 0, dy: 0, scale: 1 };

/**
 * How far a picture may be taken from the size the composer gave it.
 *
 * Wide, because the composer's size is a starting point and not an opinion -
 * the photograph is drawn at whatever the stack leaves spare, which on a full
 * cover is small. The composer clamps again to the paper itself, so neither of
 * these can put a picture off the page.
 */
export const COVER_SCALE_MIN = 0.25;
export const COVER_SCALE_MAX = 4;

/**
 * Everything about how one project prints. Stored as JSON in projects.settings,
 * so adding a field here only needs a default below - no migration.
 */
export type ProjectSettings = {
  // --- sheet ---------------------------------------------------------------
  /**
   * How this directory's name tags print, when they are printed.
   *
   * A directory is a list of people and a way of laying them out; it can print
   * as a book or as a sheet of tags, off the same list either way. So these are
   * not a mode - nothing here switches the book off - they are the second set
   * of instructions, read only by the tag sheet.
   */
  tagSize: TagSizeName;
  /** The line under the name. Its own field: a book's footer says something else. */
  tagLine: string;
  /** What sits above the name, and whether it sits on a band of colour. */
  tagStyle: TagStyle;
  /**
   * The name's own family, and the small print's.
   *
   * Two fields rather than one, because a tag is the one thing this app prints
   * where mixing them is the point: a big sans-serif name reads across a hall,
   * and the church's name above it does not have to be in the same face to do
   * its job. They are also kept apart from `typeface`, which sets the book - a
   * congregation can want a serif directory and plain sans tags, and before
   * this it could not have both.
   */
  tagNameFont: Typeface;
  tagSmallFont: Typeface;
  /**
   * The three type sizes on a tag, in points.
   *
   * The name's is the size it is set at when it fits, and the largest it will
   * be set when it does not - see TAG_PT_MIN above. The other two are simply
   * the size, shrunk only to keep one line on one line.
   */
  tagNamePt: number;
  tagHeadingPt: number;
  tagLinePt: number;
  /**
   * A hairline between the heading and the name.
   *
   * Off by default. It tidies a tag that has a lot of white in the middle of
   * it, and it is one more thing on a tag that most churches print without.
   */
  tagHeadRule: boolean;
  /** The band, the hairline and the line under the name, as #rrggbb. */
  tagAccent: string;
  tagLogoSize: TagLogoSize;
  pageSize: PageSizeName;
  /** Records stacked down each half of the sheet. */
  rows: number;
  /** Halves across the sheet. Two is the fold-in-the-middle book. */
  columns: number;

  // --- who is in it --------------------------------------------------------
  /**
   * Whether a group brings in the whole family of everyone in it.
   *
   * True for the main directory, where the family is the record and tagging
   * one chorister should print the household they belong to. False for the
   * booklet that is a list of people - the deacons, the elders - where
   * printing families would print their wives and children alongside them.
   * Only groups are affected: hand-picked records are already picked one by
   * one, and "everyone" means everyone either way.
   */
  groupWholeFamily: boolean;

  // --- what goes on a card -------------------------------------------------
  showPhotos: boolean;
  photoFit: PhotoFit;
  showMembers: boolean;
  memberStyle: MemberStyle;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showBirthdays: boolean;
  showAnniversary: boolean;
  cardStyle: CardStyle;
  textScale: TextScale;
  typeface: Typeface;

  // --- book furniture ------------------------------------------------------
  churchName: string;
  coverTitle: string;
  coverSubtitle: string;
  /** The congregation's own words - a vision or welcome, in its own paragraph. */
  coverStatement: string;
  /** Where to find the church. One line per line, exactly as it should print. */
  coverContact: string;
  /**
   * Storage paths, or "" for none.
   *
   * Empty string rather than null so normalizeSettings can keep its one rule -
   * a stored value is taken when it is the same type as the default - instead
   * of growing a special case for a field whose default is typeof "object".
   */
  coverPhotoPath: string;
  coverLogoPath: string;
  /**
   * Where the parts of the cover have been dragged to, against where the
   * composer put them.
   *
   * Offsets and not positions, which is the whole of why this is safe. The
   * cover composes itself exactly as it always did - a measured stack that
   * fits itself to what is actually on it - and these are applied to the
   * finished page. So a cover nobody has touched is the cover this app has
   * always drawn; a title that grows to two lines still pushes the verse
   * down; and putting a part back is forgetting a number rather than
   * restoring a layout.
   */
  coverPlacements: CoverPlacements;
  includeCover: boolean;
  includeIndex: boolean;
  runningHeader: boolean;
  showPageNumbers: boolean;
  /** The big A / B / C letter in the corner of each half-page. */
  showLetterTabs: boolean;
  footerText: string;
  /**
   * Reorder half-pages for duplex printing, folding down the middle, and
   * stapling the spine. Off means straight reading order, which is what you
   * want for a screen PDF or a corner-stapled handout.
   */
  bookletOrder: boolean;
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  tagSize: "badge4x3",
  tagLine: "",
  tagStyle: "classic",
  // Sans on both, whatever the book is set in. A name tag is read at a glance
  // from across a room by someone who is trying to place a face, which is the
  // one job Helvetica is better at than Times.
  tagNameFont: "sans",
  tagSmallFont: "sans",
  // The sizes a 4x3 badge - the default tag - was already printing before these
  // were typed in rather than chosen from three words. A project on another tag
  // size gets its own, worked out in normalizeSettings, so nothing already
  // saved prints differently for the change.
  tagNamePt: 44,
  tagHeadingPt: 14.5,
  tagLinePt: 8.5,
  tagHeadRule: false,
  tagAccent: "#2f6d63",
  tagLogoSize: "medium",
  pageSize: "letter",
  rows: 3,
  columns: 2,

  groupWholeFamily: true,

  showPhotos: true,
  photoFit: "fill",
  showMembers: true,
  memberStyle: "compact",
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showBirthdays: false,
  showAnniversary: false,
  // A hairline between records reads as a book; a box around each one reads as
  // a form, so the rule is the default.
  cardStyle: "rule",
  textScale: "normal",
  typeface: "serif",

  churchName: "",
  coverTitle: "Church Directory",
  coverSubtitle: "",
  coverStatement: "",
  coverContact: "",
  coverPhotoPath: "",
  coverLogoPath: "",
  coverPlacements: {},
  includeCover: true,
  includeIndex: true,
  runningHeader: true,
  showPageNumbers: true,
  showLetterTabs: true,
  footerText: "",
  bookletOrder: false,
};

/** Merges stored JSON over the defaults, dropping anything unrecognised. */
export function normalizeSettings(raw: unknown): ProjectSettings {
  const input = (raw ?? {}) as Partial<ProjectSettings>;
  const merged: ProjectSettings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ProjectSettings)[]) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  // Projects saved before the card style became a three-way choice carry a
  // boolean instead.
  if (input.cardStyle === undefined && "cardBorders" in (input as object)) {
    merged.cardStyle = (input as { cardBorders?: unknown }).cardBorders ? "box" : "none";
  }

  // The one field that is not a string, a number or a flag, and so the one the
  // rule above cannot check: `typeof` says "object" of anything at all,
  // including an array and including a map of parts that do not exist.
  merged.coverPlacements = normalizePlacements(input.coverPlacements);

  // Guard rails: the layout maths assumes at least one card per half.
  merged.rows = clamp(Math.round(merged.rows), 1, 8);
  merged.columns = clamp(Math.round(merged.columns), 1, 3);
  if (!["badge4x3", "badge3x4", "avery5395"].includes(merged.tagSize)) merged.tagSize = "badge4x3";
  if (!["classic", "banner", "plain"].includes(merged.tagStyle)) merged.tagStyle = "classic";
  if (!TYPEFACES.includes(merged.tagNameFont)) merged.tagNameFont = DEFAULT_SETTINGS.tagNameFont;
  if (!TYPEFACES.includes(merged.tagSmallFont)) merged.tagSmallFont = DEFAULT_SETTINGS.tagSmallFont;
  if (!["none", "small", "medium", "large"].includes(merged.tagLogoSize))
    merged.tagLogoSize = "medium";
  // The three type sizes, in points.
  //
  // A project saved before they were points carries the words they used to be
  // chosen from, or nothing at all, and both have to come back as the size that
  // project was actually printing - which depended on its tag, since the words
  // were shares of the rectangle. So the old arithmetic is kept below, frozen,
  // and used only for reading those projects once.
  const tag = TAG_SIZES[merged.tagSize];
  const asked = input as Record<string, unknown>;

  if (!given(asked.tagNamePt)) {
    const was = LEGACY_NAME_SHARES[String(asked.tagNameSize)] ?? 1;
    merged.tagNamePt = Math.min(LEGACY_NAME_MAX, tag.h * LEGACY_NAME_SHARE) * was;
  }
  if (!given(asked.tagHeadingPt)) {
    const was = LEGACY_HEADING_SHARES[String(asked.tagHeadingSize)] ?? LEGACY_HEADING_SHARES.medium;
    merged.tagHeadingPt = clamp(tag.w * was, 8, 22);
  }
  if (!given(asked.tagLinePt)) merged.tagLinePt = clamp(tag.w * LEGACY_LINE_SHARE, 6.5, 10);

  merged.tagNamePt = toHalfPoint(merged.tagNamePt);
  merged.tagHeadingPt = toHalfPoint(merged.tagHeadingPt);
  merged.tagLinePt = toHalfPoint(merged.tagLinePt);
  merged.tagAccent = normalizeHex(merged.tagAccent, DEFAULT_SETTINGS.tagAccent);
  if (!["letter", "a4", "legal"].includes(merged.pageSize)) merged.pageSize = "letter";
  if (!["fill", "fit"].includes(merged.photoFit)) merged.photoFit = "fill";
  if (!["compact", "detailed"].includes(merged.memberStyle)) merged.memberStyle = "compact";
  if (!["compact", "normal", "large"].includes(merged.textScale)) merged.textScale = "normal";
  if (!["rule", "box", "none"].includes(merged.cardStyle)) merged.cardStyle = "rule";
  if (!TYPEFACES.includes(merged.typeface)) merged.typeface = "serif";

  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** A number somebody actually stored, as opposed to one this file supplied. */
function given(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * To the nearest half point, and inside what a tag can carry.
 *
 * Half points because that is the step Word's own box takes and the step the
 * name is fitted in, so a size typed here is a size that can actually be
 * arrived at. It also keeps a share of a rectangle from writing 14.399999 into
 * a field somebody is about to read.
 */
function toHalfPoint(value: number): number {
  if (!Number.isFinite(value)) return TAG_PT_MIN;
  return clamp(Math.round(value * 2) / 2, TAG_PT_MIN, TAG_PT_MAX);
}

/*
 * What the tag composer worked these out as, before they were typed in.
 *
 * Frozen on purpose: this is not how anything prints now, it is only how a
 * project saved under the old settings is read once, so it must go on saying
 * what that code said rather than following what tags.ts does next.
 */
const LEGACY_NAME_MAX = 44;
const LEGACY_NAME_SHARE = 0.22;
const LEGACY_LINE_SHARE = 0.03;
const LEGACY_NAME_SHARES: Record<string, number> = { fit: 1, smaller: 0.82, smallest: 0.68 };
const LEGACY_HEADING_SHARES: Record<string, number> = {
  small: 0.037,
  medium: 0.05,
  large: 0.063,
};

/**
 * One part of the cover, moved or resized from where it is drawn now.
 *
 * Every drag, nudge and resize goes through here, and all of them are
 * relative: the pointer says how far it has come since it last said so, and
 * that is added to where the part currently is. `drawn` is what the composer
 * reports having actually used, which is not always what is stored - it keeps
 * everything on the paper - and preferring it is what makes a drag at the edge
 * behave. The part stops at the edge, so the edge is what the next movement is
 * added to, and turning round brings it straight back instead of first winding
 * off the distance the pointer went past it.
 *
 * A part that comes back to exactly where it was composed is forgotten rather
 * than written down as three zeroes, which is the rule normalizePlacements
 * keeps as well, and is what lets "has anything been moved on this cover" be a
 * question about the saved settings.
 */
export function placeCoverPart(
  stored: CoverPlacements,
  drawn: CoverPlacements,
  part: CoverPart,
  change: (from: CoverPlacement) => CoverPlacement,
): CoverPlacements {
  const next = change(drawn[part] ?? stored[part] ?? AS_COMPOSED);
  const placed: CoverPlacements = { ...stored };
  // Two decimal places is a hundredth of a point - well under a pixel on any
  // screen this is dragged on, and it keeps the stored JSON from filling up
  // with the tail ends of floats.
  const tidy: CoverPlacement = {
    dx: round(clamp(next.dx, -COVER_TRAVEL, COVER_TRAVEL), 2),
    dy: round(clamp(next.dy, -COVER_TRAVEL, COVER_TRAVEL), 2),
    scale: round(clamp(next.scale, COVER_SCALE_MIN, COVER_SCALE_MAX), 4),
  };

  if (tidy.dx === 0 && tidy.dy === 0 && tidy.scale === 1) delete placed[part];
  else placed[part] = tidy;
  return placed;
}

function round(value: number, places: number): number {
  const step = 10 ** places;
  return Math.round(value * step) / step;
}

/**
 * The placements, read back as something the composer can be handed.
 *
 * Rebuilt a part at a time rather than taken as it stands: this is the one
 * setting whose stored value is an object, so it is the one that can arrive as
 * an array, as a map of parts that no longer exist, or with a NaN in it - and
 * a NaN reaching the composer would take a line of type off the page and print
 * it nowhere.
 *
 * A part sitting exactly where it was composed is dropped rather than stored
 * as three zeroes, so "never moved" and "moved and put back" are the same
 * state, and the cover of a directory nobody has dragged anything on carries
 * nothing at all.
 */
function normalizePlacements(raw: unknown): CoverPlacements {
  if (!raw || typeof raw !== "object") return {};
  const stored = raw as Record<string, unknown>;
  const out: CoverPlacements = {};

  for (const part of COVER_PARTS) {
    const one = stored[part];
    if (!one || typeof one !== "object") continue;
    const { dx, dy, scale } = one as Record<string, unknown>;
    const placement: CoverPlacement = {
      // Points, and a cover is at most 1008 of them wide. The composer clamps
      // to the paper itself, so this is only a floor and a ceiling on what can
      // be written down at all.
      dx: clamp(given(dx) ? dx : 0, -COVER_TRAVEL, COVER_TRAVEL),
      dy: clamp(given(dy) ? dy : 0, -COVER_TRAVEL, COVER_TRAVEL),
      scale: clamp(given(scale) ? scale : 1, COVER_SCALE_MIN, COVER_SCALE_MAX),
    };
    if (placement.dx === 0 && placement.dy === 0 && placement.scale === 1) continue;
    out[part] = placement;
  }

  return out;
}

/** Further than the longest paper this app prints on, in points. */
const COVER_TRAVEL = 1200;

/**
 * A colour the renderers can actually draw with.
 *
 * Both of them parse #rrggbb by hand, so anything else - a colour name, a
 * half-typed "#2f6", the empty string a cleared input leaves behind - would
 * reach pdf-lib as NaN and paint the band black. Three-digit hex is expanded
 * rather than refused, since that is what a person types.
 */
function normalizeHex(value: string, fallback: string): string {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.replace(/./g, "$&$&").toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

/** Landscape dimensions in PDF points (72 per inch). */
export const PAGE_SIZES: Record<PageSizeName, { width: number; height: number; label: string }> = {
  letter: { width: 792, height: 612, label: 'Letter (11" x 8.5")' },
  legal: { width: 1008, height: 612, label: 'Legal (14" x 8.5")' },
  a4: { width: 841.89, height: 595.28, label: "A4 (297mm x 210mm)" },
};

/**
 * The paper's name without its dimensions - "Letter", not `Letter (11" x 8.5")`.
 *
 * For the one-line summaries, where the inches are the least useful thing on
 * the line and the longest. It was three different spellings of the same
 * answer before this: a regexp on the tag form, and a pair of nested ternaries
 * on the list, which is one place per screen for "Legal" to be forgotten.
 */
export function paperName(size: PageSizeName): string {
  return PAGE_SIZES[size].label.replace(/\s*\(.*\)$/, "");
}

/**
 * The rectangles a name tag is cut to, in PDF points.
 *
 * Named for the holder rather than the paper: whoever is printing these has
 * a box of pouches on the desk and needs the one that fits them, not a page
 * fraction. How many fit on a sheet is not written here - tagsPerSheet works it
 * out, so the number on screen cannot drift from the number that prints.
 */
export const TAG_SIZES: Record<TagSizeName, { w: number; h: number; label: string }> = {
  badge4x3: { w: 4 * 72, h: 3 * 72, label: '4" x 3" landscape' },
  badge3x4: { w: 3 * 72, h: 4 * 72, label: '3" x 4" portrait' },
  avery5395: { w: 3.375 * 72, h: 2.333 * 72, label: 'Avery 5395 (3⅜" x 2⅓")' },
};

/** The styles, as they are offered on screen. */
export const TAG_STYLES: Record<TagStyle, { label: string; hint: string }> = {
  classic: { label: "Classic", hint: "Logo left, church name right, on the paper." },
  banner: { label: "Banner", hint: "The same on a coloured band, reversed out." },
  plain: { label: "Name only", hint: "No logo, no church name." },
};

/**
 * A few colours to hand, so nobody has to fight a colour wheel on a phone.
 *
 * Any colour at all can be typed or picked; these are only the ones a church
 * badge is usually printed in, and the first is the app's own green so that the
 * default is on the list rather than being the one swatch missing from it.
 */
export const TAG_ACCENTS: { label: string; value: string }[] = [
  { label: "Green", value: "#2f6d63" },
  { label: "Maroon", value: "#7b2430" },
  { label: "Navy", value: "#26405e" },
  { label: "Plum", value: "#5a3a63" },
  { label: "Charcoal", value: "#333c3b" },
];

export const TEXT_SCALES: Record<TextScale, number> = {
  compact: 0.9,
  normal: 1,
  large: 1.12,
};

/** Records per sheet, the number people actually ask about. */
export function recordsPerSheet(settings: ProjectSettings): number {
  return settings.rows * settings.columns;
}
