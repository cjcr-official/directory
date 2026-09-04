import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, EmptyState, Field, LoadingScreen, Notice } from "@/components/ui";
import { createTag, deleteTag, updateTag } from "@/lib/queries";

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
 * Characters wide, so the field is the size of the name it holds. The ceiling
 * only stops a pathological name from running the length of the card - a
 * narrow screen is handled by the field shrinking, not by this.
 */
function nameSize(value: string): number {
  return Math.min(Math.max(value.trim().length, 6), 34);
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

  /** How many printable records each group would pull in. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      for (const tagId of entry.tagIds) map.set(tagId, (map.get(tagId) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  if (loading && !tags.length) return <LoadingScreen label="Loading groups…" />;

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
      setFormError(cause instanceof Error ? cause.message : String(cause));
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
                return (
                  <li key={tag.id} className="group-item">
                    <span className="group-dot" style={{ background: tag.color }} />
                    {canEdit ? (
                      <input
                        className="group-name"
                        type="text"
                        defaultValue={tag.name}
                        // Sized to the word rather than to the column, so the
                        // rule under it stops where the name does instead of
                        // running on like a blank to be filled in.
                        size={nameSize(tag.name)}
                        aria-label={`Rename ${tag.name}`}
                        onInput={(event) => {
                          event.currentTarget.size = nameSize(event.currentTarget.value);
                        }}
                        onBlur={async (event) => {
                          const field = event.target;
                          const next = field.value.trim();
                          if (!next || next === tag.name) {
                            field.value = tag.name;
                            field.size = nameSize(tag.name);
                            return;
                          }
                          try {
                            setFormError(null);
                            await updateTag(tag.id, { name: next });
                            await reload();
                          } catch (cause) {
                            // Group names are unique; a clash must not leave
                            // the new name on screen and the old one stored.
                            field.value = tag.name;
                            field.size = nameSize(tag.name);
                            setFormError(cause instanceof Error ? cause.message : String(cause));
                          }
                        }}
                      />
                    ) : (
                      <span className="group-name-text">{tag.name}</span>
                    )}

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
                              setFormError(cause instanceof Error ? cause.message : String(cause));
                              throw cause;
                            }
                            await reload();
                          }}
                        />
                      </span>
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
