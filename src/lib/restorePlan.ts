import { readZip, type UnzipEntry } from "./unzip";
import type {
  HouseholdRow,
  PersonRow,
  ProjectEntryRow,
  ProjectRow,
  TagRow,
} from "./database.types";
import { message } from "./format";
import { PHOTO_FOLDERS } from "./photoFolders";
import { COVER_PATH_KEYS } from "./backupSpec";

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
  /**
   * Every photograph in storage, by path, or null when that could not be
   * read. Knowing it is what lets a restore put back a picture that went
   * missing from a record that is still here, skip uploading the ones already
   * there, and tidy away the ones nothing points at after a replace. Without
   * it those three are simply not attempted.
   */
  storedPhotos?: Set<string> | null;
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
  missing: {
    households: number;
    people: number;
    tags: number;
    projects: number;
    links: number;
    /**
     * People still in the directory who lost their family when it was
     * deleted, and go back into it when it is restored.
     */
    reattach: number;
    /** Photographs of records still here whose picture is gone from storage. */
    photos: number;
  };
  /** Photographs in the archive that failed their checksum and are left out. */
  damagedPhotos: number;
  /**
   * Missing records that look as if they were typed in again since the
   * backup: a record added since with the same name. Restoring the original
   * as well would put the family or person in the directory twice.
   */
  typedAgain: { households: string[]; people: string[] };
  /**
   * Records in both the file and the directory whose details differ: edited
   * since the backup was taken. Only put back when chosen, one by one.
   */
  changed: ChangedRecord[];
  /** Records in the directory now that the file has never heard of. */
  newerThanBackup: { households: number; people: number };
}

/** A record the backup holds an earlier version of. */
export interface ChangedRecord {
  kind: "household" | "person";
  id: string;
  /** How the record is known now, for the list. */
  name: string;
  /** What differs, in words. */
  fields: string[];
  /** The backup's values for exactly the columns that differ. */
  patch: Record<string, unknown>;
  /** The record's updated_at when this was read, so a later edit is not overwritten. */
  updatedAt: string;
}

/** What the person chose on the page, beyond which of the two modes. */
export interface RestoreChoices {
  /** Leave out missing records that look as if they were typed in again. */
  skipTypedAgain?: boolean;
  /** Earlier versions to put back over records that are still here. */
  putBack?: ChangedRecord[];
}

