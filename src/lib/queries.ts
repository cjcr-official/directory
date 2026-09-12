import { supabase } from "./supabase";
import type {
  HouseholdRow,
  PersonRow,
  ProfileRow,
  ProjectEntryRow,
  ProjectRow,
  TagRow,
} from "./database.types";
import type { DirectoryData } from "./entries";

/**
 * Postgres speaks in constraint names. A person reading the screen should not
 * have to.
 */
function readable(error: { code?: string; message: string }, subject: string): string {
  if (error.code === "23505") return `A ${subject} with that name already exists.`;
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return `You do not have permission to change ${subject}s. Ask an owner for editor access.`;
  }
  return error.message;
}

/** Throws Supabase errors as plain Errors so callers can just try/catch. */
function unwrap<T>(
  result: { data: T | null; error: { code?: string; message: string } | null },
  subject?: string,
): T {
  if (result.error)
    throw new Error(subject ? readable(result.error, subject) : result.error.message);
  return result.data as T;
}

/**
 * Supabase caps an unqualified select at 1000 rows and says nothing about it,
 * which for a congregation of 1200 would quietly print a directory missing 200
 * people. Every full-table read pages explicitly instead.
 */
const PAGE_SIZE = 1000;

/**
 * A total order for every paged read.
 *
 * Paging with range() and no tiebreak is the same bug in a second costume:
 * PostgreSQL is free to return rows tied on the sort column in a different
 * order for each page, so a row can arrive twice or not at all at a page
 * boundary. Surnames are not unique and the join tables had no order at all,
 * which for a congregation over a thousand could drop somebody from a group
 * booklet with nothing on screen to say so. Each list below ends in something
 * unique - a primary key, or the pair that makes one.
 */
const PAGED_ORDER = {
  households: ["sort_name", "id"],
  people: ["last_name", "id"],
  tags: ["name", "id"],
  household_tags: ["household_id", "tag_id"],
  person_tags: ["person_id", "tag_id"],
  profiles: ["created_at", "id"],
} as const;

/**
 * Every row of one table, a page at a time.
 *
 * Exported because the restore needs the two link tables by themselves, and
 * reaching for `supabase.from(...).select()` there reintroduced exactly the
 * silent thousand-row cap this function exists to defeat. One pager, used
 * everywhere a whole table is read.
 */
export async function fetchAll<T>(table: keyof typeof PAGED_ORDER): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    for (const column of PAGED_ORDER[table]) query = query.order(column);

    const page = unwrap(await query) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Directory data
// ---------------------------------------------------------------------------

/**
 * Pulls the whole directory.
 *
 * A congregation is small data - a thousand people is well under a megabyte -
 * so the app loads it once and does all filtering, sorting and pagination in
 * the browser. That keeps every screen instant and makes the PDF builder work
 * from exactly the same rows the screen showed.
 */
export async function fetchDirectory(): Promise<DirectoryData> {
  const [households, people, tags, householdTags, personTags] = await Promise.all([
    fetchAll<HouseholdRow>("households"),
    fetchAll<PersonRow>("people"),
    fetchAll<TagRow>("tags"),
    fetchAll<{ household_id: string; tag_id: string }>("household_tags"),
    fetchAll<{ person_id: string; tag_id: string }>("person_tags"),
  ]);

  return { households, people, tags, householdTags, personTags };
}

/**
 * Whether anybody has been added since a given moment.
 *
 * The directory is fetched once and kept in memory, which is what makes every
 * screen instant - and also what makes a second administrator's work invisible
 * until the page is reloaded. The notification tray asks this instead: one
 * column, one row, no ordering, and an answer of yes or no. It is the cheapest
 * question this app puts to the database, which is what lets it be asked on a
 * timer without anybody noticing.
 *
 * A yes is followed by a full reload, deliberately. Fetching the new people
 * alone would leave the tray listing somebody the rest of the app has never
 * heard of, and a link to a record that is not there.
 */
