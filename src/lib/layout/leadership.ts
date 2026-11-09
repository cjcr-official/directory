/**
 * The leadership page: the church's offices, and who holds them.
 *
 * Deacons, elders, a treasurer, whoever runs the nursery - printed on a page
 * of its own straight after the cover, because that is where a reader looks
 * for it and where the paper this replaces always put it.
 *
 * Stored on the directory with the rest of its settings, as a list of
 * sections in the order they print. A section is one of two things:
 *
 *  - A group. Elders, deacons and deaconesses are already groups in the
 *    directory, and the page lists whoever is in the group at the moment it
 *    is printed - add a deacon to the group and he is on the next page
 *    printed, with nobody having to come here. Its heading is the group's
 *    name unless one is typed over it.
 *  - An office filled in by hand: "Treasurer" and one name. Each name is
 *    either somebody in the directory, picked from it, or a few words typed
 *    in for an office that is held by a team rather than a person -
 *    "Deaconess Team".
 *
 * A picked person keeps the name they had when they were picked as well as
 * their id. The id is what makes the page follow the directory - Bill who
 * starts going by William prints as William - and the name is what prints
 * when the id no longer leads anywhere: somebody deleted, or a directory
 * restored from a backup into a database that never had them. A page that
 * quietly dropped a deacon because his record went would be worse than one
 * that prints the name the office last saw.
 */

/** One name under an office. */
export interface Leader {
  /** The person in the directory, or null for a group or words typed in. */
  personId: string | null;
  /**
   * A group holding the office as a whole - Food Services, held by the
   * deaconesses - printed as the group's name. Absent or null otherwise.
   */
  groupId?: string | null;
  /**
   * What prints. Kept up to date from the directory while the person, or the
   * group, is in it.
   */
  name: string;
}

/** One office, and whoever holds it. */
export interface LeadershipSection {
  /** Stable across reordering, so the editor's rows keep their focus. */
  id: string;
  /**
   * What the heading says. For a group, empty means "the group's name", and
   * anything typed is printed instead of it.
   */
  title: string;
  /**
   * The group this section lists, or null for an office filled in by hand.
   * A group's people are not chosen here: they are whoever is in the group.
   */
  groupId: string | null;
  /** The group's name when it was last seen, for a heading left empty. */
  groupName: string;
  /**
   * Who holds it. For a group, the people who were in it when the directory
   * was last saved - kept so that a group deleted since still prints the
   * names it had rather than vanishing from the page, and refreshed from the
   * group every time the page is drawn while it exists.
   */
  people: Leader[];
}

/** The most sections a page will keep. Far past any real church's offices. */
export const LEADERSHIP_SECTIONS_MAX = 60;
/** The most names one office will keep. */
export const LEADERS_PER_SECTION_MAX = 60;
/** A title or name longer than this is a paste gone wrong, not an office. */
const TEXT_MAX = 120;

/** A fresh id for a section made on this screen. */
export function newSectionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Whatever was stored, as sections the composer and the editor can trust.
 *
 * Settings are JSON in a column anybody with the SQL editor can write to, and
 * a restore can hand back a file from an older version of this app, so
 * nothing here is taken on trust: anything that is not a section is dropped,
 * a section without an id is given one, and names that are not names go.
 */
export function normalizeLeadership(raw: unknown): LeadershipSection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sections: LeadershipSection[] = [];
  for (const item of raw.slice(0, LEADERSHIP_SECTIONS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    let id = typeof source.id === "string" && source.id ? source.id.slice(0, 40) : newSectionId();
    while (seen.has(id)) id = newSectionId();
    seen.add(id);

    const people = normalizeLeaders(source.people);

    sections.push({
      id,
      title: typeof source.title === "string" ? source.title.slice(0, TEXT_MAX) : "",
      groupId: typeof source.groupId === "string" && source.groupId ? source.groupId : null,
      groupName: typeof source.groupName === "string" ? source.groupName.slice(0, TEXT_MAX) : "",
      people,
    });
  }
  return sections;
}

/**
 * A list of names under an office, as stored: each a person, a group, or
 * words typed in, and anything that is none of those dropped. Shared with the
 * staff on the back cover, which are picked the same way.
 */
