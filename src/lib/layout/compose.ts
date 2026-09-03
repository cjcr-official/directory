import type { DirectoryEntry } from "../entries";
import type { PersonRow } from "../database.types";
import {
  addressLines,
  alphaBucket,
  effectiveAddress,
  fileAsName,
  firstName,
  formatMonthDay,
  formatPhone,
  formatShortDate,
  fullName,
  join,
} from "../format";
import {
  PAGE_SIZES,
  TEXT_SCALES,
  type CardStyle,
  type PhotoFit,
  type ProjectSettings,
  type Typeface,
} from "./settings";
import { truncate, wrapText, type FontWeight, type Metrics } from "./metrics";

// ---------------------------------------------------------------------------
// Model
//
// Coordinates are PDF points with a TOP-LEFT origin, matching CSS. The PDF
// writer flips y at the last moment; the HTML preview uses them as-is. Keeping
// one coordinate system is what lets both renderers share this file.
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Align = "left" | "center" | "right";

export interface TextRun {
  x: number;
  /** Top of the line box. */
  y: number;
  /** Width of the box the run is aligned within. */
  w: number;
  size: number;
  weight: FontWeight;
  color: string;
  align: Align;
  text: string;
}

export interface PhotoSlot {
  box: Box;
  path: string | null;
  fit: PhotoFit;
  /** Drawn in a soft placeholder when there is no photograph yet. */
  initials: string;
}

export interface CardModel {
  entryId: string;
  entryType: "household" | "person";
  box: Box;
  style: CardStyle;
  photo: PhotoSlot | null;
  runs: TextRun[];
  /** The hairline separating this record from the next, when style is "rule". */
  rules: RuleModel[];
}

