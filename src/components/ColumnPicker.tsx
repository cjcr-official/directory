import { useEffect, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui";

/**
 * The "Columns" button above a browse table, and the tick boxes it opens.
 *
 * A panel rather than a row of toggles left open above the table: this is a
 * setting somebody chooses once and then reads the table under for months, and
 * a permanent second bar of controls above a letter bar that is already there
 * would cost every visit to pay for that one.
 *
 * The button carries the count of what is switched off. Without it the only
 * evidence that a column exists is a panel nobody has opened, and a table with
 * no phone numbers in it looks like a directory with no phone numbers in it.
 */
export function ColumnPicker<K extends string>({
  columns,
  shown,
  onChange,
}: {
  columns: readonly { key: K; label: string }[];
  shown: readonly K[];
  onChange: (next: K[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Back to the button that opened it: closing a panel from the keyboard
      // and landing at the top of the document is how a keyboard user loses
      // their place in a page this long.
      button.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* Rebuilt from `columns` rather than pushed and spliced, so the table's own
     order survives a column being switched off and back on. */
  const set = (key: K, on: boolean) =>
    onChange(
      columns
        .filter((column) => (column.key === key ? on : shown.includes(column.key)))
        .map((column) => column.key),
    );

  const hidden = columns.length - shown.length;

  return (
    <div className="column-picker">
      <button
        type="button"
        ref={button}
        className="btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        Columns
        {hidden ? <span className="muted small">{hidden} hidden</span> : null}
      </button>
      {open ? (
        <>
          {/*
           * Every row of a browse table is a link to somebody's record, so
           * closing this by clicking away needs somewhere harmless to click.
           * Listening on the document instead put the panel away and then let
           * the click through to the row underneath, and dismissing a menu
           * opened a person's page.
           */}
          <div className="column-scrim" onClick={() => setOpen(false)} />
          <div className="column-panel" id={panelId} role="group" aria-label="Columns to show">
            {columns.map((column) => (
              <Checkbox
                key={column.key}
                label={column.label}
                checked={shown.includes(column.key)}
                onChange={(on) => set(column.key, on)}
              />
            ))}
            {hidden ? (
              <button
                type="button"
                className="btn ghost small column-all"
                onClick={() => onChange(columns.map((column) => column.key))}
              >
                Show all
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
