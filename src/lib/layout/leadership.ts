/**
 * The leadership page: the church's offices, and who holds them.
 *
 * Deacons, elders, a treasurer, whoever runs the nursery - printed on a page
 * of its own straight after the cover, because that is where a reader looks
 * for it and where the paper this replaces always put it.
 *
 * Stored on the directory with the rest of its settings, as a list of
 * sections in the order they print. A section is an office and the people in
 * it: "Deacons" and seven names, or "Treasurer" and one. Each name is either
 * somebody in the directory, picked from it, or a few words typed in for an
 * office that is held by a team rather than a person - "Deaconess Team".
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
  /** The person in the directory, or null for words typed in. */
  personId: string | null;
  /** What prints. Kept up to date from the directory while the person is in it. */
  name: string;
}

/** One office, and whoever holds it. */
export interface LeadershipSection {
  /** Stable across reordering, so the editor's rows keep their focus. */
  id: string;
  title: string;
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

    const people: Leader[] = [];
    if (Array.isArray(source.people)) {
      for (const entry of source.people.slice(0, LEADERS_PER_SECTION_MAX)) {
        if (!entry || typeof entry !== "object") continue;
        const leader = entry as Record<string, unknown>;
        const personId =
          typeof leader.personId === "string" && leader.personId ? leader.personId : null;
        const name = typeof leader.name === "string" ? leader.name.slice(0, TEXT_MAX) : "";
        if (!personId && !name.trim()) continue;
        people.push({ personId, name });
      }
    }

    sections.push({
      id,
      title: typeof source.title === "string" ? source.title.slice(0, TEXT_MAX) : "",
      people,
    });
  }
  return sections;
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
      title: section.title.trim(),
      names: section.people.map((leader) => leader.name.trim()).filter(Boolean),
    }))
    .filter((section) => section.names.length > 0);
}

/**
 * Where a new directory starts: the offices most churches have, empty.
 *
 * Offered by a button rather than filled in by default, because a directory
 * for the youth retreat has no use for a page of elders.
 */
export const STARTER_SECTIONS = ["Pastor", "Elders", "Deacons", "Treasurer", "Secretary"];