export interface RuleModel {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** A filled rectangle: the letter tab, and the frame around a photograph. */
export interface FillModel {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
  borderColor?: string;
  radius?: number;
}

/** One page of the finished book - a half of a landscape sheet. */
export interface BookPage {
  kind: "cover" | "records" | "index" | "blank";
  /** 1-based page number as printed. Blank filler pages carry 0. */
  number: number;
  box: Box;
  cards: CardModel[];
  runs: TextRun[];
  rules: RuleModel[];
  fills: FillModel[];
  /** Pictures belonging to the page rather than to any card - the cover's. */
  photos: PhotoSlot[];
}

/** One sheet of paper. */
export interface SheetModel {
  index: number;
  pages: BookPage[];
  /** The fold line, drawn faintly as a trim guide. */
  foldX: number[];
}

export interface IndexRecord {
  name: string;
  page: number;
}

export interface BookModel {
  width: number;
  height: number;
  sheets: SheetModel[];
  /** Numbered pages, excluding blank filler. */
  pageCount: number;
  recordCount: number;
  index: IndexRecord[];
  /** Storage paths of every photo the book needs, deduplicated. */
  photoPaths: string[];
  settings: ProjectSettings;
  typeface: Typeface;
}

export const COLORS = {
  ink: "#14201f",
  strong: "#0f1a19",
  muted: "#4a5a58",
  soft: "#758583",
  accent: "#2f6d63",
  rule: "#d5dedd",
  border: "#c8d4d2",
  placeholder: "#e6ecea",
  /** The photo hairline: enough to stop a pale portrait floating on the page. */
  photoEdge: "#cfd9d7",
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Geometry {
  width: number;
  height: number;
  margin: number;
  gutter: number;
  pageWidth: number;
  pageHeight: number;
  headerHeight: number;
  footerHeight: number;
  cardGap: number;
  cardHeight: number;
  contentTop: number;
  contentHeight: number;
  columns: number;
  rows: number;
}

const MARGIN = 28.8; // 0.4in
const GUTTER = 36; // 0.5in fold channel
const CARD_GAP = 8;

export function computeGeometry(settings: ProjectSettings): Geometry {
  const { width, height } = PAGE_SIZES[settings.pageSize];
  const columns = settings.columns;
  const rows = settings.rows;
  const gutter = columns > 1 ? GUTTER : 0;

  const pageWidth = (width - 2 * MARGIN - gutter * (columns - 1)) / columns;
  const pageHeight = height - 2 * MARGIN;

  const headerHeight = settings.runningHeader || settings.showLetterTabs ? 18 : 0;
  const footerHeight = settings.showPageNumbers || settings.footerText.trim() ? 15 : 0;

  const contentTop = headerHeight;
  const contentHeight = pageHeight - headerHeight - footerHeight;
  const cardHeight = (contentHeight - CARD_GAP * (rows - 1)) / rows;

  return {
    width,
    height,
    margin: MARGIN,
    gutter,
    pageWidth,
    pageHeight,
    headerHeight,
    footerHeight,
    cardGap: CARD_GAP,
    cardHeight,
    contentTop,
    contentHeight,
    columns,
    rows,
  };
}

interface TypeScale {
  title: number;
  body: number;
  small: number;
  tiny: number;
  cover: number;
}

function typeScale(settings: ProjectSettings): TypeScale {
  const s = TEXT_SCALES[settings.textScale];
  return {
    title: 12 * s,
    body: 9.4 * s,
    small: 8.6 * s,
    tiny: 7.8 * s,
    cover: 30,
  };
}

// ---------------------------------------------------------------------------
// Card content
// ---------------------------------------------------------------------------

interface Block {
  text: string;
  size: number;
  weight: FontWeight;
  color: string;
  /** Extra leading above this block, in points. */
  spaceBefore: number;
  /** Blocks that must never be dropped when a card runs out of room. */
  essential?: boolean;
}

function initialsFor(entry: DirectoryEntry): string {
  if (entry.type === "person") {
    return `${entry.person.first_name.charAt(0)}${entry.person.last_name.charAt(0)}`.toUpperCase();
  }
  return entry.household.sort_name.slice(0, 2).toUpperCase();
}

/** A member's name on the card - surname included only when it differs. */
function memberLabel(person: PersonRow, householdSurname: string): string {
  const given = firstName(person);
  return person.last_name.toLowerCase() === householdSurname.toLowerCase()
    ? given
    : `${given} ${person.last_name}`;
}

function personDates(person: PersonRow, settings: ProjectSettings): string[] {
  const parts: string[] = [];
  if (settings.showBirthdays && person.date_of_birth) {
    parts.push(`b. ${formatShortDate(person.date_of_birth)}`);
  }
  return parts;
}

function householdBlocks(
  entry: Extract<DirectoryEntry, { type: "household" }>,
  settings: ProjectSettings,
  type: TypeScale,
): Block[] {
  const household = entry.household;
  const blocks: Block[] = [
    {
      text: household.display_name,
      size: type.title,
      weight: "bold",
      color: COLORS.strong,
      spaceBefore: 0,
      essential: true,
    },
  ];

  const members = household.members;

  if (settings.showMembers && members.length) {
    if (settings.memberStyle === "detailed") {
      for (const member of members) {
        const detail = join(
          [
            settings.showPhone ? formatPhone(member.phone) : "",
            settings.showEmail ? (member.email ?? "") : "",
            ...personDates(member, settings),
          ],
          " · ",
        );
        blocks.push({
          text: detail
            ? `${memberLabel(member, household.sort_name)} — ${detail}`
            : memberLabel(member, household.sort_name),
          size: type.body,
          weight: "regular",
          color: COLORS.ink,
          spaceBefore: blocks.length === 1 ? 3 : 1,
        });
      }
    } else {
      blocks.push({
        text: members.map((m) => memberLabel(m, household.sort_name)).join(", "),
        size: type.body,
        weight: "regular",
        color: COLORS.ink,
        spaceBefore: 3,
      });
    }
  }

  if (settings.showAddress) {
    const lines = addressLines(household);
    lines.forEach((line, i) => {
      blocks.push({
        text: line,
        size: type.small,
        weight: "regular",
        color: COLORS.muted,
        spaceBefore: i === 0 ? 4 : 0,
      });
    });
  }

  const contact = join(
    [
      settings.showPhone ? formatPhone(household.phone) : "",
      settings.showEmail ? (household.email ?? "") : "",
    ],
    " · ",
  );
  if (contact) {
    blocks.push({
      text: contact,
      size: type.small,
      weight: "regular",
      color: COLORS.muted,
      spaceBefore: 3,
    });
  } else if (settings.showMembers && settings.memberStyle === "compact") {
    // A family with no shared home line still has people who can be reached.
    //
    // Only the family's own record was ever consulted here, so a congregation
    // that keeps a mobile against each person - which is most of them now -
    // switched "Phone numbers" on, got nothing, and had nothing on screen to
    // say why. Detailed members already put these on each member's own line,
    // which is why only compact needs the fallback; and it is skipped when
    // members are not listed at all, so this can never reintroduce a name the
    // settings asked to leave off.
    let first = true;
    for (const member of members) {
      const theirs = join(
        [
          settings.showPhone ? formatPhone(member.phone) : "",
          settings.showEmail ? (member.email ?? "") : "",
        ],
        " · ",
      );
      if (!theirs) continue;
      blocks.push({
        text: `${firstName(member)} — ${theirs}`,
        size: type.small,
        weight: "regular",
        color: COLORS.muted,
        spaceBefore: first ? 3 : 0,
      });
      first = false;
    }
  }

  // Birthdays belong to people, so in detailed mode they are already beside
  // each member's name and only compact mode has to collect them. The
  // anniversary is the family's own and was never on a member's line - it was
  // only ever reached through this block, so gating the whole thing on compact
  // meant a family that set an anniversary and chose detailed members printed
  // no anniversary at all.
  {
    const dateParts: string[] = [];
    if (settings.showAnniversary && household.anniversary) {
      dateParts.push(`Anniversary ${formatMonthDay(household.anniversary)}`);
    }
    if (settings.showBirthdays && settings.memberStyle === "compact") {
      const birthdays = members
        .filter((m) => m.date_of_birth)
        .map((m) => `${firstName(m)} ${formatShortDate(m.date_of_birth)}`);
      if (birthdays.length) dateParts.push(`Birthdays: ${birthdays.join(", ")}`);
    }
    if (dateParts.length) {
      blocks.push({
        text: dateParts.join("  ·  "),
        size: type.tiny,
        weight: "italic",
        color: COLORS.soft,
        spaceBefore: 3,
      });
    }
  }

  return blocks;
}

function personBlocks(
  entry: Extract<DirectoryEntry, { type: "person" }>,
  settings: ProjectSettings,
  type: TypeScale,
): Block[] {
  const person = entry.person;
  const blocks: Block[] = [
    {
      text: fullName(person),
      size: type.title,
      weight: "bold",
      color: COLORS.strong,
      spaceBefore: 0,
      essential: true,
    },
  ];

  if (settings.showAddress) {
    const lines = addressLines(effectiveAddress(person, entry.person.household));
    lines.forEach((line, i) => {
      blocks.push({
        text: line,
        size: type.small,
        weight: "regular",
        color: COLORS.muted,
        spaceBefore: i === 0 ? 4 : 0,
      });
    });
  }

  if (settings.showPhone && person.phone) {
    blocks.push({
      text: formatPhone(person.phone),
      size: type.small,
      weight: "regular",
      color: COLORS.muted,
      spaceBefore: 3,
    });
  }

  if (settings.showEmail && person.email) {
    blocks.push({
      text: person.email,
      size: type.small,
      weight: "regular",
      color: COLORS.muted,
      spaceBefore: 1,
    });
  }

  const dateParts: string[] = [];
  if (settings.showBirthdays && person.date_of_birth) {
    dateParts.push(`Birthday ${formatMonthDay(person.date_of_birth)}`);
  }
  if (dateParts.length) {
    blocks.push({
      text: dateParts.join("  ·  "),
      size: type.tiny,
      weight: "italic",
      color: COLORS.soft,
      spaceBefore: 3,
    });
  }

  return blocks;
}

const CARD_PADDING = 8;
const PHOTO_GAP = 10;
const PHOTO_ASPECT = 1.25; // height / width, a 4:5 portrait
/** Ceiling on how much of a card's width the photograph may take. */
const PHOTO_MAX_WIDTH_RATIO = 0.4;

interface LaidOutBlock extends Block {
  lines: string[];
  height: number;
}

/**
 * Lays one record into its slot: portrait on the left, text flowed down the
 * right and centred against the photo.
 *
 * Two passes. The first wraps every block and measures it; the second places
 * the lines, either centred when there is room to spare or from the top when
 * there is not. Anything that still will not fit is dropped from the bottom and
 * the last surviving line gets an ellipsis, so a card can never bleed into its
 * neighbour.
 */
function composeCard(
  entry: DirectoryEntry,
  box: Box,
  settings: ProjectSettings,
  type: TypeScale,
  metrics: Metrics,
): CardModel {
  const blocks =
    entry.type === "household"
      ? householdBlocks(entry, settings, type)
      : personBlocks(entry, settings, type);

  const innerX = box.x + CARD_PADDING;
  const innerY = box.y + CARD_PADDING;
  const innerW = box.w - CARD_PADDING * 2;
  const innerH = box.h - CARD_PADDING * 2;

  let photo: PhotoSlot | null = null;
  let textX = innerX;
  let textW = innerW;

  if (settings.showPhotos) {
    // The portrait runs the full height of the card - it is the thing an eye
    // lands on first when leafing through - unless that would make it too wide.
    let photoH = innerH;
    let photoW = photoH / PHOTO_ASPECT;
    const maxWidth = innerW * PHOTO_MAX_WIDTH_RATIO;
    if (photoW > maxWidth) {
      photoW = maxWidth;
      photoH = photoW * PHOTO_ASPECT;
    }

    const photoPath =
      entry.type === "household" ? entry.household.photo_path : entry.person.photo_path;

    photo = {
      box: { x: innerX, y: innerY + (innerH - photoH) / 2, w: photoW, h: photoH },
      path: photoPath,
      fit: settings.photoFit,
      initials: initialsFor(entry),
    };
    textX = innerX + photoW + PHOTO_GAP;
    textW = innerX + innerW - textX;
  }

  // Pass one: wrap and measure.
  const laidOut: LaidOutBlock[] = [];
  let contentHeight = 0;
  for (const block of blocks) {
    const lines = wrapText(block.text, textW, block.size, block.weight, metrics);
    if (!lines.length) continue;
    const spaceBefore = laidOut.length ? block.spaceBefore : 0;
    const height = lines.length * metrics.lineHeight(block.size);
    laidOut.push({ ...block, lines, spaceBefore, height });
    contentHeight += spaceBefore + height;
  }

  // Pass two: place.
  const runs: TextRun[] = [];
  const overflowing = contentHeight > innerH;
  let cursor = overflowing ? innerY : innerY + (innerH - contentHeight) / 2;
  const bottom = innerY + innerH;

  for (const block of laidOut) {
    const lineHeight = metrics.lineHeight(block.size);
    cursor += runs.length ? block.spaceBefore : 0;

    for (const line of block.lines) {
      if (cursor + lineHeight > bottom + 0.01) {
        const last = runs[runs.length - 1];
        if (last && !block.essential) {
          last.text = truncate(`${last.text} ...`, textW, last.size, last.weight, metrics);
        }
        return finishCard(entry, box, settings, photo, runs);
      }
      runs.push({
        x: textX,
        y: cursor,
        w: textW,
        size: block.size,
        weight: block.weight,
        color: block.color,
        align: "left",
        text: line,
      });
      cursor += lineHeight;
    }
  }

  return finishCard(entry, box, settings, photo, runs);
}

/**
 * A record is set off from its neighbour by a hairline beneath it rather than a
 * box around it - a box reads as a form, a rule reads as a book. The last card
 * on a page gets no rule, so the page does not end on a dangling line.
 */
function finishCard(
  entry: DirectoryEntry,
  box: Box,
  settings: ProjectSettings,
  photo: PhotoSlot | null,
  runs: TextRun[],
): CardModel {
  const rules: RuleModel[] =
    settings.cardStyle === "rule"
      ? [{ x: box.x, y: box.y + box.h + CARD_GAP / 2, w: box.w, color: COLORS.rule }]
      : [];

  return {
    entryId: entry.id,
    entryType: entry.type,
    box,
    style: settings.cardStyle,
    photo,
    runs,
    rules,
  };
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

function translate(page: BookPage, dx: number, dy: number): BookPage {
  const moveRun = (run: TextRun): TextRun => ({ ...run, x: run.x + dx, y: run.y + dy });
  return {
    ...page,
    box: { ...page.box, x: page.box.x + dx, y: page.box.y + dy },
    runs: page.runs.map(moveRun),
    rules: page.rules.map((rule) => ({ ...rule, x: rule.x + dx, y: rule.y + dy })),
    fills: page.fills.map((fill) => ({ ...fill, x: fill.x + dx, y: fill.y + dy })),
    // A page's own pictures move with it exactly as a card's do. Spreading the
    // page and forgetting these left the cover's photograph at half-page
    // coordinates while its text had been shifted onto the sheet, so the
    // picture sat over the rule above it.
    photos: page.photos.map((photo) => ({
      ...photo,
      box: { ...photo.box, x: photo.box.x + dx, y: photo.box.y + dy },
    })),
    cards: page.cards.map((card) => ({
      ...card,
      box: { ...card.box, x: card.box.x + dx, y: card.box.y + dy },
      photo: card.photo
        ? {
            ...card.photo,
            box: { ...card.photo.box, x: card.photo.box.x + dx, y: card.photo.box.y + dy },
          }
        : null,
      runs: card.runs.map(moveRun),
      rules: card.rules.map((rule) => ({ ...rule, x: rule.x + dx, y: rule.y + dy })),
    })),
  };
}

/** Running header, letter tab and page number. Covers and blanks get none. */
function addFurniture(
  page: BookPage,
  letter: string | null,
  settings: ProjectSettings,
  geo: Geometry,
): void {
  if (page.kind === "cover" || page.kind === "blank") return;

  const scale = TEXT_SCALES[settings.textScale];

  if (geo.headerHeight > 0) {
    const headerY = 1;
    if (settings.runningHeader) {
      const heading = settings.churchName.trim() || settings.coverTitle.trim();
      if (heading) {
        page.runs.push({
          x: 0,
          y: headerY,
          w: geo.pageWidth,
          size: 8 * scale,
          weight: "regular",
          color: COLORS.soft,
          align: "left",
          text: heading,
        });
      }
    }
    if (settings.showLetterTabs && letter) {
      // A solid tab rather than a lone letter: it gives the eye something to
      // catch when thumbing through, which is the whole point of a letter tab.
      const size = 9.5 * scale;
      const tabHeight = size + 7;
      const tabWidth = Math.max(tabHeight + 3, size * 0.72 * letter.length + 13);
      page.fills.push({
        x: geo.pageWidth - tabWidth,
        y: headerY - 3,
        w: tabWidth,
        h: tabHeight,
        color: COLORS.accent,
        radius: 2,
      });
      page.runs.push({
        x: geo.pageWidth - tabWidth,
        y: headerY + 1,
        w: tabWidth,
        size,
        weight: "bold",
        color: "#ffffff",
        align: "center",
        text: letter,
      });
    }
    page.rules.push({
      x: 0,
      y: geo.headerHeight - 5,
      w: geo.pageWidth,
      color: COLORS.rule,
    });
  }

  if (geo.footerHeight > 0) {
    const footerY = geo.pageHeight - geo.footerHeight + 4;
    if (settings.footerText.trim()) {
      page.runs.push({
        x: 0,
        y: footerY,
        w: geo.pageWidth,
        size: 7.2 * scale,
        weight: "regular",
        color: COLORS.soft,
        align: "left",
        text: settings.footerText.trim(),
      });
    }
    if (settings.showPageNumbers && page.number > 0) {
      page.runs.push({
        x: 0,
        y: footerY,
        w: geo.pageWidth,
        size: 8 * scale,
        weight: "regular",
        color: COLORS.muted,
        align: "center",
        text: String(page.number),
      });
    }
  }
}

function blankPage(geo: Geometry): BookPage {
  return {
    kind: "blank",
    number: 0,
    box: { x: 0, y: 0, w: geo.pageWidth, h: geo.pageHeight },
    cards: [],
    runs: [],
    rules: [],
    fills: [],
    photos: [],
  };
}

/** How tall the logo sits on the cover, and the photograph's shape. */
const COVER_LOGO_HEIGHT = 46;

/**
 * The cover, built as a measured stack.
 *
 * Every part is optional, and a church that fills all of them wants a
 * different vertical arrangement from one that only sets a title - so nothing
 * is placed at a fixed height. Each block that has something to say reports
 * how tall it is and how much air it wants above it; the whole stack is then
 * centred as one. An empty field contributes nothing at all, not an empty line,
 * which is what keeps a plain cover from drifting down the page.
 */
/**
 * Letterspacing, done the only way the standard fonts allow: with real
 * spaces. Plain ASCII spaces, because anything typographic is stripped on the
 * way into WinAnsi and would print as a question mark between every letter.
 */
function tracked(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.split("").join(" "))
    .join("   ");
}

/**
 * The cover.
 *
 * Three zones rather than one centred stack. The top carries the mark and the
 * church's name over a photograph that runs the full width of the page; the
 * foot carries the address, sitting on the bottom rule where a reader expects
 * to find it; and the title block is centred in whatever is left between them.
 * A stack centred as one lump - which is what this was - leaves a cover with
 * no relationship to its own edges, and reads as a form that happens to have
 * been filled in.
 *
 * The photograph absorbs the slack, so a long vision statement takes room from
 * the picture rather than pushing the address off the page.
 */
function composeCover(
  settings: ProjectSettings,
  geo: Geometry,
  type: TypeScale,
  metrics: Metrics,
): BookPage {
  const page = blankPage(geo);
  page.kind = "cover";

  const W = geo.pageWidth;
  const H = geo.pageHeight;
  const margin = 34;
  const inner = W - margin * 2;

  /** The rules top and bottom. Ink enough to frame the page, not to flood it. */
  const BAND = 6;
  const PHOTO_TARGET = W * 0.56;
  const PHOTO_MIN = 96;

  const lay = (text: string, size: number, weight: FontWeight, width: number): string[] =>
    text
      .trim()
      .split("\n")
      .flatMap((line) => (line.trim() ? wrapText(line.trim(), width, size, weight, metrics) : []));

  const put = (
    lines: string[],
    top: number,
    size: number,
    weight: FontWeight,
    color: string,
    width: number,
  ) => {
    const lineHeight = metrics.lineHeight(size);
    lines.forEach((line, i) => {
      page.runs.push({
        x: margin + (inner - width) / 2,
        y: top + i * lineHeight,
        w: width,
        size,
        weight,
        color,
        align: "center",
        text: line,
      });
    });
    return lines.length * lineHeight;
  };

  page.fills.push({ x: 0, y: 0, w: W, h: BAND, color: COLORS.accent });
  page.fills.push({ x: 0, y: H - BAND, w: W, h: BAND, color: COLORS.accent });

  // --- the foot, measured from the bottom rule up --------------------------
  let floor = H - BAND - 20;
  const contact = lay(settings.coverContact, 9.5, "regular", inner);
  if (contact.length) {
    const height = contact.length * metrics.lineHeight(9.5);
    const top = floor - height;
    put(contact, top, 9.5, "regular", COLORS.muted, inner);
    page.rules.push({ x: W / 2 - 26, y: top - 15, w: 52, color: COLORS.rule });
    floor = top - 32;
  }

  // --- the head ------------------------------------------------------------
  let y = BAND + 24;

  if (settings.coverLogoPath) {
    page.photos.push({
      box: { x: margin, y, w: inner, h: COVER_LOGO_HEIGHT },
      path: settings.coverLogoPath,
      fit: "fit",
      initials: "",
    });
    y += COVER_LOGO_HEIGHT + 16;
  }

  if (settings.churchName.trim()) {
    // Tracked, and fitted rather than wrapped: a church's name broken across
    // two lines with a space between every letter is unreadable.
    const spaced = tracked(settings.churchName.toUpperCase());
    const fitted = Math.min(10, (10 * inner) / Math.max(metrics.widthOf(spaced, 10, "regular"), 1));
    const usable = fitted >= 6.6;
    const text = usable ? spaced : settings.churchName.toUpperCase();
    const size = usable
      ? fitted
      : Math.min(11, (11 * inner) / Math.max(metrics.widthOf(text, 11, "regular"), 1));
    y += put([text], y, size, "regular", COLORS.accent, inner) + 20;
  }

  // --- the middle, measured so the photograph can take what is left --------
  interface Item {
    height: number;
    gap: number;
    place: (top: number) => void;
  }
  const middle: Item[] = [];

  if (settings.coverTitle.trim()) {
    // 0.98, not 1: sized to exactly the column width, the wrap that follows
    // breaks the title in two on the next rounding.
    const size = Math.min(
      type.cover,
      (type.cover * inner * 0.98) /
        Math.max(metrics.widthOf(settings.coverTitle, type.cover, "bold"), 1),
    );
    const lines = lay(settings.coverTitle, size, "bold", inner);
    middle.push({
      height: lines.length * metrics.lineHeight(size),
      gap: 0,
      place: (top) => put(lines, top, size, "bold", COLORS.strong, inner),
    });
    middle.push({
      height: 1,
      gap: 15,
      place: (top) => page.rules.push({ x: W / 2 - 27, y: top, w: 54, color: COLORS.accent }),
    });
  }

  const subtitle = lay(settings.coverSubtitle, 11, "regular", inner);
  if (subtitle.length) {
    middle.push({
      height: subtitle.length * metrics.lineHeight(11),
      gap: 15,
      place: (top) => put(subtitle, top, 11, "regular", COLORS.muted, inner),
    });
  }

  // Narrower than the page: a centred paragraph running the full measure is
  // hard to read back to the start of the next line.
  const statementWidth = inner * 0.84;
  const statement = lay(settings.coverStatement, 10.5, "italic", statementWidth);
  if (statement.length) {
    middle.push({
      height: statement.length * metrics.lineHeight(10.5),
      gap: 22,
      place: (top) => put(statement, top, 10.5, "italic", COLORS.ink, statementWidth),
    });
  }

  const middleHeight = middle.reduce(
    (sum, item, i) => sum + item.height + (i === 0 ? 0 : item.gap),
    0,
  );

  // --- the photograph, full width, taking whatever is spare -----------------
  if (settings.coverPhotoPath) {
    const spare = floor - y - middleHeight - 46;
    const height = Math.min(PHOTO_TARGET, spare);
    if (height >= PHOTO_MIN) {
      page.photos.push({
        box: { x: 0, y, w: W, h: height },
        path: settings.coverPhotoPath,
        fit: "fill",
        initials: "",
      });
      y += height + 26;
    }
  }

  // Centred in what is left, so the title block sits in its own space rather
  // than crowding whichever neighbour happens to be shorter.
  let cursor = y + Math.max(0, (floor - y - middleHeight) / 2);
  middle.forEach((item, i) => {
    if (i > 0) cursor += item.gap;
    item.place(cursor);
    cursor += item.height;
  });

  return page;
}

function composeIndexPages(
  records: IndexRecord[],
  settings: ProjectSettings,
  geo: Geometry,
  metrics: Metrics,
): BookPage[] {
  if (!records.length) return [];

  const scale = TEXT_SCALES[settings.textScale];
  const size = 8 * scale;
  const lineHeight = metrics.lineHeight(size) + 1.4;
  const pad = 4;
  const columnGap = 14;
  const columnWidth = (geo.pageWidth - pad * 2 - columnGap) / 2;
  const headingHeight = metrics.lineHeight(13) + 8;

  const pages: BookPage[] = [];
  let page = blankPage(geo);
  page.kind = "index";
  let column = 0;
  let y = geo.contentTop + headingHeight;
  let first = true;

  const columnTop = (isFirst: boolean) => geo.contentTop + (isFirst ? headingHeight : 4);
  const columnBottom = geo.contentTop + geo.contentHeight;

  const startPage = (isFirst: boolean) => {
    page = blankPage(geo);
    page.kind = "index";
    if (isFirst) {
      page.runs.push({
        x: pad,
        y: geo.contentTop + 2,
        w: geo.pageWidth - pad * 2,
        size: 13,
        weight: "bold",
        color: COLORS.strong,
        align: "left",
        text: "Index",
      });
    }
    column = 0;
    y = columnTop(isFirst);
  };

  startPage(true);

  for (const record of records) {
    if (y + lineHeight > columnBottom) {
      column += 1;
      if (column > 1) {
        pages.push(page);
        first = false;
        startPage(false);
      } else {
        y = columnTop(first);
      }
    }

    const x = pad + column * (columnWidth + columnGap);
    const pageLabel = String(record.page);
    const numberWidth = metrics.widthOf(pageLabel, size, "regular") + 4;
    const nameWidth = columnWidth - numberWidth;
    const name = truncate(record.name, nameWidth, size, "regular", metrics);

    page.runs.push({
      x,
      y,
      w: nameWidth,
      size,
      weight: "regular",
      color: COLORS.ink,
      align: "left",
      text: name,
    });

    // Dot leaders, so the eye can run from a name to its page number without
    // losing the line - the thing that makes an index usable at arm's length.
    const nameEnd = metrics.widthOf(name, size, "regular");
    const gap = nameWidth - nameEnd - 6;
    if (gap > size) {
      const dotWidth = metrics.widthOf(" .", size, "regular");
      const dots = " .".repeat(Math.max(0, Math.floor(gap / dotWidth)));
      if (dots) {
        page.runs.push({
          x: x + nameEnd + 3,
          y,
          w: gap,
          size,
          weight: "regular",
          color: COLORS.rule,
          align: "left",
          text: dots,
        });
      }
    }

    page.runs.push({
      x,
      y,
      w: columnWidth,
      size,
      weight: "regular",
      color: COLORS.soft,
      align: "right",
      text: pageLabel,
    });
    y += lineHeight;
  }

  pages.push(page);
  return pages;
}

// ---------------------------------------------------------------------------
// Sheet assembly
// ---------------------------------------------------------------------------

/**
 * Saddle-stitch imposition: print double-sided, fold the stack down the
 * middle, staple the spine, and the pages read 1, 2, 3... in order.
 *
 * For a stack of P pages (padded to a multiple of four) sheet s carries
 * [P-2s, 1+2s] on the front and [2+2s, P-1-2s] on the back.
 */
function bookletOrder(pageCount: number): number[] {
  const order: number[] = [];
  const sheets = pageCount / 4;
  for (let s = 0; s < sheets; s += 1) {
    order.push(pageCount - 2 * s, 1 + 2 * s); // front of the sheet
    order.push(2 + 2 * s, pageCount - 1 - 2 * s); // back of the sheet
  }
  return order;
}

function assembleSheets(pages: BookPage[], settings: ProjectSettings, geo: Geometry): SheetModel[] {
  const perSheet = geo.columns;
  // Booklet folding only makes sense with two pages to a side; anything else
  // prints in straight reading order.
  const useBooklet = settings.bookletOrder && perSheet === 2;

  const padded = [...pages];
  const multiple = useBooklet ? 4 : perSheet;
  while (padded.length % multiple !== 0) padded.push(blankPage(geo));

  const ordered = useBooklet
    ? bookletOrder(padded.length).map((position) => padded[position - 1])
    : padded;

  const foldX: number[] = [];
  for (let i = 0; i < geo.columns - 1; i += 1) {
    foldX.push(geo.margin + (i + 1) * geo.pageWidth + i * geo.gutter + geo.gutter / 2);
  }

  const sheets: SheetModel[] = [];
  for (let i = 0; i < ordered.length; i += perSheet) {
    const slots = ordered.slice(i, i + perSheet);
    sheets.push({
      index: sheets.length,
      foldX,
      pages: slots.map((page, column) =>
        translate(page, geo.margin + column * (geo.pageWidth + geo.gutter), geo.margin),
      ),
    });
  }

  return sheets;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Turns an ordered list of records into a finished book: paginated, numbered,
 * indexed, and positioned down to the point.
 *
 * The result is consumed unchanged by both renderers - `renderPdf` writes it
 * with pdf-lib and the preview screen draws it as absolutely positioned HTML -
 * so what an administrator sees on screen is what comes out of the printer.
 */
export function composeBook(
  entries: DirectoryEntry[],
  settings: ProjectSettings,
  metrics: Metrics,
): BookModel {
  const geo = computeGeometry(settings);
  const type = typeScale(settings);
  const perPage = geo.rows;

  // --- records ------------------------------------------------------------
  const recordPages: BookPage[] = [];
  const letters: (string | null)[] = [];
  const entryPageIndex = new Map<string, number>();

  for (let i = 0; i < entries.length; i += perPage) {
    const slice = entries.slice(i, i + perPage);
    const page = blankPage(geo);
    page.kind = "records";

    slice.forEach((entry, row) => {
      const box: Box = {
        x: 0,
        y: geo.contentTop + row * (geo.cardHeight + geo.cardGap),
        w: geo.pageWidth,
        h: geo.cardHeight,
      };
      page.cards.push(composeCard(entry, box, settings, type, metrics));
      entryPageIndex.set(entry.id, recordPages.length);
    });

    const lastCard = page.cards[page.cards.length - 1];
    if (lastCard) lastCard.rules = [];

    const from = alphaBucket(slice[0].sortKey);
    const to = alphaBucket(slice[slice.length - 1].sortKey);
    letters.push(from === to ? from : `${from}-${to}`);
    recordPages.push(page);
  }

  // --- numbering ----------------------------------------------------------
  const cover = settings.includeCover ? composeCover(settings, geo, type, metrics) : null;
  const coverOffset = cover ? 1 : 0;

  // --- index --------------------------------------------------------------
  const indexRecords: IndexRecord[] = [];
  if (settings.includeIndex) {
    for (const entry of entries) {
      const pageIndex = entryPageIndex.get(entry.id);
      if (pageIndex === undefined) continue;
      const number = pageIndex + 1 + coverOffset;

      if (entry.type === "person") {
        indexRecords.push({ name: fileAsName(entry.person), page: number });
      } else {
        for (const member of entry.household.members) {
          indexRecords.push({ name: fileAsName(member), page: number });
        }
        if (!entry.household.members.length) {
          indexRecords.push({ name: entry.household.display_name, page: number });
        }
      }
    }
    indexRecords.sort((a, b) => a.name.localeCompare(b.name) || a.page - b.page);
  }

  const indexPages = composeIndexPages(indexRecords, settings, geo, metrics);

  // --- assemble -----------------------------------------------------------
  const pages: BookPage[] = [];
  if (cover) pages.push(cover);
  pages.push(...recordPages, ...indexPages);

  pages.forEach((page, i) => {
    page.number = i + 1;
    const letter = page.kind === "records" ? (letters[i - coverOffset] ?? null) : null;
    addFurniture(page, letter, settings, geo);
  });

  const photoPaths = new Set<string>();
  for (const page of pages) {
    for (const card of page.cards) {
      if (card.photo?.path) photoPaths.add(card.photo.path);
    }
    // The cover's logo and photograph are fetched and embedded by the same
    // pass as every portrait; missing them here would leave the cover blank in
    // the PDF while the preview, which loads from the same list, showed them.
    for (const photo of page.photos) {
      if (photo.path) photoPaths.add(photo.path);
    }
  }

  return {
    typeface: settings.typeface,
    width: geo.width,
    height: geo.height,
    sheets: assembleSheets(pages, settings, geo),
    pageCount: pages.length,
    recordCount: entries.length,
    index: indexRecords,
    photoPaths: [...photoPaths],
    settings,
  };
}
