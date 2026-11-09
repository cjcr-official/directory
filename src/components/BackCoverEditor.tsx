import { useState } from "react";
import { useDirectory } from "@/data/DirectoryContext";
import { Caret, Checkbox, Field } from "@/components/ui";
import { PersonPicker, leaderGone, shift } from "@/components/LeadershipEditor";
import { leaderName, type Leader, type LeaderGroup } from "@/lib/layout/leadership";
import { LEADERS_PER_SECTION_MAX as PEOPLE_MAX } from "@/lib/layout/leadership";
import {
  STAFF_MAX,
  contactLines,
  newStaffId,
  staffLines,
  type StaffEntry,
} from "@/lib/layout/backCover";
import { qrModules } from "@/lib/layout/qrCode";
import type { ProjectSettings } from "@/lib/layout/settings";

type Patch = Partial<
  Pick<
    ProjectSettings,
    | "includeBack"
    | "backTitle"
    | "backHoursHeading"
    | "backStaff"
    | "backShowLogo"
    | "backMotto"
    | "backQrLink"
    | "backQr"
  >
>;

/**
 * The back cover, filled in down the form in the order it prints: the name
 * over the box, the hours, the staff, the logo, and under the box the motto
 * and the QR code.
 *
 * Staff are kept the way offices are on the leadership page - a line each,
 * opened one at a time - and picked from the directory the same way, so the
 * pastor is the pastor's record rather than a second spelling of him.
 */
