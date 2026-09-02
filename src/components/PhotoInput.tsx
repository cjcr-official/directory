import { useEffect, useRef, useState } from "react";
import { getPhotoUrl, preparePhoto, type PreparedPhoto } from "@/lib/photos";

interface Props {
  /** Storage path of the photo already saved, if any. */
  path: string | null;
  initials: string;
  disabled?: boolean;
  /**
   * Called with the resized JPEG when a new photo is chosen, or null when the
   * existing one is removed. The parent uploads on save, so nothing is written
   * to storage until the form is submitted.
   */
  onChange: (blob: Blob | null, removed: boolean) => void;
}

/**
 * Pick a photo, see it immediately, upload only on save.
 *
 * The file is downscaled in the browser the moment it is chosen, so what you
 * preview is exactly what gets stored - no surprise between the screen and the
 * printed page.
 */
export function PhotoInput({ path, initials, disabled, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<PreparedPhoto | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setSavedUrl(null);
      return;
    }
    getPhotoUrl(path)
      .then((url) => {
        if (active) setSavedUrl(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [path]);

  // Object URLs are cheap but not free; release the previous one.
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  const shown = pending?.previewUrl ?? (removed ? null : savedUrl);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      setPending((previous) => {
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return prepared;
      });
      setRemoved(false);
      onChange(prepared.blob, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that image.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setPending((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    setRemoved(true);
    onChange(null, true);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
      {shown ? (
        <img className="avatar lg" src={shown} alt="" />
      ) : (
        <span className="avatar lg" aria-hidden>
          {initials.slice(0, 2).toUpperCase()}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 160 }}>
        <input
          ref={input}
          type="file"
          accept="image/*"
          disabled={disabled || busy}
          style={{ display: "none" }}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <div className="row tight">
          <button
            type="button"
            className="btn small"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? "Preparing…" : shown ? "Replace photo" : "Add photo"}
          </button>
          {shown ? (
            <button type="button" className="btn ghost small" disabled={disabled} onClick={clear}>
              Remove
            </button>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: 7 }}>
          Portrait orientation prints best. Large photos are shrunk automatically
          {pending
            ? ` — ${pending.width}×${pending.height}, ${Math.round(pending.blob.size / 1024)} KB`
            : ""}
          .
        </p>
        {error ? (
          <p className="hint" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