export interface RestoreResult {
  added: { households: number; people: number; tags: number; projects: number };
  removed: { households: number; people: number; tags: number; projects: number };
  photosUploaded: number;
  /** Photographs that were meant to go back and could not be uploaded. */
  photosFailed: number;
  /** People put back into the family they belonged to. */
  reattached: number;
  /** Photographs nothing pointed at any more, removed after a replace. */
  photosRemoved: number;
  /** Records put back to the backup's version. */
  putBack: number;
  /** Chosen records edited again after the preview, and so left alone. */
  putBackSkipped: number;
  /** Missing records left out because they had been typed in again. */
  typedAgainSkipped: number;
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

/** The folders of the photo bucket the directory's records point into. */
export { PHOTO_FOLDERS } from "./photoFolders";

/** The cover artwork a directory's settings point at, if any. */
export function coverPaths(project: ProjectRow): string[] {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  return COVER_PATH_KEYS.map((key) => settings[key]).filter(
    (path): path is string => typeof path === "string" && path.trim() !== "",
  );
}

const squash = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";

/**
 * Missing records that were typed in again since the backup, file id to the
 * id they have now.
 *
 * Deleting somebody by mistake and then entering them again by hand is the
 * obvious repair, and the new record has a new id - so to a restore the
 * original is simply missing, and putting it back makes two. A match is a
 * record added since the backup (one the file has never heard of) with the
 * same name - and, for a person, the same birthday. Only one-to-one matches
 * count: two new John Smiths for one missing is not something to guess at.
 */
export function findTypedAgain(
  file: BackupFile,
  live: LiveDirectory,
): { households: Map<string, string>; people: Map<string, string> } {
  const pair = <F extends { id: string }, L extends { id: string }>(
    missing: F[],
    added: L[],
    keyOfFile: (row: F) => string,
    keyOfLive: (row: L) => string,
  ) => {
    const group = <T>(rows: T[], key: (row: T) => string) => {
      const out = new Map<string, T[]>();
      for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
      return out;
    };
    const was = group(missing, keyOfFile);
    const now = group(added, keyOfLive);
    const matched = new Map<string, string>();
    for (const [key, rows] of was) {
      const here = now.get(key);
      if (rows.length === 1 && here?.length === 1) matched.set(rows[0].id, here[0].id);
    }
    return matched;
  };

  const fileHouseholds = new Set(file.households.map((row) => row.id));
  const filePeople = new Set(file.people.map((row) => row.id));
  const liveHouseholds = new Set(live.households.map((row) => row.id));
  const livePeople = new Set(live.people.map((row) => row.id));

  const familyKey = (row: HouseholdRow) => `${squash(row.display_name)}|${squash(row.sort_name)}`;
  const personKey = (row: PersonRow) =>
    `${squash(row.first_name)}|${squash(row.last_name)}|${row.date_of_birth ?? ""}`;

  return {
    households: pair(
      file.households.filter((row) => !liveHouseholds.has(row.id)),
      live.households.filter((row) => !fileHouseholds.has(row.id)),
      familyKey,
      familyKey,
    ),
    people: pair(
      file.people.filter((row) => !livePeople.has(row.id)),
      live.people.filter((row) => !filePeople.has(row.id)),
      personKey,
      personKey,
    ),
  };
}

/** Columns that are bookkeeping, not details anybody edited. */
const NOT_DETAILS = new Set(["id", "created_at", "updated_at", "updated_by"]);

/** What a column is called on screen, so a list of changes reads as words. */
const FIELD_NAMES: Record<string, string> = {
  display_name: "name",
  sort_name: "name",
  first_name: "name",
  last_name: "name",
  preferred_name: "name",
  address_line1: "address",
  address_line2: "address",
  city: "address",
  state: "address",
  postal_code: "address",
  country: "address",
  use_household_address: "address",
  household_id: "family",
  household_role: "family",
  sort_order: "family",
  date_of_birth: "birthday",
  photo_path: "photograph",
  photo_fit: "photograph",
  is_active: "in printed directories",
  office_label: "office label",
  background_check_on: "background check",
  background_check_due: "background check",
};

/**
 * Records the backup holds an earlier version of.
 *
 * Only columns both sides have are compared, so a backup from before or after
 * a migration does not report a column one side has never had. A person's
 * move to another family is a change like any other, but is only offered back
 * where that family is still here to go back into.
 */
export function findChanged(file: BackupFile, live: LiveDirectory): ChangedRecord[] {
  const liveHouseholds = new Map(live.households.map((row) => [row.id, row]));
  const livePeople = new Map(live.people.map((row) => [row.id, row]));

  const differ = (
    was: Record<string, unknown>,
    now: Record<string, unknown>,
    skip: Set<string> = new Set(),
  ) => {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(was)) {
      if (NOT_DETAILS.has(key) || skip.has(key) || !(key in now)) continue;
      if (JSON.stringify(value ?? null) !== JSON.stringify(now[key] ?? null)) patch[key] = value;
    }
    return patch;
  };
  const describe = (patch: Record<string, unknown>) => [
    ...new Set(Object.keys(patch).map((key) => FIELD_NAMES[key] ?? key.replace(/_/g, " "))),
  ];

