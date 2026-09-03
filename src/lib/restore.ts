import { PHOTO_BUCKET, supabase } from "./supabase";
import { readBackup, selectRows } from "./restorePlan";
import type {
  LiveDirectory,
  RestoreMode,
  RestorePlan,
  RestoreProgress,
  RestoreResult,
} from "./restorePlan";
import type {
  HouseholdRow,
  PersonRow,
  ProjectEntryRow,
  ProjectRow,
  TagRow,
} from "./database.types";

export * from "./restorePlan";

/**
 * Sending a restore to the database.
 *
 * restorePlan.ts has already decided what goes; this puts it there, in an order
 * that keeps the foreign keys satisfied, in batches a phone on church wifi can
 * manage.
 */

/** Rows sent per request. Large enough to be quick, small enough for a phone. */
const CHUNK = 200;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += CHUNK) out.push(rows.slice(at, at + CHUNK));
  return out;
}

/** Reads a chosen file and works out what restoring it would do. */
export async function readBackupFile(file: File, live: LiveDirectory): Promise<RestorePlan> {
  return readBackup(new Uint8Array(await file.arrayBuffer()), live);
}

/**
 * Each table gets its own writer.
 *
 * A single generic one would need the table name as a variable, and the
 * generated types collapse the moment `from()` is given anything but a literal
 * - which is the whole reason database.types.ts exists. Spelled out, every
 * insert below is checked against the columns it is actually writing.
 */
function fail(what: string, message: string): never {
  throw new Error(`${what}: ${message}`);
}

async function insertHouseholds(rows: HouseholdRow[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("households").insert(batch);
    if (error) fail("families", error.message);
  }
}

async function insertPeople(rows: PersonRow[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("people").insert(batch);
    if (error) fail("people", error.message);
  }
}

async function insertTags(rows: TagRow[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("tags").insert(batch);
    if (error) fail("groups", error.message);
  }
}

async function insertHouseholdTags(
  rows: { household_id: string; tag_id: string }[],
): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("household_tags").insert(batch);
    if (error) fail("groups on families", error.message);
  }
}

async function insertPersonTags(rows: { person_id: string; tag_id: string }[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("person_tags").insert(batch);
    if (error) fail("groups on people", error.message);
  }
}

async function insertProjects(rows: ProjectRow[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("projects").insert(batch);
    if (error) fail("directories", error.message);
  }
}

async function insertProjectTags(rows: { project_id: string; tag_id: string }[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("project_tags").insert(batch);
    if (error) fail("groups on directories", error.message);
  }
}

async function insertProjectEntries(rows: ProjectEntryRow[]): Promise<void> {
  for (const batch of chunked(rows)) {
    const { error } = await supabase.from("project_entries").insert(batch);
    if (error) fail("what is in each directory", error.message);
  }
}

/**
 * Empties the directory, children before parents.
 *
 * project_entries and the two tag link tables go with their owners by cascade,
 * so these four roots are enough. PostgREST refuses a delete with no filter,
 * which is a good rule to have; "id is not null" is how you say you meant it.
 */
async function clearAll(): Promise<void> {
  const projects = await supabase.from("projects").delete().not("id", "is", null);
  if (projects.error) fail("directories", projects.error.message);

  const people = await supabase.from("people").delete().not("id", "is", null);
  if (people.error) fail("people", people.error.message);

  const households = await supabase.from("households").delete().not("id", "is", null);
  if (households.error) fail("families", households.error.message);

  const tags = await supabase.from("tags").delete().not("id", "is", null);
  if (tags.error) fail("groups", tags.error.message);
}

/**
 * Puts the photographs back at the paths the records already point at.
 *
 * upsert, because a record that survived while its picture did not is exactly
 * the case worth repairing, and writing the same bytes over the same bytes
 * costs nothing. One unreadable photograph should not cost the restore of two
 * hundred families, so a failure here is counted rather than thrown.
 */
async function uploadPhotos(
  paths: string[],
  photos: Map<string, Uint8Array>,
  onEach: () => void,
): Promise<number> {
  let uploaded = 0;
  for (const path of paths) {
    const bytes = photos.get(path);
    onEach();
    if (!bytes) continue;
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, new Blob([bytes as BlobPart], { type: "image/jpeg" }), {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
    if (!error) uploaded += 1;
  }
  return uploaded;
}

/** The links already in the database, as keys, so a re-add does not collide. */
async function currentLinkKeys(): Promise<Set<string>> {
  const keys = new Set<string>();

  const households = await supabase.from("household_tags").select("household_id,tag_id");
  if (households.error) throw new Error(households.error.message);
  for (const link of households.data ?? []) keys.add(`h:${link.household_id}:${link.tag_id}`);

  const people = await supabase.from("person_tags").select("person_id,tag_id");
  if (people.error) throw new Error(people.error.message);
  for (const link of people.data ?? []) keys.add(`p:${link.person_id}:${link.tag_id}`);

  return keys;
}

export async function applyRestore(
  plan: RestorePlan,
  mode: RestoreMode,
  live: LiveDirectory,
  onProgress?: (progress: RestoreProgress) => void,
): Promise<RestoreResult> {
  const replacing = mode === "replace";

  // Read the existing links before deciding anything, so the decision is made
  // once and everything below is plumbing.
  const existingLinks = replacing ? new Set<string>() : await currentLinkKeys();
  const rows = selectRows(plan.file, live, mode, existingLinks, plan.photos);

  const steps = (replacing ? 1 : 0) + 5 + rows.photoPaths.length;
  let done = 0;
  const step = (label: string) => {
    done += 1;
    onProgress?.({ done, total: steps, label });
  };

  onProgress?.({ done: 0, total: steps, label: "Starting" });

  const removed = { households: 0, people: 0, tags: 0, projects: 0 };

  if (replacing) {
    await clearAll();
    removed.households = live.households.length;
    removed.people = live.people.length;
    removed.tags = live.tags.length;
    removed.projects = live.projects.length;
    step("Cleared the directory");
  }

  await insertTags(rows.tags);
  step(`Groups (${rows.tags.length})`);

  await insertHouseholds(rows.households);
  step(`Families (${rows.households.length})`);

  await insertPeople(rows.people);
  step(`People (${rows.people.length})`);

  await insertHouseholdTags(rows.householdTags);
  await insertPersonTags(rows.personTags);
  step("Groups on records");

  await insertProjects(rows.projects);
  await insertProjectTags(rows.projectTags);
  await insertProjectEntries(rows.projectEntries);
  step(`Directories (${rows.projects.length})`);

  let photosUploaded = 0;
  if (rows.photoPaths.length) {
    let n = 0;
    photosUploaded = await uploadPhotos(rows.photoPaths, plan.photos, () => {
      n += 1;
      step(`Photographs (${n} of ${rows.photoPaths.length})`);
    });
  }

  return {
    added: {
      households: rows.households.length,
      people: rows.people.length,
      tags: rows.tags.length,
      projects: rows.projects.length,
    },
    removed,
    photosUploaded,
    orphaned: rows.orphaned,
  };
}
