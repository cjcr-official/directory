import { useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Notice } from "@/components/ui";
import { fetchProjects } from "@/lib/queries";
import { applyRestore, readBackupFile } from "@/lib/restore";
import type {
  LiveDirectory,
  RestoreMode,
  RestorePlan,
  RestoreProgress,
  RestoreResult,
} from "@/lib/restore";

/**
 * Loading a backup back in.
 *
 * The file is read and described before anything is written, because the two
 * things this can do are very different sizes and the person choosing between
 * them deserves to see which one they are about to press. Adding back what is
 * missing is the default and is safe; replacing everything is not, so it is
 * owner-only and asks for the word to be typed.
 */
export function RestorePanel() {
  const { canEdit, isOwner } = useAuth();
  const { households, people, tags, householdTags, personTags, reload } = useDirectory();

  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [live, setLive] = useState<LiveDirectory | null>(null);
  const [mode, setMode] = useState<RestoreMode>("missing");
  const [typed, setTyped] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  /** Set when a write failed, so the notice can say what to do about it. */
  const [partial, setPartial] = useState(false);

  function forget() {
    setPlan(null);
    setLive(null);
    setFileName("");
    setMode("missing");
    setTyped("");
    setError(null);
    setResult(null);
    setPartial(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    setResult(null);
    setPartial(false);
    setPlan(null);
    setTyped("");
    setMode("missing");
    setFileName(file.name);
    try {
      // Directories are not in the shared context, and the plan needs to know
      // which of them are missing, so they are read alongside the file.
      const projects = await fetchProjects();
      const current: LiveDirectory = {
        households,
        people,
        tags,
        projects,
        householdTags,
        personTags,
      };
      setLive(current);
      setPlan(await readBackupFile(file, current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setFileName("");
    } finally {
      setReading(false);
    }
  }

  async function restore() {
    if (!plan || !live) return;
    setBusy(true);
    setError(null);
    setPartial(false);
    try {
      const done = await applyRestore(plan, mode, live, setProgress);
      setResult(done);
      setPlan(null);
      setFileName("");
      setTyped("");
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (cause) {
      // The writes are separate requests, so a failure part way through leaves
      // a half-restored directory. Running it again is safe - adding back
      // skips what is already there by id, and replacing starts by clearing -
      // but only against the directory as it now stands, so the plan and the
      // chosen file are dropped and it has to be read again. Reusing this one
      // would try to insert rows that landed before the failure.
      setPartial(true);
      setError(cause instanceof Error ? cause.message : String(cause));
      setPlan(null);
      setLive(null);
      setTyped("");
      setFileName("");
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
        <div className="card-head">
          <h2>Restore from a backup</h2>
        </div>
        <div className="card-body">
          <Notice kind="warn">
            Restoring is limited to editors and owners — it writes records back into the directory
            for everybody.
          </Notice>
        </div>
      </div>
    );
  }

  const replacing = mode === "replace";
  const confirmed = !replacing || typed.trim().toLowerCase() === "replace";
  const nothingToDo =
    plan !== null &&
    !replacing &&
    plan.missing.households === 0 &&
    plan.missing.people === 0 &&
    plan.missing.tags === 0 &&
    plan.missing.projects === 0 &&
    plan.missing.links === 0;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Restore from a backup</h2>
      </div>
      <div className="card-body">
        <p className="small">
          Choose a backup file to see what is in it. Nothing is written until you say so.
        </p>

        {/* No accept filter on purpose. iOS greys out anything outside it and
            decides what a .zip is by its own file type rather than the
            extension, so a backup that cannot be picked at all is the worse
            failure - and the wrong file is refused below with a sentence
            saying what to choose instead. */}
        <input
          ref={fileInput}
          id="restore-file"
          type="file"
          className="file-input"
          disabled={reading || busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <label className="btn file-button" htmlFor="restore-file">
          {reading ? "Reading…" : plan ? "Choose a different file" : "Choose a backup file"}
        </label>

        {plan ? (
          <>
            <dl className="plan-figures">
              <div>
                <dt>File</dt>
                <dd>{fileName}</dd>
              </div>
              <div>
                <dt>Taken</dt>
                <dd>{plan.takenAt ? plan.takenAt.toLocaleString() : "at an unrecorded time"}</dd>
              </div>
              <div>
                <dt>Holds</dt>
                <dd>
                  {plan.inFile.households} families, {plan.inFile.people} people, {plan.inFile.tags}{" "}
                  groups
                </dd>
              </div>
              <div>
                <dt>Missing now</dt>
                <dd>
                  {plan.missing.households} families, {plan.missing.people} people,{" "}
                  {plan.missing.tags} groups, {plan.missing.links} group memberships
                </dd>
              </div>
              {plan.newerThanBackup.households + plan.newerThanBackup.people > 0 ? (
                <div>
                  <dt>Added since</dt>
                  <dd>
                    {plan.newerThanBackup.households} families, {plan.newerThanBackup.people} people
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="choices" role="radiogroup" aria-label="What to restore">
              <label className={`choice${mode === "missing" ? " active" : ""}`}>
                <input
                  type="radio"
                  name="restore-mode"
                  checked={mode === "missing"}
                  onChange={() => setMode("missing")}
                />
                <span>
                  <strong>Add back what is missing</strong>
                  <span className="choice-hint">
                    Puts back the {plan.missing.households} famil
                    {plan.missing.households === 1 ? "y" : "ies"} and {plan.missing.people}{" "}
                    {plan.missing.people === 1 ? "person" : "people"} this file has and the
                    directory does not
                    {plan.missing.links > 0
                      ? `, and ${plan.missing.links} group ${plan.missing.links === 1 ? "membership" : "memberships"} that ${plan.missing.links === 1 ? "is" : "are"} no longer recorded`
                      : ""}
                    . Nothing already here is changed or deleted.
                  </span>
                </span>
              </label>

              <label
                className={`choice danger${replacing ? " active" : ""}${isOwner ? "" : " disabled"}`}
              >
                <input
                  type="radio"
                  name="restore-mode"
                  checked={replacing}
                  disabled={!isOwner}
                  onChange={() => setMode("replace")}
                />
                <span>
                  <strong>Replace everything</strong>
                  <span className="choice-hint">
                    {isOwner ? (
                      <>
                        Deletes all {households.length} famil
                        {households.length === 1 ? "y" : "ies"} and {people.length}{" "}
                        {people.length === 1 ? "person" : "people"} in the directory now, then loads
                        this file exactly. Anything added since it was taken is gone. This cannot be
                        undone.
                      </>
                    ) : (
                      "Owners only."
                    )}
                  </span>
                </span>
              </label>
            </div>

            {replacing ? (
              <div className="field">
                <label htmlFor="restore-confirm">
                  Type <span className="mono">replace</span> to confirm
                </label>
                <input
                  id="restore-confirm"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
                <span className="hint">
                  Everything in the directory is deleted first. There is no undo — download a fresh
                  backup before doing this if you have not already.
                </span>
              </div>
            ) : null}

            {nothingToDo ? (
              <Notice kind="ok">
                Nothing is missing. Everything in this file is already in the directory.
              </Notice>
            ) : null}

            <div className="row tight" style={{ marginTop: 12 }}>
              <button
                type="button"
                className={`btn ${replacing ? "danger" : "primary"}`}
                disabled={busy || !confirmed || nothingToDo}
                onClick={() => void restore()}
              >
                {busy
                  ? "Restoring…"
                  : replacing
                    ? "Replace everything"
                    : "Add back what is missing"}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={forget}>
                Cancel
              </button>
            </div>
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
            <Notice kind="error">
              {error}
              {partial ? (
                <div style={{ marginTop: 8 }}>
                  Some of it may have been written before this stopped. Choose the same file again
                  and it will pick up from where the directory now is — nothing goes in twice.
                </div>
              ) : null}
            </Notice>
          </div>
        ) : null}

        {result ? (
          <div style={{ marginTop: 14 }}>
            <Notice kind="ok">
              {result.removed.households + result.removed.people > 0 ? (
                <>
                  Cleared the directory and loaded the backup. {result.added.households} famil
                  {result.added.households === 1 ? "y" : "ies"} and {result.added.people}{" "}
                  {result.added.people === 1 ? "person" : "people"} are in it now.
                </>
              ) : result.added.households + result.added.people + result.added.tags === 0 ? (
                <>Nothing needed putting back.</>
              ) : (
                <>
                  Put back {result.added.households} famil
                  {result.added.households === 1 ? "y" : "ies"} and {result.added.people}{" "}
                  {result.added.people === 1 ? "person" : "people"}.
                </>
              )}
              {result.photosUploaded > 0
                ? ` ${result.photosUploaded} photograph${result.photosUploaded === 1 ? "" : "s"} came back with them.`
                : ""}
              {result.orphaned > 0
                ? ` ${result.orphaned} ${result.orphaned === 1 ? "person" : "people"} had no family left to belong to and ${result.orphaned === 1 ? "was" : "were"} restored without one.`
                : ""}
            </Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
