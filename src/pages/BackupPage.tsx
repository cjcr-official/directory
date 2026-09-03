import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Checkbox, LoadingScreen, Notice } from "@/components/ui";
import { RestorePanel } from "@/components/RestorePanel";
import { buildBackup, type BackupProgress } from "@/lib/backup";

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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const age = describeAge(lastBackup);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Backup</h1>
          <div className="sub">
            Download everything as one file — the records, the groups and the photographs — and load
            it back if something is lost.
          </div>
        </div>
      </div>

      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h2>Download a backup</h2>
          </div>
          <div className="card-body">
            <p className="small">
              {entries.length} records · {people.length} people · {withPhotos} photographs
            </p>

            <Checkbox
              label="Include photographs"
              hint={
                includePhotos
                  ? "Makes the file much larger, and makes it a complete copy."
                  : "Records only. Faster, but the photographs would have to be taken again."
              }
              checked={includePhotos}
              onChange={setIncludePhotos}
            />

            {canEdit ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void download()}
                style={{ marginTop: 6 }}
              >
                {busy ? "Building…" : "Download backup"}
              </button>
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

            {age ? (
              <p className="muted small" style={{ marginTop: 14 }}>
                Last backup from this browser: {age}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Why this matters</h2>
          </div>
          <div className="card-body">
            <p className="small">
              Anyone with the editor role can delete a family, and there is no undo. A backup turns
              that from a disaster into an annoyance.
            </p>
            <p className="small">
              <strong>Once a month is plenty</strong>, and again right before a print run. Keep the
              file somewhere that is not the same place as the database — a backup stored next to
              the thing it backs up is not a backup.
            </p>
            <p className="small">
              The archive holds <span className="mono">families.csv</span> and{" "}
              <span className="mono">people.csv</span>, which open in any spreadsheet;{" "}
              <span className="mono">photos/</span>, with every picture as an ordinary JPEG; and{" "}
              <span className="mono">directory.json</span>, which is the complete copy to restore
              from. There is a README inside explaining all of it.
            </p>
            <Notice kind="warn">
              The file contains the congregation's home addresses and phone numbers. Treat it the
              way you would treat the printed directory.
            </Notice>
          </div>
        </div>

        <RestorePanel />
      </div>
    </div>
  );
}