  const changed: ChangedRecord[] = [];
  for (const was of file.households) {
    const now = liveHouseholds.get(was.id);
    if (!now) continue;
    const patch = differ(was, now);
    if (!Object.keys(patch).length) continue;
    changed.push({
      kind: "household",
      id: was.id,
      name: now.display_name,
      fields: describe(patch),
      patch,
      updatedAt: now.updated_at,
    });
  }
  for (const was of file.people) {
    const now = livePeople.get(was.id);
    if (!now) continue;
    const familyGone = Boolean(was.household_id) && !liveHouseholds.has(was.household_id!);
    const patch = differ(
      was,
      now,
      familyGone ? new Set(["household_id", "household_role", "sort_order"]) : undefined,
    );
    if (!Object.keys(patch).length) continue;
    changed.push({
      kind: "person",
      id: was.id,
      name: `${now.preferred_name || now.first_name} ${now.last_name}`.trim(),
      fields: describe(patch),
      patch,
      updatedAt: now.updated_at,
    });
  }
  return changed.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Finds the backup inside a chosen archive.
 *
 * Usually directory.json sits at the top. But a person who unzipped the file
 * to look inside and then zipped it up again with Finder's Compress or
 * Windows' Send to > Compressed folder gets everything one folder down, under
 * the folder's name - and macOS adds a __MACOSX folder of resource forks
 * beside it. Both are the same backup, so both are read.
 */
function locateBackup(contents: UnzipEntry[]): { json: UnzipEntry; root: string } | null {
  const usable = contents.filter(
    (entry) => !entry.name.startsWith("__MACOSX/") && !/(^|\/)\._/.test(entry.name),
  );
  const top = usable.find((entry) => entry.name === "directory.json");
  if (top) return { json: top, root: "" };

  const nested = usable.filter((entry) => /^[^/]+\/directory\.json$/.test(entry.name));
  if (nested.length !== 1) return null;
  return { json: nested[0], root: nested[0].name.slice(0, -"directory.json".length) };
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
    throw new Error(`${message(cause)} Choose the .zip file the backup page produced.`);
  }

  const found = locateBackup(contents);
  if (!found) {
    throw new Error(
      "That ZIP has no directory.json in it, so it is not a directory backup. The file to " +
        "choose is the one the backup page downloaded, whole and unchanged.",
    );
  }

