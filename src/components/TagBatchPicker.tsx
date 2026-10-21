import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui";

/**
 * One line of the checklist.
 *
 * Memoised, with a toggle that never changes identity, so ticking one box
 * re-renders that box rather than the whole congregation - the same bargain
 * the directory's own hand-picked checklist makes.
 */
const BatchRow = memo(function BatchRow({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  return <Checkbox label={label} checked={checked} onChange={(on) => onToggle(id, on)} />;
});

/**
 * Ticks a batch of the directory's people for a run of name tags.
 *
 * Open to everyone who can print, not only editors: nothing here is saved, so
 * there is nothing for read-only access to protect.
 */
export function TagBatchPicker({
  choices,
  chosen,
  onChange,
}: {
  choices: { id: string; label: string }[];
  chosen: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) => choice.label.toLowerCase().includes(needle));
  }, [choices, query]);

  /** Counted against who is in the directory now, not every id in the address. */
  const count = useMemo(
    () => choices.filter((choice) => chosen.has(choice.id)).length,
    [choices, chosen],
  );
  const allShownChosen = visible.length > 0 && visible.every((choice) => chosen.has(choice.id));

  // Held in a ref so the toggle can read the current batch without being
  // rebuilt on every tick, which would be a new prop on every row.
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  const onToggle = useCallback(
    (id: string, on: boolean) => {
      const next = new Set(chosenRef.current);
      if (on) next.add(id);
      else next.delete(id);
      onChange(next);
    },
    [onChange],
  );

  function chooseShown(on: boolean) {
    const next = new Set(chosen);
    for (const choice of visible) {
      if (on) next.add(choice.id);
      else next.delete(choice.id);
    }
    onChange(next);
  }

  return (
    <div>
      <div className="toolbar picker-toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search people…"
          aria-label="Search people"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted small">{count} chosen</span>
        {visible.length ? (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => chooseShown(!allShownChosen)}
          >
            {allShownChosen
              ? query.trim()
                ? "Untick these"
                : "Untick all"
              : query.trim()
                ? "Tick these"
                : "Tick all"}
          </button>
        ) : null}
        {count ? (
          <button type="button" className="btn ghost small" onClick={() => onChange(new Set())}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="picker-list">
        {visible.map((choice) => (
          <BatchRow
            key={choice.id}
            id={choice.id}
            label={choice.label}
            checked={chosen.has(choice.id)}
            onToggle={onToggle}
          />
        ))}
        {!visible.length ? <p className="muted small">Nobody matches.</p> : null}
      </div>
    </div>
  );
}
