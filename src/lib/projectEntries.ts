import { byEntryOrder, personEntry, type DirectoryEntry } from "./entries";
import type { ProjectEntryRow, SelectionMode } from "./database.types";

export interface Selection {
  mode: SelectionMode;
  tagIds: string[];
  /** Explicit picks, in the order they should print. */
  entries: ProjectEntryRow[];
  /**
   * Whether the book prints families or individuals. Defaults to true, one
   * card per family, which is the main directory's answer and was the only
   * one there was. False prints one card per person, carrying only their own
   * details.
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
 * the house, and print their own photo, with the family's portrait standing
 * in where they have none - see personCardPhoto.
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

/** Everybody in one family, each as a record of their own. */
function everyMember(entry: Extract<DirectoryEntry, { type: "household" }>): DirectoryEntry[] {
  const household = entry.household;
  return household.members.map((member) =>
    personEntry(member, household, household.memberTags[member.id] ?? []),
  );
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
 * Any of them prints as families or as individuals. As families, a family is
 * one card with everyone in it and somebody on their own is a card of their
 * own. As individuals, every family comes apart into one card per person -
 * in a group, only the members who are in the group, since a list of the
 * deacons is not a list of their wives and children.
 */
export function resolveEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  const chosen = chooseEntries(all, selection);
  if (selection.wholeFamily !== false) return chosen;

  const wanted = selection.mode === "tags" ? new Set(selection.tagIds) : null;
  const split = chosen.flatMap((entry) =>
    entry.type === "person"
      ? [entry]
      : wanted
        ? membersInGroups(entry, wanted)
        : everyMember(entry),
  );
  // Sorted again rather than filtered in place: a wife keeping her own
  // surname, or a family filed under a name none of its members carry, files
  // somewhere else entirely once it is her record rather than the family's.
  return split.sort(byEntryOrder);
}

function chooseEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  if (selection.mode === "manual") {
    const picked = new Set(selection.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
    return all.filter((entry) => picked.has(`${entry.type}:${entry.id}`));
  }

  if (selection.mode === "tags") {
    if (!selection.tagIds.length) return [];
    const wanted = new Set(selection.tagIds);
    return all.filter((entry) => entry.tagIds.some((tagId) => wanted.has(tagId)));
  }

  return all;
}
