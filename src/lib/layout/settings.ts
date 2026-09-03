export type PageSizeName = "letter" | "a4" | "legal";
export type PhotoFit = "fill" | "fit";
export type MemberStyle = "compact" | "detailed";
export type TextScale = "compact" | "normal" | "large";
export type Typeface = "sans" | "serif";
/** How one record is set off from the next on the page. */
export type CardStyle = "rule" | "box" | "none";

/**
 * Everything about how one project prints. Stored as JSON in projects.settings,
 * so adding a field here only needs a default below - no migration.
 */
export type ProjectSettings = {
  // --- sheet ---------------------------------------------------------------
  pageSize: PageSizeName;
  /** Records stacked down each half of the sheet. */
  rows: number;
  /** Halves across the sheet. Two is the fold-in-the-middle book. */
  columns: number;

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
  pageSize: "letter",
  rows: 3,
  columns: 2,

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

  // Guard rails: the layout maths assumes at least one card per half.
  merged.rows = clamp(Math.round(merged.rows), 1, 8);
  merged.columns = clamp(Math.round(merged.columns), 1, 3);
  if (!["letter", "a4", "legal"].includes(merged.pageSize)) merged.pageSize = "letter";
  if (!["fill", "fit"].includes(merged.photoFit)) merged.photoFit = "fill";
  if (!["compact", "detailed"].includes(merged.memberStyle)) merged.memberStyle = "compact";
  if (!["compact", "normal", "large"].includes(merged.textScale)) merged.textScale = "normal";
  if (!["rule", "box", "none"].includes(merged.cardStyle)) merged.cardStyle = "rule";
  if (!["sans", "serif"].includes(merged.typeface)) merged.typeface = "serif";

  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Landscape dimensions in PDF points (72 per inch). */
export const PAGE_SIZES: Record<PageSizeName, { width: number; height: number; label: string }> = {
  letter: { width: 792, height: 612, label: 'Letter (11" x 8.5")' },
  legal: { width: 1008, height: 612, label: 'Legal (14" x 8.5")' },
  a4: { width: 841.89, height: 595.28, label: "A4 (297mm x 210mm)" },
};

export const TEXT_SCALES: Record<TextScale, number> = {
  compact: 0.9,
  normal: 1,
  large: 1.12,
};

/** Records per sheet, the number people actually ask about. */
export function recordsPerSheet(settings: ProjectSettings): number {
  return settings.rows * settings.columns;
}
