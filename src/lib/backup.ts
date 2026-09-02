import type { DirectoryData } from "./entries";
import type { ProjectEntryRow, ProjectRow, TagRow } from "./database.types";
import { toCsv, type CsvValue } from "./csv";
import { buildZip, type ZipEntry } from "./zip";
import { downloadPhoto } from "./photos";
import { fetchProject, fetchProjects } from "./queries";
import { formatPhone } from "./format";

/**
 * A complete, self-contained copy of the directory as a single ZIP.
 *
 * The point is recovering from a bad afternoon: an editor can delete any family
 * and there is no undo, so this exists to make that an annoyance rather than a
 * disaster. It is deliberately readable without this app - the CSVs open in any
 * spreadsheet, the photographs are ordinary JPEGs in folders - and complete
 * enough to rebuild from, via directory.json.
 */

export interface BackupProgress {
  done: number;
  total: number;
  label: string;
}

export interface BackupResult {
  bytes: Uint8Array;
  fileName: string;
  photoCount: number;
  /** Photos referenced by a record but missing from storage. */
  missingPhotos: string[];
}

export interface BackupOptions {
  data: DirectoryData;
  includePhotos: boolean;
  onProgress?: (progress: BackupProgress) => void;
  signal?: AbortSignal;
}

const encoder = new TextEncoder();
const text = (value: string): Uint8Array => encoder.encode(value);

function tagNames(tags: TagRow[], ids: string[]): string {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .join("; ");
}

function familiesCsv(data: DirectoryData): string {
  const linked = new Map<string, string[]>();
  for (const link of data.householdTags) {
    linked.set(link.household_id, [...(linked.get(link.household_id) ?? []), link.tag_id]);
  }

  const rows: CsvValue[][] = data.households.map((household) => [
    household.display_name,
    household.sort_name,
    household.address_line1,
    household.address_line2,
    household.city,
    household.state,
    household.postal_code,
    household.country,
    formatPhone(household.phone),
    household.email,
    household.anniversary,
    tagNames(data.tags, linked.get(household.id) ?? []),
    household.notes,
    household.is_active,
    household.photo_path ? `photos/${household.photo_path}` : "",
    household.id,
  ]);

  return toCsv(
    [
      "Family name",
      "Files under",
      "Address line 1",
      "Address line 2",
      "City",
      "State",
      "ZIP",
      "Country",
      "Home phone",
      "Family email",
      "Anniversary",
      "Groups",
      "Notes",
      "In printed directories",
      "Photo file",
      "Id",
    ],
    rows,
  );
}

function peopleCsv(data: DirectoryData): string {
  const linked = new Map<string, string[]>();
  for (const link of data.personTags) {
    linked.set(link.person_id, [...(linked.get(link.person_id) ?? []), link.tag_id]);
  }
  const households = new Map(data.households.map((h) => [h.id, h.display_name]));

  const rows: CsvValue[][] = data.people.map((person) => [
    person.last_name,
    person.first_name,
    person.preferred_name,
    person.household_id ? (households.get(person.household_id) ?? "") : "",
    person.household_role,
    formatPhone(person.phone),
    person.email,
    person.date_of_birth,
    person.anniversary,
    person.use_household_address,
    person.address_line1,
    person.address_line2,
    person.city,
    person.state,
    person.postal_code,
    person.country,
    tagNames(data.tags, linked.get(person.id) ?? []),
    person.notes,
    person.is_active,
    person.photo_path ? `photos/${person.photo_path}` : "",
    person.id,
  ]);

  return toCsv(
    [
      "Last name",
      "First name",
      "Goes by",
      "Family",
      "Role in family",
      "Phone",
      "Email",
      "Date of birth",
      "Anniversary",
      "Uses family address",
      "Address line 1",
      "Address line 2",
      "City",
      "State",
      "ZIP",
      "Country",
      "Groups",
      "Notes",
      "In printed directories",
      "Photo file",
      "Id",
    ],
    rows,
  );
}

