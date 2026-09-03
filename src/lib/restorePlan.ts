import { readZip, type UnzipEntry } from "./unzip";
import type {
  HouseholdRow,
  PersonRow,
  ProjectEntryRow,
  ProjectRow,
  TagRow,
} from "./database.types";

/**
 * What loading a backup back in would do.
 *
 * The reason any of this exists is the one on the backup page: an editor can
 * delete a family and there is no undo. Having the archive was only half of
 * that promise - restoring it meant creating a fresh Supabase project and
 * loading JSON by hand, which is not something the person who needs it at the
 * time is going to manage.
 *
 * There are two ways to use it, and they are very different sizes of action.
 *
 *   "missing"  Puts back records the file has and the directory no longer
 *              does, and touches nothing else. Nothing is overwritten, nothing
 *              is deleted. This is the answer to "somebody deleted the Smiths",
 *              which is the case the whole feature was built for, so it is the
 *              default.
 *
 *   "replace"  Empties the directory and loads the file exactly. Everything
 *              added since the backup was taken is gone. Destructive, no undo,
 *              and gated behind typing the word out on the page.
 *
 * Ids are carried across rather than regenerated, which is what makes any of
 * this work: people point at families and links point at both, so a restored
 * family has to come back as the same family it was.
 *
 * Everything in this file is a decision and none of it is a write, so the
 * archives that go wrong can be put to it directly - see
 * scripts/restore-check.ts. restore.ts is the other half, which sends what
 * this chooses.
 */

export interface BackupProject {
  project: ProjectRow;
  tagIds: string[];
  entries: ProjectEntryRow[];
}

export interface BackupFile {
  format: string;
  version: number;
  takenAt: string;
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
  projects: BackupProject[];
  photosIncluded: boolean;
  missingPhotos: string[];
}

export type RestoreMode = "missing" | "replace";

export interface RestoreProgress {
  done: number;
  total: number;
  label: string;
}

/** The live directory, as restoring needs to see it. */
export interface LiveDirectory {
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
  projects: ProjectRow[];
  /**
   * The group links as they stand. Used to describe what is missing before
   * anything is written - a record can survive while the group it was in is
   * quietly no longer recorded against it, and that is worth putting back
   * even though every family and person is present.
   */
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
}

/** What is in a chosen file, and what restoring it would come to. */
export interface RestorePlan {
  file: BackupFile;
  takenAt: Date | null;
  /** Photographs found in the archive, by their storage path. */
  photos: Map<string, Uint8Array>;
  /** Counts held in the file. */
  inFile: { households: number; people: number; tags: number; projects: number };
  /** Of those, the ones the live directory no longer has. */
  missing: { households: number; people: number; tags: number; projects: number; links: number };
  /** Records in the directory now that the file has never heard of. */
  newerThanBackup: { households: number; people: number };
}

export interface RestoreResult {
  added: { households: number; people: number; tags: number; projects: number };
  removed: { households: number; people: number; tags: number; projects: number };
  photosUploaded: number;
  /**
   * People whose family could not be found in the file or the directory. They
   * come back without one rather than not at all.
   */
  orphaned: number;
}

const decoder = new TextDecoder();

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((row) => typeof row === "object" && row !== null);
}

/**
 * Turns the bytes of a chosen file into a plan, without writing anything.
 *
 * Deliberately separate from applying it: the page shows what would happen and
 * waits, because "restore" is a word people press before they have understood
 * what it means.
 */
