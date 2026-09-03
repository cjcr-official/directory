import type { HouseholdRow, PersonRow } from "./database.types";

/** A person's everyday first name: "Bill" wins over "William" when set. */
export function firstName(person: Pick<PersonRow, "first_name" | "preferred_name">): string {
  return person.preferred_name?.trim() || person.first_name;
}

export function fullName(
  person: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">,
): string {
  return `${firstName(person)} ${person.last_name}`.trim();
}

/** "Alvarez, Maria" - the form used in list views and the printed index. */
export function fileAsName(
  person: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">,
): string {
  return `${person.last_name}, ${firstName(person)}`.trim();
}

/**
 * The single string every alphabetical sort runs on. Lower-cased and stripped
 * of accents so "Ávila" files next to "Avila" rather than after "Zimmerman",
 * which is what someone flipping through the book expects.
 */
export function sortKey(...parts: (string | null | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      // Runs of spaces collapse to one. Without this a name typed with a stray
      // space - or one whose punctuation was just stripped from between two
      // words - keys differently from the same name typed cleanly, and so files
      // somewhere else in the book entirely.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Sorts by a key that costs something to work out, working it out once each.
 *
 * A comparator runs O(n log n) times, so calling sortKey inside one asks it for
 * the same answer over and over: sorting a congregation of 1,200 called it
 * about 25,000 times to make 12,000 comparisons. Measured on a 400-family
 * directory that is 10ms against 1.2ms, and the browser does it again after
 * every save - on a phone, which is several times slower again.
 *
 * The order is unchanged: the same keys are compared the same way, only fewer
 * times.
 */
export function sortByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, key: keyOf(item) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((keyed) => keyed.item);
}

/**
 * The photograph that stands for a person.
 *
 * Someone in a family is represented by the family portrait - that is what
 * their card in the book carries, because a family prints once. Any individual
 * photo taken before they joined is kept on the record but not shown, so the
 * app and the printed page never disagree about whose face appears.
 */
export function personPhotoPath(
  person: Pick<PersonRow, "photo_path">,
  household: Pick<HouseholdRow, "photo_path"> | null | undefined,
): string | null {
  return household ? household.photo_path : person.photo_path;
}

/** The letter a record files under in an A-Z book. Anything else lands in "#". */
export function alphaBucket(key: string): string {
  const first = key.charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

/**
 * Suggests "The Alvarez Family" from a surname. Only ever a suggestion - the
 * field stays editable because plenty of households are "Maria Alvarez & Sam Choi".
 */
export function suggestHouseholdName(surname: string, headFirstName?: string): string {
  const trimmed = surname.trim();
  if (!trimmed) return "";
  // Two families can share a surname, and two cards titled "The Smith Family"
  // are indistinguishable on the page. When the head of the household is
  // known, the suggestion names them.
  const head = headFirstName?.trim();
  return head ? `The ${head} ${trimmed} Family` : `The ${trimmed} Family`;
}

/**
 * Two families whose names would read identically in the book. Compared on the
 * sort key, so "The O'Neil Family" and "The ONeil family" count as the clash
 * they are.
 */
export function sameDisplayName(a: string, b: string): boolean {
  const left = sortKey(a);
  return left.length > 0 && left === sortKey(b);
}

/**
 * A family's name with the office's label after it, where there is one.
 *
 * Used on the three screens that show a family by name and nothing else - the
 * family a person belongs to, the Family column on the people list, and the
 * hand-picked checklist. Everywhere a reader can see, and everywhere the book
 * is composed from, uses display_name on its own.
 */
export function labelledHouseholdName(
  household: Pick<HouseholdRow, "display_name"> & { office_label?: string | null },
): string {
  const label = household.office_label?.trim();
  return label ? `${household.display_name} (${label})` : household.display_name;
}

/**
 * The next free number for a family that shares its name with another.
 *
 * Only ever a suggestion, and deliberately the smallest unused one rather than
 * a count: numbers are labels, not positions. A family leaving does not
 * renumber the rest - the gap it leaves is simply available again, and every
 * other family keeps the label the office already knows it by.
 */
export function suggestOfficeLabel(taken: (string | null | undefined)[]): string {
  const used = new Set(
    taken
      .map((label) => label?.trim())
      .filter((label): label is string => Boolean(label && /^\d+$/.test(label)))
      .map(Number),
  );
  let next = 1;
  while (used.has(next)) next += 1;
  return String(next);
}

/**
 * Every name one person answers to, as sort keys.
 *
 * Usually one. Someone with a preferred name answers to two - William Smith is
 * also Bill Smith - and either is what a person typing them in might reach for,
 * so both count when looking for somebody already in the directory.
 */
/**
 * A hyphen is a word break; an apostrophe is not.
 *
 * "Anne-Jones" and "Anne Jones" are one surname typed two ways, so the hyphen
 * becomes a space before the key is taken. An apostrophe is the opposite case -
 * "O'Neil" and "ONeil" are also one surname, and sortKey already joins them by
 * dropping it. Spacing all punctuation alike would fix the first and break the
 * second.
 *
 * Kept here rather than in sortKey on purpose: sortKey decides the order of the
 * printed index, and moving hyphenated surnames around in it is not something
 * a warning on a form should quietly do.
 */
function nameKey(...parts: (string | null | undefined)[]): string {
  return sortKey(...parts.map((part) => part?.replace(/[-\u2010-\u2015]/g, " ")));
}

function knownAs(person: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">): string[] {
  const names = [nameKey(person.first_name, person.last_name)];
  const preferred = person.preferred_name?.trim();
  if (preferred) names.push(nameKey(preferred, person.last_name));
  return names.filter((name) => name.length > 0);
}

/**
 * Whether two records look like the same person.
 *
 * Deliberately a question about names and nothing else. A congregation really
 * does contain two John Smiths, so this can only ever say "these would be hard
 * to tell apart" - never "this is a duplicate". What it is for is the case
 * where somebody is being typed in who is already there, which is the one that
 * quietly produces two half-filled records and a directory that prints both.
 *
 * "Ávila" matches "Avila" and "O'Neil" matches "ONeil", because sortKey strips
 * accents and punctuation - a duplicate typed slightly differently is still a
 * duplicate.
 */
export function samePersonName(
  a: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">,
  b: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">,
): boolean {
  const mine = knownAs(a);
  if (!mine.length) return false;
  const theirs = new Set(knownAs(b));
  return mine.some((name) => theirs.has(name));
}

/** Formats 10- and 11-digit North American numbers; leaves anything else alone. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw.trim();
}

export interface AddressParts {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

/** Address as printable lines, empty pieces dropped. */
export function addressLines(address: AddressParts | null | undefined): string[] {
  if (!address) return [];
  const lines: string[] = [];
  if (address.address_line1?.trim()) lines.push(address.address_line1.trim());
  if (address.address_line2?.trim()) lines.push(address.address_line2.trim());

  const city = address.city?.trim();
  const state = address.state?.trim();
  const postal = address.postal_code?.trim();
  const locality = [city, [state, postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (locality) lines.push(locality);

  const country = address.country?.trim();
  if (country && !/^(us|usa|united states)$/i.test(country)) lines.push(country);

  return lines;
}

export function hasAddress(address: AddressParts | null | undefined): boolean {
  return addressLines(address).length > 0;
}

/** A person's own address, or the household's when they share it. */
export function effectiveAddress(
  person: PersonRow,
  household: HouseholdRow | null | undefined,
): AddressParts | null {
  if (person.use_household_address && household) return household;
  return hasAddress(person) ? person : (household ?? null);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Parses "YYYY-MM-DD" without letting the local timezone shift the day. */
function parseDateParts(iso: string | null | undefined) {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "June 12" - the form used in the book, where the year is noise. */
export function formatMonthDay(iso: string | null | undefined): string {
  const parts = parseDateParts(iso);
  if (!parts) return "";
  return `${MONTHS[parts.month - 1]} ${parts.day}`;
}

/** "6/12" - the compact form for a crowded card. */
export function formatShortDate(iso: string | null | undefined): string {
  const parts = parseDateParts(iso);
  if (!parts) return "";
  return `${parts.month}/${parts.day}`;
}

/** "June 12, 1984" - the form used in the editing screens. */
export function formatLongDate(iso: string | null | undefined): string {
  const parts = parseDateParts(iso);
  if (!parts) return "";
  return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** Day of the year, for birthday and anniversary lists. */
export function monthDayOrder(iso: string | null | undefined): number {
  const parts = parseDateParts(iso);
  if (!parts) return Number.MAX_SAFE_INTEGER;
  return parts.month * 100 + parts.day;
}

/**
 * The standard PDF fonts speak WinAnsi (Latin-1) only, and pdf-lib throws on
 * anything outside it.
 *
 * Typographic punctuation is folded to ASCII first - a curly apostrophe in
 * O'Neil is outside Latin-1's useful range, and it has no combining marks to
 * strip, so the accent fold below would otherwise turn it into "?". Accents are
 * then folded to their base letter, and only a character that survives neither
 * pass becomes "?", so an unusual name degrades instead of breaking the book.
 */
export function toWinAnsi(text: string): string {
  const normalised = text
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2000-\u200a\u202f\u205f]/g, " ")
    .replace(/\u00a0/g, " ");

  let out = "";
  for (const char of normalised) {
    if (char.charCodeAt(0) < 256) {
      out += char;
      continue;
    }
    const folded = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += folded.length > 0 && /^[\x20-\xff]*$/.test(folded) ? folded : "?";
  }
  return out;
}

/** Joins non-empty pieces with a separator. */
export function join(parts: (string | null | undefined)[], separator = " · "): string {
  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(separator);
}
