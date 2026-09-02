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

/** Throws Supabase errors as plain Errors so callers can just try/catch. */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/**
 * Supabase caps an unqualified select at 1000 rows and says nothing about it,
 * which for a congregation of 1200 would quietly print a directory missing 200
 * people. Every full-table read pages explicitly instead.
 */
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  table: "households" | "people" | "tags" | "household_tags" | "person_tags",
  orderBy?: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy);

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
    fetchAll<HouseholdRow>("households", "sort_name"),
    fetchAll<PersonRow>("people", "last_name"),
    fetchAll<TagRow>("tags", "name"),
    fetchAll<{ household_id: string; tag_id: string }>("household_tags"),
    fetchAll<{ person_id: string; tag_id: string }>("person_tags"),
  ]);

  return { households, people, tags, householdTags, personTags };
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

export type HouseholdInput = Omit<HouseholdRow, "id" | "created_at" | "updated_at">;

export async function createHousehold(input: HouseholdInput): Promise<HouseholdRow> {
  return unwrap(await supabase.from("households").insert(input).select().single());
}

export async function updateHousehold(id: string, patch: Partial<HouseholdInput>): Promise<HouseholdRow> {
  return unwrap(await supabase.from("households").update(patch).eq("id", id).select().single());
}

export async function deleteHousehold(id: string): Promise<void> {
  const { error } = await supabase.from("households").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PersonInput = Omit<PersonRow, "id" | "created_at" | "updated_at">;

export async function createPerson(input: PersonInput): Promise<PersonRow> {
  return unwrap(await supabase.from("people").insert(input).select().single());
}

export async function updatePerson(id: string, patch: Partial<PersonInput>): Promise<PersonRow> {
  return unwrap(await supabase.from("people").update(patch).eq("id", id).select().single());
}

export async function deletePerson(id: string): Promise<void> {
  const { error } = await supabase.from("people").delete().eq("id", id);
  if (error) throw new Error(error.message);
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

export async function createTag(name: string, color: string, description: string | null): Promise<TagRow> {
  return unwrap(await supabase.from("tags").insert({ name, color, description }).select().single());
}

export async function updateTag(id: string, patch: Partial<TagRow>): Promise<TagRow> {
  return unwrap(await supabase.from("tags").update(patch).eq("id", id).select().single());
}

export async function deleteTag(id: string): Promise<void> {
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Replaces the whole tag set for one household or person.
 *
 * Written as two explicit branches rather than one parameterised query: the
 * join tables have different key columns, and spelling them out keeps the
 * query types checkable.
 */
export async function setTags(
  kind: "household" | "person",
  id: string,
  tagIds: string[],
): Promise<void> {
  if (kind === "household") {
    const remove = await supabase.from("household_tags").delete().eq("household_id", id);
    if (remove.error) throw new Error(remove.error.message);
    if (!tagIds.length) return;
    const insert = await supabase
      .from("household_tags")
      .insert(tagIds.map((tag_id) => ({ household_id: id, tag_id })));
    if (insert.error) throw new Error(insert.error.message);
    return;
  }

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

export async function fetchProjects(): Promise<ProjectRow[]> {
  return unwrap(await supabase.from("projects").select("*").order("created_at", { ascending: false }));
}

export async function fetchProject(id: string): Promise<ProjectWithSelection> {
  const [project, tags, entries] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("project_tags").select("*").eq("project_id", id),
    supabase.from("project_entries").select("*").eq("project_id", id).order("position"),
  ]);

  return {
    project: unwrap(project) as ProjectRow,
    tagIds: unwrap(tags).map((row) => row.tag_id),
    entries: unwrap(entries) as ProjectEntryRow[],
  };
}

export type ProjectInput = Pick<
  ProjectRow,
  "name" | "kind" | "description" | "selection_mode" | "settings"
>;

export async function createProject(input: ProjectInput): Promise<ProjectRow> {
  return unwrap(await supabase.from("projects").insert(input).select().single());
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<ProjectRow> {
  return unwrap(await supabase.from("projects").update(patch).eq("id", id).select().single());
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setProjectTags(projectId: string, tagIds: string[]): Promise<void> {
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
  const remove = await supabase.from("project_entries").delete().eq("project_id", projectId);
  if (remove.error) throw new Error(remove.error.message);
  if (!entries.length) return;

  const insert = await supabase.from("project_entries").insert(
    entries.map((entry, position) => ({ project_id: projectId, position, ...entry })),
  );
  if (insert.error) throw new Error(insert.error.message);
}

// ---------------------------------------------------------------------------
// Administrators
// ---------------------------------------------------------------------------

export async function fetchProfiles(): Promise<ProfileRow[]> {
  return unwrap(await supabase.from("profiles").select("*").order("created_at"));
}

export async function updateProfile(id: string, patch: Partial<ProfileRow>): Promise<ProfileRow> {
  return unwrap(await supabase.from("profiles").update(patch).eq("id", id).select().single());
}
