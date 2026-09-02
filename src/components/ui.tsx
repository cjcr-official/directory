import { useEffect, useState, type ReactNode } from "react";
import { getPhotoUrl } from "@/lib/photos";

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row tight">
      <span className="spinner" aria-hidden />
      {label ? <span className="muted small">{label}</span> : null}
    </span>
  );
}

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
        {error ? <span className="small" style={{ color: "var(--danger)" }}>{error}</span> : null}
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
            setError(cause instanceof Error ? cause.message : String(cause));
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

export function TagPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="pill">
      <span className="dot" style={{ background: color }} />
      {name}
    </span>
  );
}