export function BackCoverEditor({
  settings,
  staff,
  groups,
  disabled,
  onChange,
  onFocus,
}: {
  settings: ProjectSettings;
  /** The staff, with every picked name as the directory has it now. */
  staff: StaffEntry[];
  groups: ReadonlyMap<string, LeaderGroup>;
  disabled: boolean;
  onChange: (patch: Patch) => void;
  onFocus?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const setStaff = (next: StaffEntry[]) => onChange({ backStaff: next.slice(0, STAFF_MAX) });
  const update = (id: string, change: (entry: StaffEntry) => StaffEntry) =>
    setStaff(staff.map((entry) => (entry.id === id ? change(entry) : entry)));

  /** The link and its QR code change together, or a printed code opens the old address. */
  const setLink = (link: string) => {
    let backQr: string[] = [];
    try {
      backQr = qrModules(link);
    } catch {
      // Longer than any QR code can hold: no code, rather than half of one.
    }
    onChange({ backQrLink: link, backQr });
  };
  const tooLong = settings.backQrLink.trim() !== "" && settings.backQr.length === 0;

  return (
    <section className="card" aria-labelledby="book-back" onFocus={onFocus}>
      <div className="card-head column">
        <h2 id="book-back">Back cover</h2>
        <span className="muted small">
          The last page: office hours, staff, and how to reach the church
        </span>
      </div>
      <div className="card-body">
        <Checkbox
          label="Print a back cover"
          hint="On the very last page, the outside of the folded book."
          checked={settings.includeBack}
          disabled={disabled}
          onChange={(value) => onChange({ includeBack: value })}
        />

        {settings.includeBack ? (
          <>
            <div style={{ marginTop: 14 }}>
              <Field
                label="Name at the top"
                hint="Leave empty to use the church's name from the cover."
                htmlFor="back_title"
              >
                <input
                  id="back_title"
                  type="text"
                  value={settings.backTitle}
                  placeholder={settings.churchName.trim() || "Plains Alliance Church"}
                  disabled={disabled}
                  onChange={(event) => onChange({ backTitle: event.target.value })}
                />
              </Field>
            </div>
            <div>
              <Field
                label="Hours heading"
                hint="Over the staff. Each person's office hours go with them below."
                htmlFor="back_hours_heading"
              >
                <input
                  id="back_hours_heading"
                  type="text"
                  value={settings.backHoursHeading}
                  placeholder="Staff Office Hours"
                  disabled={disabled}
                  onChange={(event) => onChange({ backHoursHeading: event.target.value })}
                />
              </Field>
            </div>

            <div className="field">
              <span className="field-label-like">Staff</span>
              <span className="hint">
                A role and who holds it, with their email, phone and office hours underneath. Tap a
                line to change it.
              </span>
            </div>

            {staff.length ? (
              <ol className="leader-sections">
                {staff.map((entry, index) =>
                  openId === entry.id ? (
                    <StaffEditor
                      key={entry.id}
                      entry={entry}
                      groups={groups}
                      fresh={entry.id === freshId}
                      first={index === 0}
                      last={index === staff.length - 1}
                      disabled={disabled}
                      onChange={(change) => update(entry.id, change)}
                      onMove={(by) => setStaff(shift(staff, index, by))}
                      onRemove={() => {
                        setOpenId(null);
                        setStaff(staff.filter((other) => other.id !== entry.id));
                      }}
                      onDone={() => setOpenId(null)}
                    />
                  ) : (
                    <StaffLine
                      key={entry.id}
                      entry={entry}
                      groups={groups}
                      onOpen={() => {
                        setFreshId(null);
                        setOpenId(entry.id);
                      }}
                    />
                  ),
                )}
              </ol>
            ) : null}

            {disabled ? null : (
              <div className="row tight" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={staff.length >= STAFF_MAX}
                  onClick={() => {
                    const made: StaffEntry = {
                      id: newStaffId(),
                      role: "",
                      people: [],
                      lines: "",
                      hours: "",
                    };
                    setFreshId(made.id);
                    setOpenId(made.id);
                    setStaff([...staff, made]);
                  }}
                >
                  + Add staff
                </button>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <Checkbox
                label="The logo at the foot of the box"
                hint={
                  settings.coverLogoPath
                    ? "The same logo as the cover."
                    : "Add a logo under Cover and it shows here too."
                }
                checked={settings.backShowLogo}
                disabled={disabled}
                onChange={(value) => onChange({ backShowLogo: value })}
              />
            </div>

            <div className="grid two" style={{ marginTop: 14 }}>
              <Field label="Motto" hint="Under the box, in italics." htmlFor="back_motto">
                <input
                  id="back_motto"
                  type="text"
                  value={settings.backMotto}
                  placeholder="“All of Jesus for All the World”"
                  disabled={disabled}
                  onChange={(event) => onChange({ backMotto: event.target.value })}
                />
              </Field>
              <Field
                label="QR code link"
                hint={
                  tooLong
                    ? "Too long for a QR code — use a shorter address."
                    : "Prints a QR code that opens it. Leave empty for none."
                }
                htmlFor="back_qr"
              >
                <input
                  id="back_qr"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={settings.backQrLink}
                  placeholder="https://yourchurch.org"
                  disabled={disabled}
                  onChange={(event) => setLink(event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** One staff entry closed to a line: as it prints, and the line under it. */
function StaffLine({
  entry,
  groups,
  onOpen,
}: {
  entry: StaffEntry;
  groups: ReadonlyMap<string, LeaderGroup>;
  onOpen: () => void;
}) {
  const { personById } = useDirectory();
  const { strong, plain } = staffLines(entry);
  const gone = entry.people.some((leader) => leaderGone(leader, personById, groups));
  return (
    <li className="leader-line">
      <button type="button" className="leader-line-button" aria-expanded={false} onClick={onOpen}>
        <span className="leader-line-text">
          <span className="leader-line-title">
            {strong.length ? strong.join(" — ") : <span className="muted">Nobody yet</span>}
          </span>
          <span className={`leader-line-names${plain.length ? "" : " muted"}`}>
            {plain.length ? plain.join(" · ") : "No email or phone"}
          </span>
          {gone ? (
            <span className="leader-line-names leader-gone">Needs a look — tap to see why</span>
          ) : null}
        </span>
        <Caret className="leader-line-mark" />
      </button>
    </li>
  );
}

/** One staff entry, open: the role, who holds it, and the lines under them. */
function StaffEditor({
  entry,
  groups,
  fresh,
  first,
  last,
  disabled,
  onChange,
  onMove,
  onRemove,
  onDone,
}: {
  entry: StaffEntry;
  groups: ReadonlyMap<string, LeaderGroup>;
  fresh: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onChange: (change: (entry: StaffEntry) => StaffEntry) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const { personById, householdById } = useDirectory();
  const label = entry.role.trim() || "this staff entry";

  /** A picked person's email and phone, as their record has them. */
  const contactOf = (personId: string | null) => {
    const person = personId ? personById.get(personId) : undefined;
    if (!person) return "";
    return contactLines(
      person,
      person.household_id ? householdById.get(person.household_id) : null,
    );
  };
  /** The people here whose record has something the box does not say already. */
  const fillable = entry.people.filter((leader) => {
    const lines = contactOf(leader.personId);
    return lines !== "" && lines !== entry.lines.trim();
  });
  /** The entry with one more person in it, unless they are in it already. */
  const withLeader = (current: StaffEntry, leader: Leader): StaffEntry => {
    if (leader.personId && current.people.some((other) => other.personId === leader.personId))
      return current;
    if (leader.groupId && current.people.some((other) => other.groupId === leader.groupId))
      return current;
    return { ...current, people: [...current.people, leader].slice(0, PEOPLE_MAX) };
  };
  const add = (leader: Leader) => onChange((current) => withLeader(current, leader));

  return (
    <li className="leader-section is-open">
      <div className="leader-head">
        <input
          type="text"
          className="leader-title"
          aria-label="Role"
          value={entry.role}
          placeholder="Role — e.g. Senior Pastor"
          autoFocus={fresh}
          disabled={disabled}
          onChange={(event) => {
            const role = event.target.value;
            onChange((current) => ({ ...current, role }));
          }}
        />
        {disabled ? null : (
          <div className="leader-tools">
            <button
              type="button"
              className="btn ghost small"
              aria-label={`Move ${label} up`}
              title="Move up"
              disabled={first}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn ghost small"
              aria-label={`Move ${label} down`}
              title="Move down"
              disabled={last}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn ghost small danger-hover"
              aria-label={`Remove ${label}`}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {entry.people.length ? (
        <ul className="leader-chips">
          {entry.people.map((leader, index) => {
            const gone = leaderGone(leader, personById, groups);
            const typed = !leader.personId && !leader.groupId;
            return (
              <li
                key={`${leader.personId ?? leader.groupId ?? "typed"}:${leader.name}:${index}`}
                className={`leader-chip${gone ? " gone" : ""}${typed ? " typed" : ""}`}
                title={gone ? "No longer in the directory — prints as saved" : undefined}
              >
                <span>{leader.name}</span>
                {leader.groupId ? <span className="leader-badge">Group</span> : null}
                {disabled ? null : (
                  <button
                    type="button"
                    aria-label={`Take ${leader.name} off ${label}`}
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        people: current.people.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {disabled ? null : (
        <PersonPicker
          label={label}
          taken={entry.people}
          groups={groups}
          onPick={(person) => {
            // One change, not two: the person and their email and phone go in
            // together. Two in a row would each start from the entry as it was
            // before either, and the second would undo the first.
            //
            // The email and phone only go into an empty box. Anything already
            // there was typed on purpose - the office's own address, or the
            // first person's details when a second is added to share the role.
            const contact = contactOf(person.id);
            onChange((current) => {
              const next = withLeader(current, { personId: person.id, name: leaderName(person) });
              return contact && !next.lines.trim() ? { ...next, lines: contact } : next;
            });
          }}
          onPickGroup={(id, group) => add({ personId: null, groupId: id, name: group.name })}
          onType={(name) => add({ personId: null, name })}
        />
      )}

      <div style={{ marginTop: 10 }}>
        <Field
          label="Email and phone"
          hint="One per line, under the name. Filled from their record when you pick them — change anything."
          htmlFor={`staff_lines_${entry.id}`}
        >
          <textarea
            id={`staff_lines_${entry.id}`}
            rows={2}
            value={entry.lines}
            placeholder={"pastor@yourchurch.org\n(406) 555-0142"}
            disabled={disabled}
            onChange={(event) => {
              const lines = event.target.value;
              onChange((current) => ({ ...current, lines }));
            }}
          />
        </Field>
        {/* Back to what the directory says, for somebody whose record has
            changed, or whose lines were typed over and should not have been. */}
        {disabled || !fillable.length ? null : (
          <div className="row tight staff-fill">
            {fillable.map((leader) => (
              <button
                key={leader.personId}
                type="button"
                className="btn ghost small"
                onClick={() => {
                  const contact = contactOf(leader.personId);
                  onChange((current) => ({ ...current, lines: contact }));
                }}
              >
                Fill from {leader.name}’s record
              </button>
            ))}
          </div>
        )}
        <Field
          label="Office hours"
          hint="Under the email and phone. Leave empty for none."
          htmlFor={`staff_hours_${entry.id}`}
        >
          <input
            id={`staff_hours_${entry.id}`}
            type="text"
            value={entry.hours}
            placeholder="(Monday – Thursday)"
            disabled={disabled}
            onChange={(event) => {
              const hours = event.target.value;
              onChange((current) => ({ ...current, hours }));
            }}
          />
        </Field>
      </div>

      <div className="leader-done">
        <button type="button" className="btn small" onClick={onDone}>
          Done
        </button>
      </div>
    </li>
  );
}
