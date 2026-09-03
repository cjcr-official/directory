import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { AddressFields } from "@/components/AddressFields";
import { PhotoInput } from "@/components/PhotoInput";
import { TagPicker } from "@/components/TagPicker";
import { Avatar, Checkbox, ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import type { HouseholdRole, PersonRow } from "@/lib/database.types";
import { removePhoto, uploadPhoto } from "@/lib/photos";
import { createPerson, deletePerson, setTags, updatePerson } from "@/lib/queries";
import { addressLines } from "@/lib/format";

const ROLES: { value: HouseholdRole; label: string }[] = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse / partner" },
  { value: "child", label: "Child" },
  { value: "other", label: "Other" },
];

const BLANK: Omit<PersonRow, "id" | "created_at" | "updated_at"> = {
  household_id: null,
  household_role: null,
  first_name: "",
  last_name: "",
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
  sort_order: 0,
  is_active: true,
};

export function PersonEditPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const { personById, householdById, households, membersOf, tags, tagsOfPerson, reload, loading } =
    useDirectory();

  const existing = id ? personById.get(id) : undefined;
  const isNew = !id;

  const [form, setForm] = useState(BLANK);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      const household = params.get("household");
      if (household)
        setForm((current) => ({ ...current, household_id: household, household_role: "other" }));
      return;
    }
    if (!existing) return;
    setForm({ ...existing });
    setTagIds(tagsOfPerson(existing.id));
  }, [existing?.id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNew && loading && !existing) return <LoadingScreen />;
  if (!isNew && !loading && !existing) {
    return (
      <div className="page">
        <Notice kind="error">That person no longer exists.</Notice>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" to="/people">
            Back to people
          </Link>
        </p>
      </div>
    );
  }

  function patch(next: Partial<typeof BLANK>) {
    setForm((current) => ({ ...current, ...next }));
  }

  const household = form.household_id ? householdById.get(form.household_id) : null;
  const inheritedAddress = household ? addressLines(household) : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("A first and last name are needed so the person can be filed alphabetically.");
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
        photoPath = await uploadPhoto("people", photoBlob);
      }

      // Joining a family with the default sort_order of 0 would file them
      // ahead of the head of household on the printed card.
      const joiningId =
        form.household_id && form.household_id !== existing?.household_id
          ? form.household_id
          : null;
      const sortOrder = joiningId ? membersOf(joiningId).length : form.sort_order;

      const payload = {
        ...form,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        preferred_name: form.preferred_name?.trim() || null,
        household_role: form.household_id ? (form.household_role ?? "other") : null,
        sort_order: sortOrder,
        photo_path: photoPath,
      };

      const person = existing
        ? await updatePerson(existing.id, payload)
        : await createPerson(payload);
      await setTags("person", person.id, tagIds);
      await reload();
      // Made from a family's page, so go back there - that is the job that
      // was interrupted, and the next member is added from the same screen.
      const cameFromFamily = isNew ? params.get("household") : null;
      navigate(cameFromFamily ? `/families/${cameFromFamily}` : `/people/${person.id}`, {
        replace: true,
      });
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
          <h1>
            {isNew ? "Add a person" : `${form.first_name} ${form.last_name}`.trim() || "Person"}
          </h1>
          <div className="sub">
            {household ? (
              <>
                Part of <Link to={`/families/${household.id}`}>{household.display_name}</Link>, so
                they print on that family's card.
              </>
            ) : (
              "Not in a family, so they get their own record in the book."
            )}
          </div>
        </div>
        <Link className="btn ghost" to="/people">
          Back
        </Link>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <form onSubmit={save}>
        <div className="grid two" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="card-head">
              <h2>Details</h2>
            </div>
            <div className="card-body">
              <div className="field">
                {household ? (
                  // In a family, the family portrait is the picture - it is
                  // what their card in the book carries, because the family
                  // prints once, together. Offering an individual upload here
                  // would collect a photo that never appears anywhere.
                  <div className="photo-inherited">
                    <Avatar
                      path={household.photo_path}
                      initials={household.sort_name}
                      size="lg"
                      alt=""
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {household.photo_path ? "Family photo" : "No family photo yet"}
                      </div>
                      <p className="muted small" style={{ margin: "3px 0 8px" }}>
                        People in a family share one picture, and it prints on the family card.
                      </p>
                      <Link className="btn small" to={`/families/${household.id}`}>
                        {household.photo_path ? "Change it" : "Add one"} on {household.display_name}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <PhotoInput
                    path={photoRemoved ? null : form.photo_path}
                    initials={`${form.first_name[0] ?? ""}${form.last_name[0] ?? ""}`}
                    disabled={!canEdit}
                    onChange={(blob, removed) => {
                      setPhotoBlob(blob);
                      setPhotoRemoved(removed);
                    }}
                  />
                )}
              </div>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="First name" htmlFor="first_name">
                  <input
                    id="first_name"
                    type="text"
                    required
                    disabled={!canEdit}
                    value={form.first_name}
                    onChange={(event) => patch({ first_name: event.target.value })}
                  />
                </Field>
                <Field label="Last name" htmlFor="last_name">
                  <input
                    id="last_name"
                    type="text"
                    required
                    disabled={!canEdit}
                    value={form.last_name}
                    onChange={(event) => patch({ last_name: event.target.value })}
                  />
                </Field>
              </div>

              <Field
                label="Goes by"
                hint="Prints instead of the first name — “Bill” for a William."
                htmlFor="preferred_name"
              >
                <input
                  id="preferred_name"
                  type="text"
                  disabled={!canEdit}
                  placeholder={form.first_name}
                  value={form.preferred_name ?? ""}
                  onChange={(event) => patch({ preferred_name: event.target.value || null })}
                />
              </Field>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Phone" htmlFor="person_phone">
                  <input
                    id="person_phone"
                    type="tel"
                    disabled={!canEdit}
                    value={form.phone ?? ""}
                    onChange={(event) => patch({ phone: event.target.value || null })}
                  />
                </Field>
                <Field label="Email" htmlFor="person_email">
                  <input
                    id="person_email"
                    type="email"
                    disabled={!canEdit}
                    value={form.email ?? ""}
                    onChange={(event) => patch({ email: event.target.value || null })}
                  />
                </Field>
              </div>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Date of birth" hint="Optional." htmlFor="dob">
                  <input
                    id="dob"
                    type="date"
                    disabled={!canEdit}
                    value={form.date_of_birth ?? ""}
                    onChange={(event) => patch({ date_of_birth: event.target.value || null })}
                  />
                </Field>
                <Field label="Anniversary" hint="Optional." htmlFor="person_anniversary">
                  <input
                    id="person_anniversary"
                    type="date"
                    disabled={!canEdit}
                    value={form.anniversary ?? ""}
                    onChange={(event) => patch({ anniversary: event.target.value || null })}
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Family &amp; address</h2>
            </div>
            <div className="card-body">
              <Field
                label="Family"
                hint="Choose a family to have this person print on its card."
                htmlFor="household"
              >
                <select
                  id="household"
                  disabled={!canEdit}
                  value={form.household_id ?? ""}
                  onChange={(event) =>
                    patch({
                      household_id: event.target.value || null,
                      household_role: event.target.value ? (form.household_role ?? "other") : null,
                    })
                  }
                >
                  <option value="">Not in a family — prints on their own</option>
                  {households.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.display_name}
                    </option>
                  ))}
                </select>
              </Field>

              {form.household_id ? (
                <Field label="In the family" htmlFor="role">
                  <select
                    id="role"
                    disabled={!canEdit}
                    value={form.household_role ?? "other"}
                    onChange={(event) =>
                      patch({ household_role: event.target.value as HouseholdRole })
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              {household ? (
                <Checkbox
                  label="Use the family's address"
                  hint={
                    inheritedAddress.length
                      ? inheritedAddress.join(", ")
                      : "The family has no address yet."
                  }
                  checked={form.use_household_address}
                  disabled={!canEdit}
                  onChange={(value) => patch({ use_household_address: value })}
                />
              ) : null}

              {!household || !form.use_household_address ? (
                <AddressFields
                  idPrefix="person"
                  disabled={!canEdit}
                  value={form}
                  onChange={(next) => patch(next)}
                />
              ) : null}

              <Field
                label="Notes"
                hint="For your own reference. Never printed."
                htmlFor="person_notes"
              >
                <textarea
                  id="person_notes"
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

        {canEdit ? (
          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : isNew ? "Add person" : "Save changes"}
            </button>
            <Link className="btn ghost" to="/people">
              Cancel
            </Link>
            <span className="spacer" />
            {existing ? (
              <ConfirmButton
                label="Delete person"
                confirmLabel="Delete permanently"
                onConfirm={async () => {
                  await removePhoto(existing.photo_path);
                  await deletePerson(existing.id);
                  await reload();
                  navigate("/people");
                }}
              />
            ) : null}
          </div>
        ) : (
          <Notice kind="warn">You have read-only access, so changes cannot be saved.</Notice>
        )}
      </form>
    </div>
  );
}
