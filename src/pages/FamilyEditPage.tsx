import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { AddressFields } from "@/components/AddressFields";
import { PhotoInput } from "@/components/PhotoInput";
import { TagPicker } from "@/components/TagPicker";
import { Avatar, Checkbox, ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import type { HouseholdRole, HouseholdRow, PersonRow } from "@/lib/database.types";
import { removePhoto, uploadPhoto } from "@/lib/photos";
import {
  isStaleWrite,
  createHousehold,
  deleteHousehold,
  setPersonHousehold,
  setTags,
  updateHousehold,
  updatePerson,
} from "@/lib/queries";
import {
  firstName,
  formatPhone,
  fullName,
  personPhotoPath,
  sameDisplayName,
  sortKey,
  suggestHouseholdName,
} from "@/lib/format";

const ROLES: { value: HouseholdRole; label: string }[] = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse / partner" },
  { value: "child", label: "Child" },
  { value: "other", label: "Other" },
];

/**
 * A person's place in the family. People themselves are created and edited on
 * their own record; this only says who is in the family, in what role, and in
 * what order they are listed on the card.
 */
interface MemberLink {
  id: string;
  role: HouseholdRole;
}

/** Head, then spouse, then children - the role a newly added person likely has. */
function suggestRole(current: MemberLink[]): HouseholdRole {
  if (!current.some((m) => m.role === "head")) return "head";
  if (!current.some((m) => m.role === "spouse")) return "spouse";
  return "child";
}

const BLANK: Omit<HouseholdRow, "id" | "created_at" | "updated_at"> = {
  display_name: "",
  sort_name: "",
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  phone: null,
  email: null,
  anniversary: null,
  photo_path: null,
  notes: null,
  is_active: true,
};

