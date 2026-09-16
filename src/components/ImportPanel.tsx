import { useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Notice } from "@/components/ui";
import { applyImport, readImportFile } from "@/lib/importPeople";
import { message, join } from "@/lib/format";
import type { ImportPlan, ImportProgress } from "@/lib/importPeople";

/** "1 family", "3 people" - the plural said once rather than at every call. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Bringing a congregation in from Planning Center.
 *
 * The same shape as restoring: the file is read and described before anything
 * is written, and nothing already in the directory is touched. An import only
 * ever adds - a family whose name is already here keeps the record it has and
 * gains whoever is new, and a person already under that name in that family is
 * left exactly as they are. So running it twice does nothing the second time,
 * which is the property that makes it safe to press.
 */
export function ImportPanel() {
  const { canEdit } = useAuth();
  const { households, people, reload } = useDirectory();

  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ households: number; people: number } | null>(null);

  /** Puts the panel back to its empty state, minus whatever it has just said. */
  function forget() {
    setPlan(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setResult(null);
    forget();
    try {
      setPlan(await readImportFile(file, { households, people }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setReading(false);
    }
  }

  async function bringIn() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await applyImport(plan, setProgress));
      forget();
      await reload();
    } catch (cause) {
      // The writes are separate requests, so a failure part way through leaves
      // some of the file in. Running it again is safe - what landed is found
      // and skipped - but only against the directory as it now stands, so the
      // plan is dropped and the file has to be chosen again.
      setError(message(cause));
      setPlan(null);
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!canEdit) {
    return (
      <div className="card">
        <div className="card-head column">
          <h2>Import from Planning Center</h2>
          <span className="muted">Only ever adds. Nothing already here is changed.</span>
        </div>
        <div className="card-body">
          <Notice kind="warn">
            Importing is limited to editors and owners — it writes records into the directory for
            everybody.
          </Notice>
        </div>
      </div>
    );
  }

  const adding = plan ? plan.households.length + plan.people.length : 0;

  return (
    <div className="card">
      <div className="card-head column">
        <h2>Import from Planning Center</h2>
        <span className="muted">Only ever adds. Nothing already here is changed.</span>
      </div>
      <div className="card-body">
        <p className="small measure">
          In Planning Center: <strong>People → the list you want → Actions → Export</strong>, as a
          spreadsheet.
        </p>

        {/* No accept filter, for the reason the restore panel gives: iOS greys
            out what it does not recognise, and a file that cannot be picked is
            worse than one refused with a sentence saying why. */}
        <input
          ref={fileInput}
          id="import-file"
          type="file"
          className="file-input"
          disabled={reading || busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />

        {plan ? (
          <>
            <label className="btn small file-button" htmlFor="import-file">
              {reading ? "Reading…" : "Choose a different file"}
            </label>

            <dl className="plan-figures">
              <div>
                <dt>File</dt>
                <dd>{plan.fileName}</dd>
              </div>
              <div>
                <dt>Holds</dt>
                <dd>
                  {count(plan.rowsRead, "row", "rows")}
                  {plan.unnamed > 0 ? `, ${plan.unnamed} with no name in` : ""}
                </dd>
              </div>
              <div>
                <dt>Will add</dt>
                <dd>
                  {join([
                    count(plan.households.length, "family", "families"),
                    count(plan.people.length, "person", "people"),
                  ])}
                  {plan.joining > 0 ? ` · ${plan.joining} joining a family already here` : ""}
                </dd>
              </div>
              {plan.alreadyHere > 0 ? (
                <div>
                  <dt>Already here</dt>
                  <dd>{count(plan.alreadyHere, "person", "people")}, left alone</dd>
                </div>
              ) : null}
              {plan.unmapped.length > 0 ? (
                <div>
                  <dt>Not brought in</dt>
                  <dd className="muted">{plan.unmapped.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : null}

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
              Added{" "}
              {join([
                count(result.households, "family", "families"),
                count(result.people, "person", "people"),
              ])}
              . Photographs are not in an export, so they are still to be taken.
            </Notice>
          </div>
        ) : null}

        <p className="muted small measure" style={{ marginTop: 14 }}>
          Comes in: names, the family each person is in, addresses, phones, emails, birthdays,
          anniversaries, background check dates and medical notes. Photographs are not in an export.
        </p>
      </div>

      {/* The same foot the other two panels keep: what you press, ruled off at
          the bottom, with the chooser standing in for it until there is a file
          to say anything about. */}
      <div className="panel-foot">
        {plan ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy || adding === 0}
              onClick={() => void bringIn()}
            >
              {busy
                ? "Adding…"
                : adding === 0
                  ? "Nothing new to add"
                  : `Add ${join([
                      count(plan.households.length, "family", "families"),
                      count(plan.people.length, "person", "people"),
                    ])}`}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={forget}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <label className="btn file-button" htmlFor="import-file">
              {reading ? "Reading…" : "Choose an export"}
            </label>
            <span className="note">An .xlsx or .csv export.</span>
          </>
        )}
      </div>
    </div>
  );
}
