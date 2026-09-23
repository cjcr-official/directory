import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import {
  ChangedNote,
  Checkbox,
  ConfirmButton,
  Disclosure,
  Field,
  LoadingScreen,
  Notice,
} from "@/components/ui";
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
  COVER_PARTS,
  DEFAULT_SETTINGS,
  PAGE_SIZES,
  TAG_SIZES,
  TAG_STYLES,
  normalizeSettings,
  paperName,
  placeCoverPart,
  recordsPerSheet,
  type CardStyle,
  type CoverPart,
  type CoverPlacement,
  type CoverPlacements,
  type PageSizeName,
  type ProjectSettings,
  type TextScale,
  type Typeface,
} from "@/lib/layout/settings";
import { resolveEntries, type Selection } from "@/lib/projectEntries";
import { labelledHouseholdName, message } from "@/lib/format";
import { getPhotoUrls, removePhoto, uploadPhoto } from "@/lib/photos";
import { CoverCanvas, type MovableParts } from "@/components/BookPreview";
import { composeCoverPage } from "@/lib/layout/compose";
import { tagsPerSheet } from "@/lib/layout/tags";
import { TYPEFACE_LABELS, loadMetrics, type Metrics } from "@/lib/layout/metrics";
import { PhotoInput } from "@/components/PhotoInput";

/*
 * Stand-in storage paths for a picture that has been chosen but not yet
 * uploaded. The composer draws a photograph by its path, and a Blob picked a
 * second ago does not have one, so these carry it as far as the canvas. They
 * never reach the database: Save uploads the Blob and writes the real path.
 * Prefixed so they cannot collide with anything storage would hand back.
 */
const PENDING_LOGO = "pending:cover-logo";
const PENDING_PHOTO = "pending:cover-photo";

/**
 * The five lines on a cover that come from a setting, and the grey words each
 * holds its place with while it is being typed in. Named after what belongs
 * there, because they are read on the cover by somebody who has never seen the
 * field they came from.
 */
const COVER_PLACEHOLDER: Record<string, string> = {
  churchName: "Your church's name",
  coverTitle: "The book's title",
  coverSubtitle: "A subtitle",
  coverStatement: "A verse, or a sentence about the congregation",
  coverContact: "The address, and how to reach the office",
};

/** The two of them that may hold more than one line. */
const COVER_MULTILINE = new Set(["coverStatement", "coverContact", "coverTitle", "coverSubtitle"]);

/**
 * What each part of the cover is called when a handle has to name it.
 *
 * Read aloud by a screen reader as "Move the church's name", so they are the
 * words for the thing on the paper rather than the words on the field that
 * fills it in - somebody moving the address about is not thinking about a
 * textarea labelled Contact details.
 */
const COVER_PART_LABELS: Record<CoverPart, string> = {
  coverLogo: "the logo",
  churchName: "the church's name",
  coverPhoto: "the photograph",
  coverTitle: "the title",
  coverSubtitle: "the subtitle",
  coverStatement: "the mission or welcome",
  coverContact: "the contact details",
};

