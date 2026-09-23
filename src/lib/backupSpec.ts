import type { DirectoryData } from "./entries";
import type { HouseholdRow, PersonRow, TagRow } from "./database.types";
import { toCsv, type CsvValue } from "./csv";
import { formatPhone } from "./format";

/**
 * What a backup covers, declared where a check can hold it to the database.
 *
 * A backup quietly goes out of date the day somebody adds a column or a table
 * and nobody thinks of the backup page. The first you hear of it is the
 * restore that brings everything back except the thing that was added. So
 * everything the backup has to know about the shape of the data lives here,
 * and scripts/backup-coverage-check.ts reads the migrations and fails the
 * build until each new table, column, photo folder and cover-art setting is
 * either covered or written down below as deliberately left out, with why.
 *
 * Pure: no database, no browser. That is what lets the check import it.
 */

/**
 * Every table the directory's data lives in: read into directory.json,
 * written back by a restore, and emptied and refilled by replace_directory.
 * `inFile` is the key the table goes under in directory.json.
 */
export const DIRECTORY_TABLES = {
  households: { inFile: "households" },
  people: { inFile: "people" },
  tags: { inFile: "tags" },
  household_tags: { inFile: "householdTags" },
  person_tags: { inFile: "personTags" },
  projects: { inFile: "projects" },
  project_tags: { inFile: "projects" },
  project_entries: { inFile: "projects" },
} as const;

/** Tables that are not in a backup, and why. A new table goes in one list or the other. */
export const OUTSIDE_BACKUP: Record<string, string> = {
  profiles:
    "Accounts belong to Supabase's sign-in system, which a restore cannot write into. " +
    "The list is in administrators.csv for reference.",
  backup_log: "A record of backups taken. Not directory data, and restoring it would make it lie.",
};

/** The storage folders photographs are saved into. A new one must be backed up too. */
export { PHOTO_FOLDERS } from "./photoFolders";

/**
 * Directory settings that hold a path into the photo bucket. Their pictures
 * go into the backup and come back with the directory.
 */
export const COVER_PATH_KEYS = ["coverPhotoPath", "coverLogoPath"] as const;

/** Bookkeeping columns every table may have, which no spreadsheet needs. */
const BOOKKEEPING = {
  created_at: "When the row was made. In directory.json.",
  updated_at: "When the row last changed. In directory.json.",
  updated_by: "Which account last changed it. Not restorable: the restorer becomes the author.",
};

// ---------------------------------------------------------------------------
// The spreadsheets
// ---------------------------------------------------------------------------

interface Lookups {
  /** Group names for a record, joined for one cell. */
  groups: (id: string) => string;
  /** A family's name, by id. */
  familyName: (id: string) => string;
}

interface Column<Row> {
  header: string;
  /** The database column this shows, when it shows one. */
  column?: keyof Row & string;
  value: (row: Row, lookups: Lookups) => CsvValue;
}

const photoFile = (path: string | null) => (path ? `photos/${path}` : "");

export const FAMILY_COLUMNS: Column<HouseholdRow>[] = [
  { header: "Family name", column: "display_name", value: (row) => row.display_name },
  { header: "Files under", column: "sort_name", value: (row) => row.sort_name },
  { header: "Address line 1", column: "address_line1", value: (row) => row.address_line1 },
  { header: "Address line 2", column: "address_line2", value: (row) => row.address_line2 },
  { header: "City", column: "city", value: (row) => row.city },
  { header: "State", column: "state", value: (row) => row.state },
  { header: "ZIP", column: "postal_code", value: (row) => row.postal_code },
  { header: "Country", column: "country", value: (row) => row.country },
  { header: "Home phone", column: "phone", value: (row) => formatPhone(row.phone) },
  { header: "Family email", column: "email", value: (row) => row.email },
  { header: "Anniversary", column: "anniversary", value: (row) => row.anniversary },
  { header: "Groups", value: (row, lookups) => lookups.groups(row.id) },
  { header: "Notes", column: "notes", value: (row) => row.notes },
  // Office-only, and in the spreadsheet for the same reason it is in the
  // JSON: a backup that cannot rebuild what was on screen is not a backup.
  {
    header: "Which one (office only)",
    column: "office_label",
    value: (row) => row.office_label ?? "",
  },
  { header: "In printed directories", column: "is_active", value: (row) => row.is_active },
  { header: "Photo file", column: "photo_path", value: (row) => photoFile(row.photo_path) },
  { header: "Photo shape", column: "photo_fit", value: (row) => row.photo_fit ?? "" },
  { header: "Id", column: "id", value: (row) => row.id },
];

