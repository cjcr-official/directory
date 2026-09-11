import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPhotoUrl } from "@/lib/photos";
import { describeChange, message } from "@/lib/format";

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-screen">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "error" | "warn" | "ok";
  children: ReactNode;
}) {
  return <div className={`notice ${kind === "info" ? "" : kind}`}>{children}</div>;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

/**
 * A card that stays shut until it is wanted.
 *
 * Every setting on a directory has a default that prints a good book, so a
 * form showing all of them at once asks a question the answer to which is
 * almost always "leave it". Closed, the panel says what it is currently set
 * to, which is the part worth reading; open, it is an ordinary card.
 */
export function Disclosure({
  title,
  summary,
  open,
  children,
}: {
  title: string;
  /** What the settings inside currently add up to, in a few words. */
  summary: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card disclosure" open={open}>
      <summary className="disclosure-head">
        <span className="disclosure-titles">
          <span className="disclosure-title">{title}</span>
          <span className="disclosure-summary">{summary}</span>
        </span>
        <span className="disclosure-mark" aria-hidden>
          ⌄
        </span>
      </summary>
      <div className="card-body">{children}</div>
    </details>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/**
 * A date, and every way a browser has of emptying one.
 *
 * iOS does not draw these itself: tapping one opens the system calendar, and
 * that calendar has a Reset button. Reset empties the element - but through a
 * path a controlled React input was not hearing, so the field went blank on
 * screen while the form went on holding the date. The line underneath still
 * described it, saving kept it, and the next render put it back on screen. A
 * date could be changed and not removed, which for four optional fields is
 * most of what they are for.
 *
 * So the element is asked what it holds rather than waited on to say: on its
 * own change event, which some browsers raise for the picker where React's
 * onChange hears nothing, and again when it loses focus, which is the last
 * moment before anything else can be done with the form. Each is compared
 * with what is held, so the ordinary case - typing a date, and hearing about
 * it three times - still only reports once.
 *
 * The blur pass earns its place on a desk too. Half a date typed into one of
 * these leaves the element empty, and the form used to keep the old value
 * against a field showing nothing.
 */
export function DateInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string | null;
  disabled?: boolean;
  /** Null for an empty field, which every date in this app is allowed to be. */
  onChange: (value: string | null) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  /*
   * What the listeners below compare against, kept somewhere they can read it.
   * They are attached once - re-attaching them on every render to pick up a
   * new closure would mean adding and removing two listeners per keystroke -
   * so the props they need are put where a listener attached on the first
   * render can still find the latest of them.
   */
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    const node = field.current;
    if (!node) return;
    const sync = () => {
      const next = node.value || null;
      if (next !== latest.current.value) latest.current.onChange(next);
    };
    node.addEventListener("change", sync);
    node.addEventListener("blur", sync);
    return () => {
      node.removeEventListener("change", sync);
      node.removeEventListener("blur", sync);
    };
  }, []);

  return (
    <input
      ref={field}
      id={id}
      type="date"
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    />
  );
}

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="check-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * A photo, or the person's initials while there isn't one. Signed URLs are
 * fetched lazily and cached by the photos module, so a long list of faces
 * costs one request.
 */
export function Avatar({
  path,
  initials,
  size = "sm",
  alt = "",
}: {
  path: string | null | undefined;
  initials: string;
  size?: "sm" | "lg";
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    getPhotoUrl(path)
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [path]);

  const className = `avatar${size === "lg" ? " lg" : ""}`;
  if (url) return <img className={className} src={url} alt={alt} />;
  return (
    <span className={className} aria-hidden={!alt}>
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** A destructive button that asks once, inline, before doing the thing. */
export function ConfirmButton({
  label,
  confirmLabel = "Really delete",
  onConfirm,
  disabled,
  /** Quiet until hovered - for a delete that sits in every row of a table. */
  subtle,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  subtle?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <span className="row tight">
        <button
          type="button"
          className={subtle ? "btn ghost small danger-hover" : "btn danger"}
          disabled={disabled}
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
        >
          {label}
        </button>
        {error ? (
          <span className="small" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="row tight">
      <button
        type="button"
        className={subtle ? "btn danger small" : "btn danger"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onConfirm();
            setArmed(false);
          } catch (cause) {
            // Without this the rejection is swallowed and a failed delete
            // looks exactly like a successful one.
            setError(message(cause));
            setArmed(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Deleting…" : confirmLabel}
      </button>
      <button type="button" className="btn ghost small" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/**
 * "Changed on Tuesday by Anne Whitfield", under the heading of a record.
 *
 * Renders nothing at all when there is nothing to say - a record being created,
 * or a database that has not run migration 0005 - rather than a row of dashes
 * explaining its own absence. Three people sharing the work is the case this
 * is for; one person editing their own directory never needs to read it.
 */
export function ChangedNote({
  updatedAt,
  author,
}: {
  updatedAt: string | null | undefined;
  author: string | null | undefined;
}) {
  const text = describeChange(updatedAt, author);
  if (!text) return null;
  return <div className="muted small changed-note">{text}</div>;
}

export function TagPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="pill">
      <span className="dot" style={{ background: color }} />
      {name}
    </span>
  );
}
