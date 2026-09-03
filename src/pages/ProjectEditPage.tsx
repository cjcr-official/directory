import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Checkbox, ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import { TagPicker } from "@/components/TagPicker";
import {
  createProject,
  deleteProject,
  fetchProject,
  isStaleWrite,
  setProjectEntries,
  setProjectTags,
  updateProject,
} from "@/lib/queries";
import type { ProjectKind, SelectionMode } from "@/lib/database.types";
import {
  DEFAULT_SETTINGS,
  PAGE_SIZES,
  normalizeSettings,
  recordsPerSheet,
  type CardStyle,
  type PageSizeName,
  type ProjectSettings,
  type TextScale,
  type Typeface,
} from "@/lib/layout/settings";
import { resolveEntries, type Selection } from "@/lib/projectEntries";
import { labelledHouseholdName } from "@/lib/format";
import { removePhoto, uploadPhoto } from "@/lib/photos";
import { PhotoInput } from "@/components/PhotoInput";

export function ProjectEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const { entries, tags, reload } = useDirectory();
  const isNew = !id;

  const [name, setName] = useState("Church Directory");
  const [kind, setKind] = useState<ProjectKind>("directory");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<SelectionMode>("all");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  /**
   * Cover artwork chosen but not yet uploaded.
   *
   * Nothing reaches storage until the directory is saved, so backing out of a
   * half-made change leaves no orphan file behind - the same bargain the family
   * and person forms make with their portraits.
   */
  const [coverBlobs, setCoverBlobs] = useState<{ photo?: Blob | null; logo?: Blob | null }>({});
  const [coverRemoved, setCoverRemoved] = useState<{ photo?: boolean; logo?: boolean }>({});

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * The version this form was opened on, as a fingerprint for the save.
   *
   * Held separately from the loaded row on purpose: a reload refreshes that,
   * and what is wanted here is the version that was on screen when the editing
   * started.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    fetchProject(id)
      .then((loaded) => {
        if (!active) return;
        setName(loaded.project.name);
        setKind(loaded.project.kind);
        setDescription(loaded.project.description ?? "");
        setMode(loaded.project.selection_mode);
        setTagIds(loaded.tagIds);
        setPicked(loaded.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
        setSettings(normalizeSettings(loaded.project.settings));
        setOpenedAt(loaded.project.updated_at);
        setStale(false);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const selection: Selection = useMemo(
    () => ({
      mode,
      tagIds,
      entries: picked.map((key, position) => {
        const [entry_type, ref_id] = key.split(":");
        return {
          project_id: id ?? "",
          entry_type: entry_type as "household" | "person",
          ref_id,
          position,
        };
      }),
    }),
    [mode, tagIds, picked, id],
  );

  const included = useMemo(() => resolveEntries(entries, selection), [entries, selection]);

  // The checklist is the one place a family is picked by its name alone, so it
  // is the one place the office label belongs. It is added here rather than in
  // buildEntries because `title` is also what the printed card and the index
  // are composed from - putting it there would print the office's filing note
  // in the congregation's book.
  const pickable = useMemo(
    () =>
      entries.map((entry) => ({
        type: entry.type,
        id: entry.id,
        title: entry.type === "household" ? labelledHouseholdName(entry.household) : entry.title,
      })),
    [entries],
  );
  // The rows/columns inputs can hold a half-typed or empty value; the summary
  // and the saved record both use the clamped version so neither can show or
  // store "0 records to a sheet".
  const safeSettings = useMemo(() => normalizeSettings(settings), [settings]);
  const sheets = Math.ceil(included.length / recordsPerSheet(safeSettings));

  if (loading) return <LoadingScreen label="Loading directory…" />;

  function set(patch: Partial<ProjectSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    await store(false);
  }

  /**
   * Throws this browser's changes away and shows the directory as somebody
   * else left it. Reading it again is what makes the form honest - the values
   * on screen were worked out from a version that is no longer current.
   */
  async function discardMine() {
    if (!id) return;
    setSaving(true);
    try {
      const loaded = await fetchProject(id);
      setName(loaded.project.name);
      setKind(loaded.project.kind);
      setDescription(loaded.project.description ?? "");
      setMode(loaded.project.selection_mode);
      setTagIds(loaded.tagIds);
      setPicked(loaded.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
      setSettings(normalizeSettings(loaded.project.settings));
      setOpenedAt(loaded.project.updated_at);
      setStale(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Writes the directory. `force` drops the check that it has not moved since
   * it was opened - only reached from the button offered when it has, so
   * overwriting somebody is a decision rather than an accident.
   */
  async function store(force: boolean) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      // Upload before deleting, never the other way round: this runs on a
      // phone on church wifi, and removing first would mean a failed upload
      // took the existing artwork with it.
      const settle = async (current: string, blob: Blob | null | undefined, gone?: boolean) => {
        if (blob) {
          const replaced = gone ? "" : current;
          const path = await uploadPhoto("covers", blob);
          if (replaced) await removePhoto(replaced);
          return path;
        }
        if (gone && current) {
          await removePhoto(current);
          return "";
        }
        return current;
      };

      const cover = {
        coverPhotoPath: await settle(
          safeSettings.coverPhotoPath,
          coverBlobs.photo,
          coverRemoved.photo,
        ),
        coverLogoPath: await settle(safeSettings.coverLogoPath, coverBlobs.logo, coverRemoved.logo),
      };
      const saved = { ...safeSettings, ...cover };

      const payload = {
        name: name.trim() || "Untitled directory",
        kind,
        description: description.trim() || null,
        selection_mode: mode,
        settings: saved as unknown as Record<string, unknown>,
      };

      const project = id
        ? await updateProject(id, payload, force ? null : openedAt)
        : await createProject(payload);
      await setProjectTags(project.id, mode === "tags" ? tagIds : []);
      await setProjectEntries(
        project.id,
        mode === "manual"
          ? picked.map((key) => {
              const [entry_type, ref_id] = key.split(":");
              return { entry_type: entry_type as "household" | "person", ref_id };
            })
          : [],
      );

      setSettings((current) => ({ ...current, ...cover }));
      setCoverBlobs({});
      setCoverRemoved({});
      setOpenedAt(project.updated_at);
      setStale(false);
      setSavedAt(Date.now());
      if (!id) navigate(`/projects/${project.id}`, { replace: true });
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
          <h1>{isNew ? "New directory" : name}</h1>
          <div className="sub">
            {included.length} record{included.length === 1 ? "" : "s"} ·{" "}
            {recordsPerSheet(safeSettings)} to a sheet · about {sheets} sheet
            {sheets === 1 ? "" : "s"} of paper
          </div>
        </div>
        <div className="row tight">
          {!isNew ? (
            <Link className="btn" to={`/projects/${id}/preview`}>
              Preview &amp; print
            </Link>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : isNew ? "Create" : "Save"}
            </button>
          ) : null}
        </div>
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
      {savedAt ? <Notice kind="ok">Saved. Open the preview to see it laid out.</Notice> : null}

      <form onSubmit={save}>
        <div className="grid two" style={{ alignItems: "start", marginTop: 16 }}>
          <div>
            <div className="card">
              <div className="card-head">
                <h2>About this directory</h2>
              </div>
              <div className="card-body">
                <Field label="Name" hint="For your own list of directories." htmlFor="project_name">
                  <input
                    id="project_name"
                    type="text"
                    value={name}
                    disabled={!canEdit}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>

                <Field label="Kind" htmlFor="project_kind">
                  <select
                    id="project_kind"
                    value={kind}
                    disabled={!canEdit}
                    onChange={(event) => setKind(event.target.value as ProjectKind)}
                  >
                    <option value="directory">Main directory</option>
                    <option value="event">Smaller / event directory</option>
                  </select>
                </Field>

                <Field label="Description" htmlFor="project_description">
                  <textarea
                    id="project_description"
                    value={description}
                    disabled={!canEdit}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Who is in it</h2>
              </div>
              <div className="card-body">
                <Field label="Include" htmlFor="mode">
                  <select
                    id="mode"
                    value={mode}
                    disabled={!canEdit}
                    onChange={(event) => setMode(event.target.value as SelectionMode)}
                  >
                    <option value="all">Everyone in the directory</option>
                    <option value="tags">People in certain groups</option>
                    <option value="manual">Hand-picked records</option>
                  </select>
                </Field>

                {mode === "tags" ? (
                  <>
                    <TagPicker
                      tags={tags}
                      selected={tagIds}
                      disabled={!canEdit}
                      onChange={setTagIds}
                    />
                    <p className="hint" style={{ marginTop: 8 }}>
                      A family is included when the family or any member carries one of these
                      groups. New people added to a group appear here automatically.
                    </p>
                  </>
                ) : null}

                {mode === "manual" ? (
                  <ManualPicker
                    entries={pickable}
                    picked={picked}
                    disabled={!canEdit}
                    onChange={setPicked}
                  />
                ) : null}

                {mode === "all" ? (
                  <p className="hint">
                    Everyone marked “include in printed directories” prints, in alphabetical order.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="card-head">
                <h2>The page</h2>
              </div>
              <div className="card-body">
                <Field label="Paper" htmlFor="page_size">
                  <select
                    id="page_size"
                    value={settings.pageSize}
                    disabled={!canEdit}
                    onChange={(event) => set({ pageSize: event.target.value as PageSizeName })}
                  >
                    {(Object.keys(PAGE_SIZES) as PageSizeName[]).map((key) => (
                      <option key={key} value={key}>
                        {PAGE_SIZES[key].label} landscape
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Records per half-page" htmlFor="rows">
                    <input
                      id="rows"
                      type="number"
                      min={1}
                      max={8}
                      value={settings.rows}
                      disabled={!canEdit}
                      onChange={(event) => set({ rows: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label="Halves per sheet" htmlFor="columns">
                    <input
                      id="columns"
                      type="number"
                      min={1}
                      max={3}
                      value={settings.columns}
                      disabled={!canEdit}
                      onChange={(event) => set({ columns: Number(event.target.value) })}
                    />
                  </Field>
                </div>

                <Notice>
                  <strong>{recordsPerSheet(safeSettings)} records on one sheet of paper</strong> —{" "}
                  {safeSettings.rows} down each half, {safeSettings.columns} halves across. Fold the
                  sheet down the middle for a{" "}
                  {safeSettings.pageSize === "a4" ? "A5" : "half-letter"} booklet.
                </Notice>

                <Field label="Typeface" htmlFor="typeface">
                  <select
                    id="typeface"
                    value={settings.typeface}
                    disabled={!canEdit}
                    onChange={(event) => set({ typeface: event.target.value as Typeface })}
                  >
                    <option value="serif">Serif — traditional, best for a book</option>
                    <option value="sans">Sans serif — plainer, a little more compact</option>
                  </select>
                </Field>

                <Field label="Text size" htmlFor="text_scale">
                  <select
                    id="text_scale"
                    value={settings.textScale}
                    disabled={!canEdit}
                    onChange={(event) => set({ textScale: event.target.value as TextScale })}
                  >
                    <option value="compact">Compact — fits more</option>
                    <option value="normal">Normal</option>
                    <option value="large">Large — easier to read</option>
                  </select>
                </Field>

                <Checkbox
                  label="Booklet page order"
                  hint="Reorders pages for double-sided printing, folding and stapling the spine. Leave off for a straight-through PDF."
                  checked={settings.bookletOrder}
                  disabled={!canEdit || settings.columns !== 2}
                  onChange={(value) => set({ bookletOrder: value })}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>What each card shows</h2>
              </div>
              <div className="card-body">
                <Checkbox
                  label="Photographs"
                  checked={settings.showPhotos}
                  disabled={!canEdit}
                  onChange={(value) => set({ showPhotos: value })}
                />
                {settings.showPhotos ? (
                  <div className="check-child">
                    <Field
                      label="Photo shape"
                      hint="Cropping gives every card the same shape, which is tidiest on the page."
                      htmlFor="photo_fit"
                    >
                      <select
                        id="photo_fit"
                        value={settings.photoFit}
                        disabled={!canEdit}
                        onChange={(event) =>
                          set({ photoFit: event.target.value as "fill" | "fit" })
                        }
                      >
                        <option value="fill">Crop to a matching portrait</option>
                        <option value="fit">Show the whole photo</option>
                      </select>
                    </Field>
                  </div>
                ) : null}
                <Checkbox
                  label="Family members' names"
                  checked={settings.showMembers}
                  disabled={!canEdit}
                  onChange={(value) => set({ showMembers: value })}
                />
                {settings.showMembers ? (
                  <div className="check-child">
                    <Field label="Member style" htmlFor="member_style">
                      <select
                        id="member_style"
                        value={settings.memberStyle}
                        disabled={!canEdit}
                        onChange={(event) =>
                          set({ memberStyle: event.target.value as "compact" | "detailed" })
                        }
                      >
                        <option value="compact">One line of first names</option>
                        <option value="detailed">
                          A line each, with their own contact details
                        </option>
                      </select>
                    </Field>
                  </div>
                ) : null}
                <Checkbox
                  label="Address"
                  checked={settings.showAddress}
                  disabled={!canEdit}
                  onChange={(value) => set({ showAddress: value })}
                />
                <Checkbox
                  label="Phone numbers"
                  checked={settings.showPhone}
                  disabled={!canEdit}
                  onChange={(value) => set({ showPhone: value })}
                />
                <Checkbox
                  label="Email addresses"
                  checked={settings.showEmail}
                  disabled={!canEdit}
                  onChange={(value) => set({ showEmail: value })}
                />
                <Checkbox
                  label="Birthdays"
                  checked={settings.showBirthdays}
                  disabled={!canEdit}
                  onChange={(value) => set({ showBirthdays: value })}
                />
                <Checkbox
                  label="Family anniversaries"
                  checked={settings.showAnniversary}
                  disabled={!canEdit}
                  onChange={(value) => set({ showAnniversary: value })}
                />
                <div className="form-decision">
                  <Field label="How records are separated" htmlFor="card_style">
                    <select
                      id="card_style"
                      value={settings.cardStyle}
                      disabled={!canEdit}
                      onChange={(event) => set({ cardStyle: event.target.value as CardStyle })}
                    >
                      <option value="rule">A hairline between records</option>
                      <option value="box">A light box around each record</option>
                      <option value="none">Nothing — space only</option>
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>The cover</h2>
              </div>
              {/* In the order it prints, top of the cover to the bottom, so
                  filling the form in reads down the page it makes. */}
              <div className="card-body">
                <div className="grid two">
                  {/* One hint apiece: PhotoInput carries its own, so a hint on
                      the Field as well just stacks two paragraphs under every
                      picture. */}
                  <Field label="Logo">
                    <PhotoInput
                      path={coverRemoved.logo ? null : settings.coverLogoPath || null}
                      initials=""
                      shape="square"
                      hint="Sits at the very top, any shape - fitted whole, never cropped"
                      disabled={!canEdit}
                      onChange={(blob, removed) => {
                        setCoverBlobs((current) => ({ ...current, logo: blob }));
                        setCoverRemoved((current) => ({ ...current, logo: removed }));
                      }}
                    />
                  </Field>
                  <Field label="Photograph">
                    <PhotoInput
                      path={coverRemoved.photo ? null : settings.coverPhotoPath || null}
                      initials=""
                      shape="wide"
                      hint="Under the title - the building, or the sign. Landscape prints best, and large photos are shrunk automatically"
                      disabled={!canEdit}
                      onChange={(blob, removed) => {
                        setCoverBlobs((current) => ({ ...current, photo: blob }));
                        setCoverRemoved((current) => ({ ...current, photo: removed }));
                      }}
                    />
                  </Field>
                </div>

                <Field
                  label="Church name"
                  hint="Small, above the title - and along the top of every page inside."
                  htmlFor="church_name"
                >
                  <input
                    id="church_name"
                    type="text"
                    value={settings.churchName}
                    placeholder="Plains Alliance Church"
                    disabled={!canEdit}
                    onChange={(event) => set({ churchName: event.target.value })}
                  />
                </Field>

                <div className="grid two">
                  <Field label="Title" hint="The big line." htmlFor="cover_title">
                    <input
                      id="cover_title"
                      type="text"
                      value={settings.coverTitle}
                      placeholder="Church Directory"
                      disabled={!canEdit}
                      onChange={(event) => set({ coverTitle: event.target.value })}
                    />
                  </Field>
                  <Field label="Subtitle" hint="A season or a year." htmlFor="cover_subtitle">
                    <input
                      id="cover_subtitle"
                      type="text"
                      value={settings.coverSubtitle}
                      placeholder="Spring 2026"
                      disabled={!canEdit}
                      onChange={(event) => set({ coverSubtitle: event.target.value })}
                    />
                  </Field>
                </div>

                <Field
                  label="In your own words"
                  hint="A vision, a welcome, a verse. Its own paragraph, under the photograph."
                  htmlFor="cover_statement"
                >
                  <textarea
                    id="cover_statement"
                    rows={4}
                    value={settings.coverStatement}
                    placeholder={
                      "OUR VISION…\nTo be a God-glorifying, Spirit-filled community of believers."
                    }
                    disabled={!canEdit}
                    onChange={(event) => set({ coverStatement: event.target.value })}
                  />
                </Field>

                <Field
                  label="How to reach the church"
                  hint="The foot of the cover. One line here is one line there."
                  htmlFor="cover_contact"
                >
                  <textarea
                    id="cover_contact"
                    rows={5}
                    value={settings.coverContact}
                    placeholder={
                      "505 West 5th Street\nP.O. Box 368\nPlains, MT 59859\n406.826.3916\noffice@example.org"
                    }
                    disabled={!canEdit}
                    onChange={(event) => set({ coverContact: event.target.value })}
                  />
                </Field>

                <Checkbox
                  label="Print a cover page"
                  hint="Off prints the records straight away, with no cover."
                  checked={settings.includeCover}
                  disabled={!canEdit}
                  onChange={(value) => set({ includeCover: value })}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Inside the book</h2>
              </div>
              <div className="card-body">
                <Field
                  label="Footer note"
                  hint="Along the bottom of every page."
                  htmlFor="footer_text"
                >
                  <input
                    id="footer_text"
                    type="text"
                    value={settings.footerText}
                    placeholder="Please keep this directory for church use only."
                    disabled={!canEdit}
                    onChange={(event) => set({ footerText: event.target.value })}
                  />
                </Field>

                <Checkbox
                  label="Alphabetical index at the back"
                  hint="Every person by surname, with the page their family is on."
                  checked={settings.includeIndex}
                  disabled={!canEdit}
                  onChange={(value) => set({ includeIndex: value })}
                />
                <Checkbox
                  label="Church name in the running header"
                  checked={settings.runningHeader}
                  disabled={!canEdit}
                  onChange={(value) => set({ runningHeader: value })}
                />
                <Checkbox
                  label="Letter tabs (A, B, C…)"
                  checked={settings.showLetterTabs}
                  disabled={!canEdit}
                  onChange={(value) => set({ showLetterTabs: value })}
                />
                <Checkbox
                  label="Page numbers"
                  checked={settings.showPageNumbers}
                  disabled={!canEdit}
                  onChange={(value) => set({ showPageNumbers: value })}
                />
              </div>
            </div>
          </div>
        </div>

        {canEdit ? (
          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create directory" : "Save changes"}
            </button>
            {!isNew ? (
              <Link className="btn" to={`/projects/${id}/preview`}>
                Preview &amp; print
              </Link>
            ) : null}
            <Link className="btn ghost" to="/projects">
              Back
            </Link>
          </div>
        ) : (
          <Notice kind="warn">You have read-only access. You can still preview and print.</Notice>
        )}

        {/* Deleting is not one of the ways to leave this page, so it does not
            sit in the row that saves and goes back. */}
        {canEdit && !isNew && id ? (
          <div className="form-decision">
            <ConfirmButton
              label="Delete directory"
              confirmLabel="Delete permanently"
              onConfirm={async () => {
                await deleteProject(id);
                await reload();
                navigate("/projects");
              }}
            />
          </div>
        ) : null}
      </form>
    </div>
  );
}

/**
 * One line of the checklist.
 *
 * Memoised, with a toggle that never changes identity, so ticking one box
 * re-renders that box rather than the whole congregation. Without both halves
 * a directory of a thousand records re-created a thousand checkboxes on every
 * tick, and picking a booklet by hand is nothing but ticks.
 */
const PickerRow = memo(function PickerRow({
  entryKey,
  label,
  checked,
  disabled,
  onToggle,
}: {
  entryKey: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (entryKey: string, on: boolean) => void;
}) {
  return (
    <Checkbox
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(on) => onToggle(entryKey, on)}
    />
  );
});

/** Checklist of every record, for the hand-picked mode. */
function ManualPicker({
  entries,
  picked,
  onChange,
  disabled,
}: {
  entries: { type: "household" | "person"; id: string; title: string }[];
  picked: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const chosen = useMemo(() => new Set(picked), [picked]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.title.toLowerCase().includes(needle));
  }, [entries, query]);

  // Held in a ref so the callback below can read the current selection without
  // being rebuilt when it changes - a new callback every render would be a new
  // prop on every row, and the memo above would never once hold.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const onToggle = useCallback(
    (entryKey: string, on: boolean) => {
      const next = pickedRef.current.filter((key) => key !== entryKey);
      onChange(on ? [...next, entryKey] : next);
    },
    [onChange],
  );

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input
          className="search"
          type="search"
          placeholder="Search records…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted small">{picked.length} chosen</span>
        {picked.length ? (
          <button
            type="button"
            className="btn ghost small"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div
        style={{
          maxHeight: 320,
          overflowY: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          padding: 10,
        }}
      >
        {visible.map((entry) => {
          const key = `${entry.type}:${entry.id}`;
          return (
            <PickerRow
              key={key}
              entryKey={key}
              label={entry.title}
              checked={chosen.has(key)}
              disabled={disabled}
              onToggle={onToggle}
            />
          );
        })}
        {!visible.length ? <p className="muted small">Nothing matches.</p> : null}
      </div>
    </div>
  );
}