export function ProjectEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const { entries, tags, authorName, reload } = useDirectory();
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
  /**
   * When this directory was last written and by whom.
   *
   * Held apart from openedAt, which is a fingerprint for the save and must go
   * on naming the version the editing started from. This pair is only ever
   * read, and follows whatever the last write actually returned.
   *
   * A directory is loaded straight from the database on this screen rather
   * than read out of the shared context, so it carries its own copy where the
   * family and person forms can use the row the context already holds.
   */
  const [changed, setChanged] = useState<{ at: string; by: string | null } | null>(null);

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
        setChanged({ at: loaded.project.updated_at, by: loaded.project.updated_by ?? null });
        setStale(false);
      })
      .catch((cause) => setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const selection: Selection = useMemo(
    () => ({
      mode,
      tagIds,
      wholeFamily: settings.groupWholeFamily,
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
    [mode, tagIds, picked, id, settings.groupWholeFamily],
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

  // --- the cover, drawn ------------------------------------------------------

  /**
   * Font metrics for the typeface the book is set in. The composer needs them
   * to break a line where the PDF will break it - without them the canvas would
   * be a drawing of a cover rather than a proof of one - and they are fetched,
   * so the canvas appears a moment after the card does.
   */
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  useEffect(() => {
    let active = true;
    void loadMetrics(safeSettings.typeface).then((loaded) => {
      if (active) setMetrics(loaded);
    });
    return () => {
      active = false;
    };
  }, [safeSettings.typeface]);

  /**
   * A photograph chosen a moment ago has been read into a Blob and not yet
   * uploaded, so it has no storage path to be drawn by. These stand in as one
   * until Save gives it a real one, which is what lets a logo appear on the
   * canvas when it is picked rather than only after the record is written.
   */
  const pendingCoverUrls = useMemo(() => {
    const urls = new Map<string, string>();
    if (coverBlobs.logo) urls.set(PENDING_LOGO, URL.createObjectURL(coverBlobs.logo));
    if (coverBlobs.photo) urls.set(PENDING_PHOTO, URL.createObjectURL(coverBlobs.photo));
    return urls;
  }, [coverBlobs]);
  useEffect(
    () => () => pendingCoverUrls.forEach((url) => URL.revokeObjectURL(url)),
    [pendingCoverUrls],
  );

  /**
   * The settings as they would print this second, artwork and all.
   *
   * The cover and the name tag are both drawn from these, and both carry the
   * same mark, so the substitution of a picture chosen a moment ago for one
   * that has been saved belongs here rather than in each of them.
   */
  const drawnSettings = useMemo(
    () => ({
      ...safeSettings,
      coverLogoPath: coverRemoved.logo
        ? ""
        : coverBlobs.logo
          ? PENDING_LOGO
          : safeSettings.coverLogoPath,
      coverPhotoPath: coverRemoved.photo
        ? ""
        : coverBlobs.photo
          ? PENDING_PHOTO
          : safeSettings.coverPhotoPath,
    }),
    [safeSettings, coverBlobs, coverRemoved],
  );

  /*
   * A line being typed in keeps its place even when it has been emptied.
   *
   * Composed, a setting with nothing in it is not on the cover at all - which
   * is right on paper and a trap on screen: clear the subtitle and the box you
   * were typing in vanishes under the cursor. So an emptied line stands in with
   * grey words for exactly as long as it has the caret, and no longer. A
   * placeholder that outstayed the caret would have the screen laying the cover
   * out around type the paper never sees - and on a cover that matters more
   * than on a tag, because everything below a line moves when it goes.
   */
  const [editing, setEditing] = useState<string | null>(null);

  /** What the cover would be if it were saved and printed exactly now. */
  const coverPage = useMemo(() => {
    if (!metrics || !safeSettings.includeCover) return null;
    const standIn = (field: string, value: string) =>
      value.trim() || (editing === field ? COVER_PLACEHOLDER[field] : "");
    return composeCoverPage(
      {
        ...drawnSettings,
        churchName: standIn("churchName", drawnSettings.churchName),
        coverTitle: standIn("coverTitle", drawnSettings.coverTitle),
        coverSubtitle: standIn("coverSubtitle", drawnSettings.coverSubtitle),
        coverStatement: standIn("coverStatement", drawnSettings.coverStatement),
        coverContact: standIn("coverContact", drawnSettings.coverContact),
      },
      metrics,
    );
  }, [metrics, safeSettings.includeCover, drawnSettings, editing]);

  /*
   * Where each part of the cover actually ended up.
   *
   * The composer keeps everything on the paper, so what it used is not always
   * what is stored - and a drag has to be measured against what is on screen
   * or it stops feeling like dragging. Held in a ref rather than read from
   * `coverPage` directly so that the handlers below never need rebuilding: a
   * new one of those on every frame of a drag is a new prop on the drawing
   * sixty times a second.
   */
  const placedRef = useRef<CoverPlacements>({});
  placedRef.current = coverPage?.placed ?? {};

  /**
   * One part of the cover, moved or resized from where it is drawn now.
   *
   * The rule itself lives with the settings, because what it does with a part
   * that has been dragged past the edge of the paper is not an opinion this
   * screen is entitled to have. Held in a callback that never changes, so that
   * a drag is not handing the drawing a new set of props sixty times a second.
   */
  const place = useCallback((part: string, change: (from: CoverPlacement) => CoverPlacement) => {
    setSettings((current) => ({
      ...current,
      coverPlacements: placeCoverPart(
        current.coverPlacements,
        placedRef.current,
        part as CoverPart,
        change,
      ),
    }));
  }, []);

  /*
   * The cover, handing its parts back to be moved.
   *
   * Only where this browser may actually change the directory: a reader gets
   * the drawing and none of the handles, exactly as they get the type and no
   * way to type over it.
   */
  const movableCover = useMemo<MovableParts | undefined>(
    () =>
      canEdit
        ? {
            label: (part) => COVER_PART_LABELS[part as CoverPart] ?? "this",
            onMove: (part, dx, dy) =>
              place(part, (from) => ({ ...from, dx: from.dx + dx, dy: from.dy + dy })),
            onResize: (part, by) => place(part, (from) => ({ ...from, scale: from.scale * by })),
          }
        : undefined,
    [canEdit, place],
  );

  /** The parts somebody has moved, in the order they print down the page. */
  const moved = useMemo(
    () => COVER_PARTS.filter((part) => safeSettings.coverPlacements[part]),
    [safeSettings.coverPlacements],
  );

  /*
   * The cover, handing its own type back.
   *
   * Writing goes through the same set() the pane's own fields use, so the two
   * are never out of step and Save means what it always did.
   */
  const editableCover = useMemo(
    () => ({
      value: (field: string) => (settings?.[field as keyof typeof settings] as string) ?? "",
      placeholder: (field: string) => COVER_PLACEHOLDER[field] ?? "",
      multiline: (field: string) => COVER_MULTILINE.has(field),
      onChange: (field: string, value: string) => set({ [field]: value }),
      onFocus: (field: string) => setEditing(field),
      onBlur: (field: string) => setEditing((current) => (current === field ? null : current)),
      /*
       * The church's name is the one line the composer does not draw as it was
       * typed: it sets it in capitals with a space between every letter, which
       * is a shape no field can hold. So the box that edits it wears the shape
       * instead - capitals and tracking in CSS - and holds the name as it was
       * written. The tracking is added after the last letter as well, which
       * pushes a centred line left by half of it; half of it back as an indent
       * puts it where the composed line sits. The same correction the code
       * field on Settings makes, for the same reason.
       *
       * It is near rather than exact - CSS spaces letters, the composer spaces
       * them with spaces - and it is only worn while the caret is in the box.
       */
      style: (field: string) =>
        field === "churchName"
          ? ({ textTransform: "uppercase", letterSpacing: "0.28em", textIndent: "0.14em" } as const)
          : undefined,
    }),
    [settings],
  );

  // Saved photographs, fetched once per set of paths rather than per keystroke.
  const [savedCoverUrls, setSavedCoverUrls] = useState<Map<string, string>>(new Map());
  const storedCoverPaths = [safeSettings.coverLogoPath, safeSettings.coverPhotoPath]
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    const paths = storedCoverPaths.split("|").filter(Boolean);
    if (!paths.length) return;
    let active = true;
    void getPhotoUrls(paths).then((urls) => {
      if (active) setSavedCoverUrls(urls);
    });
    return () => {
      active = false;
    };
  }, [storedCoverPaths]);

  const coverUrls = useMemo(
    () => new Map([...savedCoverUrls, ...pendingCoverUrls]),
    [savedCoverUrls, pendingCoverUrls],
  );

  // What the three panels below come to, said in a few words so they are worth
  // reading shut. A list of what is on beats a count of how many, and every one
  // of them is separated the same way - the panels read as a set, and a comma
  // inside an item would not be told apart from the one between two of them.
  const listOr = (parts: (string | false)[], none: string) =>
    parts.filter(Boolean).join(" · ") || none;

  const pageSummary = listOr(
    [
      `${paperName(safeSettings.pageSize)} landscape`,
      `${recordsPerSheet(safeSettings)} to a sheet`,
      TYPEFACE_LABELS[safeSettings.typeface].toLowerCase(),
      safeSettings.textScale === "large" ? "large text" : "normal text",
      safeSettings.bookletOrder && "booklet order",
    ],
    "",
  );

  // What the name tags currently come to, for the card that leads to them.
  const tagSummary = listOr(
    [
      TAG_SIZES[safeSettings.tagSize].label,
      `${tagsPerSheet(safeSettings)} to a sheet`,
      TAG_STYLES[safeSettings.tagStyle].label.toLowerCase(),
      TYPEFACE_LABELS[safeSettings.tagNameFont].toLowerCase(),
      `${safeSettings.tagNamePt}pt names`,
      safeSettings.tagLine.trim() !== "" && "a line underneath",
    ],
    "",
  );

  const cardSummary = listOr(
    [
      safeSettings.showPhotos && "photographs",
      safeSettings.showMembers && "members' names",
      safeSettings.showAddress && "address",
      safeSettings.showPhone && "phone",
      safeSettings.showEmail && "email",
      safeSettings.showBirthdays && "birthdays",
      safeSettings.showAnniversary && "anniversaries",
    ],
    "names only",
  );

  const bookSummary = listOr(
    [
      safeSettings.includeIndex && "index",
      safeSettings.runningHeader && "running header",
      safeSettings.showLetterTabs && "letter tabs",
      safeSettings.showPageNumbers && "page numbers",
      safeSettings.footerText.trim() !== "" && "footer note",
    ],
    "nothing extra",
  );

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
      setChanged({ at: loaded.project.updated_at, by: loaded.project.updated_by ?? null });
      setStale(false);
      setError(null);
    } catch (cause) {
      setError(message(cause));
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
      /*
       * Upload before deleting, and delete after writing the row - never any
       * other way round. This runs on a phone on church wifi, so removing
       * first meant a failed upload took the existing artwork with it; and the
       * write below is allowed to fail by design, because a stale write is an
       * outcome this screen has a whole button for, so removing before it meant
       * a conflict destroyed the cover and left the directory pointing at it.
       */
      const discard: string[] = [];
      const settle = async (current: string, blob: Blob | null | undefined, gone?: boolean) => {
        if (blob) {
          const replaced = gone ? "" : current;
          const path = await uploadPhoto("covers", blob);
          if (replaced) discard.push(replaced);
          return path;
        }
        if (gone && current) {
          discard.push(current);
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
      for (const path of discard) await removePhoto(path);

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
      setChanged({ at: project.updated_at, by: project.updated_by ?? null });
      setStale(false);
      setSavedAt(Date.now());
      if (!id) navigate(`/projects/${project.id}`, { replace: true });
    } catch (cause) {
      setStale(isStaleWrite(cause));
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page form desk-page">
      <div className="page-head">
        <div className="grow">
          <Link className="btn ghost small page-back" to="/projects">
            ← Back to directories
          </Link>
          <h1>{isNew ? "New directory" : name}</h1>
          <div className="sub">
            {included.length} record{included.length === 1 ? "" : "s"} ·{" "}
            {recordsPerSheet(safeSettings)} to a sheet · about {sheets} sheet
            {sheets === 1 ? "" : "s"} of paper
          </div>
          {changed ? <ChangedNote updatedAt={changed.at} author={authorName(changed.by)} /> : null}
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
      {savedAt ? <Notice kind="ok">Saved.</Notice> : null}

      <form onSubmit={save}>
        {/* Everything that sets the book on the left, the book itself on the
            right. The settings scroll inside their own column and the drawing
            stays where it is - which is the whole point of drawing it here,
            since every field on this form is described in words ("the big
            line", "the foot of the cover") and words are a poor way to know
            whether a title has come out too long for its own page.

            The three panels that open are kept together and kept last: opening
            one then only lengthens the column below what has already been
            read, rather than moving anything beside it.

            On a phone the two stack and the cover leads: the stylesheet lifts
            it, so that a form this long does not have to be scrolled past to
            reach the picture of what it is making. */}
        <div className="desk">
          <div className="desk-settings">
            {/* Said once, on the head, rather than under all three fields:
                none of them prints, and the cover's own title is a field of
                its own further down. */}
            <section className="card" aria-labelledby="book-details">
              <div className="card-head column">
                <h2 id="book-details">Details</h2>
                <span className="muted small">For your list of directories, not for the book</span>
              </div>
              <div className="card-body">
                <div className="grid two">
                  <Field label="Name" htmlFor="project_name">
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
                      <option value="event">Event directory</option>
                    </select>
                  </Field>
                </div>

                <Field label="Description" hint="Optional." htmlFor="project_description">
                  <textarea
                    id="project_description"
                    rows={2}
                    value={description}
                    disabled={!canEdit}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="card" aria-labelledby="book-people">
              <div className="card-head">
                <h2 id="book-people">People</h2>
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

                    {/* The pills above run right up to this label without it.

                        What each choice does is said in the option itself
                        rather than in a paragraph under the box: the answer is
                        the part worth reading, and it was three sentences. */}
                    <div style={{ marginTop: 14 }}>
                      <Field
                        label="Who prints"
                        htmlFor="group_scope"
                        hint="Groups stay live: anyone added to one prints next time."
                      >
                        <select
                          id="group_scope"
                          value={settings.groupWholeFamily ? "family" : "person"}
                          disabled={!canEdit}
                          onChange={(event) =>
                            set({ groupWholeFamily: event.target.value === "family" })
                          }
                        >
                          <option value="family">The whole family of anyone in a group</option>
                          <option value="person">
                            Only the people in the groups, one record each
                          </option>
                        </select>
                      </Field>
                    </div>
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
            </section>

            <section className="card" aria-labelledby="book-cover">
              <div className="card-head">
                <h2 id="book-cover">Cover</h2>
              </div>
              {/* In the order it prints, top of the cover to the bottom, so
                  filling the form in reads down the page it makes. The one
                  thing out of that order is the switch that decides whether
                  any of it prints at all, which leads. */}
              <div className="card-body">
                <Checkbox
                  label="Print a cover page"
                  hint="Off starts the book at the first record."
                  checked={settings.includeCover}
                  disabled={!canEdit}
                  onChange={(value) => set({ includeCover: value })}
                />

                {/* A row each rather than a pair of columns: the wide slot
                    for the photograph and the square one for the logo are
                    different widths, so side by side one of them wrapped its
                    button under its picture and the other did not.

                    One hint apiece: PhotoInput carries its own, so a hint on
                    the Field as well just stacks two paragraphs under every
                    picture. They end without a full stop because the component
                    adds one after the size of the picture chosen. */}
                <div className="form-decision">
                  <Field label="Logo">
                    <PhotoInput
                      path={coverRemoved.logo ? null : settings.coverLogoPath || null}
                      initials=""
                      shape="square"
                      hint="At the very top, any shape — fitted whole, never cropped"
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
                      hint="Under the title — the building, or the sign. Landscape prints best"
                      disabled={!canEdit}
                      onChange={(blob, removed) => {
                        setCoverBlobs((current) => ({ ...current, photo: blob }));
                        setCoverRemoved((current) => ({ ...current, photo: removed }));
                      }}
                    />
                  </Field>
                </div>

                {/* The church's name is the width of the card and the two
                    short lines share a row: three across came out as two and
                    an orphan in a column this wide, and the name is the
                    longest of the three anyway. */}
                <Field
                  label="Church name"
                  hint="Above the title, and along the top of every page inside."
                  htmlFor="church_name"
                >
                  <input
                    id="church_name"
                    type="text"
                    value={settings.churchName}
                    placeholder="Fairhaven Community Church"
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

                {/* The two paragraphs, which want the room the short
                    lines above do not. */}
                <div className="grid two">
                  <Field
                    label="Mission or welcome"
                    hint="Its own paragraph, under the photograph."
                    htmlFor="cover_statement"
                  >
                    <textarea
                      id="cover_statement"
                      rows={5}
                      value={settings.coverStatement}
                      placeholder={
                        "OUR MISSION\nTo worship together, serve our community, and welcome everyone."
                      }
                      disabled={!canEdit}
                      onChange={(event) => set({ coverStatement: event.target.value })}
                    />
                  </Field>

                  <Field
                    label="Contact details"
                    hint="The foot of the cover, line for line."
                    htmlFor="cover_contact"
                  >
                    <textarea
                      id="cover_contact"
                      rows={5}
                      value={settings.coverContact}
                      placeholder={
                        "123 Main Street\nPO Box 100\nFairhaven, OH 44092\n(216) 555-0142\noffice@example.org"
                      }
                      disabled={!canEdit}
                      onChange={(event) => set({ coverContact: event.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </section>

            {/* Name tags are set under Name tags, not here.

                They were a panel on this form, which meant the one screen in
                the app that is only ever opened to print badges sent you to
                the book's form to change how a badge looks - past the cover,
                the index and the page count, none of which a tag has. The
                settings live on this same row either way, so what is left here
                is what they currently come to and the way over. */}
            {!isNew && id ? (
              <section className="card" aria-labelledby="book-tags">
                <div className="card-head column">
                  <h2 id="book-tags">Name tags</h2>
                  <span className="muted small">
                    One each for everyone in this directory, set under Name tags
                  </span>
                </div>
                <div className="card-body">
                  <p className="muted small">{tagSummary}</p>
                  <Link className="btn" to={`/tags/${id}`}>
                    Set up name tags
                  </Link>
                </div>
              </section>
            ) : null}

            <Disclosure title="Page setup" summary={pageSummary}>
              {/* Named for both of the things it sets. A book of half-pages is
                  printed on landscape paper whichever size is picked, and
                  "Paper" alone left that to be discovered in the options. */}
              <Field label="Paper &amp; orientation" htmlFor="page_size">
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
                <strong>{recordsPerSheet(safeSettings)} to a sheet</strong> — {safeSettings.rows}{" "}
                down each half, {safeSettings.columns} across. Folded down the middle, that is a{" "}
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
                  <option value="mono">Typewriter — every letter the same width</option>
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
                hint="Reorders the pages to fold and staple. Off prints straight through."
                checked={settings.bookletOrder}
                disabled={!canEdit || settings.columns !== 2}
                onChange={(value) => set({ bookletOrder: value })}
              />
            </Disclosure>

            <Disclosure title="Each record" summary={cardSummary}>
              <Checkbox
                label="Photographs"
                checked={settings.showPhotos}
                disabled={!canEdit}
                onChange={(value) => set({ showPhotos: value })}
              />
              {settings.showPhotos ? (
                <div className="check-child">
                  <Field
                    label="Shape"
                    hint="Cropping keeps every record the same shape. A family or person can be set otherwise beside their own photo."
                    htmlFor="photo_fit"
                  >
                    <select
                      id="photo_fit"
                      value={settings.photoFit}
                      disabled={!canEdit}
                      onChange={(event) => set({ photoFit: event.target.value as "fill" | "fit" })}
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
                  <Field label="Listed as" htmlFor="member_style">
                    <select
                      id="member_style"
                      value={settings.memberStyle}
                      disabled={!canEdit}
                      onChange={(event) =>
                        set({ memberStyle: event.target.value as "compact" | "detailed" })
                      }
                    >
                      <option value="compact">One line of first names</option>
                      <option value="detailed">A line each, with their own contact details</option>
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
                <Field label="Separator" htmlFor="card_style">
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
            </Disclosure>

            {/* In the order the summary reads them, and the typed field
                last: four things that are on or off, then the one line
                somebody has to write. */}
            <Disclosure title="Inside the book" summary={bookSummary}>
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

              <div className="form-decision">
                <Field
                  label="Footer note"
                  hint="Along the bottom of every page. Leave empty for none."
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
              </div>
            </Disclosure>

            {canEdit ? (
              /* Preview & print is not repeated here - it is in the head,
                 and a screen with two of the same button has one of them too
                 many. */
              <div className="row" style={{ marginTop: 18 }}>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving…" : isNew ? "Create directory" : "Save changes"}
                </button>
                <Link className="btn ghost" to="/projects">
                  Cancel
                </Link>
              </div>
            ) : (
              <Notice kind="warn">
                You have read-only access. You can still preview and print.
              </Notice>
            )}

            {/* Deleting is not one of the ways to leave this page, so it does
                not sit in the row that saves and goes back. */}
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
          </div>

          <div className="desk-stage">
            <section className="card" aria-labelledby="book-preview">
              <div className="card-head">
                <h2 id="book-preview">Cover preview</h2>
              </div>
              <div className="card-body">
                {coverPage ? (
                  <figure className="cover-figure">
                    <CoverCanvas
                      page={coverPage.page}
                      width={coverPage.width}
                      height={coverPage.height}
                      photoUrls={coverUrls}
                      typeface={coverPage.typeface}
                      editable={editableCover}
                      movable={movableCover}
                    />
                    {/* Two facts rather than a sentence: which paper, and the
                        face it is set in. That it redraws as you type is
                        something the drawing itself says. */}
                    <figcaption className="hint">
                      {paperName(safeSettings.pageSize)} landscape ·{" "}
                      {TYPEFACE_LABELS[safeSettings.typeface].toLowerCase()}
                      {canEdit ? (
                        <span className="tag-figure-tip">
                          Click a line to change its words, or drag it to move it — on a phone, hold
                          it a moment first. Pictures move the same way, and a picture's corner
                          makes it bigger. The handle beside a part moves it too, and answers the
                          arrow keys.
                        </span>
                      ) : null}
                      {canEdit && moved.length ? (
                        <span className="tag-figure-tip cover-moved">
                          <span>
                            Moved: {moved.map((part) => COVER_PART_LABELS[part]).join(", ")}.
                          </span>
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => set({ coverPlacements: {} })}
                          >
                            Put it all back
                          </button>
                        </span>
                      ) : null}
                    </figcaption>
                  </figure>
                ) : safeSettings.includeCover ? (
                  <p className="hint cover-figure">Drawing the cover…</p>
                ) : (
                  <p className="hint cover-figure">No cover page. Turn one on under Cover.</p>
                )}
              </div>
            </section>
          </div>
        </div>
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
      <div className="toolbar picker-toolbar">
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

      <div className="picker-list">
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