export async function anyPersonAddedSince(iso: string): Promise<boolean> {
  const rows = unwrap(
    await supabase.from("people").select("id").gt("created_at", iso).limit(1),
  ) as { id: string }[];
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

export type HouseholdInput = Omit<HouseholdRow, "id" | "created_at" | "updated_at" | "updated_by">;

/**
 * Takes the author column back out of anything on its way to the database.
 *
 * 0005 stamps updated_by from a trigger, so a value sent from here is
 * discarded anyway - but sending one is not harmless. A form seeds itself with
 * `{ ...existing }`, which carries every column the row came back with, and
 * PostgREST refuses the whole save over a column it cannot write. Never
 * mentioning it is cheaper than noticing afterwards that it was refused.
 *
 * Applied at the write itself rather than trusted to each caller, so a new
 * screen cannot reintroduce it by spreading a row it just read.
 */
export function withoutAuthor<T extends object>(patch: T): Omit<T, "updated_by"> {
  const { updated_by: _stamped, ...rest } = patch as T & { updated_by?: unknown };
  return rest as Omit<T, "updated_by">;
}

export async function createHousehold(input: HouseholdInput): Promise<HouseholdRow> {
  return unwrap(await supabase.from("households").insert(withoutAuthor(input)).select().single());
}

/** Removes one row by primary key. The three tables that need nothing else. */
async function removeById(table: "households" | "people" | "projects", id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Raised when a record was saved by somebody else while this browser had it
 * open. The write is refused rather than applied, because applying it would
 * throw their work away without either of them being told.
 */
export class StaleWriteError extends Error {
  readonly stale = true;
  constructor(what: string) {
    super(
      `Somebody else saved this ${what} while you had it open. Nothing has been saved, ` +
        `so their changes are still there.`,
    );
    this.name = "StaleWriteError";
  }
}

export function isStaleWrite(error: unknown): boolean {
  return error instanceof StaleWriteError;
}

/**
 * Says why a guarded write matched nothing.
 *
 * Either the row moved on or it is not there at all, and those two want
 * different words, so ask which it was rather than guessing.
 */
async function explainMiss(
  table: "households" | "people" | "projects",
  what: string,
  id: string,
): Promise<never> {
  const check = await supabase.from(table).select("id").eq("id", id).maybeSingle();
  if (check.error) throw new Error(check.error.message);
  if (!check.data) throw new Error(`That ${what} no longer exists.`);
  throw new StaleWriteError(what);
}

/**
 * Writes a family, refusing if it has moved underneath us.
 *
 * updated_at is maintained by a trigger, so the value a form loaded with is a
 * fingerprint of the version it was editing. Adding it to the where clause
 * makes the update land only while that is still the current version - two
 * people editing one family used to mean whoever saved second silently won,
 * and the first one's work was gone with nothing on screen about it.
 *
 * Without an expected value it behaves as it always did, which is what a fresh
 * record wants.
 */
export async function updateHousehold(
  id: string,
  patch: Partial<HouseholdInput>,
  expectedUpdatedAt?: string | null,
): Promise<HouseholdRow> {
  let query = supabase.from("households").update(withoutAuthor(patch)).eq("id", id);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);

  const rows = unwrap(await query.select()) as HouseholdRow[];
  return rows[0] ?? (await explainMiss("households", "family", id));
}

export async function deleteHousehold(id: string): Promise<void> {
  return removeById("households", id);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PersonInput = Omit<PersonRow, "id" | "created_at" | "updated_at" | "updated_by">;

export async function createPerson(input: PersonInput): Promise<PersonRow> {
  return unwrap(await supabase.from("people").insert(withoutAuthor(input)).select().single());
}

/** As updateHousehold, guarded the same way and for the same reason. */
export async function updatePerson(
  id: string,
  patch: Partial<PersonInput>,
  expectedUpdatedAt?: string | null,
): Promise<PersonRow> {
  let query = supabase.from("people").update(withoutAuthor(patch)).eq("id", id);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);

  const rows = unwrap(await query.select()) as PersonRow[];
  return rows[0] ?? (await explainMiss("people", "person", id));
}

export async function deletePerson(id: string): Promise<void> {
  return removeById("people", id);
}

/** Moves a person into a household, or out of one when householdId is null. */
export async function setPersonHousehold(
  personId: string,
  householdId: string | null,
  role: PersonRow["household_role"],
  sortOrder: number,
): Promise<void> {
  const { error } = await supabase
    .from("people")
    .update({ household_id: householdId, household_role: role, sort_order: sortOrder })
    .eq("id", personId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function createTag(
  name: string,
  color: string,
  description: string | null,
): Promise<TagRow> {
  return unwrap(
    await supabase.from("tags").insert({ name, color, description }).select().single(),
    "group",
  );
}

export async function updateTag(id: string, patch: Partial<TagRow>): Promise<TagRow> {
  return unwrap(await supabase.from("tags").update(patch).eq("id", id).select().single());
}

/**
 * Deletes a group, and insists on having actually deleted one.
 *
 * A policy that forbids the delete does not raise: its USING clause simply
 * matches no rows, so the statement succeeds having removed nothing. The list
 * then reloads and looks for all the world as though it worked - until the
 * name is used again and the database says it is taken. Asking for the deleted
 * row back is what turns that silence into a sentence.
 */
export async function deleteTag(id: string): Promise<void> {
  const { data, error } = await supabase.from("tags").delete().eq("id", id).select("id");
  if (error) throw new Error(readable(error, "group"));
  if (!data?.length) {
    throw new Error(
      "That group was not deleted. You may not have permission to change groups, " +
        "or somebody else removed it first — reload and check.",
    );
  }
}

/**
 * PostgREST could not find the function it was asked for.
 *
 * Migrations here are pasted into the SQL editor by hand while the deploy goes
 * out on its own, so a build can reach the site before 0003 reaches the
 * database. That is not an error worth showing anyone - it just means the old
 * path is still the only one available.
 */
function missingFunction(error: { code?: string; message: string }): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message);
}

/**
 * True when the write went through the single-statement function, false when
 * the database has not got it yet and the caller should do it the old way.
 *
 * The two-statement way leaves a moment with the links deleted and the
 * replacements not yet written, and a connection that drops there loses them
 * outright. 0003 adds functions that do both halves inside one transaction.
 */
async function tryReplaceLinks(
  call: PromiseLike<{ error: { code?: string; message: string } | null }>,
): Promise<boolean> {
  const { error } = await call;
  if (!error) return true;
  if (missingFunction(error)) return false;
  throw new Error(error.message);
}

/**
 * Replaces the whole tag set for one household or person.
 *
 * The fallbacks are written out per table rather than shared: the join tables
 * have different key columns, and spelling them out keeps the query types
 * checkable, which a Record<string, unknown> row would not.
 */
export async function setTags(
  kind: "household" | "person",
  id: string,
  tagIds: string[],
): Promise<void> {
  if (kind === "household") {
    if (
      await tryReplaceLinks(
        supabase.rpc("set_household_tags", { p_household_id: id, p_tag_ids: tagIds }),
      )
    )
      return;

    const remove = await supabase.from("household_tags").delete().eq("household_id", id);
    if (remove.error) throw new Error(remove.error.message);
    if (!tagIds.length) return;
    const insert = await supabase
      .from("household_tags")
      .insert(tagIds.map((tag_id) => ({ household_id: id, tag_id })));
    if (insert.error) throw new Error(insert.error.message);
    return;
  }

  if (
    await tryReplaceLinks(supabase.rpc("set_person_tags", { p_person_id: id, p_tag_ids: tagIds }))
  )
    return;

  const remove = await supabase.from("person_tags").delete().eq("person_id", id);
  if (remove.error) throw new Error(remove.error.message);
  if (!tagIds.length) return;
  const insert = await supabase
    .from("person_tags")
    .insert(tagIds.map((tag_id) => ({ person_id: id, tag_id })));
  if (insert.error) throw new Error(insert.error.message);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectWithSelection {
  project: ProjectRow;
  tagIds: string[];
  entries: ProjectEntryRow[];
}

/**
 * Every saved directory, newest first.
 *
 * Paged, and ordered on the primary key underneath the timestamp, for the
 * reason the pager above gives: projects accumulate for as long as a church
 * keeps printing, and an unpaged read would one day return the first thousand
 * and let the backup quietly leave the rest out. created_at is not unique -
 * two directories duplicated in one click share it - so it cannot page on its
 * own.
 */
export async function fetchProjects(): Promise<ProjectRow[]> {
  const rows: ProjectRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const page = unwrap(
      await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + PAGE_SIZE - 1),
    ) as ProjectRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * A hand-picked directory names one row per record, so this is the one project
 * read that can pass a thousand rows - and an unpaged select would have taken
 * the first thousand and printed a book quietly missing the rest. Position is
 * unique within a project, so it orders the pages on its own.
 */
async function fetchProjectEntries(projectId: string): Promise<ProjectEntryRow[]> {
  const rows: ProjectEntryRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const page = unwrap(
      await supabase
        .from("project_entries")
        .select("*")
        .eq("project_id", projectId)
        .order("position")
        .range(from, from + PAGE_SIZE - 1),
    ) as ProjectEntryRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function fetchProject(id: string): Promise<ProjectWithSelection> {
  const [project, tags, entries] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("project_tags").select("*").eq("project_id", id),
    fetchProjectEntries(id),
  ]);

  return {
    project: unwrap(project) as ProjectRow,
    tagIds: unwrap(tags).map((row) => row.tag_id),
    entries,
  };
}

export type ProjectInput = Pick<
  ProjectRow,
  "name" | "kind" | "description" | "selection_mode" | "settings"
>;

export async function createProject(input: ProjectInput): Promise<ProjectRow> {
  return unwrap(await supabase.from("projects").insert(input).select().single());
}

/**
 * As updateHousehold, guarded the same way and for the same reason.
 *
 * A directory is one row that decides how a whole booklet prints, and two
 * people tidying it before a print run is exactly when it gets edited at all.
 * Whoever saved second used to win, quietly, and the settings the first one
 * chose were gone with nothing on screen about it.
 */
export async function updateProject(
  id: string,
  patch: Partial<ProjectInput>,
  expectedUpdatedAt?: string | null,
): Promise<ProjectRow> {
  let query = supabase.from("projects").update(patch).eq("id", id);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);

  const rows = unwrap(await query.select()) as ProjectRow[];
  return rows[0] ?? (await explainMiss("projects", "directory", id));
}

