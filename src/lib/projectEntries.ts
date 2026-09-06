import { byEntryOrder, personEntry, type DirectoryEntry } from "./entries";
import type { ProjectEntryRow, SelectionMode } from "./database.types";

export interface Selection {
  mode: SelectionMode;
  tagIds: string[];
  /** Explicit picks, in the order they should print. */
  entries: ProjectEntryRow[];
  /**
   * Whether a group pulls in the whole family of everyone in it. Defaults to
   * true, which is the main directory's answer and was the only one there was.
   */
  wholeFamily?: boolean;
}

/**
 * The people of one family who are themselves in the group, each as a record
 * of their own.
 *
 * For the booklet that is a list of people rather than of families - the
 * deacons, the elders, the choristers - where printing the family card would
 * print everyone who lives with them. They keep the address they share with
 * the house, and the family's portrait stands in where they have no picture
 * of their own, which is nearly always - see personCardPhoto.
 */
function membersInGroups(
  entry: Extract<DirectoryEntry, { type: "household" }>,
  wanted: Set<string>,
): DirectoryEntry[] {
  const household = entry.household;
  const entries: DirectoryEntry[] = [];
  for (const member of household.members) {
    const tags = household.memberTags[member.id] ?? [];
    if (tags.some((tag) => wanted.has(tag.id))) entries.push(personEntry(member, household, tags));
  }
  return entries;
}

/**
 * Works out which records a project prints.
 *
 * Every mode stays alphabetical, because the point of the book is that you can
 * look someone up in it. "all" and "tags" also pick up new families on their
 * own - add someone to the choir in March and the choir booklet includes them
 * in April without anyone editing the project. "manual" is the escape hatch for
 * a one-off handout, and it filters the alphabetical list rather than following
 * the order the boxes happened to be ticked in.
 *
 * "tags" comes two ways: the families of everyone in the group, which is the
 * main directory's habit, or the people in it and nobody else, which is what a
 * list of deacons or elders is.
 */
export function resolveEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  if (selection.mode === "manual") {
    const picked = new Set(selection.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
    return all.filter((entry) => picked.has(`${entry.type}:${entry.id}`));
  }

  if (selection.mode === "tags") {
    if (!selection.tagIds.length) return [];
    const wanted = new Set(selection.tagIds);
    const matched = all.filter((entry) => entry.tagIds.some((tagId) => wanted.has(tagId)));
    if (selection.wholeFamily !== false) return matched;

    // Asked for the people in the group rather than their families. A family
    // that is in the group itself still prints as a family - somebody put the
    // household in, not one of the people who live there - so only the
    // families pulled in on a member's behalf come apart.
    const split = matched.flatMap((entry) => {
      if (entry.type === "person") return [entry];
      if (entry.household.tags.some((tag) => wanted.has(tag.id))) return [entry];
      return membersInGroups(entry, wanted);
    });
    // Sorted again rather than filtered in place: a wife keeping her own
    // surname, or a family filed under a name none of its members carry, files
    // somewhere else entirely once it is her record rather than the family's.
    return split.sort(byEntryOrder);
  }

  return all;
}
