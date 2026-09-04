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
            <table className="grid-table">
              <colgroup>
                <col className="c-rest" />
                <col className="c-mid" />
                <col className="c-mid" />
              </colgroup>
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="num">Records</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id}>
                    <td>
                      <span className="row tight">
                        <span
                          className="dot"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: tag.color,
                          }}
                        />
                        {canEdit ? (
                          <input
                            type="text"
                            defaultValue={tag.name}
                            style={{
                              maxWidth: 220,
                              border: "1px solid transparent",
                              background: "transparent",
                            }}
                            onBlur={async (event) => {
                              const field = event.target;
                              const next = field.value.trim();
                              if (!next || next === tag.name) {
                                field.value = tag.name;
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
                                setFormError(
                                  cause instanceof Error ? cause.message : String(cause),
                                );
                              }
                            }}
                          />
                        ) : (
                          tag.name
                        )}
                      </span>
                    </td>
                    <td className="num muted">{counts.get(tag.id) ?? 0}</td>
                    <td style={{ textAlign: "right" }}>
                      {canEdit ? (
                        <ConfirmButton
                          subtle
                          label="Delete"
                          confirmLabel="Delete group"
                          onConfirm={async () => {
                            await deleteTag(tag.id);
                            await reload();
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
