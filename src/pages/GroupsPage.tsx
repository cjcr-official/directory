import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Caret, ConfirmButton, EmptyState, Field, LoadingScreen, Notice } from "@/components/ui";
import { createTag, deleteTag, updateTag } from "@/lib/queries";
import { fileAsName, firstName, labelledHouseholdName, message, sortKey } from "@/lib/format";
import type { HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import type { DirectoryEntry, HouseholdWithMembers } from "@/lib/entries";

const PALETTE = [
  "#2f6d63",
  "#7c5cbf",
  "#c2643a",
  "#3f7cac",
  "#a34f6f",
  "#5c7a2f",
  "#b0813a",
  "#4b5c8a",
  "#8a4b4b",
];

type GroupRow =
  | { person: PersonRow; household: HouseholdRow | null }
  | { person: null; household: HouseholdWithMembers };

/**
 * Who is in a group: the people ticked into it, one to a line.
 *
 * Only people who carry the group themselves. Listing everyone who lives with
 * them put a wife, a husband and three children under "Deacons" because one of
 * them is a deacon. Filed by surname, the way the book files them.
 *
 * A family ticked into the group as a whole - on the family's own page rather
 * than a person's - is not one of those people, and is listed after them as
 * the family it is. Saying so is the whole point: it is why a family can turn
 * up in a group's booklet when nobody in it is ticked, and the line links to
 * where that tick can be taken off.
 */
function peopleIn(entries: DirectoryEntry[], tagId: string): GroupRow[] {
  const people: GroupRow[] = [];
  const families: GroupRow[] = [];
  for (const entry of entries) {
    if (entry.type === "person") {
      if (entry.person.tags.some((tag) => tag.id === tagId))
        people.push({ person: entry.person, household: entry.person.household });
      continue;
    }
    const household = entry.household;
    for (const member of household.members) {
      if ((household.memberTags[member.id] ?? []).some((tag) => tag.id === tagId))
        people.push({ person: member, household });
    }
    if (household.tags.some((tag) => tag.id === tagId)) families.push({ person: null, household });
  }
  const key = (row: GroupRow) =>
    row.person
      ? sortKey(row.person.last_name, firstName(row.person))
      : sortKey(row.household.sort_name);
  const byKey = (x: GroupRow, y: GroupRow) => key(x).localeCompare(key(y));
  return [...people.sort(byKey), ...families.sort(byKey)];
}

/**
 * The colours a group is usually given, and a well for any other.
 *
 * The same row the name tags' accent uses, so choosing a colour looks and
 * works the same wherever it is done. The well is ringed when the colour in
 * use is none of the presets, or the row would show nothing as chosen.
 */
function ColourChoice({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (color: string) => void;
}) {
  const own = !PALETTE.includes(value.toLowerCase());
  return (
    <div className="colour-field">
      {PALETTE.map((option) => (
        <button
          key={option}
          type="button"
          className={`swatch${value.toLowerCase() === option ? " on" : ""}`}
          style={{ background: option }}
          aria-label={option}
          aria-pressed={value.toLowerCase() === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        />
      ))}
      <span className={`any-colour${own ? " on" : ""}`} title="Any colour">
        <input
          id={id}
          type="color"
          aria-label="Any colour"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}

/**
 * Groups are plain labels, but they are the mechanism behind event booklets:
 * tag once here, then a project can select "everyone in the choir" without
 * anybody re-picking names.
 */
export function GroupsPage() {
  const { tags, entries, loading, error, reload } = useDirectory();
  const { canEdit } = useAuth();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The one group whose people are on show, if any. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftColor, setDraftColor] = useState(PALETTE[0]);
  const [renaming, setRenaming] = useState(false);

  /** Who each group holds, counted the way the list below lists them. */
  const counts = useMemo(() => {
    const map = new Map<string, GroupRow[]>();
    for (const tag of tags) map.set(tag.id, peopleIn(entries, tag.id));
    return map;
  }, [entries, tags]);

  /** Who is in the group that is open, one person to a line - see peopleIn. */
  const inGroup = useMemo(() => (openId ? peopleIn(entries, openId) : []), [entries, openId]);

  if (loading && !tags.length) return <LoadingScreen label="Loading groups…" />;

  /** Opening a group also arms its name and colour for editing. */
  function toggle(tag: TagRow) {
    setFormError(null);
    if (openId === tag.id) {
      setOpenId(null);
      return;
    }
    setOpenId(tag.id);
    setDraft(tag.name);
    setDraftColor(tag.color);
  }

  async function rename(tag: TagRow) {
    const next = draft.trim();
    if (!next) return;
    const patch: Partial<TagRow> = {};
    if (next !== tag.name) patch.name = next;
    if (draftColor.toLowerCase() !== tag.color.toLowerCase()) patch.color = draftColor;
    if (!Object.keys(patch).length) return;

    // Caught here rather than by the unique index, for the same reason the add
    // form catches it: the answer names the group, and a group that differs
    // only by capitals is refused too, which the index would allow.
    const clash = tags.find(
      (other) => other.id !== tag.id && other.name.toLowerCase() === next.toLowerCase(),
    );
    if (clash) {
      setFormError(`There is already a group called “${clash.name}”.`);
      return;
    }

    setRenaming(true);
    setFormError(null);
    try {
      await updateTag(tag.id, patch);
      await reload();
    } catch (cause) {
      // The stored name and colour are still the old ones, so the fields go
      // back to saying so rather than showing what nothing was saved under.
      setDraft(tag.name);
      setDraftColor(tag.color);
      setFormError(message(cause));
    } finally {
      setRenaming(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    // Caught here rather than by the unique index, so the answer names the
    // group instead of a constraint - and so a group that only differs by
    // capitals is refused too, which the index would happily allow.
    const clash = tags.find((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      setFormError(`There is already a group called “${clash.name}”.`);
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await createTag(trimmed, color, null);
      setName("");
      // The next preset along, so a run of new groups do not all come out
      // one colour; from a colour of their own, back to the first.
      setColor(PALETTE[(PALETTE.indexOf(color) + 1) % PALETTE.length]);
      await reload();
    } catch (cause) {
      setFormError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Groups</h1>
          <div className="sub">
            Labels you can attach to a family or a person — choir, youth group, a committee, an
            event. Tagging one member pulls their whole family into a booklet.
          </div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h2>Your groups</h2>
          </div>
          {formError ? (
            <div style={{ padding: "12px 18px 0" }}>
              <Notice kind="error">{formError}</Notice>
            </div>
          ) : null}
          {tags.length ? (
            <ul className="group-list">
              {tags.map((tag) => {
                const rows = counts.get(tag.id) ?? [];
                const count = rows.filter((row) => row.person).length;
                const families = rows.length - count;
                const open = openId === tag.id;
                const panelId = `group-people-${tag.id}`;
                return (
                  <li key={tag.id} className="group-item">
                    <div className="group-row">
                      <span className="group-dot" style={{ background: tag.color }} />

                      {/* The name asks the question a name in a list is asked -
                          who is in this? - rather than offering to be retyped,
                          which is what it used to do the moment it was touched. */}
                      <button
                        type="button"
                        className="group-name-button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => toggle(tag)}
                      >
                        <span className="group-name-label">{tag.name}</span>
                        <Caret className="group-name-mark" />
                      </button>

                      <span className="group-count">
                        {count === 0 ? "Nobody" : count === 1 ? "1 person" : `${count} people`}
                        {families === 1
                          ? ", 1 family"
                          : families > 1
                            ? `, ${families} families`
                            : ""}
                      </span>

                      {canEdit ? (
                        <span className="group-actions">
                          <ConfirmButton
                            subtle
                            label="Delete"
                            confirmLabel="Delete group"
                            onConfirm={async () => {
                              setFormError(null);
                              try {
                                await deleteTag(tag.id);
                              } catch (cause) {
                                // Shown at the top of the card, where the add
                                // form's errors go, rather than as small print
                                // beside a button in a row.
                                setFormError(message(cause));
                                throw cause;
                              }
                              if (openId === tag.id) setOpenId(null);
                              await reload();
                            }}
                          />
                        </span>
                      ) : null}
                    </div>

                    {open ? (
                      <div className="group-members" id={panelId}>
                        {inGroup.length ? (
                          <ul className="group-member-list">
                            {inGroup.map((row) =>
                              row.person ? (
                                <li key={row.person.id} className="group-member">
                                  <Link
                                    className="list-link group-member-name"
                                    to={`/people/${row.person.id}`}
                                  >
                                    {fileAsName(row.person)}
                                  </Link>
                                  <span className="group-member-who">
                                    {row.household
                                      ? labelledHouseholdName(row.household)
                                      : "On their own"}
                                  </span>
                                </li>
                              ) : (
                                <li key={row.household.id} className="group-member">
                                  <Link
                                    className="list-link group-member-name"
                                    to={`/families/${row.household.id}`}
                                  >
                                    {labelledHouseholdName(row.household)}
                                  </Link>
                                  <span className="group-member-who">
                                    The whole family is in this group
                                    {row.household.members.length
                                      ? ` — ${row.household.members.map(firstName).join(", ")}`
                                      : ""}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="hint" style={{ margin: 0 }}>
                            Nobody is in this group yet. Open a family or a person and tick “
                            {tag.name}” under Groups.
                          </p>
                        )}

                        {canEdit ? (
                          <form
                            className="group-rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void rename(tag);
                            }}
                          >
                            <Field label="Name" htmlFor={`group-name-${tag.id}`}>
                              <input
                                id={`group-name-${tag.id}`}
                                type="text"
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                              />
                            </Field>
                            <Field label="Colour" htmlFor={`group-colour-${tag.id}`}>
                              <ColourChoice
                                id={`group-colour-${tag.id}`}
                                value={draftColor}
                                disabled={renaming}
                                onChange={setDraftColor}
                              />
                            </Field>
                            <button
                              type="submit"
                              className="btn"
                              disabled={
                                renaming ||
                                !draft.trim() ||
                                (draft.trim() === tag.name &&
                                  draftColor.toLowerCase() === tag.color.toLowerCase())
                              }
                            >
                              {renaming ? "Saving…" : "Save changes"}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No groups yet">
              Groups are optional. Add one when you want to print a directory for part of the
              congregation rather than all of it.
            </EmptyState>
          )}
        </div>

        {canEdit ? (
          <div className="card">
            <div className="card-head">
              <h2>Add a group</h2>
            </div>
            <div className="card-body">
              <form onSubmit={add}>
                <Field label="Name" htmlFor="group_name">
                  <input
                    id="group_name"
                    type="text"
                    value={name}
                    placeholder="Choir, Youth Group, Deacons…"
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>

                <Field label="Colour" htmlFor="group_colour">
                  <ColourChoice id="group_colour" value={color} onChange={setColor} />
                </Field>

                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !name.trim()}
                  style={{ marginTop: 10 }}
                >
                  {busy ? "Adding…" : "Add group"}
                </button>
              </form>

              <p className="muted small" style={{ marginTop: 16 }}>
                Once you have a group, create a directory under{" "}
                <Link to="/projects">Directories</Link> and choose “People in certain groups”.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
