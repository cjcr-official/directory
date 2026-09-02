import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { AddressFields } from "@/components/AddressFields";
import { PhotoInput } from "@/components/PhotoInput";
import { TagPicker } from "@/components/TagPicker";
import { Checkbox, ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import type { HouseholdRole, HouseholdRow, PersonRow } from "@/lib/database.types";
import { removePhoto, uploadPhoto } from "@/lib/photos";
import {
  createHousehold,
  createPerson,
  deleteHousehold,
  setPersonHousehold,
  setTags,
  updateHousehold,
  updatePerson,
} from "@/lib/queries";
import { sameDisplayName, suggestHouseholdName } from "@/lib/format";

const ROLES: { value: HouseholdRole; label: string }[] = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse / partner" },
  { value: "child", label: "Child" },
  { value: "other", label: "Other" },
];

interface MemberDraft {
  /**
   * Stable for the life of the form. Array indices are not: discarding an
   * unsaved member shifts every row after it, and React would then reuse the
   * discarded row's photo state for its neighbour.
   */
  key: string;
  /** Present when the person already exists in the database. */
  id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string;
  household_role: HouseholdRole;
  email: string;
  phone: string;
  date_of_birth: string;
  /**
   * Kept only so it survives a save. Members of a family are pictured by the
   * family portrait, so nothing here uploads or replaces it.
   */
  photo_path: string | null;
  /** Marked for removal on save; existing people are unlinked, not deleted. */
  removed: boolean;
}

function draftFromPerson(person: PersonRow): MemberDraft {
  return {
    key: person.id,
    id: person.id,
    first_name: person.first_name,
    last_name: person.last_name,
    preferred_name: person.preferred_name ?? "",
    household_role: person.household_role ?? "other",
    email: person.email ?? "",
    phone: person.phone ?? "",
    date_of_birth: person.date_of_birth ?? "",
    photo_path: person.photo_path,
    removed: false,
  };
}

