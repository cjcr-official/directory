import { byEntryOrder, personEntry, type DirectoryEntry } from "./entries";
import type { HouseholdWithMembers } from "./entries";
import type { PersonRow, ProjectEntryRow, SelectionMode } from "./database.types";

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
 * Some of one family's members, each as a record of their own.
 *
 * For the booklet that is a list of people rather than of families - the
 * deacons, the elders, the choristers, the people hand-picked for a name tag -
 * where printing the family card would print everyone who lives with them.
 * They keep the address they share with the house, and print their own photo,
 * with the family's portrait standing in where they have none - see
 * personCardPhoto.
 */
function membersWhere(
  entry: Extract<DirectoryEntry, { type: "household" }>,
  include: (member: PersonRow) => boolean,
): DirectoryEntry[] {
  const household = entry.household;
  return household.members
    .filter(include)
    .map((member) => personEntry(member, household, household.memberTags[member.id] ?? []));
}

/**
 * Which members of a family print when it comes apart into people.
 *
 * In a group, the members who are in the group. Picked by hand, everyone when
 * the family itself was ticked, and otherwise only the people who were.
 * Everyone, when the directory is everyone.
 */
function memberTest(
  household: HouseholdWithMembers,
  selection: Selection,
  picked: Set<string>,
): (member: PersonRow) => boolean {
  if (selection.mode === "tags") {
    const wanted = new Set(selection.tagIds);
    return (member) => (household.memberTags[member.id] ?? []).some((tag) => wanted.has(tag.id));
  }
  if (selection.mode === "manual" && !picked.has(`household:${household.id}`))
    return (member) => picked.has(`person:${member.id}`);
  return () => true;
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
 *
 * Picking by hand works the same way round. A person can be ticked on their
 * own - one name tag, not one for everyone they live with - and printed as
 * families they bring their family, just as being in a group does.
 */
export function resolveEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  const chosen = chooseEntries(all, selection);
  if (selection.wholeFamily !== false) return chosen;

  const picked = pickedKeys(selection);
  const split = chosen.flatMap((entry) =>
    entry.type === "person"
      ? [entry]
      : membersWhere(entry, memberTest(entry.household, selection, picked)),
  );
  // Sorted again rather than filtered in place: a wife keeping her own
  // surname, or a family filed under a name none of its members carry, files
  // somewhere else entirely once it is her record rather than the family's.
  return split.sort(byEntryOrder);
}

function chooseEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  if (selection.mode === "manual") {
    const picked = pickedKeys(selection);
    return all.filter(
      (entry) =>
        picked.has(`${entry.type}:${entry.id}`) ||
        (entry.type === "household" &&
          entry.household.members.some((member) => picked.has(`person:${member.id}`))),
    );
  }

  if (selection.mode === "tags") {
    if (!selection.tagIds.length) return [];
    const wanted = new Set(selection.tagIds);
    return all.filter((entry) => entry.tagIds.some((tagId) => wanted.has(tagId)));
  }

  return all;
}

function pickedKeys(selection: Selection): Set<string> {
  return new Set(selection.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
}

/**
 * One line of the hand-picking checklist.
 *
 * Printed as families the lines are the families, and the people who belong
 * to none. Printed as individuals they are every person, one by one, so a
 * sheet of name tags can be for the four people giving the readings rather
 * than for the four families they live in.
 *
 * Both kinds of pick are kept as they were ticked, and the two lists read
 * each other's: a family ticked shows everyone in it ticked, and a person
 * ticked shows their family ticked, because that is what each prints as.
 */
export interface PickRow {
  /** What is stored when this line is ticked: `household:<id>` or `person:<id>`. */
  key: string;
  title: string;
  /** For a family: its members' own keys, any of which brings the family. */
  members: string[];
  /** For somebody in a family: the family's key, and the keys of everyone in it. */
  family: { key: string; members: string[] } | null;
}

/** The checklist, for a directory printed as families or as individuals. */
export function pickList(
  all: DirectoryEntry[],
  wholeFamily: boolean,
  familyTitle: (household: HouseholdWithMembers) => string = (household) => household.display_name,
): PickRow[] {
  const memberKeys = (household: HouseholdWithMembers) =>
    household.members.map((member) => `person:${member.id}`);

  if (wholeFamily) {
    return all.map((entry) =>
      entry.type === "household"
        ? {
            key: `household:${entry.id}`,
            title: familyTitle(entry.household),
            members: memberKeys(entry.household),
            family: null,
          }
        : { key: `person:${entry.id}`, title: entry.title, members: [], family: null },
    );
  }

  // Only a family that prints is one to belong to. Somebody whose family has
  // been archived is a record of their own already, and is picked as one.
  const familyOf = new Map<string, { key: string; members: string[] }>();
  for (const entry of all) {
    if (entry.type !== "household") continue;
    const family = { key: `household:${entry.id}`, members: memberKeys(entry.household) };
    for (const member of entry.household.members) familyOf.set(member.id, family);
  }
  return resolveEntries(all, { mode: "all", tagIds: [], entries: [], wholeFamily: false }).map(
    (entry) => ({
      key: `person:${entry.id}`,
      title: entry.title,
      members: [],
      family: familyOf.get(entry.id) ?? null,
    }),
  );
}

/** Whether a line of the checklist prints, which is whether it shows ticked. */
export function isPicked(picked: ReadonlySet<string>, row: PickRow): boolean {
  return (
    picked.has(row.key) ||
    row.members.some((key) => picked.has(key)) ||
    (row.family !== null && picked.has(row.family.key))
  );
}

/**
 * The picks after one line is ticked or unticked.
 *
 * Unticking a family takes its members with it, or the family would stay
 * ticked through them. Unticking one person from a family that was ticked
 * whole turns the family into everyone else in it, so the rest of their tags
 * still print.
 */
export function togglePick(picked: readonly string[], row: PickRow, on: boolean): string[] {
  if (on) return isPicked(new Set(picked), row) ? [...picked] : [...picked, row.key];

  const drop = new Set([row.key, ...row.members]);
  const next = picked.filter((key) => !drop.has(key));
  if (!row.family || !next.includes(row.family.key)) return next;

  const familyKey = row.family.key;
  const rest = next.filter((key) => key !== familyKey);
  const have = new Set(rest);
  return [...rest, ...row.family.members.filter((key) => key !== row.key && !have.has(key))];
}
