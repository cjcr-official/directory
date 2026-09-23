import { useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Notice } from "@/components/ui";
import { fetchDirectory, fetchProjects } from "@/lib/queries";
import { buildBackup, saveBackupFile } from "@/lib/backup";
import { recordBackup } from "@/lib/backupLog";
import { applyRestore, listStoredPhotos, readBackupFile } from "@/lib/restore";
import { message } from "@/lib/format";
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
 * owner-only, asks for the word to be typed, and downloads a copy of the
 * directory as it stands before it touches anything.
 */

/**
 * The directory as the database holds it right now.
 *
 * Not the copy the rest of the app is showing: that is only refreshed when
 * somebody is added, so a family another editor deleted an hour ago would
 * still be in it, and would not be offered back. Storage is listed alongside,
 * so a photograph missing from a record that is still here can be put back.
 */
async function readLive(): Promise<LiveDirectory> {
  const [directory, projects, storedPhotos] = await Promise.all([
    fetchDirectory(),
    fetchProjects(),
    listStoredPhotos(),
  ]);
  return { ...directory, projects, storedPhotos };
}
export function RestorePanel() {
  const { canEdit, isOwner } = useAuth();
  const { reload } = useDirectory();

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
      const current = await readLive();
      setLive(current);
      setPlan(await readBackupFile(file, current));
    } catch (cause) {
      setError(message(cause));
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
    // Nothing is written until applyRestore starts. A failure before then -
    // the safety copy, or reading the directory - leaves the directory as it
    // was and the chosen file still good to use.
    let writing = false;
    try {
      if (mode === "replace") {
        // Everything added since the chosen file was taken is about to go, and
        // a replace that fails part way on a database without 0011 leaves the
        // directory half-loaded. Either way, what is here now is kept on this
        // device first. If that copy cannot be made, nothing is replaced.
        setProgress({ done: 0, total: 1, label: "Saving a copy of the directory as it is now" });
        let safety;
        try {
          safety = await buildBackup({
            data: await fetchDirectory(),
            includePhotos: true,
            onProgress: (step) =>
              setProgress({ ...step, label: `Saving a copy first: ${step.label.toLowerCase()}` }),
          });
        } catch (cause) {
          throw new Error(
            `A copy of the directory as it is now could not be saved (${message(cause)}), so ` +
              `nothing has been replaced.`,
          );
        }
        saveBackupFile(safety.bytes, safety.fileName.replace("-backup-", "-before-replace-"));
        await recordBackup({
          photosIncluded: true,
          households: live.households.length,
          people: live.people.length,
        });
      }

      // Read again, so the decision is made against the directory as it is at
      // the moment of writing rather than when the file was chosen.
      const current = await readLive();
      writing = true;
      const done = await applyRestore(plan, mode, current, setProgress);
      setResult(done);
      setPlan(null);
      setFileName("");
      setTyped("");
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (cause) {
      if (!writing) {
        setError(message(cause));
        return;
      }
      // The writes are separate requests, so a failure part way through leaves
      // a half-restored directory. Running it again is safe - adding back
      // skips what is already there by id, and replacing starts by clearing -
      // but only against the directory as it now stands, so the plan and the
      // chosen file are dropped and it has to be read again. Reusing this one
      // would try to insert rows that landed before the failure.
      setPartial(true);
      setError(message(cause));
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
        <div className="card-head column">
          <h2>Restore from a backup</h2>
          <span className="muted">Nothing is written until you say so.</span>
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
  const liveFamilies = live?.households.length ?? 0;
  const livePeople = live?.people.length ?? 0;
  const confirmed = !replacing || typed.trim().toLowerCase() === "replace";
  const nothingToDo =
    plan !== null &&
    !replacing &&
    plan.missing.households === 0 &&
    plan.missing.people === 0 &&
    plan.missing.tags === 0 &&
    plan.missing.projects === 0 &&
    plan.missing.links === 0 &&
    plan.missing.reattach === 0 &&
    plan.missing.photos === 0;

  return (
    <div className="card">
      <div className="card-head column">
        <h2>Restore from a backup</h2>
        <span className="muted">Nothing is written until you say so.</span>
      </div>
      <div className="card-body">
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

        {plan ? (
          <>
            {/* Second in the body once a file is read, because by then the
                first thing to say is what that file holds. Choosing another
                one is the correction, not the task. */}
            <label className="btn small file-button" htmlFor="restore-file">
              {reading ? "Reading…" : "Choose a different file"}
            </label>

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
                  {plan.missing.reattach > 0
                    ? `, ${plan.missing.reattach} ${plan.missing.reattach === 1 ? "person" : "people"} no longer in their family`
                    : ""}
                  {plan.missing.photos > 0
                    ? `, ${plan.missing.photos} ${plan.missing.photos === 1 ? "photograph" : "photographs"}`
                    : ""}
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
                    .
                    {plan.missing.reattach > 0
                      ? ` ${plan.missing.reattach} ${plan.missing.reattach === 1 ? "person who is" : "people who are"} still here but no longer in their family ${plan.missing.reattach === 1 ? "goes" : "go"} back into it.`
                      : ""}
                    {plan.missing.photos > 0
                      ? ` ${plan.missing.photos} missing ${plan.missing.photos === 1 ? "photograph is" : "photographs are"} put back.`
                      : ""}{" "}
                    Nothing else already here is changed or deleted.
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
                        Deletes all {liveFamilies} famil
                        {liveFamilies === 1 ? "y" : "ies"} and {livePeople}{" "}
                        {livePeople === 1 ? "person" : "people"} in the directory now, then loads
                        this file exactly. Anything added since it was taken is gone. A copy of the
                        directory as it is now downloads first.
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
                  Everything in the directory is replaced. Before anything is touched, a copy of the
                  directory as it is now is downloaded to this device — keep it until you are sure.
                </span>
              </div>
            ) : null}

            {plan.damagedPhotos > 0 ? (
              <Notice kind="warn">
                {plan.damagedPhotos} {plan.damagedPhotos === 1 ? "photograph" : "photographs"} in
                this file {plan.damagedPhotos === 1 ? "is" : "are"} damaged and will be left out.
                Everything else in it reads correctly.
              </Notice>
            ) : null}

            {nothingToDo ? (
              <Notice kind="ok">
                Nothing is missing. Everything in this file is already in the directory.
              </Notice>
            ) : null}
          </>
        ) : (
          <p className="small">
            Choose a backup file and it is read and described here: what it holds, and what is in it
            that the directory no longer has. Adding back what is missing changes nothing that is
            already here.
          </p>
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
              ) : result.added.households +
                  result.added.people +
                  result.added.tags +
                  result.reattached +
                  result.photosUploaded ===
                0 ? (
                <>Nothing needed putting back.</>
              ) : (
                <>
                  Put back {result.added.households} famil
                  {result.added.households === 1 ? "y" : "ies"} and {result.added.people}{" "}
                  {result.added.people === 1 ? "person" : "people"}.
                </>
              )}
              {result.reattached > 0
                ? ` ${result.reattached} ${result.reattached === 1 ? "person is" : "people are"} back in their family.`
                : ""}
              {result.photosUploaded > 0
                ? ` ${result.photosUploaded} photograph${result.photosUploaded === 1 ? "" : "s"} put back.`
                : ""}
              {result.photosRemoved > 0
                ? ` ${result.photosRemoved} photograph${result.photosRemoved === 1 ? "" : "s"} nothing used any more ${result.photosRemoved === 1 ? "was" : "were"} cleared from storage.`
                : ""}
              {result.orphaned > 0
                ? ` ${result.orphaned} ${result.orphaned === 1 ? "person" : "people"} had no family left to belong to and ${result.orphaned === 1 ? "was" : "were"} restored without one.`
                : ""}
            </Notice>
            {result.photosFailed > 0 ? (
              <div style={{ marginTop: 8 }}>
                <Notice kind="warn">
                  {result.photosFailed} {result.photosFailed === 1 ? "photograph" : "photographs"}{" "}
                  could not be uploaded. The records are restored; choose the same file again and
                  add back what is missing to try the photographs again.
                </Notice>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* What you press, ruled off at the bottom of the panel where the other
          two keep theirs. Before a file is read there is nothing to commit, so
          the foot holds the chooser instead - which is the only thing this
          panel can do at that point, and the reason to be looking at it. */}
      <div className="panel-foot">
        {plan ? (
          <>
            <button
              type="button"
              className={`btn ${replacing ? "danger" : "primary"}`}
              disabled={busy || !confirmed || nothingToDo}
              onClick={() => void restore()}
            >
              {busy ? "Restoring…" : replacing ? "Replace everything" : "Add back what is missing"}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={forget}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <label className="btn file-button" htmlFor="restore-file">
              {reading ? "Reading…" : "Choose a backup file"}
            </label>
            <span className="note">A .zip this app took.</span>
          </>
        )}
      </div>
    </div>
  );
}
