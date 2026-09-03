import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { AddressFields } from "@/components/AddressFields";
import { PhotoInput } from "@/components/PhotoInput";
import { TagPicker } from "@/components/TagPicker";
import { Avatar, Checkbox, ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import type { HouseholdRole, PersonRow } from "@/lib/database.types";
import { removePhoto, uploadPhoto } from "@/lib/photos";
import { createPerson, deletePerson, isStaleWrite, setTags, updatePerson } from "@/lib/queries";
import { addressLines, fullName, labelledHouseholdName, samePersonName } from "@/lib/format";

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
  const {
    personById,
    householdById,
    households,
    people,
    membersOf,
    tags,
    tagsOfPerson,
    reload,
    loading,
  } = useDirectory();

  const existing = id ? personById.get(id) : undefined;
  const isNew = !id;

  const [form, setForm] = useState(BLANK);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The version this form was opened on. Not read from `existing`, which every
   * reload refreshes - the point is the value that was on screen when the
   * typing started.
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
    if (isNew) {
      const household = params.get("household");
      if (household)
        setForm((current) => ({ ...current, household_id: household, household_role: "other" }));
      return;
    }
    if (!existing) return;
    setForm({ ...existing });
    setPhotoBlob(null);
    setPhotoRemoved(false);
    setOpenedAt(existing.updated_at);
    setStale(false);
    setTagIds(tagsOfPerson(existing.id));
  }, [existing?.id, isNew, reseed]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * People already here who would be hard to tell apart from this one.
   *
   * Archived ones count. Somebody typing in a name that was archived last year
   * is usually re-adding a person who came back, and bringing the old record
   * out of the archive keeps their history rather than starting a second one.
   */
  const nameClashes = useMemo(
    () =>
      people
        .filter((other) => other.id !== existing?.id && samePersonName(form, other))
        .slice(0, 4),
    [people, existing?.id, form.first_name, form.last_name, form.preferred_name],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await store(false);
  }

  /**
   * Throws this browser's typing away and shows the person as somebody else
   * left them. The reload has to land before the form is filled in again, or
   * it would be seeded from the same stale copy it is trying to replace.
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
   * `force` drops the check that the record has not moved since it was opened.
   * Only reached from the button offered when it has, so overwriting somebody
   * is a decision rather than an accident.
   */
  async function store(force: boolean) {
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
        // Upload before deleting, never the other way round: this runs on a
        // phone on church wifi, and removing first meant a failed upload took
        // the existing photograph with it while the record still pointed at
        // the file that no longer existed.
        const replaced = !photoRemoved ? form.photo_path : null;
        photoPath = await uploadPhoto("people", photoBlob);
        if (replaced) await removePhoto(replaced);
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
        ? await updatePerson(existing.id, payload, force ? null : openedAt)
        : await createPerson(payload);
      setOpenedAt(person.updated_at);
      setStale(false);
      await setTags("person", person.id, tagIds);
      await reload();
      // Made from a family's page, so go back there - that is the job that
      // was interrupted, and the next member is added from the same screen.
      const cameFromFamily = isNew ? params.get("household") : null;
      navigate(cameFromFamily ? `/families/${cameFromFamily}` : `/people/${person.id}`, {
        replace: true,
      });
    } catch (cause) {
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

              {nameClashes.length ? (
                <div style={{ marginTop: -4, marginBottom: 14 }}>
                  <Notice kind="warn">
                    {nameClashes.length === 1
                      ? "Somebody with this name is"
                      : "People with this name are"}{" "}
                    already in the directory. Two people really can share a name — but if this is
                    the same person, open them instead of adding them twice.
                    <ul className="clash-list">
                      {nameClashes.map((other) => {
                        const theirs = other.household_id
                          ? householdById.get(other.household_id)
                          : null;
                        return (
                          <li key={other.id}>
                            <Link className="list-link" to={`/people/${other.id}`}>
                              {fullName(other)}
                            </Link>
                            <span className="muted">
                              {" — "}
                              {theirs ? theirs.display_name : "on their own"}
                              {other.is_active ? "" : ", archived"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </Notice>
                </div>
              ) : null}

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

              {/* An anniversary belongs to a couple, which is what a family
                  record is - so it is asked for there and only there. */}
              <Field label="Date of birth" hint="Optional." htmlFor="dob">
                <input
                  id="dob"
                  type="date"
                  disabled={!canEdit}
                  value={form.date_of_birth ?? ""}
                  onChange={(event) => patch({ date_of_birth: event.target.value || null })}
                />
              </Field>
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
                      {labelledHouseholdName(option)}
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
