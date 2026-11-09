import { useMemo, useState } from "react";
import { useDirectory } from "@/data/DirectoryContext";
import { Checkbox, Field } from "@/components/ui";
import { sortKey } from "@/lib/format";
import {
  LEADERS_PER_SECTION_MAX,
  LEADERSHIP_GROUP_NAMES,
  LEADERSHIP_SECTIONS_MAX,
  STARTER_SECTIONS,
  leaderName,
  newSectionId,
  type Leader,
  type LeaderGroup,
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

const office = (title: string): LeadershipSection => ({
  id: newSectionId(),
  title,
  groupId: null,
  groupName: "",
  people: [],
});

const groupSection = (id: string, group: LeaderGroup): LeadershipSection => ({
  id: newSectionId(),
  title: "",
  groupId: id,
  groupName: group.name,
  people: group.members,
});

/**
 * The leadership page, as groups to tick and offices to fill in.
 *
 * Elders, deacons and deaconesses are groups the directory already keeps, so
 * they are ticked rather than typed: the page lists whoever is in the group
 * when it prints, and who is in it is changed where groups are changed. That
 * is the point - the office adding a deacon to the Deacons group should not
 * have to remember a second list on this screen.
 *
 * Everything else is an office filled in here: a name for it and who holds
 * it, picked from the directory by typing a few letters of their name - the
 * same search as putting someone in a family - or typed in for an office
 * held by a team rather than a person ("Deaconess Team").
 *
 * Groups and offices share one list, in the order they print, and the arrows
 * change it: a list this short does not need dragging, and arrows work the
 * same with a thumb.
 */
export function LeadershipEditor({
  settings,
  sections,
  groups,
  disabled,
  onChange,
  onFocus,
}: {
  settings: ProjectSettings;
  /** The sections as they print now: groups as they are, names as they are. */
  sections: LeadershipSection[];
  /** Every group in the directory and who is in it. */
  groups: ReadonlyMap<string, LeaderGroup>;
  disabled: boolean;
  onChange: (patch: Patch) => void;
  /** Focus has come into the card - the form shows this page beside it. */
  onFocus?: () => void;
}) {
  const setSections = (next: LeadershipSection[]) =>
    onChange({ leadership: next.slice(0, LEADERSHIP_SECTIONS_MAX) });
  const update = (id: string, change: (section: LeadershipSection) => LeadershipSection) =>
    setSections(sections.map((section) => (section.id === id ? change(section) : section)));

  const onPage = new Set(sections.map((section) => section.groupId).filter(Boolean));
  const groupList = [...groups.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));

  /** A group goes in after the groups already on the page, which print first. */
  const tick = (id: string, on: boolean) => {
    if (!on) {
      setSections(sections.filter((section) => section.groupId !== id));
      return;
    }
    const group = groups.get(id);
    if (!group) return;
    let at = 0;
    sections.forEach((section, i) => {
      if (section.groupId) at = i + 1;
    });
    setSections([...sections.slice(0, at), groupSection(id, group), ...sections.slice(at)]);
  };

  /** Pastor, then the leadership groups the directory has, then the offices. */
  const start = () => {
    const matched = LEADERSHIP_GROUP_NAMES.flatMap((pattern) =>
      groupList.filter(([, group]) => pattern.test(group.name)),
    ).filter(([id], i, all) => all.findIndex(([other]) => other === id) === i);
    const [first, ...rest] = STARTER_SECTIONS.map(office);
    setSections([first, ...matched.map(([id, group]) => groupSection(id, group)), ...rest]);
  };

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

            {groupList.length ? (
              <fieldset className="leader-groups">
                <legend>Groups on this page</legend>
                <p className="hint">
                  Each prints under its name with whoever is in it, by surname. Change who is in a
                  group on the Groups page and the page follows.
                </p>
                <div className="leader-group-list">
                  {groupList.map(([id, group]) => (
                    <Checkbox
                      key={id}
                      label={group.name}
                      hint={
                        group.members.length === 0
                          ? "Nobody in it yet"
                          : `${group.members.length} ${group.members.length === 1 ? "person" : "people"}`
                      }
                      checked={onPage.has(id)}
                      disabled={disabled}
                      onChange={(on) => tick(id, on)}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            <p className="hint leader-explain">
              Offices that aren't a group — Treasurer, Facilities Manager — are added below. One
              person prints on a line of its own, “Treasurer ……… Kim Feiro”; two or more print under
              a heading, in two columns. Anything with nobody in it is left off the page.
            </p>

            {sections.length ? (
              <ol className="leader-sections">
                {sections.map((section, index) =>
                  section.groupId ? (
                    <GroupRow
                      key={section.id}
                      section={section}
                      exists={groups.has(section.groupId)}
                      first={index === 0}
                      last={index === sections.length - 1}
                      disabled={disabled}
                      onChange={(change) => update(section.id, change)}
                      onMove={(by) => setSections(shift(sections, index, by))}
                      onRemove={() =>
                        setSections(sections.filter((other) => other.id !== section.id))
                      }
                    />
                  ) : (
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
                  ),
                )}
              </ol>
            ) : null}

            {disabled ? null : (
              <div className="row tight" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={sections.length >= LEADERSHIP_SECTIONS_MAX}
                  onClick={() => setSections([...sections, office("")])}
                >
                  + Add an office
                </button>
                {sections.length === 0 ? (
                  <button type="button" className="btn ghost" onClick={start}>
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

/**
 * A group on the page: its heading, which may be typed over, and who is in
 * it - shown, not edited, because who is in a group is changed on the group.
 */
function GroupRow({
  section,
  exists,
  first,
  last,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  section: LeadershipSection;
  exists: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onChange: (change: (section: LeadershipSection) => LeadershipSection) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = section.title.trim() || section.groupName || "this group";
  const names = section.people.map((leader) => leader.name);
  return (
    <li className="leader-section is-group">
      <div className="leader-head">
        <input
          type="text"
          className="leader-title"
          aria-label={`Heading for the ${section.groupName} group`}
          value={section.title}
          placeholder={section.groupName}
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
              aria-label={`Take ${label} off the page`}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        )}
      </div>
      <p className="small leader-group-source">
        {exists ? (
          <span className="muted">
            From the {section.groupName} group
            {names.length
              ? ` — ${names.length} ${names.length === 1 ? "person" : "people"}, by surname`
              : ""}
          </span>
        ) : (
          <span className="leader-gone">
            This group no longer exists — prints the names it had when this directory was saved.
          </span>
        )}
      </p>
      {names.length ? (
        <p className="leader-group-names">{names.join(" · ")}</p>
      ) : (
        <p className="muted small leader-empty">
          Nobody in this group yet — it is left off the page.
        </p>
      )}
    </li>
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
  const { people, personById, householdById } = useDirectory();
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
        </div>
      )}
    </li>
  );
}
