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
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
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
export function suggestHouseholdName(surname: string): string {
  const trimmed = surname.trim();
  if (!trimmed) return "";
  return `The ${trimmed} Family`;
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
  const locality = [city, [state, postal].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
  return parts.map((p) => p?.trim()).filter(Boolean).join(separator);
}
