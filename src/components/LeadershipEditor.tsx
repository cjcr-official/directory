import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useDirectory } from "@/data/DirectoryContext";
import { Caret, Checkbox, Disclosure, Field } from "@/components/ui";
import { TagPicker } from "@/components/TagPicker";
import { sortKey } from "@/lib/format";
import {
  LEADERS_PER_SECTION_MAX,
  LEADERSHIP_GROUP_NAMES,
  LEADERSHIP_SECTIONS_MAX,
  STARTER_SECTIONS,
  leaderName,
  newSectionId,
  sectionTitle,
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
export function shift<T>(list: T[], from: number, by: -1 | 1): T[] {
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
  /** The office the button made a moment ago, so its name box can take the caret. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /**
   * The one office open for changing. The rest are a line each - its name and
   * who holds it - because every office open at once, a row per person and a
   * search box apiece, made a church's ordinary list several screens long.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const groupList = [...groups.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const { tags } = useDirectory();
  /** The directory's groups as pills, in the same order as the list above. */
  const pickable = useMemo(() => tags.filter((tag) => groups.has(tag.id)), [tags, groups]);

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

  const summary = settings.includeLeadership
    ? [
        settings.leadershipTitle.trim(),
        `${sections.length} ${sections.length === 1 ? "office" : "offices"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Not printed";

  return (
    <Disclosure title="Leadership page" summary={summary} onFocus={onFocus}>
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
                Tap a group to put it on the page, and again to take it off. Each prints under its
                name with whoever is in it, by surname.
              </p>
              {/* The same pills a group is picked with everywhere else in
                    the app: a church has a dozen groups or more, and a
                    checkbox and a count for each was a screen of scrolling
                    to find the three that matter here. Who is in each is
                    shown below, once it is on the page. */}
              <TagPicker
                tags={pickable}
                selected={sections.flatMap((section) =>
                  section.groupId && groups.has(section.groupId) ? [section.groupId] : [],
                )}
                disabled={disabled}
                onChange={(next) => {
                  const wanted = new Set(next);
                  const added = next.find((id) => !onPage.has(id));
                  const removed = [...onPage].find((id) => id && !wanted.has(id));
                  if (added) tick(added, true);
                  else if (removed) tick(removed, false);
                }}
              />
            </fieldset>
          ) : null}

          <p className="hint leader-explain">
            Tap a line to change it. Offices that aren't a group — Treasurer, Facilities Manager —
            are added with the button underneath. One person prints on a line of its own; two or
            more print under a heading. Anything with nobody in it is left off.
          </p>

          {sections.length ? (
            <ol className="leader-sections">
              {sections.map((section, index) => {
                const common = {
                  section,
                  first: index === 0,
                  last: index === sections.length - 1,
                  disabled,
                  onChange: (change: (section: LeadershipSection) => LeadershipSection) =>
                    update(section.id, change),
                  onMove: (by: -1 | 1) => setSections(shift(sections, index, by)),
                  onRemove: () => {
                    setOpenId(null);
                    setSections(sections.filter((other) => other.id !== section.id));
                  },
                  onDone: () => setOpenId(null),
                };
                const exists = !section.groupId || groups.has(section.groupId);
                if (openId !== section.id) {
                  return (
                    <SectionLine
                      key={section.id}
                      section={section}
                      exists={exists}
                      groups={groups}
                      onOpen={() => {
                        setFreshId(null);
                        setOpenId(section.id);
                      }}
                    />
                  );
                }
                return section.groupId ? (
                  <GroupRow key={section.id} {...common} exists={exists} />
                ) : (
                  <OfficeEditor
                    key={section.id}
                    {...common}
                    groups={groups}
                    fresh={section.id === freshId}
                  />
                );
              })}
            </ol>
          ) : null}

          {disabled ? null : (
            <div className="row tight" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                disabled={sections.length >= LEADERSHIP_SECTIONS_MAX}
                onClick={() => {
                  const made = office("");
                  setFreshId(made.id);
                  setOpenId(made.id);
                  setSections([...sections, made]);
                }}
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
    </Disclosure>
  );
}

/**
 * A group on the page: its heading, which may be typed over, and who is in
 * it - shown, not edited, because who is in a group is changed on the group.
 */
function GroupRow({
  section,
  onDone,
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
  /** Closes it back to its one line. */
  onDone: () => void;
}) {
  const label = section.title.trim() || section.groupName || "this group";
  const names = section.people.map((leader) => leader.name);
  return (
    <li className="leader-section is-group is-open">
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
      <div className="leader-done">
        <button type="button" className="btn small" onClick={onDone}>
          Done
        </button>
      </div>
    </li>
  );
}

/** A person, or a group, an office was given that the directory no longer has. */
export function leaderGone(
  leader: Leader,
  personById: ReadonlyMap<string, unknown>,
  groups: ReadonlyMap<string, LeaderGroup>,
): boolean {
  if (leader.personId) return !personById.has(leader.personId);
  if (leader.groupId) return !groups.has(leader.groupId);
  return false;
}

/**
 * An office or group closed down to one line: what it is called and who holds
 * it, the whole line a button that opens it. Somebody who has left the
 * directory, or a group that has been deleted, is said here too - it is the
 * one thing on a closed line that wants looking at.
 */
function SectionLine({
  section,
  exists,
  groups,
  onOpen,
}: {
  section: LeadershipSection;
  exists: boolean;
  groups: ReadonlyMap<string, LeaderGroup>;
  onOpen: () => void;
}) {
  const { personById } = useDirectory();
  const title = sectionTitle(section);
  const names = section.people.map((leader) => leader.name);
  const gone = !exists || section.people.some((leader) => leaderGone(leader, personById, groups));
  return (
    <li className={`leader-line${section.groupId ? " is-group" : ""}`}>
      <button type="button" className="leader-line-button" aria-expanded={false} onClick={onOpen}>
        <span className="leader-line-text">
          <span className="leader-line-title">
            {title || <span className="muted">Untitled office</span>}
            {section.groupId ? <span className="leader-badge">Group</span> : null}
          </span>
          <span className={`leader-line-names${names.length ? "" : " muted"}`}>
            {names.length
              ? names.join(", ")
              : section.groupId
                ? "Nobody in this group yet"
                : "Nobody yet — left off the page"}
          </span>
          {gone ? (
            <span className="leader-line-names leader-gone">Needs a look — tap to see why</span>
          ) : null}
        </span>
        <Caret className="leader-line-mark" />
      </button>
    </li>
  );
}

/** One office: its name, who holds it, and the box that adds to them. */
function OfficeEditor({
  section,
  groups,
  onDone,
  fresh = false,
  first,
  last,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  section: LeadershipSection;
  /** Every group, for an office held by one as a whole. */
  groups: ReadonlyMap<string, LeaderGroup>;
  /** Just added with the button: the caret goes straight to its name. */
  fresh?: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onChange: (change: (section: LeadershipSection) => LeadershipSection) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  /** Closes it back to its one line. */
  onDone: () => void;
}) {
  const { personById } = useDirectory();
  const label = section.title.trim() || "this office";
  const full = section.people.length >= LEADERS_PER_SECTION_MAX;

  const add = (leader: Leader) =>
    onChange((current) => {
      if (leader.personId && current.people.some((other) => other.personId === leader.personId))
        return current;
      if (leader.groupId && current.people.some((other) => other.groupId === leader.groupId))
        return current;
      return {
        ...current,
        people: [...current.people, leader].slice(0, LEADERS_PER_SECTION_MAX),
      };
    });

  return (
    <li className="leader-section is-open">
      <div className="leader-head">
        <input
          type="text"
          className="leader-title"
          aria-label="Office"
          value={section.title}
          placeholder="Office — e.g. Treasurer"
          autoFocus={fresh}
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
        <ul className="leader-chips">
          {section.people.map((leader, index) => {
            const gone = leaderGone(leader, personById, groups);
            const typed = !leader.personId && !leader.groupId;
            return (
              <li
                key={`${leader.personId ?? leader.groupId ?? "typed"}:${leader.name}:${index}`}
                className={`leader-chip${gone ? " gone" : ""}${typed ? " typed" : ""}`}
                title={
                  gone
                    ? "No longer in the directory — prints as saved"
                    : leader.groupId
                      ? "A group — prints as its name"
                      : typed
                        ? "Typed in"
                        : undefined
                }
              >
                <span>{leader.name}</span>
                {leader.groupId ? <span className="leader-badge">Group</span> : null}
                {disabled ? null : (
                  <button
                    type="button"
                    aria-label={`Take ${leader.name} off ${label}`}
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        people: current.people.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small leader-empty">Nobody yet — this office is left off the page.</p>
      )}
      {section.people.some((leader) => leaderGone(leader, personById, groups)) ? (
        <p className="small leader-gone leader-empty">
          Somebody here, or a group, is no longer in the directory, and prints as saved.
        </p>
      ) : null}

      {disabled || full ? null : (
        <PersonPicker
          label={label}
          taken={section.people}
          groups={groups}
          onPick={(person) => add({ personId: person.id, name: leaderName(person) })}
          onPickGroup={(id, group) => add({ personId: null, groupId: id, name: group.name })}
          onType={(name) => add({ personId: null, name })}
        />
      )}
      <div className="leader-done">
        <button type="button" className="btn small" onClick={onDone}>
          Done
        </button>
      </div>
    </li>
  );
}

/** How many people the open list shows before it asks for a few letters more. */
const PICKER_LIMIT = 80;

/**
 * Search and select: the directory as a list under the box, filtered as it
 * is typed into.
 *
 * It opens on a tap, before anything is typed, because a person adding the
 * treasurer may not remember how her surname is spelt - and on a phone,
 * typing to find out what can be typed is the slow way round. The list is in
 * the order of the book, by surname, and a whole row is the thing tapped.
 *
 * Words that are nobody's name can be printed as they are - an office held
 * by a team - and that choice sits at the foot of the list once something has
 * been typed, after everybody it might have meant.
 */
export function PersonPicker({
  label,
  taken,
  groups,
  onPick,
  onPickGroup,
  onType,
}: {
  /** What the office is called, for the box's name read aloud. */
  label: string;
  /** Who is already in the office, and so is not offered again. */
  taken: Leader[];
  /** Every group, for an office held by one as a whole. */
  groups: ReadonlyMap<string, LeaderGroup>;
  onPick: (person: PersonRow) => void;
  onPickGroup: (id: string, group: LeaderGroup) => void;
  onType: (words: string) => void;
}) {
  const { people, householdById, tags } = useDirectory();
  const colourOf = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.color])), [tags]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const closing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closing.current), []);

  /** Everybody, filed as the book files them: surname, then the name they go by. */
  const filed = useMemo(
    () =>
      people
        .map((person) => ({
          person,
          key: sortKey(person.last_name, leaderName(person)),
          searched: sortKey(
            person.first_name,
            person.preferred_name,
            person.last_name,
            leaderName(person),
          ),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [people],
  );

  const words = query.replace(/\s+/g, " ").trim();
  const { shown, more } = useMemo(() => {
    const needle = sortKey(query);
    const already = new Set(taken.map((leader) => leader.personId));
    const found = filed.filter(
      ({ person, searched }) => !already.has(person.id) && (!needle || searched.includes(needle)),
    );
    return {
      shown: found.slice(0, PICKER_LIMIT).map(({ person }) => person),
      more: Math.max(0, found.length - PICKER_LIMIT),
    };
  }, [filed, query, taken]);

  /** Groups whose name has what was typed in it, not already holding this office. */
  const groupsShown = useMemo(() => {
    const needle = sortKey(query);
    const already = new Set(taken.map((leader) => leader.groupId).filter(Boolean));
    return [...groups.entries()]
      .filter(
        ([id, group]) => !already.has(id) && (!needle || sortKey(group.name).includes(needle)),
      )
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [groups, query, taken]);

  /** Everything that can be chosen, in the order it is drawn: groups, people, the typed words. */
  type Option =
    | { kind: "group"; id: string; group: LeaderGroup }
    | { kind: "person"; person: PersonRow }
    | { kind: "typed" };
  const options: Option[] = [
    ...groupsShown.map(([id, group]) => ({ kind: "group" as const, id, group })),
    ...shown.map((person) => ({ kind: "person" as const, person })),
    ...(words ? [{ kind: "typed" as const }] : []),
  ];
  const current = Math.min(active, options.length - 1);
  const groupCount = groupsShown.length;

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    if (option.kind === "typed") onType(words);
    else if (option.kind === "group") onPickGroup(option.id, option.group);
    else onPick(option.person);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="leader-add person-picker">
      <input
        type="search"
        className="search"
        role="combobox"
        aria-label={`Add someone to ${label}`}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length ? optionId(current) : undefined}
        placeholder="Add a person or group…"
        autoComplete="off"
        value={query}
        onFocus={() => {
          window.clearTimeout(closing.current);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        // Closed a beat after the box loses focus rather than at once: on a
        // phone the tap on a row can take focus first, and a list that had
        // already gone would leave that tap landing on nothing.
        onBlur={() => {
          closing.current = window.setTimeout(() => setOpen(false), 200);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          // Enter is the form's Save everywhere else on this screen; here
          // it means "this one".
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && options.length) choose(current);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(Math.min(current + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (event.key === "Escape" && (open || query)) {
            event.preventDefault();
            if (open) setOpen(false);
            else setQuery("");
          }
        }}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`People to add to ${label}`}
          className="person-options"
          // Keeps the caret in the box while a row is pressed with a mouse.
          onMouseDown={(event) => event.preventDefault()}
        >
          {groupCount ? (
            // A group holds an office as a whole - the deaconesses doing the
            // food - and prints as the group's name. As pills, the way groups
            // are picked everywhere else, so a dozen of them are a few lines
            // at the top rather than a screen to scroll past to reach people.
            <li role="group" aria-label="Groups" className="person-option-groups">
              <span className="muted small">Groups</span>
              <span className="person-group-pills">
                {groupsShown.map(([id, group], index) => (
                  <span
                    key={id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === current}
                    className={`pill person-group-pill${index === current ? " active" : ""}`}
                    onClick={() => choose(index)}
                  >
                    <span
                      className="dot"
                      style={{ background: colourOf.get(id) ?? "var(--accent)" }}
                    />
                    {group.name}
                  </span>
                ))}
              </span>
            </li>
          ) : null}
          {shown.map((person, at) => {
            const index = groupCount + at;
            const home = person.household_id ? householdById.get(person.household_id) : null;
            return (
              <li
                key={person.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                className={`person-option${index === current ? " active" : ""}`}
                onClick={() => choose(index)}
              >
                <span className="person-option-name">{leaderName(person)}</span>
                {home ? <span className="muted small">{home.display_name}</span> : null}
              </li>
            );
          })}
          {more ? (
            <li className="person-option-more muted small" aria-hidden="true">
              {more} more — type a few letters of a name to find them.
            </li>
          ) : null}
          {!shown.length && !groupCount && !words ? (
            <li className="person-option-more muted small" aria-hidden="true">
              Everybody in the directory is already here.
            </li>
          ) : null}
          {words ? (
            <li
              id={optionId(options.length - 1)}
              role="option"
              aria-selected={current === options.length - 1}
              className={`person-option typed${current === options.length - 1 ? " active" : ""}`}
              onClick={() => choose(options.length - 1)}
            >
              <span className="person-option-name">“{words}”</span>
              <span className="muted small">
                {shown.length || groupCount
                  ? "Or print these words as they are"
                  : "Nobody by that name — print these words as they are"}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
