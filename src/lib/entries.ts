import type { HouseholdRow, PersonRow, TagRow } from "./database.types";
import { fileAsName, firstName, sortKey } from "./format";

export interface HouseholdWithMembers extends HouseholdRow {
  members: PersonRow[];
  tags: TagRow[];
  /**
   * Each member's own groups, by person id, for the members who have any.
   *
   * The entry's tagIds are the family's groups and its members' rolled into
   * one, which answers "is this family in the choir booklet at all". This
   * answers the other question - which of them is actually in the choir - and
   * that is what a booklet printing people rather than families needs.
   */
  memberTags: Record<string, TagRow[]>;
}

export interface PersonWithContext extends PersonRow {
  household: HouseholdRow | null;
  tags: TagRow[];
}

/**
 * One printable record - the unit that occupies a single card in the book.
 * A household prints once with its members listed on the card; a person who
 * belongs to no household prints as an individual.
 */
export type DirectoryEntry =
  | {
      type: "household";
      id: string;
      sortKey: string;
      title: string;
      /** Household tags plus every member's tags - what tag selection matches on. */
      tagIds: string[];
      household: HouseholdWithMembers;
    }
  | {
      type: "person";
      id: string;
      sortKey: string;
      title: string;
      tagIds: string[];
      person: PersonWithContext;
    };

/**
 * The order records print in.
 *
 * The id breaks ties. Two families with one surname and no members between
 * them produce the same sort key, and without this their order - and so their
 * page numbers - would come down to whatever order the database happened to
 * return, which can differ between two printings of one book.
 */
export function byEntryOrder(a: DirectoryEntry, b: DirectoryEntry): number {
  return a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id);
}

export interface DirectoryData {
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
}

/**
 * One person as a record of their own.
 *
 * Used for somebody who belongs to no printed family, and for a member a
 * booklet prints alone - a deacons' list, where the family is not the record.
 * Both go through here so the two are the same record: filed under the same
 * name, sorted on the same key, and carrying the family behind them, which is
 * where their address comes from when they share the household's.
 */
export function personEntry(
  person: PersonRow,
  household: HouseholdRow | null,
  tags: TagRow[],
): DirectoryEntry {
  return {
    type: "person",
    id: person.id,
    sortKey: sortKey(person.last_name, firstName(person)),
    title: fileAsName(person),
    tagIds: tags.map((tag) => tag.id),
    person: { ...person, household, tags },
  };
}

/** Members of a household in the order they should be listed on the card. */
export function sortMembers(members: PersonRow[]): PersonRow[] {
  const rank: Record<string, number> = { head: 0, spouse: 1, child: 2, other: 3 };
  return [...members].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    const roleDelta =
      (rank[a.household_role ?? "other"] ?? 3) - (rank[b.household_role ?? "other"] ?? 3);
    if (roleDelta !== 0) return roleDelta;
    // Children last, oldest first, so a family reads the way it is introduced.
    if (a.household_role === "child" && b.household_role === "child") {
      const aDob = a.date_of_birth ?? "9999";
      const bDob = b.date_of_birth ?? "9999";
      if (aDob !== bDob) return aDob < bDob ? -1 : 1;
    }
    return sortKey(a.first_name).localeCompare(sortKey(b.first_name));
  });
}

/**
 * Turns raw tables into the alphabetical list of records that becomes the book.
 * Households sort on their surname, individuals on their last name, so the two
 * kinds of record interleave into one A-Z sequence.
 */
export function buildEntries(data: DirectoryData, includeInactive = false): DirectoryEntry[] {
  const tagsById = new Map(data.tags.map((tag) => [tag.id, tag]));

  const tagsForHousehold = new Map<string, TagRow[]>();
  for (const link of data.householdTags) {
    const tag = tagsById.get(link.tag_id);
    if (!tag) continue;
    const list = tagsForHousehold.get(link.household_id) ?? [];
    list.push(tag);
    tagsForHousehold.set(link.household_id, list);
  }

  const tagsForPerson = new Map<string, TagRow[]>();
  for (const link of data.personTags) {
    const tag = tagsById.get(link.tag_id);
    if (!tag) continue;
    const list = tagsForPerson.get(link.person_id) ?? [];
    list.push(tag);
    tagsForPerson.set(link.person_id, list);
  }

  const householdsById = new Map(data.households.map((h) => [h.id, h]));
  const people = data.people.filter((p) => includeInactive || p.is_active);

  // A member of a household that has been archived still belongs in the book,
  // as an individual - dropping them silently would lose a person.
  const printedHouseholds = data.households.filter((h) => includeInactive || h.is_active);
  const printedHouseholdIds = new Set(printedHouseholds.map((h) => h.id));

  const membersByHousehold = new Map<string, PersonRow[]>();
  for (const person of people) {
    if (!person.household_id) continue;
    const list = membersByHousehold.get(person.household_id) ?? [];
    list.push(person);
    membersByHousehold.set(person.household_id, list);
  }

  const entries: DirectoryEntry[] = [];

  for (const household of printedHouseholds) {
    const members = sortMembers(membersByHousehold.get(household.id) ?? []);
    const householdTags = tagsForHousehold.get(household.id) ?? [];
    const tagIds = new Set(householdTags.map((tag) => tag.id));
    // Tagging one chorister should pull their whole family into the choir
    // booklet, so a member's tags count towards the household. Whose tag it
    // was is kept as well: a booklet can be asked for the choristers
    // themselves rather than their families, and then it matters.
    const memberTags: Record<string, TagRow[]> = {};
    for (const member of members) {
      const theirs = tagsForPerson.get(member.id) ?? [];
      if (theirs.length) memberTags[member.id] = theirs;
      for (const tag of theirs) tagIds.add(tag.id);
    }
    entries.push({
      type: "household",
      id: household.id,
      // Surname first, then the head of household's first name, so two
      // "Smith" families keep a stable, predictable order.
      sortKey: sortKey(household.sort_name, members[0] ? firstName(members[0]) : ""),
      title: household.display_name,
      tagIds: [...tagIds],
      household: { ...household, members, tags: householdTags, memberTags },
    });
  }

  for (const person of people) {
    if (person.household_id && printedHouseholdIds.has(person.household_id)) continue;
    const household = person.household_id
      ? (householdsById.get(person.household_id) ?? null)
      : null;
    entries.push(personEntry(person, household, tagsForPerson.get(person.id) ?? []));
  }

  return entries.sort(byEntryOrder);
}

/** People inside a record - one for an individual, all members for a household. */
export function entryPeople(entry: DirectoryEntry): PersonRow[] {
  return entry.type === "household" ? entry.household.members : [entry.person];
}