export async function deleteProject(id: string): Promise<void> {
  return removeById("projects", id);
}

export async function setProjectTags(projectId: string, tagIds: string[]): Promise<void> {
  if (
    await tryReplaceLinks(
      supabase.rpc("set_project_tags", { p_project_id: projectId, p_tag_ids: tagIds }),
    )
  )
    return;

  const remove = await supabase.from("project_tags").delete().eq("project_id", projectId);
  if (remove.error) throw new Error(remove.error.message);
  if (!tagIds.length) return;

  const insert = await supabase
    .from("project_tags")
    .insert(tagIds.map((tagId) => ({ project_id: projectId, tag_id: tagId })));
  if (insert.error) throw new Error(insert.error.message);
}

export async function setProjectEntries(
  projectId: string,
  entries: { entry_type: "household" | "person"; ref_id: string }[],
): Promise<void> {
  if (
    await tryReplaceLinks(
      supabase.rpc("set_project_entries", { p_project_id: projectId, p_entries: entries }),
    )
  )
    return;

  const remove = await supabase.from("project_entries").delete().eq("project_id", projectId);
  if (remove.error) throw new Error(remove.error.message);
  if (!entries.length) return;

  const insert = await supabase
    .from("project_entries")
    .insert(entries.map((entry, position) => ({ project_id: projectId, position, ...entry })));
  if (insert.error) throw new Error(insert.error.message);
}

