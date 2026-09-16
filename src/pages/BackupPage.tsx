import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Checkbox, LoadingScreen, Notice } from "@/components/ui";
import { RestorePanel } from "@/components/RestorePanel";
import { ImportPanel } from "@/components/ImportPanel";
import { buildBackup, type BackupProgress } from "@/lib/backup";
import { message } from "@/lib/format";

const LAST_BACKUP_KEY = "church-directory:last-backup";

function describeAge(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "about a month ago" : `about ${months} months ago`;
}

export function BackupPage() {
  const { canEdit } = useAuth();
  const { households, people, tags, householdTags, personTags, entries, loading } = useDirectory();

  const [includePhotos, setIncludePhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fileName: string; size: number; missing: number } | null>(
    null,
  );
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLastBackup(localStorage.getItem(LAST_BACKUP_KEY));
    } catch {
      // Private browsing, or storage disabled. The reminder is a nicety.
    }
  }, []);

  const withPhotos = [
    ...households.map((row) => row.photo_path),
    ...people.map((row) => row.photo_path),
  ].filter(Boolean).length;

  if (loading && !people.length) return <LoadingScreen label="Loading the directory…" />;

  async function download() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const backup = await buildBackup({
        data: { households, people, tags, householdTags, personTags },
        includePhotos,
        onProgress: setProgress,
      });

      const url = URL.createObjectURL(
        new Blob([backup.bytes as BlobPart], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_BACKUP_KEY, now);
      } catch {
        // Not worth failing the backup over.
      }
      setLastBackup(now);
      setResult({
        fileName: backup.fileName,
        size: backup.bytes.length,
        missing: backup.missingPhotos.length,
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const age = describeAge(lastBackup);

  return (
    <div className="page backup-page">
      <div className="page-head">
        <div className="grow">
          <h1>Backup</h1>
          <div className="sub">Take a copy, put one back, or bring a congregation in.</div>
        </div>
      </div>

      {/* What a backup would hold, and how long it has been. These are facts
          about the directory rather than about any one of the three panels, so
          they are stated once at the top instead of as a line of small print
          inside the download card - which is where they used to live, and
          where the one that actually decides anything, how long it has been,
          was the last few words of a paragraph. */}
      <div className="card stat-strip">
        <div className="stat">
          <span className="value">{entries.length}</span>
          <span className="label">Records</span>
        </div>
        <div className="stat">
          <span className="value">{people.length}</span>
          <span className="label">People</span>
        </div>
        <div className="stat">
          <span className="value">{withPhotos}</span>
          <span className="label">Photographs</span>
        </div>
        <div className="stat worded">
          <span className="value">{age ?? "Never"}</span>
          <span className="label">Last backup</span>
        </div>
      </div>

      {/* Three things to do with one file, so three panels of one shape: a
          head saying what it is, a body holding however much it holds, and a
          foot holding what you press. The stylesheet keeps them the same
          height as each other and no taller than the window. */}
      <div className="grid backup-panels">
        <div className="card">
          <div className="card-head column">
            <h2>Download a backup</h2>
            <span className="muted">Every record and photograph, in one file you keep.</span>
          </div>
          <div className="card-body">
            {canEdit ? (
              <Checkbox
                label="Include photographs"
                hint={
                  includePhotos
                    ? "A complete copy, and a much larger file."
                    : "Records only — the photographs would have to be taken again."
                }
                checked={includePhotos}
                onChange={setIncludePhotos}
                disabled={busy}
              />
            ) : (
              <Notice kind="warn">
                Backups are limited to editors and owners — the file contains every address and
                phone number in one place.
              </Notice>
            )}

            {progress ? (
              <div className="row" style={{ marginTop: 14 }}>
                <span className="progress-track">
                  <div
                    style={{
                      width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                    }}
                  />
                </span>
                <span className="muted small">{progress.label}</span>
              </div>
            ) : null}

            {error ? (
              <div style={{ marginTop: 14 }}>
                <Notice kind="error">{error}</Notice>
              </div>
            ) : null}

            {result ? (
              <div style={{ marginTop: 14 }}>
                <Notice kind="ok">
                  Saved <strong>{result.fileName}</strong> ({(result.size / 1_048_576).toFixed(1)}{" "}
                  MB).
                  {result.missing > 0
                    ? ` ${result.missing} photograph${result.missing === 1 ? "" : "s"} could not be read and ${result.missing === 1 ? "was" : "were"} left out.`
                    : ""}
                </Notice>
              </div>
            ) : null}

            {/* Deleting a family has no undo, so the interval is the whole
                advice: often enough that a bad afternoon costs a month, and
                kept somewhere that is not the database it copies. */}
            <p className="muted small" style={{ marginTop: 14 }}>
              Once a month, and before a print run. Keep it somewhere other than the database.
            </p>

            <Notice kind="warn">
              The file holds every address and phone number in one place. Treat it the way you treat
              the printed directory.
            </Notice>
          </div>
          {canEdit ? (
            <div className="panel-foot">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void download()}
              >
                {busy ? "Building…" : "Download backup"}
              </button>
              {age ? <span className="note">Last one from this browser: {age}.</span> : null}
            </div>
          ) : null}
        </div>

        <RestorePanel />
        <ImportPanel />
      </div>
    </div>
  );
}