function emptyDraft(lastName: string, role: HouseholdRole): MemberDraft {
  return {
    key: crypto.randomUUID(),
    id: null,
    first_name: "",
    last_name: lastName,
    preferred_name: "",
    household_role: role,
    email: "",
    phone: "",
    date_of_birth: "",
    photo_path: null,
    removed: false,
  };
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
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setMembers([emptyDraft("", "head")]);
      return;
    }
    if (!existing) return;
    setForm({ ...existing });
    setMembers(membersOf(existing.id).map(draftFromPerson));
    setTagIds(tagsOfHousehold(existing.id));
    setNameTouched(true);
  }, [existing?.id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMembers = useMemo(() => members.filter((member) => !member.removed), [members]);

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
    setMembers((current) =>
      current.map((member) =>
        member.id === null && (!member.last_name || member.last_name === form.sort_name)
          ? { ...member, last_name: value }
          : member,
      ),
    );
  }

  /** The head of the household, if one has been named yet. */
  function headFirstName(): string {
    const head =
      members.find((m) => !m.removed && m.household_role === "head") ??
      members.find((m) => !m.removed);
    return (head?.preferred_name || head?.first_name || "").trim();
  }

  function updateMember(index: number, next: Partial<MemberDraft>) {
    setMembers((current) =>
      current.map((member, i) => (i === index ? { ...member, ...next } : member)),
    );
  }

  function removeMember(index: number) {
    setMembers((current) =>
      current.flatMap((member, i) => {
        if (i !== index) return [member];
        // A person who was never saved just disappears; a saved one is
        // unlinked from the family on save so their record survives.
        return member.id ? [{ ...member, removed: true }] : [];
      }),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;

    const surname = form.sort_name.trim();
    if (!surname) {
      setError("A family needs a surname so it can be filed alphabetically.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let photoPath = form.photo_path;
      if (photoRemoved && form.photo_path) {
        await removePhoto(form.photo_path);
        photoPath = null;
      }
      if (photoBlob) {
        if (form.photo_path && !photoRemoved) await removePhoto(form.photo_path);
        photoPath = await uploadPhoto("households", photoBlob);
      }

      const payload = {
        ...form,
        sort_name: surname,
        display_name: form.display_name.trim() || suggestHouseholdName(surname, headFirstName()),
        photo_path: photoPath,
      };

      const household = existing
        ? await updateHousehold(existing.id, payload)
        : await createHousehold(payload);

      await setTags("household", household.id, tagIds);

      let order = 0;
      for (const member of members) {
        if (member.removed) {
          if (member.id) {
            // They keep living where they lived: copy the household address
            // down, or their standalone card would print with none at all.
            const previous = personById.get(member.id);
            if (previous?.use_household_address) {
              await updatePerson(member.id, {
                use_household_address: false,
                address_line1: form.address_line1,
                address_line2: form.address_line2,
                city: form.city,
                state: form.state,
                postal_code: form.postal_code,
                country: form.country,
              });
            }
            await setPersonHousehold(member.id, null, null, 0);
          }
          continue;
        }
        // A row added and never filled in still carries the pre-filled
        // surname, so the first name is what decides whether it is a real
        // person or an empty row the user left behind.
        if (!member.first_name.trim()) continue;

        const fields = {
          first_name: member.first_name.trim(),
          last_name: member.last_name.trim() || surname,
          preferred_name: member.preferred_name.trim() || null,
          household_role: member.household_role,
          email: member.email.trim() || null,
          phone: member.phone.trim() || null,
          date_of_birth: member.date_of_birth || null,
          photo_path: member.photo_path,
          household_id: household.id,
          sort_order: order,
        };
        order += 1;

        if (member.id) await updatePerson(member.id, fields);
        else await createPerson({ ...blankPersonFields(), ...fields });
      }

      await reload();
      navigate(`/families/${household.id}`, { replace: true });
    } catch (cause) {
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

      {error ? <Notice kind="error">{error}</Notice> : null}

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
                    way, so a reader cannot tell them apart. Naming the head of each — “The John{" "}
                    {form.sort_name || "Smith"} Family” — is the usual fix.
                    <div className="row tight" style={{ marginTop: 8 }}>
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

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Family members</h2>
            <span className="muted small">Listed on the card in this order.</span>
          </div>
          <div className="card-body">
            {visibleMembers.map((member) => {
              const index = members.indexOf(member);
              return (
                <div
                  key={member.key}
                  style={{
                    borderTop:
                      index === members.indexOf(visibleMembers[0])
                        ? "none"
                        : "1px solid var(--line)",
                    paddingTop: index === members.indexOf(visibleMembers[0]) ? 0 : 16,
                    marginTop: index === members.indexOf(visibleMembers[0]) ? 0 : 16,
                  }}
                >
                  <div>
                    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="First name">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={member.first_name}
                          onChange={(event) =>
                            updateMember(index, { first_name: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Last name">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={member.last_name}
                          onChange={(event) =>
                            updateMember(index, { last_name: event.target.value })
                          }
                        />
                      </Field>
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Goes by" hint="Prints instead of the first name.">
                        <input
                          type="text"
                          disabled={!canEdit}
                          placeholder={member.first_name}
                          value={member.preferred_name}
                          onChange={(event) =>
                            updateMember(index, { preferred_name: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="In the family">
                        <select
                          disabled={!canEdit}
                          value={member.household_role}
                          onChange={(event) =>
                            updateMember(index, {
                              household_role: event.target.value as HouseholdRole,
                            })
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <Field label="Phone">
                        <input
                          type="tel"
                          disabled={!canEdit}
                          value={member.phone}
                          onChange={(event) => updateMember(index, { phone: event.target.value })}
                        />
                      </Field>
                      <Field label="Email">
                        <input
                          type="email"
                          disabled={!canEdit}
                          value={member.email}
                          onChange={(event) => updateMember(index, { email: event.target.value })}
                        />
                      </Field>
                      <Field label="Birthday">
                        <input
                          type="date"
                          disabled={!canEdit}
                          value={member.date_of_birth}
                          onChange={(event) =>
                            updateMember(index, { date_of_birth: event.target.value })
                          }
                        />
                      </Field>
                    </div>

                    <div className="row tight">
                      {member.id ? (
                        <Link className="btn ghost small" to={`/people/${member.id}`}>
                          Open full record
                        </Link>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => removeMember(index)}
                        >
                          {member.id ? "Remove from family" : "Discard"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}

            {canEdit ? (
              <button
                type="button"
                className="btn"
                style={{ marginTop: visibleMembers.length ? 16 : 0 }}
                onClick={() =>
                  setMembers((current) => [
                    ...current,
                    emptyDraft(
                      form.sort_name,
                      current.some((m) => !m.removed && m.household_role === "head")
                        ? current.some((m) => !m.removed && m.household_role === "spouse")
                          ? "child"
                          : "spouse"
                        : "head",
                    ),
                  ])
                }
              >
                + Add a member
              </button>
            ) : null}
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

/** Column defaults for a person created from the family form. */
function blankPersonFields() {
  return {
    preferred_name: null,
    email: null,
    phone: null,
    date_of_birth: null,
    anniversary: null,
    use_household_address: true,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    photo_path: null,
    notes: null,
    is_active: true,
  };
}