  const { json, root } = found;
  if (!json.intact) {
    throw new Error(
      "The directory.json inside that archive is damaged - it does not match the checksum " +
        "it was saved with. Try another copy of the backup.",
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

  // A photograph that fails its checksum is left out rather than uploaded:
  // putting back a corrupt picture would replace a gap nobody minds with a
  // broken image in the printed book.
  const photos = new Map<string, Uint8Array>();
  let damagedPhotos = 0;
  const photoPrefix = `${root}photos/`;
  for (const entry of contents) {
    if (!entry.name.startsWith(photoPrefix)) continue;
    if (entry.intact) photos.set(entry.name.slice(photoPrefix.length), entry.data);
    else damagedPhotos += 1;
  }

  const liveHouseholds = new Set(live.households.map((row) => row.id));
  const livePeople = new Set(live.people.map((row) => row.id));
  const liveProjects = new Set(live.projects.map((row) => row.id));

  const backupHouseholds = new Set(backup.households.map((row) => row.id));
  const backupPeople = new Set(backup.people.map((row) => row.id));

  const liveLinks = new Set([
    ...live.householdTags.map((link) => `h:${link.household_id}:${link.tag_id}`),
    ...live.personTags.map((link) => `p:${link.person_id}:${link.tag_id}`),
  ]);

  const takenAt = backup.takenAt ? new Date(backup.takenAt) : null;

  // The two figures that depend on how records relate, rather than on which
  // ids are present, come from the same function the restore itself runs, so
  // the preview cannot promise something the restore then does not do.
  const adding = selectRows(backup, live, "missing", liveLinks, photos);
  const typedAgain = findTypedAgain(backup, live);
  const nameOf = new Map([
    ...backup.households.map((row) => [row.id, row.display_name] as const),
    ...backup.people.map(
      (row) => [row.id, `${row.preferred_name || row.first_name} ${row.last_name}`.trim()] as const,
    ),
  ]);

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
      // Groups and links from the same decision the restore makes, so a group
      // that is here under a new id is not promised as "missing".
      tags: adding.tags.length,
      projects: backup.projects.filter((row) => !liveProjects.has(row.project.id)).length,
      links: adding.householdTags.length + adding.personTags.length,
      reattach: adding.reattach.length,
      photos: adding.repairedPhotos,
    },
    damagedPhotos,
    typedAgain: {
      households: [...typedAgain.households.keys()].map((id) => nameOf.get(id) ?? id),
      people: [...typedAgain.people.keys()].map((id) => nameOf.get(id) ?? id),
    },
    changed: findChanged(backup, live),
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
  /**
   * People still in the directory whose family is being restored, or is
   * already back but empty, and who were in it when the backup was taken. Deleting a family does not delete
   * its members - the database only clears their link to it - so without this
   * a restored family comes back empty, with its members beside it.
   */
  reattach: Pick<PersonRow, "id" | "household_id" | "household_role" | "sort_order">[];
  /** Photographs to put back, by storage path. */
  photoPaths: string[];
  /** Of those, the ones for records that are already in the directory. */
  repairedPhotos: number;
  /**
   * Photographs in storage that nothing will point at once a replace has run.
   * Only ever filled when replacing, and only when storage could be listed.
   */
  photosToRemove: string[];
  /** People whose family is in neither the file nor the directory. */
  orphaned: number;
  /** Missing records left out because they were typed in again. */
  typedAgainSkipped: number;
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
  choices: RestoreChoices = {},
): RestoreRows {
  const liveHouseholds = new Set(live.households.map((row) => row.id));
  const livePeople = new Set(live.people.map((row) => row.id));
  const liveTags = new Set(live.tags.map((row) => row.id));
  const liveProjects = new Set(live.projects.map((row) => row.id));

  const replacing = mode === "replace";
  const keep = <T>(rows: T[], has: (row: T) => boolean) => (replacing ? rows : rows.filter(has));

  // A group deleted and then made again under the same name has a new id. The
  // name is unique, so writing the old one back would be refused - and groups
  // go in first, so that refusal would stop the whole restore, every time it
  // was tried. The group that is here already is the same group as far as
  // anybody can tell, so the file's links are pointed at it instead.
  const liveTagByName = new Map(live.tags.map((row) => [row.name, row.id]));
  const sameGroup = new Map<string, string>();
  if (!replacing) {
    for (const row of file.tags) {
      const here = liveTagByName.get(row.name);
      if (!liveTags.has(row.id) && here) sameGroup.set(row.id, here);
    }
  }
  const tagId = (id: string) => sameGroup.get(id) ?? id;

  // Families and people typed in again since the backup, when the person
  // restoring has said to treat them as the same: not written twice, and
  // everything that pointed at the original points at the one here now.
  const typedAgain =
    !replacing && choices.skipTypedAgain
      ? findTypedAgain(file, live)
      : { households: new Map<string, string>(), people: new Map<string, string>() };
  const householdId = (id: string) => typedAgain.households.get(id) ?? id;
  const personId = (id: string) => typedAgain.people.get(id) ?? id;

  const tags = keep(file.tags, (row) => !liveTags.has(row.id) && !sameGroup.has(row.id));
  const households = keep(
    file.households,
    (row) => !liveHouseholds.has(row.id) && !typedAgain.households.has(row.id),
  );
  const people = keep(
    file.people,
    (row) => !livePeople.has(row.id) && !typedAgain.people.has(row.id),
  );
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
    if (!person.household_id) return person;
    const family = householdId(person.household_id);
    if (willHaveHousehold.has(family)) {
      return family === person.household_id ? person : { ...person, household_id: family };
    }
    orphaned += 1;
    return { ...person, household_id: null, household_role: null };
  });

  // Links are only written where both ends will be there, and where the same
  // link is not recorded already. Replacing empties the tables first, so
  // nothing is already recorded however the caller filled `existingLinks` -
  // honouring it there would drop links that have to go back in.
  const already = replacing ? new Set<string>() : existingLinks;
  const householdTags = file.householdTags
    .map((link) => ({ household_id: householdId(link.household_id), tag_id: tagId(link.tag_id) }))
    .filter(
      (link) =>
        willHaveHousehold.has(link.household_id) &&
        willHaveTag.has(link.tag_id) &&
        !already.has(`h:${link.household_id}:${link.tag_id}`),
    );
  const personTags = file.personTags
    .map((link) => ({ person_id: personId(link.person_id), tag_id: tagId(link.tag_id) }))
    .filter(
      (link) =>
        willHavePerson.has(link.person_id) &&
        willHaveTag.has(link.tag_id) &&
        !already.has(`p:${link.person_id}:${link.tag_id}`),
    );

  // Members left behind when their family was deleted. Only people who have
  // no family now, and who were in that family in the file, and only into a
  // family that is either being put back now or is already back but empty.
  //
  // The second kind is a family an earlier restore brought back without its
  // people: one that stopped part way, after the families went in and before
  // anybody was put back into them, or one run before this existed. Running
  // the restore again has to finish that job. A family that still has members
  // is left alone, so somebody an editor took out of it on purpose, or has
  // since moved into another family, stays where they are.
  const occupied = new Set(live.people.map((row) => row.household_id).filter(Boolean));
  const reattachable = new Set([
    ...households.map((row) => row.id),
    ...live.households.filter((row) => !occupied.has(row.id)).map((row) => row.id),
  ]);
  const livePeopleById = new Map(live.people.map((row) => [row.id, row]));
  const reattach = replacing
    ? []
    : file.people
        .filter((person) => {
          if (!person.household_id || !reattachable.has(householdId(person.household_id))) {
            return false;
          }
          const now = livePeopleById.get(person.id);
          return now !== undefined && !now.household_id;
        })
        .map((person) => ({
          id: person.id,
          household_id: person.household_id ? householdId(person.household_id) : null,
          household_role: person.household_role,
          sort_order: person.sort_order ?? 0,
        }));

  // Photographs. For records being written, every picture the archive has.
  // For records already here, the ones whose picture has gone from storage -
  // which can only be known when storage was listed. Either way, a picture
  // already in storage is not uploaded again: its path is a fresh id each time
  // a photograph is saved, so the same path is the same picture.
  const stored = live.storedPhotos ?? null;
  const wanted = (path: string) => photos.has(path) && !(stored?.has(path) ?? false);

  const writtenPaths = [
    ...households.map((row) => row.photo_path),
    ...people.map((row) => row.photo_path),
    ...projects.flatMap((row) => coverPaths(row.project)),
  ].filter((path): path is string => typeof path === "string" && path !== "");

  const writtenIds = new Set([
    ...households.map((row) => row.id),
    ...people.map((row) => row.id),
    ...projects.map((row) => row.project.id),
  ]);
  const survivingPaths =
    replacing || !stored
      ? []
      : [
          ...live.households.filter((row) => !writtenIds.has(row.id)).map((row) => row.photo_path),
          ...live.people.filter((row) => !writtenIds.has(row.id)).map((row) => row.photo_path),
          ...live.projects.filter((row) => !writtenIds.has(row.id)).flatMap(coverPaths),
        ].filter((path): path is string => typeof path === "string" && path !== "");

  const photoPaths = [...new Set(writtenPaths.filter(wanted))];
  const repairs = [...new Set(survivingPaths.filter(wanted))].filter(
    (path) => !photoPaths.includes(path),
  );

  // After a replace, the only pictures anything points at are the file's.
  const referenced = new Set([
    ...file.households.map((row) => row.photo_path),
    ...file.people.map((row) => row.photo_path),
    ...file.projects.flatMap((row) => coverPaths(row.project)),
  ]);
  const photosToRemove =
    replacing && stored
      ? [...stored].filter(
          (path) =>
            PHOTO_FOLDERS.some((folder) => path.startsWith(`${folder}/`)) && !referenced.has(path),
        )
      : [];

  return {
    tags,
    households,
    people: peopleToWrite,
    householdTags,
    personTags,
    projects: projects.map((row) => row.project),
    projectTags: projects.flatMap((row) =>
      row.tagIds
        .map(tagId)
        .filter((id) => willHaveTag.has(id))
        .map((id) => ({ project_id: row.project.id, tag_id: id })),
    ),
    projectEntries: projects.flatMap((row) =>
      row.entries
        .map((entry) => ({
          ...entry,
          ref_id:
            entry.entry_type === "household" ? householdId(entry.ref_id) : personId(entry.ref_id),
        }))
        .filter((entry) =>
          entry.entry_type === "household"
            ? willHaveHousehold.has(entry.ref_id)
            : willHavePerson.has(entry.ref_id),
        ),
    ),
    typedAgainSkipped: typedAgain.households.size + typedAgain.people.size,
    reattach,
    photoPaths: [...photoPaths, ...repairs],
    repairedPhotos: repairs.length,
    photosToRemove,
    orphaned,
  };
}