export const PERSON_COLUMNS: Column<PersonRow>[] = [
  { header: "Last name", column: "last_name", value: (row) => row.last_name },
  { header: "First name", column: "first_name", value: (row) => row.first_name },
  { header: "Goes by", column: "preferred_name", value: (row) => row.preferred_name },
  {
    header: "Family",
    column: "household_id",
    value: (row, lookups) => (row.household_id ? lookups.familyName(row.household_id) : ""),
  },
  { header: "Role in family", column: "household_role", value: (row) => row.household_role },
  { header: "Gender", column: "gender", value: (row) => row.gender },
  { header: "Phone", column: "phone", value: (row) => formatPhone(row.phone) },
  { header: "Email", column: "email", value: (row) => row.email },
  { header: "Date of birth", column: "date_of_birth", value: (row) => row.date_of_birth },
  { header: "Anniversary", column: "anniversary", value: (row) => row.anniversary },
  {
    header: "Uses family address",
    column: "use_household_address",
    value: (row) => row.use_household_address,
  },
  { header: "Address line 1", column: "address_line1", value: (row) => row.address_line1 },
  { header: "Address line 2", column: "address_line2", value: (row) => row.address_line2 },
  { header: "City", column: "city", value: (row) => row.city },
  { header: "State", column: "state", value: (row) => row.state },
  { header: "ZIP", column: "postal_code", value: (row) => row.postal_code },
  { header: "Country", column: "country", value: (row) => row.country },
  { header: "Groups", value: (row, lookups) => lookups.groups(row.id) },
  { header: "Notes", column: "notes", value: (row) => row.notes },
  // Office-only and never printed, and in the spreadsheet for the reason
  // everything office-only is: a backup that cannot rebuild what was on
  // screen is not a backup. Whoever opens people.csv to work out who is due
  // wants these two beside the name.
  {
    header: "Background check done",
    column: "background_check_on",
    value: (row) => row.background_check_on,
  },
  {
    header: "Background check due",
    column: "background_check_due",
    value: (row) => row.background_check_due,
  },
  { header: "In printed directories", column: "is_active", value: (row) => row.is_active },
  { header: "Photo file", column: "photo_path", value: (row) => photoFile(row.photo_path) },
  { header: "Photo shape", column: "photo_fit", value: (row) => row.photo_fit ?? "" },
  { header: "Id", column: "id", value: (row) => row.id },
];

/**
 * Columns of the two record tables that are not in their spreadsheet, and
 * why. Everything is in directory.json whatever this says - it is written from
 * whole rows - so this is only about what a person opening the CSV sees.
 */
export const NOT_IN_SPREADSHEET: Record<"households" | "people", Record<string, string>> = {
  households: { ...BOOKKEEPING },
  people: {
    ...BOOKKEEPING,
    sort_order: "The order within a family. Shown by the rows' order, and in directory.json.",
  },
};

function linksBy<K extends string>(links: Record<K | "tag_id", string>[], key: K) {
  const out = new Map<string, string[]>();
  for (const link of links) out.set(link[key], [...(out.get(link[key]) ?? []), link.tag_id]);
  return out;
}

function groupLookup(tags: TagRow[], linked: Map<string, string[]>) {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]));
  return (id: string) =>
    (linked.get(id) ?? [])
      .map((tag) => byId.get(tag))
      .filter(Boolean)
      .join("; ");
}

function sheet<Row>(columns: Column<Row>[], rows: Row[], lookups: Lookups): string {
  return toCsv(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => column.value(row, lookups))),
  );
}

export function familiesCsv(data: DirectoryData): string {
  return sheet(FAMILY_COLUMNS, data.households, {
    groups: groupLookup(data.tags, linksBy(data.householdTags, "household_id")),
    familyName: () => "",
  });
}

export function peopleCsv(data: DirectoryData): string {
  const families = new Map(data.households.map((row) => [row.id, row.display_name]));
  return sheet(PERSON_COLUMNS, data.people, {
    groups: groupLookup(data.tags, linksBy(data.personTags, "person_id")),
    familyName: (id) => families.get(id) ?? "",
  });
}