export function FamilyEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const {
    households,
    householdById,
    people,
    personById,
    membersOf,
    tags,
    tagsOfHousehold,
    reload,
    loading,
  } = useDirectory();

  const existing = id ? householdById.get(id) : undefined;
  const isNew = !id;

  const [form, setForm] = useState(BLANK);
  const [members, setMembers] = useState<MemberLink[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The version this form was opened on. Not read from `existing`, which is
   * refreshed by every reload and would quietly become whatever is current -
   * the point is to hold the value that was on screen when the typing started.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  /**
   * Bumped to fill the form in again from the record as it now stands. The
   * effect below keys on the record's id, which does not change when somebody
   * else's version is pulled in, so without this "reload" would leave the old
   * typing on screen and change nothing.
   */
  const [reseed, setReseed] = useState(0);

  useEffect(() => {
    if (isNew || !existing) return;
    setForm({ ...existing });
    setPhotoBlob(null);
    setPhotoRemoved(false);
    setMembers(
      membersOf(existing.id).map((person) => ({
        id: person.id,
        role: person.household_role ?? "other",
      })),
    );
    setTagIds(tagsOfHousehold(existing.id));
    setNameTouched(true);
    setOpenedAt(existing.updated_at);
    setStale(false);
  }, [existing?.id, isNew, reseed]); // eslint-disable-line react-hooks/exhaustive-deps

  const memberPeople = useMemo(
    () => members.map((m) => ({ link: m, person: personById.get(m.id) })).filter((m) => m.person),
    [members, personById],
  );

  /**
   * People who could be added: anyone not already listed here.
   *
   * No sort. `people` arrives from the directory already ordered by exactly
   * this key, and filtering keeps that order - re-sorting it was doing the
   * congregation over again on every keystroke, which measured at 10ms per
   * letter typed on a desktop and several times that on a phone.
   */
  const candidates = useMemo(() => {
    const taken = new Set(members.map((m) => m.id));
    const needle = sortKey(memberQuery);
    const found: PersonRow[] = [];
    for (const person of people) {
      if (taken.has(person.id)) continue;
      if (needle && !sortKey(fullName(person), person.email).includes(needle)) continue;
      found.push(person);
      // Only eight are shown, and on a directory of any size most of the work
      // was scanning past them.
      if (found.length === 8) break;
    }
    return found;
  }, [people, members, memberQuery]);

  // Until someone edits the family name by hand it tracks the surname and the
  // head's first name, so "The Smith Family" becomes "The John Smith Family"
  // as soon as there is a John - which is what keeps two Smith families apart
  // on the page.
  useEffect(() => {
    if (nameTouched) return;
    const suggested = suggestHouseholdName(form.sort_name, headFirstName());
    if (suggested !== form.display_name) patch({ display_name: suggested });
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /** Other families whose card would carry the same title as this one. */
  const nameClashes = useMemo(
    () =>
      households.filter(
        (other) =>
          other.id !== existing?.id &&
          other.is_active &&
          sameDisplayName(other.display_name, form.display_name),
      ),
    [households, existing?.id, form.display_name],
  );

  /** "The John Smith Family" - available once the family has a head. */
  const qualifiedName = useMemo(() => {
    const head = members.find((m) => m.role === "head") ?? members[0];
    const person = head ? personById.get(head.id) : undefined;
    return person ? suggestHouseholdName(form.sort_name, firstName(person)) : "";
  }, [members, personById, form.sort_name]);

  if (!isNew && loading && !existing) return <LoadingScreen />;
  if (!isNew && !loading && !existing) {
    return (
      <div className="page">
        <Notice kind="error">That family no longer exists.</Notice>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" to="/families">
            Back to families
          </Link>
        </p>
      </div>
    );
  }

  function patch(next: Partial<typeof BLANK>) {
    setForm((current) => ({ ...current, ...next }));
  }

  /** Typing a surname fills in the family name until someone edits it directly. */
  function setSurname(value: string) {
    patch({ sort_name: value });
  }

  /** The head of the household, if one has been named yet. */
  function headFirstName(): string {
    const head = members.find((m) => m.role === "head") ?? members[0];
    const person = head ? personById.get(head.id) : undefined;
    return person ? firstName(person) : "";
  }

  function setRole(id: string, role: HouseholdRole) {
    setMembers((current) => current.map((m) => (m.id === id ? { ...m, role } : m)));
  }

  /** Moves a member one place up or down the order they print in. */
  function moveMember(index: number, delta: number) {
    setMembers((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /**
   * Writes the family and its membership, and hands back the id. Split out of
   * the submit handler so "add a new person" can save first and come back to a
   * family that exists, rather than losing what was typed.
   */
  async function persist(force = false): Promise<string> {
    let photoPath = form.photo_path;
    if (photoRemoved && form.photo_path) {
      await removePhoto(form.photo_path);
      photoPath = null;
    }
    if (photoBlob) {
      // Upload before deleting, never the other way round: this runs on a
      // phone on church wifi, and removing first meant a failed upload took
      // the existing photograph with it while the record still pointed at the
      // file that no longer existed.
      const replaced = !photoRemoved ? form.photo_path : null;
      photoPath = await uploadPhoto("households", photoBlob);
      if (replaced) await removePhoto(replaced);
    }

    const surname = form.sort_name.trim();
    const payload = {
      ...form,
      sort_name: surname,
      display_name: form.display_name.trim() || suggestHouseholdName(surname, headFirstName()),
      photo_path: photoPath,
    };

    const household = existing
      ? await updateHousehold(existing.id, payload, force ? null : openedAt)
      : await createHousehold(payload);
    setOpenedAt(household.updated_at);

    await setTags("household", household.id, tagIds);

    // Anyone who was in the family and no longer is. Their record survives -
    // they simply print on their own from now on.
    const before = existing ? membersOf(existing.id) : [];
    const staying = new Set(members.map((m) => m.id));
    for (const person of before) {
      if (staying.has(person.id)) continue;
      // They keep living where they lived: copy the family address down, or
      // their standalone card would print with none at all.
      if (person.use_household_address) {
        await updatePerson(person.id, {
          use_household_address: false,
          address_line1: form.address_line1,
          address_line2: form.address_line2,
          city: form.city,
          state: form.state,
          postal_code: form.postal_code,
          country: form.country,
        });
      }
      await setPersonHousehold(person.id, null, null, 0);
    }

    for (const [order, member] of members.entries()) {
      await setPersonHousehold(member.id, household.id, member.role, order);
    }

    await reload();
    return household.id;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;

    if (!form.sort_name.trim()) {
      setError("A family needs a surname so it can be filed alphabetically.");
      return;
    }

    await store(false);
  }

  /**
   * Throws this browser's typing away and shows the family as somebody else
   * left it. The reload has to land before the form is filled in again, or it
   * would be seeded from the same stale copy it is trying to replace.
   */
  async function discardMine() {
    setSaving(true);
    try {
      await reload();
      setError(null);
      setStale(false);
      setReseed((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Writes the family and goes to it. `force` drops the check that the record
   * has not moved since it was opened - only reached by the button offered
   * when it has, so overwriting somebody is a decision rather than an accident.
   */
  async function store(force: boolean) {
    setSaving(true);
    setError(null);
    try {
      const householdId = await persist(force);
      setStale(false);
      navigate(`/families/${householdId}`, { replace: true });
    } catch (cause) {
      setStale(isStaleWrite(cause));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  /** Save what is here, then go and make a person who lands in this family. */
  async function addNewPerson() {
    if (!canEdit) return;
    if (!form.sort_name.trim()) {
      setError("A family needs a surname so it can be filed alphabetically.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const householdId = await persist();
      navigate(`/people/new?household=${householdId}`);
    } catch (cause) {
      // Same conflict can happen on this path, so offer the same way out of it
      // rather than a message with nothing to do about it.
      setStale(isStaleWrite(cause));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{isNew ? "Add a family" : form.display_name || "Family"}</h1>
          <div className="sub">
            Everything here prints on one card. Only the surname is required — the rest is optional.
          </div>
        </div>
        <Link className="btn ghost" to="/families">
          Back
        </Link>
      </div>

      {error ? (
        <Notice kind="error">
          {error}
          {stale ? (
            <div className="row tight" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn small"
                disabled={saving}
                onClick={() => void discardMine()}
              >
                Reload and lose my changes
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={saving}
                onClick={() => void store(true)}
              >
                Save mine over theirs
              </button>
            </div>
          ) : null}
        </Notice>
      ) : null}

      <form onSubmit={save}>
        <div className="grid two" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="card-head">
              <h2>The family</h2>
            </div>
            <div className="card-body">
              <div className="field">
                <PhotoInput
                  path={photoRemoved ? null : form.photo_path}
                  initials={form.sort_name || "?"}
                  disabled={!canEdit}
                  onChange={(blob, removed) => {
                    setPhotoBlob(blob);
                    setPhotoRemoved(removed);
                  }}
                />
              </div>

              <Field
                label="Surname"
                hint="Files the family in the book. “Alvarez” sorts under A."
                htmlFor="surname"
              >
                <input
                  id="surname"
                  type="text"
                  required
                  disabled={!canEdit}
                  value={form.sort_name}
                  onChange={(event) => setSurname(event.target.value)}
                />
              </Field>

              <Field
                label="Printed name"
                hint="How the card is headed. Change it for “Maria Alvarez & Sam Choi”."
                htmlFor="display_name"
              >
                <input
                  id="display_name"
                  type="text"
                  disabled={!canEdit}
                  placeholder={
                    suggestHouseholdName(form.sort_name, headFirstName()) || "The Alvarez Family"
                  }
                  value={form.display_name}
                  onChange={(event) => {
                    setNameTouched(true);
                    patch({ display_name: event.target.value });
                  }}
                />
              </Field>

              {nameClashes.length ? (
                <div style={{ marginTop: -4, marginBottom: 14 }}>
                  <Notice kind="warn">
                    {nameClashes.length === 1 ? "Another family is" : "Other families are"} already
                    called <strong>{form.display_name}</strong>. Both cards will be headed the same
                    way, so a reader cannot tell them apart. Naming the head of each is the usual
                    fix.
                    <div className="row tight" style={{ marginTop: 8 }}>
                      {/* Only once a head is in the family is there a name to
                          offer - which is usually after the family was created,
                          so it is a button rather than something typed for you. */}
                      {qualifiedName && qualifiedName !== form.display_name ? (
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setNameTouched(true);
                            patch({ display_name: qualifiedName });
                          }}
                        >
                          Use “{qualifiedName}”
                        </button>
                      ) : null}
                      {nameClashes.map((other) => (
                        <Link key={other.id} className="btn small" to={`/families/${other.id}`}>
                          Open the other one
                        </Link>
                      ))}
                    </div>
                  </Notice>
                </div>
              ) : null}

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Home phone" htmlFor="phone">
                  <input
                    id="phone"
                    type="tel"
                    disabled={!canEdit}
                    value={form.phone ?? ""}
                    onChange={(event) => patch({ phone: event.target.value || null })}
                  />
                </Field>
                <Field label="Family email" htmlFor="email">
                  <input
                    id="email"
                    type="email"
                    disabled={!canEdit}
                    value={form.email ?? ""}
                    onChange={(event) => patch({ email: event.target.value || null })}
                  />
                </Field>
              </div>

              <Field
                label="Anniversary"
                hint="Optional. Only printed if you switch it on for a directory."
                htmlFor="anniversary"
              >
                <input
                  id="anniversary"
                  type="date"
                  disabled={!canEdit}
                  value={form.anniversary ?? ""}
                  onChange={(event) => patch({ anniversary: event.target.value || null })}
                />
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Address</h2>
            </div>
            <div className="card-body">
              <AddressFields
                idPrefix="household"
                disabled={!canEdit}
                value={form}
                onChange={(next) => patch(next)}
              />

              <Field label="Notes" hint="For your own reference. Never printed." htmlFor="notes">
                <textarea
                  id="notes"
                  disabled={!canEdit}
                  value={form.notes ?? ""}
                  onChange={(event) => patch({ notes: event.target.value || null })}
                />
              </Field>

              <fieldset>
                <legend>Groups</legend>
                <TagPicker
                  tags={tags}
                  selected={tagIds}
                  disabled={!canEdit}
                  allowCreate={canEdit}
                  onCreated={reload}
                  onChange={setTagIds}
                />
                <p className="hint" style={{ marginTop: 8 }}>
                  Groups are how you build a smaller directory later — tag the choir once, then
                  print a choir booklet in two clicks.
                </p>
              </fieldset>

              <div className="form-decision">
                <Checkbox
                  label="Include in printed directories"
                  hint="Turn off to keep the record but leave it out of every book."
                  checked={form.is_active}
                  disabled={!canEdit}
                  onChange={(value) => patch({ is_active: value })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Family members</h2>
            <span className="muted small">Listed on the card in this order.</span>
          </div>
          <div className="card-body">
            {isNew ? (
              <p className="muted small" style={{ margin: 0 }}>
                Create the family first. You can then put people into it — either ones already in
                the directory, or new records made here.
              </p>
            ) : (
              <>
                {memberPeople.length ? (
                  <ul className="member-list">
                    {memberPeople.map(({ link, person }, index) => (
                      <li key={link.id} className="member-row">
                        <Avatar
                          path={personPhotoPath(person!, form)}
                          initials={`${person!.first_name[0] ?? ""}${person!.last_name[0] ?? ""}`}
                        />
                        <div className="member-name">
                          <Link className="list-link" to={`/people/${person!.id}`}>
                            {fullName(person!)}
                          </Link>
                          <div className="muted small">
                            {[formatPhone(person!.phone), person!.email]
                              .filter(Boolean)
                              .join(" · ") || "No phone or email"}
                          </div>
                        </div>
                        <select
                          aria-label={`${fullName(person!)} in the family`}
                          className="member-role"
                          disabled={!canEdit}
                          value={link.role}
                          onChange={(event) =>
                            setRole(link.id, event.target.value as HouseholdRole)
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                        {canEdit ? (
                          <div className="row tight member-actions">
                            <button
                              type="button"
                              className="btn ghost small"
                              aria-label="Move up"
                              disabled={index === 0}
                              onClick={() => moveMember(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn ghost small"
                              aria-label="Move down"
                              disabled={index === memberPeople.length - 1}
                              onClick={() => moveMember(index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn ghost small"
                              onClick={() =>
                                setMembers((current) => current.filter((m) => m.id !== link.id))
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small" style={{ marginTop: 0 }}>
                    Nobody in this family yet.
                  </p>
                )}

                {canEdit ? (
                  <div className="member-add">
                    <Field
                      label="Put someone in this family"
                      hint="Search the directory. Adding someone moves them out of any family they are in now."
                      htmlFor="member-search"
                    >
                      <input
                        id="member-search"
                        className="search"
                        type="search"
                        placeholder="Search by name or email…"
                        value={memberQuery}
                        onChange={(event) => setMemberQuery(event.target.value)}
                      />
                    </Field>

                    {candidates.length ? (
                      <ul className="member-list picker">
                        {candidates.map((person) => {
                          const current = person.household_id
                            ? householdById.get(person.household_id)
                            : null;
                          return (
                            <li key={person.id} className="member-row">
                              <Avatar
                                path={personPhotoPath(person, current)}
                                initials={`${person.first_name[0] ?? ""}${person.last_name[0] ?? ""}`}
                              />
                              <div className="member-name">
                                <div style={{ fontWeight: 600 }}>{fullName(person)}</div>
                                <div className="muted small">
                                  {current
                                    ? `Currently in ${current.display_name}`
                                    : "On their own"}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => {
                                  setMembers((c) => [
                                    ...c,
                                    { id: person.id, role: suggestRole(c) },
                                  ]);
                                  setMemberQuery("");
                                }}
                              >
                                Add
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="muted small">
                        {memberQuery ? "Nobody matches." : "Everyone is already in a family here."}
                      </p>
                    )}

                    <div className="row tight" style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={saving}
                        onClick={() => void addNewPerson()}
                      >
                        + Create a new person
                      </button>
                      <span className="muted small">
                        Saves this family, then opens a blank record already in it.
                      </span>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {canEdit ? (
          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create family" : "Save changes"}
            </button>
            <Link className="btn ghost" to="/families">
              Cancel
            </Link>
            <span className="spacer" />
            {existing ? (
              <ConfirmButton
                label="Delete family"
                confirmLabel="Delete permanently"
                onConfirm={async () => {
                  await removePhoto(existing.photo_path);
                  await deleteHousehold(existing.id);
                  await reload();
                  navigate("/families");
                }}
              />
            ) : null}
          </div>
        ) : (
          <Notice kind="warn">You have read-only access, so changes cannot be saved.</Notice>
        )}
      </form>

      {existing ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          Deleting a family leaves its members in the directory as individuals — nobody is lost.
        </p>
      ) : null}
    </div>
  );
}
