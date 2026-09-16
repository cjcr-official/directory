/**
 * Turning a Planning Center export into this directory's own rows.
 *
 * Every judgement an import makes is made here and nothing here touches a
 * database, so the awkward cases can be put to it directly and checked:
 * scripts/import-check.ts does exactly that. importPeople.ts writes what this
 * decides.
 *
 * Planning Center exports a row per person and repeats the household on every
 * one of them - the same address, the same household name, the same id - so the
 * first job is to fold those rows back into families. The second is to leave
 * alone what is already here: an office that imports the same file twice, or
 * imports again after adding a few families by hand, should end up with the
 * congregation it has rather than two of it.
 */

import { sortKey, samePersonName, sameDisplayName, suggestHouseholdName } from "./format";
import type { SheetTable } from "./sheet";
import type { Gender, HouseholdRole, HouseholdRow, PersonRow } from "./database.types";

/** The rows an import would write, ready for insert(). */
export type HouseholdDraft = Omit<HouseholdRow, "created_at" | "updated_at" | "updated_by">;
export type PersonDraft = Omit<PersonRow, "created_at" | "updated_at" | "updated_by">;

/** What the directory already holds, for deciding what is new. */
export interface LiveForImport {
  households: Pick<HouseholdRow, "id" | "display_name" | "sort_name">[];
  people: Pick<PersonRow, "first_name" | "last_name" | "preferred_name" | "household_id">[];
}

export interface ImportPlan {
  fileName: string;
  /** Rows of people in the file, headings not counted. */
  rowsRead: number;
  /** Rows with no name in them at all, which nothing can be made of. */
  unnamed: number;
  households: HouseholdDraft[];
  people: PersonDraft[];
  /** People joining a family that is already in the directory. */
  joining: number;
  /** People the directory already has under that name, left alone. */
  alreadyHere: number;
  /** Columns the file fills in that nothing here reads. */
  unmapped: string[];
}

/*
 * Planning Center's headings, as its export writes them. Several fields are
 * one of two or three columns depending on what the office filled in, so each
 * is a list and the first one with anything in it wins - a mobile number
 * before the landline, the home address before work.
 */
const HEADINGS = {
  personId: ["person id"],
  firstName: ["first name", "given name"],
  lastName: ["last name"],
  nickname: ["nickname"],
  gender: ["gender"],
  birthdate: ["birthdate", "birthday", "date of birth"],
  anniversary: ["anniversary"],
  child: ["child"],
  maritalStatus: ["marital status"],
  status: ["status"],
  medical: ["medical notes"],
  email: ["home email", "work email", "other email"],
  phone: ["mobile phone number", "home phone number", "work phone number"],
  householdPhone: ["home phone number"],
  householdId: ["household id"],
  householdName: ["household name"],
  primary: ["household primary contact"],
  street1: ["home address street line 1"],
  street2: ["home address street line 2"],
  city: ["home address city"],
  state: ["home address state"],
  postal: ["home address zip code", "home address postal code"],
  country: ["home address country", "home address country code"],
  checkOn: ["background check created at"],
  checkDue: ["background check expires on"],
} as const;

/** Every heading above, for working out what the file holds that we do not. */
const READ: ReadonlySet<string> = new Set(Object.values(HEADINGS).flat());

/**
 * Columns nobody wants told about.
 *
 * "Not brought in" is a promise to say what was left behind, and a list of
 * twelve buries the one or two entries that a church would actually miss.
 * These are the ones nothing could be done with: which Planning Center
 * products somebody can sign into, the ids and timestamps of its own records,
 * and the yes/no beside a background check whose two dates do come across.
 */
const NOT_WORTH_SAYING = [
  /(^| )user$/,
  /^person id$/,
  /^household id$/,
  /^created at$/,
  /^updated at$/,
  /^background check cleared$/,
];

