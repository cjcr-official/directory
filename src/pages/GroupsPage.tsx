import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, EmptyState, Field, LoadingScreen, Notice } from "@/components/ui";
import { createTag, deleteTag, updateTag } from "@/lib/queries";
import { resolveEntries } from "@/lib/projectEntries";
import { fileAsName, firstName, join, labelledHouseholdName, message } from "@/lib/format";
import type { TagRow } from "@/lib/database.types";

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
  const [renaming, setRenaming] = useState(false);

  /** How many printable records each group would pull in. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      for (const tagId of entry.tagIds) map.set(tagId, (map.get(tagId) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  /**
   * Who is in the group that is open.
   *
   * Worked out by the function the booklets already use, asked the way a list
   * of people rather than of families asks it: a family that carries the group
   * itself stays one record, because somebody put the household in, and a
   * family pulled in on a member's behalf comes apart into the members who are
   * actually in it. So this answers "who is in the choir" with exactly the
   * names a choir booklet would print, rather than with a second opinion.
   */
  const inGroup = useMemo(
    () =>
      openId
        ? resolveEntries(entries, {
            mode: "tags",
            tagIds: [openId],
            entries: [],
            wholeFamily: false,
          })
        : [],
    [entries, openId],
  );

  if (loading && !tags.length) return <LoadingScreen label="Loading groups…" />;

  /** Opening a group also arms its name for renaming, which is the one edit it has. */
  function toggle(tag: TagRow) {
    setFormError(null);
    if (openId === tag.id) {
      setOpenId(null);
      return;
    }
    setOpenId(tag.id);
    setDraft(tag.name);
  }

  async function rename(tag: TagRow) {
    const next = draft.trim();
    if (!next || next === tag.name) return;

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
      await updateTag(tag.id, { name: next });
      await reload();
    } catch (cause) {
      // The stored name is still the old one, so the field goes back to saying
      // so rather than showing a name nothing was saved under.
      setDraft(tag.name);
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
                const count = counts.get(tag.id) ?? 0;
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
                        <span className="group-name-mark" aria-hidden>
                          ⌄
                        </span>
                      </button>

                      <span className="group-count">
                        {count === 0 ? "No records" : count === 1 ? "1 record" : `${count} records`}
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
                            {inGroup.map((entry) =>
                              entry.type === "household" ? (
                                <li key={`household:${entry.id}`} className="group-member">
                                  <Link
                                    className="list-link group-member-name"
                                    to={`/families/${entry.id}`}
                                  >
                                    {labelledHouseholdName(entry.household)}
                                  </Link>
                                  <span className="group-member-who">
                                    {entry.household.members.length
                                      ? `The whole family — ${join(
                                          entry.household.members.map(firstName),
                                          ", ",
                                        )}`
                                      : "The whole family — nobody is on its card yet"}
                                  </span>
                                </li>
                              ) : (
                                <li key={`person:${entry.id}`} className="group-member">
                                  <Link
                                    className="list-link group-member-name"
                                    to={`/people/${entry.id}`}
                                  >
                                    {fileAsName(entry.person)}
                                  </Link>
                                  <span className="group-member-who">
                                    {entry.person.household
                                      ? labelledHouseholdName(entry.person.household)
                                      : "On their own"}
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
                            <button
                              type="submit"
                              className="btn"
                              disabled={renaming || !draft.trim() || draft.trim() === tag.name}
                            >
                              {renaming ? "Renaming…" : "Rename"}
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

                <Field label="Colour">
                  <div className="row tight">
                    {PALETTE.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-label={option}
                        onClick={() => setColor(option)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          background: option,
                          border:
                            color === option ? "2px solid var(--ink)" : "2px solid transparent",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>
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