export function normalizeLeaders(raw: unknown): Leader[] {
  const people: Leader[] = [];
  if (!Array.isArray(raw)) return people;
  for (const entry of raw.slice(0, LEADERS_PER_SECTION_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const leader = entry as Record<string, unknown>;
    const personId =
      typeof leader.personId === "string" && leader.personId ? leader.personId : null;
    const groupId =
      !personId && typeof leader.groupId === "string" && leader.groupId ? leader.groupId : null;
    const name = typeof leader.name === "string" ? leader.name.slice(0, TEXT_MAX) : "";
    if (!personId && !groupId && !name.trim()) continue;
    people.push(groupId ? { personId, groupId, name } : { personId, name });
  }
  return people;
}

/** What a person is printed as on the page: "Bill Smith", by the name they go by. */
export interface NamedPerson {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

export function leaderName(person: NamedPerson): string {
  const first = person.preferred_name?.trim() || person.first_name;
  return `${first} ${person.last_name}`.replace(/\s+/g, " ").trim();
}

/**
 * The sections with every picked person's name as the directory has it now.
 *
 * Run on the way into the composer and on the way into the editor, so a name
 * changed on a person's record is on the page the next time it is printed,
 * and is what gets saved the next time the directory is. Somebody no longer
 * in the directory keeps the name they were saved with - see the top of this
 * file. Hands back the same array when nothing changed, so a memo keyed on it
 * does not redraw for nothing.
 */
export function withCurrentNames(
  sections: LeadershipSection[],
  personById: ReadonlyMap<string, NamedPerson>,
): LeadershipSection[] {
  let changed = false;
  const next = sections.map((section) => {
    let sectionChanged = false;
    const people = section.people.map((leader) => {
      const person = leader.personId ? personById.get(leader.personId) : undefined;
      if (!person) return leader;
      const name = leaderName(person);
      if (name === leader.name) return leader;
      sectionChanged = true;
      return { ...leader, name };
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, people };
  });
  return changed ? next : sections;
}

/**
 * What actually prints: sections with a title or a name, and names with
 * words in them. A section added and not yet filled in is not a heading over
 * nothing on paper.
 */
export function printedSections(
  sections: LeadershipSection[],
): { title: string; names: string[] }[] {
  return sections
    .map((section) => ({
      title: sectionTitle(section),
      names: section.people.map((leader) => leader.name.trim()).filter(Boolean),
    }))
    .filter((section) => section.names.length > 0);
}

/** The heading a section prints under: what was typed, or its group's name. */
export function sectionTitle(section: LeadershipSection): string {
  return section.title.trim() || (section.groupId ? section.groupName.trim() : "");
}

/**
 * Where a new page starts: the offices most churches fill by hand, empty.
 * Elders and deacons are not among them - those are groups, ticked rather
 * than typed. Offered by a button rather than filled in by default, because
 * a directory for the youth retreat has no use for a page of elders.
 */
export const STARTER_SECTIONS = ["Pastor", "Treasurer", "Secretary"];

/**
 * The groups that are leadership by their name, ticked by the same button.
 * Matched loosely - "Deacons", "Deacon Board", "Elders 2026" - and never
 * "Deaconesses" for "Deacons": each pattern is anchored to a whole word.
 */
export const LEADERSHIP_GROUP_NAMES = [/\belders?\b/i, /\bdeacons?\b/i, /\bdeaconess(es)?\b/i];

/** A person in the directory, as much of them as this page needs. */
export interface LeaderCandidate extends NamedPerson {
  id: string;
  is_active: boolean;
}

/** A group, and who is in it now. */
export interface LeaderGroup {
  name: string;
  /** In the order they print: by surname, then by the name they go by. */
  members: { personId: string; name: string }[];
}

/**
 * Every group and the active people in it, the way the page lists them.
 *
 * Groups belong to people - a family is only in one through its members -
 * so this reads person_tags alone, exactly as the directory does when it
 * prints a group's people on their own. Somebody marked as no longer
 * printing in the directory is left out here too.
 */
export function leadershipGroups(
  tags: { id: string; name: string }[],
  personTags: { person_id: string; tag_id: string }[],
  people: LeaderCandidate[],
): Map<string, LeaderGroup> {
  const byId = new Map(people.map((person) => [person.id, person]));
  const groups = new Map<string, LeaderGroup>();
  const lists = new Map<string, LeaderCandidate[]>();
  for (const tag of tags) lists.set(tag.id, []);
  for (const link of personTags) {
    const person = byId.get(link.person_id);
    const list = lists.get(link.tag_id);
    if (!person || !list || !person.is_active || list.includes(person)) continue;
    list.push(person);
  }
  const fold = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  for (const tag of tags) {
    const members = (lists.get(tag.id) ?? [])
      .map((person) => ({
        personId: person.id,
        name: leaderName(person),
        key: `${fold(person.last_name)} ${fold(leaderName(person))}`,
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ personId, name }) => ({ personId, name }));
    groups.set(tag.id, { name: tag.name, members });
  }
  return groups;
}

/**
 * The sections as they print now: every group listing whoever is in it,
 * under its current name, and every picked person under the name their
 * record has. A group that has been deleted keeps what it was saved with.
 * Hands back the same array when nothing changed.
 */
export function currentLeadership(
  sections: LeadershipSection[],
  personById: ReadonlyMap<string, NamedPerson>,
  groups: ReadonlyMap<string, LeaderGroup>,
): LeadershipSection[] {
  let changed = false;
  const next = withCurrentNames(sections, personById).map((section) => {
    const group = section.groupId ? groups.get(section.groupId) : undefined;
    if (!group) {
      // An office held by a group as a whole prints under the group's name
      // as it is now; a group that has gone keeps the name it was saved with.
      let renamed = false;
      const people = section.people.map((leader) => {
        const holder = leader.groupId ? groups.get(leader.groupId) : undefined;
        if (!holder || holder.name === leader.name) return leader;
        renamed = true;
        return { ...leader, name: holder.name };
      });
      if (!renamed) return section;
      changed = true;
      return { ...section, people };
    }
    const same =
      group.name === section.groupName &&
      group.members.length === section.people.length &&
      group.members.every(
        (member, i) =>
          member.personId === section.people[i].personId && member.name === section.people[i].name,
      );
    if (same) return section;
    changed = true;
    return { ...section, groupName: group.name, people: group.members };
  });
  return changed || next.some((section, i) => section !== sections[i]) ? next : sections;
}