export async function readBackup(bytes: Uint8Array, live: LiveDirectory): Promise<RestorePlan> {
  let contents: UnzipEntry[];
  try {
    contents = await readZip(bytes);
  } catch (cause) {
    // The likeliest wrong file by far is the PDF that was made at the same
    // time, so say what was expected rather than repeating a parser's words.
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)} Choose the .zip file the ` +
        `backup page produced.`,
    );
  }

  const json = contents.find((entry) => entry.name === "directory.json");
  if (!json) {
    throw new Error(
      "That ZIP has no directory.json in it, so it is not a directory backup. The file to " +
        "choose is the one the backup page downloaded, whole and unchanged.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(json.data));
  } catch {
    throw new Error("The directory.json inside that archive is damaged and will not read.");
  }

  const raw = parsed as Partial<BackupFile>;
  if (raw?.format !== "church-directory-backup") {
    throw new Error("That file is a ZIP, but not one this app wrote.");
  }
  if (typeof raw.version !== "number" || raw.version > 1) {
    throw new Error(
      `That backup was written by a newer version of this app (format ${String(raw.version)}). ` +
        `Update the app before restoring it.`,
    );
  }
  // Missing record arrays mean a damaged or hand-edited file. Letting it
  // through as "empty" would make Replace everything an eraser.
  if (!isRowArray(raw.households) || !isRowArray(raw.people) || !isRowArray(raw.tags)) {
    throw new Error("That backup is missing its records and cannot be restored from.");
  }

  const backup: BackupFile = {
    format: raw.format,
    version: raw.version,
    takenAt: typeof raw.takenAt === "string" ? raw.takenAt : "",
    households: raw.households as unknown as HouseholdRow[],
    people: raw.people as unknown as PersonRow[],
    tags: raw.tags as unknown as TagRow[],
    householdTags: isRowArray(raw.householdTags)
      ? (raw.householdTags as unknown as BackupFile["householdTags"])
      : [],
    personTags: isRowArray(raw.personTags)
      ? (raw.personTags as unknown as BackupFile["personTags"])
      : [],
    projects: Array.isArray(raw.projects) ? (raw.projects as BackupProject[]) : [],
    photosIncluded: raw.photosIncluded === true,
    missingPhotos: Array.isArray(raw.missingPhotos) ? (raw.missingPhotos as string[]) : [],
  };

  const photos = new Map<string, Uint8Array>();
  for (const entry of contents) {
    if (entry.name.startsWith("photos/"))
      photos.set(entry.name.slice("photos/".length), entry.data);
  }

  const liveHouseholds = new Set(live.households.map((row) => row.id));
  const livePeople = new Set(live.people.map((row) => row.id));
  const liveTags = new Set(live.tags.map((row) => row.id));
  const liveProjects = new Set(live.projects.map((row) => row.id));

  const backupHouseholds = new Set(backup.households.map((row) => row.id));
  const backupPeople = new Set(backup.people.map((row) => row.id));

  const liveLinks = new Set([
    ...live.householdTags.map((link) => `h:${link.household_id}:${link.tag_id}`),
    ...live.personTags.map((link) => `p:${link.person_id}:${link.tag_id}`),
  ]);

  const takenAt = backup.takenAt ? new Date(backup.takenAt) : null;

  return {
    file: backup,
    takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
    photos,
    inFile: {
      households: backup.households.length,
      people: backup.people.length,
      tags: backup.tags.length,
      projects: backup.projects.length,
    },
    missing: {
      households: backup.households.filter((row) => !liveHouseholds.has(row.id)).length,
      people: backup.people.filter((row) => !livePeople.has(row.id)).length,
      tags: backup.tags.filter((row) => !liveTags.has(row.id)).length,
      projects: backup.projects.filter((row) => !liveProjects.has(row.project.id)).length,
      links:
        backup.householdTags.filter(
          (link) => !liveLinks.has(`h:${link.household_id}:${link.tag_id}`),
        ).length +
        backup.personTags.filter((link) => !liveLinks.has(`p:${link.person_id}:${link.tag_id}`))
          .length,
    },
    newerThanBackup: {
      households: live.households.filter((row) => !backupHouseholds.has(row.id)).length,
      people: live.people.filter((row) => !backupPeople.has(row.id)).length,
    },
  };
}

/** Exactly which rows a restore would write. */
export interface RestoreRows {
  tags: TagRow[];
  households: HouseholdRow[];
  people: PersonRow[];
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
  projects: ProjectRow[];
  projectTags: { project_id: string; tag_id: string }[];
  projectEntries: ProjectEntryRow[];
  /** Photographs to put back, by storage path. */
  photoPaths: string[];
  /** People whose family is in neither the file nor the directory. */
  orphaned: number;
}

/**
 * Decides what a restore writes.
 *
 * Every judgement worth getting right is here - which rows are missing, which
 * links have both ends, what to do with a person whose family is gone - so it
 * can be run against awkward archives rather than only ever being exercised by
 * pressing the button on a live congregation.
 *
 * `existingLinks` are the group links already in the database, in the shape
 * currentLinkKeys builds. Adding back can meet a link that is already there,
 * and inserting it again is a primary key collision that fails the whole batch.
 */
export function selectRows(
  file: BackupFile,
  live: LiveDirectory,
  mode: RestoreMode,
  existingLinks: Set<string> = new Set(),
  photos: Map<string, Uint8Array> = new Map(),
): RestoreRows {
  const liveHouseholds = new Set(live.households.map((row) => row.id));
  const livePeople = new Set(live.people.map((row) => row.id));
  const liveTags = new Set(live.tags.map((row) => row.id));
  const liveProjects = new Set(live.projects.map((row) => row.id));

  const replacing = mode === "replace";
  const keep = <T>(rows: T[], has: (row: T) => boolean) => (replacing ? rows : rows.filter(has));

  const tags = keep(file.tags, (row) => !liveTags.has(row.id));
  const households = keep(file.households, (row) => !liveHouseholds.has(row.id));
  const people = keep(file.people, (row) => !livePeople.has(row.id));
  const projects = keep(file.projects, (row) => !liveProjects.has(row.project.id));

  // What will exist once this has run: everything the file holds, plus - when
  // adding back rather than replacing - everything that is still here.
  const willHaveHousehold = new Set([
    ...file.households.map((row) => row.id),
    ...(replacing ? [] : liveHouseholds),
  ]);
  const willHaveTag = new Set([...file.tags.map((row) => row.id), ...(replacing ? [] : liveTags)]);
  const willHavePerson = new Set([
    ...file.people.map((row) => row.id),
    ...(replacing ? [] : livePeople),
  ]);

  // A person's family has to exist before the person can point at it. A backup
  // taken mid-delete can hold somebody whose family is in neither place; they
  // come back without one rather than taking the restore down with them.
  let orphaned = 0;
  const peopleToWrite = people.map((person) => {
    if (!person.household_id || willHaveHousehold.has(person.household_id)) return person;
    orphaned += 1;
    return { ...person, household_id: null, household_role: null };
  });

  // Links are only written where both ends will be there, and where the same
  // link is not recorded already. Replacing empties the tables first, so
  // nothing is already recorded however the caller filled `existingLinks` -
  // honouring it there would drop links that have to go back in.
  const already = replacing ? new Set<string>() : existingLinks;
  const householdTags = file.householdTags.filter(
    (link) =>
      willHaveHousehold.has(link.household_id) &&
      willHaveTag.has(link.tag_id) &&
      !already.has(`h:${link.household_id}:${link.tag_id}`),
  );
  const personTags = file.personTags.filter(
    (link) =>
      willHavePerson.has(link.person_id) &&
      willHaveTag.has(link.tag_id) &&
      !already.has(`p:${link.person_id}:${link.tag_id}`),
  );

  return {
    tags,
    households,
    people: peopleToWrite,
    householdTags,
    personTags,
    projects: projects.map((row) => row.project),
    projectTags: projects.flatMap((row) =>
      row.tagIds
        .filter((tagId) => willHaveTag.has(tagId))
        .map((tagId) => ({ project_id: row.project.id, tag_id: tagId })),
    ),
    projectEntries: projects.flatMap((row) =>
      row.entries.filter((entry) =>
        entry.entry_type === "household"
          ? willHaveHousehold.has(entry.ref_id)
          : willHavePerson.has(entry.ref_id),
      ),
    ),
    // Only pictures that are actually in the archive, and only for records
    // being written - a photograph nobody is restoring is not worth uploading.
    photoPaths: [
      ...new Set(
        [...households.map((row) => row.photo_path), ...people.map((row) => row.photo_path)].filter(
          (path): path is string => typeof path === "string" && photos.has(path),
        ),
      ),
    ],
    orphaned,
  };
}
