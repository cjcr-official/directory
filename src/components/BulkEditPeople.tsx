import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useDirectory } from "@/data/DirectoryContext";
import { AddressFields } from "@/components/AddressFields";
import { TagPicker } from "@/components/TagPicker";
import { DateInput, Field, Notice } from "@/components/ui";
import type { Gender, HouseholdRole, PersonRow, PhotoFit } from "@/lib/database.types";
import {
  asksNothing,
  describeNow,
  planBulkEdit,
  type BulkChanges,
  type BulkContext,
} from "@/lib/bulkEdit";
import { saveBulkEdit } from "@/lib/queries";
import {
  fileAsName,
  fullName,
  HOUSEHOLD_ROLES,
  labelledHouseholdName,
  message,
} from "@/lib/format";
import { RENEWAL_YEARS, suggestDue } from "@/lib/backgroundChecks";

/** How many names the heading lists before it says how many more. */
const NAMES_SHOWN = 8;

interface Props {
  /** Everybody being edited, as the directory holds them now. */
  people: PersonRow[];
  changes: BulkChanges;
  onChange: (changes: BulkChanges) => void;
  onCancel: () => void;
  /**
   * Everything that could go through did, for this many people. `note` names
   * anybody somebody else deleted meanwhile, who there was no changing.
   */
  onDone: (count: number, note: string | null) => void;
  /** Some did not: these are the ones left to try again. */
  onNarrow: (ids: string[]) => void;
}