function groupsCsv(data: DirectoryData): string {
  const rows: CsvValue[][] = data.tags.map((tag) => [
    tag.name,
    tag.description,
    data.householdTags.filter((link) => link.tag_id === tag.id).length,
    data.personTags.filter((link) => link.tag_id === tag.id).length,
    tag.color,
    tag.id,
  ]);
  return toCsv(["Group", "Description", "Families", "People", "Colour", "Id"], rows);
}

function readme(data: DirectoryData, photoCount: number, when: Date): string {
  return [
    "CHURCH DIRECTORY - BACKUP",
    "",
    `Taken ${when.toLocaleString()}`,
    `${data.households.length} families, ${data.people.length} people, ${data.tags.length} groups, ${photoCount} photographs`,
    "",
    "WHAT IS IN HERE",
    "",
    "  families.csv    One row per family. Opens in Excel, Numbers or Sheets.",
    "  people.csv      One row per person, with the family they belong to.",
    "  groups.csv      The group labels and how many records carry each.",
    "  photos/         Every photograph, in the folders the app stores them in.",
    "  directory.json  The same information exactly as the database holds it,",
    "                  including the ids that link people to families. This is",
    "                  the file to restore from.",
    "",
    "READING IT WITHOUT THE APP",
    "",
    "  The CSVs are plain text and need nothing but a spreadsheet. The 'Photo",
    "  file' column gives the path inside this archive, so you can find anyone's",
    "  picture by hand.",
    "",
    "RESTORING",
    "",
    "  Create a fresh Supabase project, run the two files in supabase/migrations,",
    "  then load directory.json. Keep this archive somewhere that is not the same",
    "  place as the database - a backup stored next to the thing it backs up is",
    "  not a backup.",
    "",
    "  These files contain the congregation's home addresses and phone numbers.",
    "  Treat the archive the way you would treat the printed directory.",
    "",
  ].join("\n");
}

export async function buildBackup(options: BackupOptions): Promise<BackupResult> {
  const { data, includePhotos, onProgress, signal } = options;
  const when = new Date();

  const photoPaths = [
    ...new Set(
      [
        ...data.households.map((row) => row.photo_path),
        ...data.people.map((row) => row.photo_path),
      ].filter((path): path is string => Boolean(path)),
    ),
  ];

  // Text first, then projects, then one step per photograph.
  const total = 2 + (includePhotos ? photoPaths.length : 0);
  let done = 0;
  const step = (label: string) => {
    done += 1;
    onProgress?.({ done, total, label });
  };

  onProgress?.({ done: 0, total, label: "Collecting records" });

  const projects: { project: ProjectRow; tagIds: string[]; entries: ProjectEntryRow[] }[] = [];
  for (const row of await fetchProjects()) {
    projects.push(await fetchProject(row.id));
  }
  step("Collecting directories");

  const missingPhotos: string[] = [];
  const entries: ZipEntry[] = [];

  if (includePhotos) {
    for (const path of photoPaths) {
      if (signal?.aborted) throw new Error("Backup cancelled.");
      const bytes = await downloadPhoto(path);
      if (bytes) entries.push({ name: `photos/${path}`, data: bytes });
      else missingPhotos.push(path);
      step(`Photographs (${done - 1} of ${photoPaths.length})`);
    }
  }

  const photoCount = entries.length;

  entries.unshift(
    { name: "README.txt", data: text(readme(data, photoCount, when)) },
    { name: "families.csv", data: text(familiesCsv(data)) },
    { name: "people.csv", data: text(peopleCsv(data)) },
    { name: "groups.csv", data: text(groupsCsv(data)) },
    {
      name: "directory.json",
      data: text(
        JSON.stringify(
          {
            format: "church-directory-backup",
            version: 1,
            takenAt: when.toISOString(),
            households: data.households,
            people: data.people,
            tags: data.tags,
            householdTags: data.householdTags,
            personTags: data.personTags,
            projects,
            photosIncluded: includePhotos,
            missingPhotos,
          },
          null,
          2,
        ),
      ),
    },
  );

  step("Writing the archive");

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;

  return {
    bytes: buildZip(entries, when),
    fileName: `church-directory-backup-${stamp}.zip`,
    photoCount,
    missingPhotos,
  };
}
