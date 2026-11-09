import { useMemo, useState } from "react";
import { useDirectory } from "@/data/DirectoryContext";
import { Checkbox, Field } from "@/components/ui";
import { sortKey } from "@/lib/format";
import {
  LEADERS_PER_SECTION_MAX,
  LEADERSHIP_SECTIONS_MAX,
  STARTER_SECTIONS,
  leaderName,
  newSectionId,
  type Leader,
  type LeadershipSection,
} from "@/lib/layout/leadership";
import type { ProjectSettings } from "@/lib/layout/settings";
import type { PersonRow } from "@/lib/database.types";

type Patch = Partial<
  Pick<ProjectSettings, "includeLeadership" | "leadershipTitle" | "leadershipNote" | "leadership">
>;

/** Moves one item of a list by one place, or hands the list back when it cannot. */
function shift<T>(list: T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * The leadership page, as a list of offices to fill in.
 *
 * An office is a name for it and the people who hold it. People are picked
 * from the directory by typing a few letters of their name - the same search
 * as putting someone in a family - so a deacon is the person on record rather
 * than a second spelling of them. An office held by a team rather than a
 * person ("Deaconess Team") is typed in as it should print, from the same
 * box. A whole group can be added at once, for the offices the directory
 * already has a group for.
 *
 * The order on screen is the order on paper, for the offices and for the
 * names in each, and the arrows are how it is changed: a list this short
 * does not need dragging, and arrows work the same with a thumb.
 */
export function LeadershipEditor({
  settings,
  sections,
  disabled,
  onChange,
  onFocus,
}: {
  settings: ProjectSettings;
  /** The offices, with every picked person's name as the directory has it now. */
  sections: LeadershipSection[];
  disabled: boolean;
  onChange: (patch: Patch) => void;
  /** Focus has come into the card - the form shows this page beside it. */
  onFocus?: () => void;
}) {
  const setSections = (next: LeadershipSection[]) => onChange({ leadership: next });
  const update = (id: string, change: (section: LeadershipSection) => LeadershipSection) =>
    setSections(sections.map((section) => (section.id === id ? change(section) : section)));

  const addOffices = (titles: string[]) =>
    setSections(
      [...sections, ...titles.map((title) => ({ id: newSectionId(), title, people: [] }))].slice(
        0,
        LEADERSHIP_SECTIONS_MAX,
      ),
    );

  return (
    <section className="card" aria-labelledby="book-leadership" onFocus={onFocus}>
      <div className="card-head column">
        <h2 id="book-leadership">Leadership page</h2>
        <span className="muted small">
          The church's offices and who holds them, straight after the cover
        </span>
      </div>
      <div className="card-body">
        <Checkbox
          label="Print a leadership page"
          hint="Deacons, elders, the treasurer — before the first record."
          checked={settings.includeLeadership}
          disabled={disabled}
          onChange={(value) => onChange({ includeLeadership: value })}
        />

        {settings.includeLeadership ? (
          <>
            <div className="grid two" style={{ marginTop: 14 }}>
              <Field label="Heading" htmlFor="leadership_title">
                <input
                  id="leadership_title"
                  type="text"
                  value={settings.leadershipTitle}
                  placeholder="Church Leadership"
                  disabled={disabled}
                  onChange={(event) => onChange({ leadershipTitle: event.target.value })}
                />
              </Field>
              <Field label="Line under it" hint="Optional, in italics." htmlFor="leadership_note">
                <input
                  id="leadership_note"
                  type="text"
                  value={settings.leadershipNote}
                  placeholder="Please be praying for these individuals this year."
                  disabled={disabled}
                  onChange={(event) => onChange({ leadershipNote: event.target.value })}
                />
              </Field>
            </div>

            <p className="hint leader-explain">
              An office held by one person prints on a line of its own — “Treasurer ……… Kim Feiro”.
              Two or more print under a heading, in two columns. An office with nobody in it is left
              off the page.
            </p>

            {sections.length ? (
              <ol className="leader-sections">
                {sections.map((section, index) => (
                  <OfficeEditor
                    key={section.id}
                    section={section}
                    first={index === 0}
                    last={index === sections.length - 1}
                    disabled={disabled}
                    onChange={(change) => update(section.id, change)}
                    onMove={(by) => setSections(shift(sections, index, by))}
                    onRemove={() =>
                      setSections(sections.filter((other) => other.id !== section.id))
                    }
                  />
                ))}
              </ol>
            ) : null}

            {disabled ? null : (
              <div className="row tight" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={sections.length >= LEADERSHIP_SECTIONS_MAX}
                  onClick={() => addOffices([""])}
                >
                  + Add an office
                </button>
                {sections.length === 0 ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => addOffices(STARTER_SECTIONS)}
                  >
                    Start with the usual ones
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** One office: its name, who holds it, and the box that adds to them. */
function OfficeEditor({
  section,
  first,
  last,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  section: LeadershipSection;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onChange: (change: (section: LeadershipSection) => LeadershipSection) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { people, personById, householdById, tags, personTags } = useDirectory();
  const [query, setQuery] = useState("");
  const label = section.title.trim() || "this office";
  const full = section.people.length >= LEADERS_PER_SECTION_MAX;

  const add = (leaders: Leader[]) =>
    onChange((current) => {
      const taken = new Set(current.people.map((leader) => leader.personId).filter(Boolean));
      const fresh = leaders.filter((leader) => !leader.personId || !taken.has(leader.personId));
      return {
        ...current,
        people: [...current.people, ...fresh].slice(0, LEADERS_PER_SECTION_MAX),
      };
    });
  const addPerson = (person: PersonRow) => {
    add([{ personId: person.id, name: leaderName(person) }]);
    setQuery("");
  };
  const addTyped = () => {
    const name = query.replace(/\s+/g, " ").trim();
    if (!name) return;
    add([{ personId: null, name }]);
    setQuery("");
  };

  /** Up to six people whose name has what was typed in it, not already here. */
  const matches = useMemo(() => {
    const needle = sortKey(query);
    if (!needle) return [];
    const taken = new Set(section.people.map((leader) => leader.personId));
    const found: PersonRow[] = [];
    for (const person of people) {
      if (taken.has(person.id)) continue;
      if (!sortKey(person.first_name, person.preferred_name, person.last_name).includes(needle)) {
        // "Bill Smith" as well as "Smith": the name as it prints, in one.
        if (!sortKey(leaderName(person)).includes(needle)) continue;
      }
      found.push(person);
      if (found.length === 6) break;
    }
    return found;
  }, [people, query, section.people]);

  /** Groups with people tagged in them directly, for adding a whole one. */
  const groups = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const row of personTags) {
      const list = counts.get(row.tag_id) ?? [];
      list.push(row.person_id);
      counts.set(row.tag_id, list);
    }
    return tags
      .map((tag) => ({ tag, ids: counts.get(tag.id) ?? [] }))
      .filter((group) => group.ids.length > 0);
  }, [tags, personTags]);

  return (
    <li className="leader-section">
      <div className="leader-head">
        <input
          type="text"
          className="leader-title"
          aria-label="Office"
          value={section.title}
          placeholder="Office — Deacons, Treasurer…"
          disabled={disabled}
          onChange={(event) => {
            const title = event.target.value;
            onChange((current) => ({ ...current, title }));
          }}
        />
        {disabled ? null : (
          <div className="leader-tools">
            <button
              type="button"
              className="btn ghost small"
              aria-label={`Move ${label} up`}
              title="Move up"
              disabled={first}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn ghost small"
              aria-label={`Move ${label} down`}
              title="Move down"
              disabled={last}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn ghost small danger-hover"
              aria-label={`Remove ${label}`}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {section.people.length ? (
        <ul className="member-list leader-people">
          {section.people.map((leader, index) => {
            const person = leader.personId ? personById.get(leader.personId) : undefined;
            const home = person?.household_id ? householdById.get(person.household_id) : null;
            const note = !leader.personId
              ? "Typed in"
              : !person
                ? "No longer in the directory — prints as saved"
                : (home?.display_name ?? "");
            return (
              <li
                key={`${leader.personId ?? "typed"}:${leader.name}:${index}`}
                className="member-row"
              >
                <div className="member-name">
                  <div style={{ fontWeight: 600 }}>{leader.name}</div>
                  {note ? (
                    <div
                      className={leader.personId && !person ? "small leader-gone" : "muted small"}
                    >
                      {note}
                    </div>
                  ) : null}
                </div>
                {disabled ? null : (
                  <div className="leader-tools">
                    <button
                      type="button"
                      className="btn ghost small"
                      aria-label={`Move ${leader.name} up`}
                      title="Move up"
                      disabled={index === 0}
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          people: shift(current.people, index, -1),
                        }))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost small danger-hover"
                      aria-label={`Take ${leader.name} off ${label}`}
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          people: current.people.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small leader-empty">Nobody yet — this office is left off the page.</p>
      )}

      {disabled || full ? null : (
        <div className="leader-add">
          <input
            type="search"
            className="search"
            aria-label={`Add someone to ${label}`}
            placeholder="Add a person — type a name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter is the form's Save everywhere else on this screen; here
              // it means "this one".
              if (event.key === "Enter") {
                event.preventDefault();
                if (matches[0]) addPerson(matches[0]);
                else addTyped();
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />

          {query.trim() ? (
            <ul className="member-list picker">
              {matches.map((person) => {
                const home = person.household_id ? householdById.get(person.household_id) : null;
                return (
                  <li key={person.id} className="member-row">
                    <div className="member-name">
                      <div style={{ fontWeight: 600 }}>{leaderName(person)}</div>
                      {home ? <div className="muted small">{home.display_name}</div> : null}
                    </div>
                    <button type="button" className="btn small" onClick={() => addPerson(person)}>
                      Add
                    </button>
                  </li>
                );
              })}
              <li className="member-row">
                <div className="member-name">
                  <div style={{ fontWeight: 600 }}>“{query.replace(/\s+/g, " ").trim()}”</div>
                  <div className="muted small">
                    {matches.length
                      ? "Or print these words as they are"
                      : "Nobody by that name — print these words as they are"}
                  </div>
                </div>
                <button type="button" className="btn small" onClick={addTyped}>
                  Add
                </button>
              </li>
            </ul>
          ) : null}

          {groups.length ? (
            <select
              className="leader-group"
              aria-label={`Add everyone in a group to ${label}`}
              value=""
              onChange={(event) => {
                const group = groups.find((each) => each.tag.id === event.target.value);
                if (!group) return;
                const found = group.ids
                  .map((id) => personById.get(id))
                  .filter((person): person is PersonRow => !!person)
                  .sort((a, b) =>
                    sortKey(a.last_name, a.first_name).localeCompare(
                      sortKey(b.last_name, b.first_name),
                    ),
                  );
                add(found.map((person) => ({ personId: person.id, name: leaderName(person) })));
              }}
            >
              <option value="">Or add everyone in a group…</option>
              {groups.map(({ tag, ids }) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} ({ids.length} {ids.length === 1 ? "person" : "people"})
                </option>
              ))}
            </select>
          ) : null}
        </div>
      )}
    </li>
  );
}