// ---------------------------------------------------------------------------
// Administrators
// ---------------------------------------------------------------------------

/**
 * The roster, oldest account first.
 *
 * Through the pager like every other whole-table read. A church office is never
 * going to have a thousand administrators, so this is consistency rather than a
 * fix: there is now one way to read a table here, which is what stops the next
 * one of these being written the short way and quietly stopping at a thousand.
 */
export async function fetchProfiles(): Promise<ProfileRow[]> {
  return fetchAll<ProfileRow>("profiles");
}

export async function updateProfile(id: string, patch: Partial<ProfileRow>): Promise<ProfileRow> {
  return unwrap(await supabase.from("profiles").update(patch).eq("id", id).select().single());
}

/**
 * Removes the sign-in account itself, not just its row on the roster.
 *
 * Deleting the profile alone would leave the account behind: the person could
 * still sign in, land on "your account is not set up", and never be able to
 * register that email address again. So this goes through the function added
 * by migration 0007, which deletes from auth.users and lets the profile follow.
 *
 * Who may do it is decided there and not here - owners only, never their own
 * account - because a rule enforced in the browser is a rule enforced for
 * whoever has not opened the network tab. The page hides the button; the
 * database is what refuses.
 *
 * The message is passed through as the database wrote it. The usual rewriting
 * of Postgres's wording is for constraint names nobody should have to read;
 * these refusals are already sentences, and better ones than a generic line
 * about permissions.
 *
 * The one exception is the function not being there at all, which is not a
 * refusal but a directory whose database has not caught up with its app. The
 * app is deployed by a push and the migrations are run by hand, so that gap is
 * ordinary rather than exotic - and PostgREST describes it as a missing schema
 * cache entry, which tells the person reading it nothing about what to do.
 */
export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_account", { p_user_id: id });
  if (!error) return;
  if (error.code === "PGRST202" || /delete_account/.test(error.message)) {
    throw new Error(
      "This database has not run supabase/migrations/0007_account_deletion.sql yet, " +
        "so accounts cannot be deleted from here. Run it in the Supabase SQL editor.",
    );
  }
  throw new Error(error.message);
}
