import type { DirectoryData } from "./entries";
import type { ProfileRow, ProjectEntryRow, ProjectRow } from "./database.types";
import { toCsv, type CsvValue } from "./csv";
import { familiesCsv, peopleCsv } from "./backupSpec";
import { buildZipBlob, type ZipEntry } from "./zip";
import { downloadPhoto } from "./photos";
import { fetchProfiles, fetchProject, fetchProjects } from "./queries";
import { coverPaths } from "./restorePlan";

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
  file: Blob;
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

/**
 * Who could sign in, and as what.
 *
 * Accounts live in Supabase's own sign-in system, which a backup cannot write
 * back into: a password is not something this app ever sees. But a church
 * moving to a new project has to invite everybody again and give each of them
 * the right role, and this list is what saves them from reconstructing it
 * from memory. Reference only; a restore never reads it.
 */
function administratorsCsv(profiles: ProfileRow[]): string {
  const rows: CsvValue[][] = profiles.map((profile) => [
    profile.full_name,
    profile.email,
    profile.role,
    profile.is_active,
  ]);
  return toCsv(["Name", "Email", "Role", "Has access"], rows);
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
    "  administrators.csv",
    "                  Who could sign in, and with what role. For reference:",
    "                  accounts are not restored, so after moving to a new",
    "                  project, invite these people again from this list.",
    "  photos/         Every photograph and directory cover, in the folders the",
    "                  app stores them in.",
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
    "  Open the app's Backup page and choose this file. It will tell you what is",
    "  in it and what is missing from the directory before writing anything, and",
    "  can either put back only what has been lost or replace the lot.",
    "",
    "  Starting again from nothing instead: create a fresh Supabase project, run",
    "  the files in supabase/migrations, then restore this archive as above.",
    "",
    "  Keep this archive somewhere that is not the same place as the database -",
    "  a backup stored next to the thing it backs up is not a backup.",
    "",
    "  These files contain the congregation's home addresses and phone numbers.",
    "  Treat the archive the way you would treat the printed directory.",
    "",
  ].join("\n");
}

/**
 * How many photographs are fetched at once.
 *
 * They were fetched one at a time, and a directory of two hundred faces is
 * then two hundred round trips end to end - minutes of them, on the church
 * wifi this is actually run on, for a button the README asks somebody to press
 * once a month and again before every print run. Six is the budget a browser
 * already keeps for one host and sits well inside the storage API's rate
 * limit, and it turns the wait into one a person will sit through.
 */
const PHOTO_AT_A_TIME = 6;

/**
 * Runs `work` over every item with at most `limit` of them in flight.
 *
 * Each worker takes the next index that nobody has taken. Results go wherever
 * `work` puts them - nothing here collects them - because the caller wants
 * them back in the order it asked, not the order they arrived.
 */
async function inParallel<T>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}

/** Hands a finished archive to the browser as a download. */
export function saveBackupFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function buildBackup(options: BackupOptions): Promise<BackupResult> {
  const { data, includePhotos, onProgress, signal } = options;
  const when = new Date();

  onProgress?.({ done: 0, total: 1, label: "Collecting directories" });

  const projects: { project: ProjectRow; tagIds: string[]; entries: ProjectEntryRow[] }[] = [];
  for (const row of await fetchProjects()) {
    projects.push(await fetchProject(row.id));
  }

  // The directories' cover artwork lives in the same bucket as the portraits,
  // and a directory restored without it prints with a gap where its cover was.
  const photoPaths = [
    ...new Set(
      [
        ...data.households.map((row) => row.photo_path),
        ...data.people.map((row) => row.photo_path),
        ...projects.flatMap((row) => coverPaths(row.project)),
      ].filter((path): path is string => Boolean(path)),
    ),
  ];

  // Projects, then one step per photograph, then the archive itself.
  const total = 2 + (includePhotos ? photoPaths.length : 0);
  let done = 0;
  const step = (label: string) => {
    done += 1;
    onProgress?.({ done, total, label });
  };
  step("Collecting directories");

  const missingPhotos: string[] = [];
  const entries: ZipEntry[] = [];

  if (includePhotos) {
    if (signal?.aborted) throw new Error("Backup cancelled.");

    const fetched = new Array<Uint8Array | null>(photoPaths.length).fill(null);
    await inParallel(photoPaths, PHOTO_AT_A_TIME, async (path, index) => {
      if (signal?.aborted) return;
      fetched[index] = await downloadPhoto(path);
      // `done` counts the directories step too, so the photographs finished
      // so far - this one included - are everything after it.
      step(`Photographs (${done} of ${photoPaths.length})`);
    });
    if (signal?.aborted) throw new Error("Backup cancelled.");

    // Filed in the order they were asked for rather than the order they came
    // back, so the archive holds the same photographs in the same places
    // however the fetches happened to interleave.
    for (const [index, path] of photoPaths.entries()) {
      const bytes = fetched[index];
      if (bytes) entries.push({ name: `photos/${path}`, data: bytes });
      else missingPhotos.push(path);
    }
  }

  const photoCount = entries.length;

  // Not worth failing a backup over: the directory is the part that matters.
  const profiles = await fetchProfiles().catch(() => null);

  entries.unshift(
    { name: "README.txt", data: text(readme(data, photoCount, when)) },
    { name: "families.csv", data: text(familiesCsv(data)) },
    { name: "people.csv", data: text(peopleCsv(data)) },
    { name: "groups.csv", data: text(groupsCsv(data)) },
    ...(profiles ? [{ name: "administrators.csv", data: text(administratorsCsv(profiles)) }] : []),
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
    file: buildZipBlob(entries, when),
    fileName: `church-directory-backup-${stamp}.zip`,
    photoCount,
    missingPhotos,
  };
}
