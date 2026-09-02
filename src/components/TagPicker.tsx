import { useState } from "react";
import type { TagRow } from "@/lib/database.types";
import { createTag } from "@/lib/queries";

interface Props {
  tags: TagRow[];
  selected: string[];
  onChange: (tagIds: string[]) => void;
  /** Allows creating a tag inline, so a new group never means a detour. */
  allowCreate?: boolean;
  onCreated?: () => Promise<void> | void;
  disabled?: boolean;
}

const NEW_TAG_COLORS = [
  "#2f6d63",
  "#7c5cbf",
  "#c2643a",
  "#3f7cac",
  "#a34f6f",
  "#5c7a2f",
  "#b0813a",
];

export function TagPicker({ tags, selected, onChange, allowCreate, onCreated, disabled }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((tagId) => tagId !== id) : [...selected, id]);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const color = NEW_TAG_COLORS[tags.length % NEW_TAG_COLORS.length];
      const tag = await createTag(trimmed, color, null);
      await onCreated?.();
      onChange([...selected, tag.id]);
      setName("");
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row tight">
        {tags.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className="pill"
              disabled={disabled}
              onClick={() => toggle(tag.id)}
              style={{
                cursor: disabled ? "default" : "pointer",
                background: on ? tag.color : "var(--canvas)",
                borderColor: on ? tag.color : "var(--line)",
                color: on ? "#fff" : "var(--ink-2)",
              }}
            >
              <span
                className="dot"
                style={{ background: on ? "rgba(255,255,255,.75)" : tag.color }}
              />
              {tag.name}
            </button>
          );
        })}

        {allowCreate && !adding ? (
          <button
            type="button"
            className="btn ghost small"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            + New group
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="row tight" style={{ marginTop: 8 }}>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="Choir, Youth Group, Deacons…"
            style={{ maxWidth: 240 }}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <button
            type="button"
            className="btn small primary"
            disabled={busy}
            onClick={() => void create()}
          >
            Add
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