function normalize(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The first of these columns with something in it. */
function pick(row: Record<string, string>, headings: readonly string[]): string {
  for (const wanted of headings) {
    for (const [heading, value] of Object.entries(row)) {
      if (normalize(heading) === wanted && value.trim()) return value.trim();
    }
  }
  return "";
}

/** Planning Center writes these as 1 and 0; a CSV opened and re-saved may not. */
function flag(value: string): boolean {
  return /^(1|y|yes|true)$/i.test(value.trim());
}

/**
 * A date, however the file happens to be carrying one.
 *
 * A .xlsx stores a date as the number of days since the last day of 1899 - and
 * the format that would say so lives in a styles file this reader does not
 * open - so a bare number in a column that is meant to be a date is one of
 * those. A CSV has already been turned back into text by whatever wrote it,
 * which Planning Center writes ISO and a spreadsheet that has been through
 * Excel writes American.
 */
export function toIsoDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Math.floor(Number(value));
    // 1899-12-30, not the 31st: the spreadsheet format counts a 29 February
    // 1900 that never happened, and starting a day early is how every reader
    // of these files cancels it out.
    if (serial <= 0 || serial > 200_000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }

  const american = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (american) {
    const [, month, day, year] = american;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function genderOf(value: string): Gender | null {
  const said = value.trim().toLowerCase();
  if (said === "male" || said === "m") return "male";
  if (said === "female" || said === "f") return "female";
  return null;
}

function or(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

/** The surname a family files under, from its household name or its people. */
function surnameOf(householdName: string, lastName: string): string {
  const trimmed = householdName.replace(/\s+household$/i, "").trim();
  return trimmed || lastName.trim();
}

interface Group {
  key: string;
  rows: Record<string, string>[];
}

/**
 * Rows folded back into families.
 *
 * The household id is the honest key where there is one. Where there is not -
 * an export of individuals, or a file somebody has edited - a shared surname
 * and a shared address is the next best thing, and two Smiths at different
 * addresses stay two families. A person with neither belongs to nobody, which
 * this app allows: they are a record with no family, not an error.
 */
function groupRows(rows: Record<string, string>[]): Group[] {
  const groups = new Map<string, Group>();
  const loose: Group[] = [];

  for (const row of rows) {
    const id = pick(row, HEADINGS.householdId);
    const name = pick(row, HEADINGS.householdName);
    const surname = surnameOf(name, pick(row, HEADINGS.lastName));
    const address = sortKey(pick(row, HEADINGS.street1), pick(row, HEADINGS.postal));
    const key = id ? `id:${id}` : surname && address ? `at:${sortKey(surname)}|${address}` : "";

    if (!key) {
      loose.push({ key: `row:${loose.length}`, rows: [row] });
      continue;
    }
    const found = groups.get(key);
    if (found) found.rows.push(row);
    else groups.set(key, { key, rows: [row] });
  }

  return [...groups.values(), ...loose];
}

/**
 * Who is the head, and who is everybody else.
 *
 * Planning Center marks one person in each household as its primary contact,
 * which is the same idea as this app's head. Where the export does not say -
 * an older file, or a household whose contact was deleted - the first adult in
 * the file takes it, because a family with nobody at the head of it prints
 * without a name at the top of the card.
 */
function roleOf(row: Record<string, string>, isHead: boolean): HouseholdRole {
  if (isHead) return "head";
  if (flag(pick(row, HEADINGS.child))) return "child";
  if (/^married$/i.test(pick(row, HEADINGS.maritalStatus))) return "spouse";
  return "other";
}

function headIndex(rows: Record<string, string>[]): number {
  const marked = rows.findIndex((row) => flag(pick(row, HEADINGS.primary)));
  if (marked >= 0) return marked;
  const adult = rows.findIndex((row) => !flag(pick(row, HEADINGS.child)));
  return adult >= 0 ? adult : 0;
}

function addressOf(row: Record<string, string>) {
  return {
    address_line1: or(pick(row, HEADINGS.street1)),
    address_line2: or(pick(row, HEADINGS.street2)),
    city: or(pick(row, HEADINGS.city)),
    state: or(pick(row, HEADINGS.state)),
    postal_code: or(pick(row, HEADINGS.postal)),
    country: or(pick(row, HEADINGS.country)),
  };
}

/**
 * Whether somebody lives where their family lives.
 *
 * Deliberately forgiving about the parts of an address people leave out. An
 * export repeats the household's address on every member, but not always all
 * of it - a spouse's row with the street and the town and no state is the same
 * house, and treating it as a different one would hang a second copy of the
 * address on half the congregation. So the street has to match, and the town
 * and the postcode only have to not disagree.
 */
function sameAddress(a: ReturnType<typeof addressOf>, b: ReturnType<typeof addressOf>): boolean {
  const agree = (left: string | null, right: string | null) =>
    !left || !right || sortKey(left) === sortKey(right);

  const street = sortKey(a.address_line1, a.address_line2);
  if (!street) return true; // Nothing of their own: they are at the family's.
  return (
    street === sortKey(b.address_line1, b.address_line2) &&
    agree(a.city, b.city) &&
    agree(a.state, b.state) &&
    agree(a.postal_code, b.postal_code)
  );
}

function personName(row: Record<string, string>) {
  const first = pick(row, HEADINGS.firstName);
  const last = pick(row, HEADINGS.lastName);
  const nickname = pick(row, HEADINGS.nickname);
  return {
    first_name: first || nickname,
    last_name: last,
    preferred_name: nickname && sortKey(nickname) !== sortKey(first || nickname) ? nickname : null,
  };
}

/**
 * What importing this file would do, without doing any of it.
 *
 * Ids are made here rather than left to the database, because a person has to
 * be told which family they are joining in the same breath as the family is
 * written, and a plan that cannot say that is not a plan.
 */
export function planImport(
  fileName: string,
  table: SheetTable,
  live: LiveForImport,
  newId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const named = table.rows.filter((row) => {
    const { first_name, last_name } = personName(row);
    return Boolean(first_name || last_name);
  });

  const households: HouseholdDraft[] = [];
  const people: PersonDraft[] = [];
  let joining = 0;
  let alreadyHere = 0;

  /* Who the directory already has, by the family they are in. A name is
     compared against the family it is joining rather than against the whole
     congregation: two John Smiths in one church are two people, and a thousand
     people compared against a thousand people is a million name comparisons on
     a phone. */
  const byHousehold = new Map<string, LiveForImport["people"]>();
  for (const person of live.people) {
    const key = person.household_id ?? "";
    const found = byHousehold.get(key);
    if (found) found.push(person);
    else byHousehold.set(key, [person]);
  }

  // Surnames that turn up twice in the file get the head's first name in the
  // family name, which is the only thing that tells two of them apart on a
  // page: "The Siebert Family" twice is a directory with a mistake in it.
  const surnames = new Map<string, number>();
  for (const group of groupRows(named)) {
    const surname = surnameOf(
      pick(group.rows[0], HEADINGS.householdName),
      pick(group.rows[headIndex(group.rows)], HEADINGS.lastName),
    );
    const key = sortKey(surname);
    if (key) surnames.set(key, (surnames.get(key) ?? 0) + 1);
  }

  for (const group of groupRows(named)) {
    const rows = group.rows;
    const head = headIndex(rows);
    const surname = surnameOf(
      pick(rows[0], HEADINGS.householdName),
      pick(rows[head], HEADINGS.lastName),
    );
    const headName = personName(rows[head]);
    const shared = surnames.get(sortKey(surname)) ?? 0;
    const displayName = suggestHouseholdName(
      surname,
      shared > 1 ? (headName.preferred_name ?? headName.first_name) : undefined,
    );

    const address = addressOf(rows[head]);
    const existing = surname
      ? live.households.find((row) => sameDisplayName(row.display_name, displayName))
      : undefined;

    let householdId: string | null = existing?.id ?? null;
    if (surname && !existing) {
      householdId = newId();
      households.push({
        id: householdId,
        display_name: displayName,
        sort_name: surname,
        ...address,
        phone: or(pick(rows[head], HEADINGS.householdPhone)),
        email: null,
        anniversary: toIsoDate(pick(rows[head], HEADINGS.anniversary)),
        photo_path: null,
        notes: null,
        is_active: true,
      });
    }

    // A new family holds nobody yet, so nothing in it can be a duplicate.
    // Somebody with no family at all is compared against everybody who has
    // none either.
    const here = householdId ? (byHousehold.get(householdId) ?? []) : (byHousehold.get("") ?? []);

    rows.forEach((row, at) => {
      const name = personName(row);
      if (here.some((person) => samePersonName(person, name))) {
        alreadyHere += 1;
        return;
      }
      if (existing) joining += 1;

      const own = addressOf(row);
      const shares = sameAddress(own, address);
      people.push({
        id: newId(),
        household_id: householdId,
        household_role: householdId ? roleOf(row, at === head) : null,
        ...name,
        gender: genderOf(pick(row, HEADINGS.gender)),
        email: or(pick(row, HEADINGS.email)),
        phone: or(pick(row, HEADINGS.phone)),
        date_of_birth: toIsoDate(pick(row, HEADINGS.birthdate)),
        // The family carries the anniversary, because that is the one the book
        // prints. Putting it on both would have a couple's card say it twice.
        anniversary: householdId ? null : toIsoDate(pick(row, HEADINGS.anniversary)),
        use_household_address: Boolean(householdId) && shares,
        ...(householdId && shares
          ? {
              address_line1: null,
              address_line2: null,
              city: null,
              state: null,
              postal_code: null,
              country: null,
            }
          : own),
        photo_path: null,
        notes: or(pick(row, HEADINGS.medical)),
        background_check_on: toIsoDate(pick(row, HEADINGS.checkOn)),
        background_check_due: toIsoDate(pick(row, HEADINGS.checkDue)),
        sort_order: at,
        is_active: !/^inactive$/i.test(pick(row, HEADINGS.status)),
      });
    });
  }

  // Only the columns that actually carry something. A Planning Center export
  // is sixty-eight columns wide and most of them are empty for most churches,
  // so listing every heading we ignore would bury the handful that matter.
  const unmapped = table.headers.filter((heading) => {
    const name = normalize(heading);
    if (READ.has(name) || NOT_WORTH_SAYING.some((pattern) => pattern.test(name))) return false;
    return table.rows.some((row) => (row[heading] ?? "").trim());
  });

  return {
    fileName,
    rowsRead: table.rows.length,
    unnamed: table.rows.length - named.length,
    households,
    people,
    joining,
    alreadyHere,
    unmapped,
  };
}