/** "1 person", "12 people". */
function countPeople(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * One field of a bulk edit: what it is, the choice of what to do to it, and
 * how the people chosen stand on it now.
 */
function BulkField({
  label,
  htmlFor,
  now,
  children,
}: {
  label: string;
  htmlFor: string;
  now: string;
  children: ReactNode;
}) {
  return (
    <Field label={label} htmlFor={htmlFor} hint={`Now: ${now}`}>
      <div className="bulk-choice">{children}</div>
    </Field>
  );
}

/**
 * The form for changing everybody chosen on the People list at once.
 *
 * Shaped like a person's own form, card for card, so nothing on it has to be
 * learned twice. The difference is that every field opens on "Leave as they
 * are", says underneath how the people chosen stand on it now, and changes
 * nothing until it is set to something else - and that the bottom of the form
 * says, before anything is saved, exactly what saving would do and to how
 * many.
 */
export function BulkEditPeople({
  people: chosen,
  changes,
  onChange,
  onCancel,
  onDone,
  onNarrow,
}: Props) {
  const { households, tags, householdById, membersOf, tagsOfPerson, reload } = useDirectory();
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ written: number; of: number } | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [allNames, setAllNames] = useState(false);

  const context = useMemo<BulkContext>(
    () => ({ householdById, membersOf, tagsOfPerson, tags }),
    [householdById, membersOf, tagsOfPerson, tags],
  );
  const plan = useMemo(() => planBulkEdit(chosen, changes, context), [chosen, changes, context]);
  const now = useMemo(() => describeNow(chosen, context), [chosen, context]);

  /** The groups anybody chosen is in - the only ones there is anybody to take out of. */
  const heldTags = useMemo(() => {
    const held = new Set(chosen.flatMap((person) => tagsOfPerson(person.id)));
    return tags.filter((tag) => held.has(tag.id));
  }, [chosen, tags, tagsOfPerson]);

  /*
   * Photo shape arrived with migration 0010, and a database that has not run
   * it returns rows without the column - writing to it there would refuse the
   * whole request. And it is a choice about a photo, so it is not offered for
   * people who have none of their own, as the person form offers it only
   * beside one.
   */
  const canShapePhotos = chosen.some((person) => "photo_fit" in person && person.photo_path);

  function set<K extends keyof BulkChanges>(key: K, value: BulkChanges[K]) {
    setError(null);
    onChange({ ...changes, [key]: value });
  }

  const nothing = asksNothing(changes);
  const leaving = changes.family.mode === "leave";
  // A part in a family is only for somebody in one: asked while anybody chosen
  // is in a family and staying, or when they are all being put in one.
  const asksRole =
    changes.family.mode === "join" || (!leaving && chosen.some((person) => person.household_id));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || plan.problems.length || !plan.touched.length) return;

    setSaving(true);
    setError(null);
    setProgress(null);
    const nameOf = new Map(chosen.map((person) => [person.id, fullName(person)]));
    try {
      const result = await saveBulkEdit(plan, (written, of) => setProgress({ written, of }));
      await reload();
      const goneNote = result.gone.length
        ? `Not changed, because somebody has deleted them: ${result.gone
            .map((id) => nameOf.get(id) ?? "Somebody")
            .join(", ")}.`
        : null;
      if (!result.failed.size) {
        onDone(result.done.length, goneNote);
        return;
      }

      // Said a reason at a time, because the reasons are what decide what to
      // do next: a deleted person is gone, somebody else's edit is worth
      // looking at, and a dropped connection only wants pressing again.
      const byReason = new Map<string, string[]>();
      for (const [id, reason] of result.failed) {
        const list = byReason.get(reason) ?? [];
        list.push(nameOf.get(id) ?? "Somebody");
        byReason.set(reason, list);
      }
      setError(
        <>
          {result.done.length
            ? `${countPeople(result.done.length)} changed, but not everybody. `
            : "Nobody was changed. "}
          {result.failed.size === 1 ? "This one was not:" : `These ${result.failed.size} were not:`}
          <ul className="bulk-failures">
            {[...byReason].map(([reason, list]) => (
              <li key={reason}>
                <strong>{list.join(", ")}</strong> — {reason}
              </li>
            ))}
          </ul>
          They are still chosen, and the form is as you left it, so pressing Change again tries them
          again.
          {goneNote ? <p className="bulk-gone">{goneNote}</p> : null}
        </>,
      );
      onNarrow([...result.failed.keys()]);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  const names = chosen.map(fileAsName);
  const shownNames = allNames ? names : names.slice(0, NAMES_SHOWN);

  return (
    <div className="page form">
      <div className="page-head">
        <div className="grow">
          <button type="button" className="btn ghost small page-back" onClick={onCancel}>
            ← Back to people
          </button>
          <h1>Edit {countPeople(chosen.length)}</h1>
          <div className="sub">
            Only what you change here is changed. Everything left as it is stays as each person has
            it.
          </div>
          <p className="bulk-names small">
            {shownNames.join("; ")}
            {names.length > NAMES_SHOWN ? (
              <>
                {allNames ? "" : `; and ${names.length - NAMES_SHOWN} more`}{" "}
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setAllNames((open) => !open)}
                >
                  {allNames ? "Show fewer" : "Show all"}
                </button>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <form onSubmit={save}>
        <div className="grid two">
          <div className="card">
            <div className="card-head">
              <h2>Details</h2>
            </div>
            <div className="card-body">
              <BulkField label="Last name" htmlFor="bulk-last-name" now={now.lastName}>
                <select
                  id="bulk-last-name"
                  value={changes.lastName.mode}
                  onChange={(event) =>
                    set("lastName", {
                      ...changes.lastName,
                      mode: event.target.value as "keep" | "set",
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="set">Change to…</option>
                </select>
                {changes.lastName.mode === "set" ? (
                  <input
                    type="text"
                    aria-label="New last name"
                    autoFocus
                    value={changes.lastName.value}
                    onChange={(event) =>
                      set("lastName", { mode: "set", value: event.target.value })
                    }
                  />
                ) : null}
              </BulkField>

              <BulkField label="Gender" htmlFor="bulk-gender" now={now.gender}>
                <select
                  id="bulk-gender"
                  value={
                    changes.gender.mode === "keep" ? "keep" : (changes.gender.value ?? "unsaid")
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    set(
                      "gender",
                      value === "keep"
                        ? { mode: "keep", value: null }
                        : { mode: "set", value: value === "unsaid" ? null : (value as Gender) },
                    );
                  }}
                >
                  <option value="keep">Leave as they are</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="unsaid">Not said</option>
                </select>
              </BulkField>

              <BulkField label="Phone" htmlFor="bulk-phone" now={now.phone}>
                <select
                  id="bulk-phone"
                  value={changes.phone.mode}
                  onChange={(event) =>
                    set("phone", {
                      ...changes.phone,
                      mode: event.target.value as BulkChanges["phone"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="set">Change to…</option>
                  <option value="clear">Remove</option>
                </select>
                {changes.phone.mode === "set" ? (
                  <input
                    type="tel"
                    aria-label="New phone number"
                    value={changes.phone.value}
                    onChange={(event) => set("phone", { mode: "set", value: event.target.value })}
                  />
                ) : null}
              </BulkField>

              <BulkField label="Email" htmlFor="bulk-email" now={now.email}>
                <select
                  id="bulk-email"
                  value={changes.email.mode}
                  onChange={(event) =>
                    set("email", {
                      ...changes.email,
                      mode: event.target.value as BulkChanges["email"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="set">Change to…</option>
                  <option value="clear">Remove</option>
                </select>
                {changes.email.mode === "set" ? (
                  <input
                    type="email"
                    aria-label="New email address"
                    value={changes.email.value}
                    onChange={(event) => set("email", { mode: "set", value: event.target.value })}
                  />
                ) : null}
              </BulkField>

              {/* Each person's own, so there is no date to give everybody - but
                  taking the year off, or the birthday away, is one decision
                  however many people it is made for. */}
              <BulkField label="Date of birth" htmlFor="bulk-birthday" now={now.birthday}>
                <select
                  id="bulk-birthday"
                  value={changes.birthday.mode}
                  onChange={(event) =>
                    set("birthday", {
                      mode: event.target.value as BulkChanges["birthday"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="drop-year">Leave out the year, keep the day</option>
                  <option value="clear">Remove</option>
                </select>
              </BulkField>

              {canShapePhotos ? (
                <BulkField
                  label="Their own photo, in the book"
                  htmlFor="bulk-fit"
                  now={now.photoFit}
                >
                  <select
                    id="bulk-fit"
                    value={
                      changes.photoFit.mode === "keep"
                        ? "keep"
                        : (changes.photoFit.value ?? "default")
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      set(
                        "photoFit",
                        value === "keep"
                          ? { mode: "keep", value: null }
                          : {
                              mode: "set",
                              value: value === "default" ? null : (value as PhotoFit),
                            },
                      );
                    }}
                  >
                    <option value="keep">Leave as they are</option>
                    <option value="default">Directory default</option>
                    <option value="fill">Crop to fill</option>
                    <option value="fit">Whole photo</option>
                  </select>
                </BulkField>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Family &amp; address</h2>
            </div>
            <div className="card-body">
              <BulkField label="Family" htmlFor="bulk-family" now={now.family}>
                <select
                  id="bulk-family"
                  value={
                    changes.family.mode === "join"
                      ? changes.family.householdId || "join"
                      : changes.family.mode
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    set(
                      "family",
                      value === "keep" || value === "leave"
                        ? { mode: value, householdId: "" }
                        : { mode: "join", householdId: value === "join" ? "" : value },
                    );
                  }}
                >
                  <option value="keep">Leave as they are</option>
                  <option value="leave">Not in a family — each prints on their own</option>
                  <optgroup label="Put them all in">
                    {households.map((option) => (
                      <option key={option.id} value={option.id}>
                        {labelledHouseholdName(option)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </BulkField>

              {asksRole ? (
                <BulkField label="In the family" htmlFor="bulk-role" now={now.role}>
                  <select
                    id="bulk-role"
                    value={changes.role.mode === "keep" ? "keep" : changes.role.value}
                    onChange={(event) => {
                      const value = event.target.value;
                      set(
                        "role",
                        value === "keep"
                          ? { ...changes.role, mode: "keep" }
                          : { mode: "set", value: value as HouseholdRole },
                      );
                    }}
                  >
                    <option value="keep">Leave as they are</option>
                    {HOUSEHOLD_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </BulkField>
              ) : null}

              <BulkField label="Address" htmlFor="bulk-address" now={now.address}>
                <select
                  id="bulk-address"
                  value={
                    leaving && changes.address.mode === "family" ? "keep" : changes.address.mode
                  }
                  onChange={(event) =>
                    set("address", {
                      ...changes.address,
                      mode: event.target.value as BulkChanges["address"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  {leaving ? null : <option value="family">Use their family's address</option>}
                  <option value="set">Give them all this address…</option>
                  <option value="clear">Remove their own address</option>
                </select>
              </BulkField>
              {changes.address.mode === "set" ? (
                <div className="bulk-nested">
                  <AddressFields
                    idPrefix="bulk"
                    value={changes.address.value}
                    onChange={(next) =>
                      set("address", {
                        mode: "set",
                        value: { ...changes.address.value, ...next },
                      })
                    }
                  />
                </div>
              ) : null}
              {leaving && changes.address.mode !== "set" && changes.address.mode !== "clear" ? (
                <p className="hint bulk-aside">
                  Anybody who printed with their family's address keeps it, copied onto their own
                  record, so their card still has one.
                </p>
              ) : null}

              <BulkField label="Notes" htmlFor="bulk-notes" now={now.notes}>
                <select
                  id="bulk-notes"
                  value={changes.notes.mode}
                  onChange={(event) =>
                    set("notes", {
                      ...changes.notes,
                      mode: event.target.value as BulkChanges["notes"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="append">Add a line to their notes…</option>
                  <option value="set">Replace their notes with…</option>
                  <option value="clear">Remove their notes</option>
                </select>
                {changes.notes.mode === "append" || changes.notes.mode === "set" ? (
                  <textarea
                    aria-label={changes.notes.mode === "append" ? "Line to add" : "New notes"}
                    value={changes.notes.value}
                    onChange={(event) =>
                      set("notes", { ...changes.notes, value: event.target.value })
                    }
                  />
                ) : null}
              </BulkField>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Groups &amp; printing</h2>
            </div>
            <div className="card-body">
              <fieldset>
                <legend>Add them all to</legend>
                <TagPicker
                  tags={tags}
                  selected={changes.addTags}
                  allowCreate
                  onCreated={reload}
                  onChange={(addTags) =>
                    onChange({
                      ...changes,
                      addTags,
                      removeTags: changes.removeTags.filter((id) => !addTags.includes(id)),
                    })
                  }
                />
              </fieldset>

              <fieldset className="bulk-aside">
                <legend>Take them all out of</legend>
                {heldTags.length ? (
                  <TagPicker
                    tags={heldTags}
                    selected={changes.removeTags}
                    onChange={(removeTags) =>
                      onChange({
                        ...changes,
                        removeTags,
                        addTags: changes.addTags.filter((id) => !removeTags.includes(id)),
                      })
                    }
                  />
                ) : (
                  <p className="hint">None of them is in a group.</p>
                )}
              </fieldset>

              <div className="form-decision">
                <BulkField label="Printed directories" htmlFor="bulk-printed" now={now.printed}>
                  <select
                    id="bulk-printed"
                    value={
                      changes.printed.mode === "keep"
                        ? "keep"
                        : changes.printed.value
                          ? "include"
                          : "omit"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      set(
                        "printed",
                        value === "keep"
                          ? { ...changes.printed, mode: "keep" }
                          : { mode: "set", value: value === "include" },
                      );
                    }}
                  >
                    <option value="keep">Leave as they are</option>
                    <option value="include">Include in printed directories</option>
                    <option value="omit">Leave out of printed directories</option>
                  </select>
                </BulkField>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head column">
              <h2>Background check</h2>
              <span className="muted small">
                For a group checked together — everybody cleared at the same training evening.
              </span>
            </div>
            <div className="card-body">
              <BulkField label="Dates" htmlFor="bulk-check" now={now.check}>
                <select
                  id="bulk-check"
                  value={changes.check.mode}
                  onChange={(event) =>
                    set("check", {
                      ...changes.check,
                      mode: event.target.value as BulkChanges["check"]["mode"],
                    })
                  }
                >
                  <option value="keep">Leave as they are</option>
                  <option value="set">Give them all these dates…</option>
                  <option value="clear">Remove both dates</option>
                </select>
              </BulkField>
              {changes.check.mode === "set" ? (
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Last one done" htmlFor="bulk-check-on">
                    <DateInput
                      id="bulk-check-on"
                      value={changes.check.on}
                      onChange={(done) => {
                        // The due date follows until somebody sets it, as on
                        // a person's own form.
                        const following =
                          !changes.check.due || changes.check.due === suggestDue(changes.check.on);
                        set("check", {
                          mode: "set",
                          on: done,
                          due: following ? suggestDue(done) : changes.check.due,
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label="Next one due"
                    hint={`Starts at ${RENEWAL_YEARS} years on.`}
                    htmlFor="bulk-check-due"
                  >
                    <DateInput
                      id="bulk-check-due"
                      value={changes.check.due}
                      onChange={(due) => set("check", { ...changes.check, mode: "set", due })}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="card bulk-summary">
          <div className="card-head">
            <h2>What saving will do</h2>
          </div>
          <div className="card-body">
            {nothing ? (
              <p className="muted" style={{ margin: 0 }}>
                Nothing yet. Choose what to change above.
              </p>
            ) : (
              <ul className="bulk-plan">
                {plan.lines.map((line) => (
                  <li key={line.text} className={line.count ? "" : "muted"}>
                    <span>{line.text}</span>
                    <span className="bulk-plan-count">
                      {line.count ? countPeople(line.count) : "Nobody"}
                      {line.already ? ` · ${line.already} already` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {plan.problems.length ? (
              <Notice kind="warn">
                {plan.problems.map((problem) => (
                  <div key={problem}>{problem}</div>
                ))}
              </Notice>
            ) : null}
          </div>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button
            type="submit"
            className="btn primary"
            disabled={saving || plan.problems.length > 0 || !plan.touched.length}
          >
            {saving
              ? progress && progress.of > 1
                ? `Saving… ${progress.written} of ${progress.of}`
                : "Saving…"
              : plan.touched.length
                ? `Change ${countPeople(plan.touched.length)}`
                : nothing
                  ? "Nothing to change yet"
                  : "Nobody needs changing"}
          </button>
          <button type="button" className="btn ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
