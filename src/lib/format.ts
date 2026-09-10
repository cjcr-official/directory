import type { HouseholdRole, HouseholdRow, PersonRow } from "./database.types";

/** A person's place in a family, and what each one is called on screen. */
export const HOUSEHOLD_ROLES: { value: HouseholdRole; label: string }[] = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse / partner" },
  { value: "child", label: "Child" },
  { value: "other", label: "Other" },
];

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

/**
 * The one number, however it was typed.
 *
 * Compared on digits, so "(406) 555-0000" and "406-555-0000" are the same
 * number, and a number written with its country code is the same number as one
 * written without it. Something with no digits at all - a note where a number
 * should be - is compared as it was typed.
 */
function phoneKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.trim().toLowerCase();
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * Whether two records carry the same phone number.
 *
 * The house line is usually typed against the house and against each person who
 * answers it, so this is what stops a card printing one number five times.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = phoneKey(a);
  return left.length > 0 && left === phoneKey(b);
}

/** The same, for an address a family and one of its members both carry. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase();
  return left.length > 0 && left === (b ?? "").trim().toLowerCase();
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

/**
 * What went wrong, in words fit for a screen.
 *
 * Anything at all can be thrown, and every screen catching one wants the same
 * thing out of it: a line of text. An Error gives up its message; anything else
 * is described as best it can be, unless the caller knows a better word for it
 * than the raw form would be.
 */
export function message(cause: unknown, fallback?: string): string {
  if (cause instanceof Error) return cause.message;
  return fallback ?? String(cause);
}

/** Joins non-empty pieces with a separator. */
export function join(parts: (string | null | undefined)[], separator = " · "): string {
  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(separator);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Midnight local, so "yesterday" means the day before, not 24 hours ago. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * When a record was last written, as the office would say it.
 *
 * "today", "yesterday", "on Tuesday" inside the last week, and a date after
 * that - which is how somebody actually answers "when did this change?". A
 * weekday is only useful while there is one of it in recent memory, so it
 * stops at six days; beyond that it would be ambiguous between this Tuesday
 * and last.
 *
 * The year is added only when it is not this one. "on 3 March" is what you
 * want nine times in ten, and "on 3 March 2025" is the tenth, where leaving
 * the year off would quietly claim the change was recent.
 *
 * Local time throughout, deliberately - unlike the birthday helpers above,
 * which parse a bare YYYY-MM-DD and must not let a timezone move the day.
 * This is a real instant, and the day it happened is the day it was in the
 * room where somebody typed it.
 */
export function describeWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";

  const days = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  // A clock that is behind can date a change tomorrow. Saying "on Thursday"
  // for it would be a guess; the date is at least what was recorded.
  if (days > 1 && days < 7) return `on ${WEEKDAYS[when.getDay()]}`;

  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`;
  return when.getFullYear() === now.getFullYear() ? `on ${day}` : `on ${day} ${when.getFullYear()}`;
}

/**
 * The whole line: when a record was last written and by whom.
 *
 * Every piece of it is allowed to be missing, and each absence means something
 * different. No timestamp at all is a record that has never been saved through
 * this app. A timestamp with no name is a row older than migration 0005, or
 * one written by a service-role tool where there was no person to name - so it
 * says when and stops, rather than inventing an "unknown" nobody asked about.
 */
export function describeChange(
  updatedAt: string | null | undefined,
  author: string | null | undefined,
  now = new Date(),
): string {
  const when = describeWhen(updatedAt, now);
  if (!when) return "";
  const who = author?.trim();
  return who ? `Changed ${when} by ${who}` : `Changed ${when}`;
}
