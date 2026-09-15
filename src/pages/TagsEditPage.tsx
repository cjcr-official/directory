import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { ChangedNote, Checkbox, Field, LoadingScreen, Notice } from "@/components/ui";
import { CoverCanvas } from "@/components/BookPreview";
import { PhotoInput } from "@/components/PhotoInput";
import { fetchProject, isStaleWrite, updateProject } from "@/lib/queries";
import { getPhotoUrls, removePhoto, uploadPhoto } from "@/lib/photos";
import { resolveEntries } from "@/lib/projectEntries";
import { bandContrast, composeTagPreview, tagsPerSheet } from "@/lib/layout/tags";
import { TYPEFACES, TYPEFACE_LABELS, loadMetrics, type Metrics } from "@/lib/layout/metrics";
import {
  PAGE_SIZES,
  TAG_ACCENTS,
  TAG_SIZES,
  TAG_STYLES,
  normalizeSettings,
  type PageSizeName,
  type ProjectSettings,
  type TagHeadingSize,
  type TagLogoSize,
  type TagSizeName,
  type TagStyle,
  type Typeface,
} from "@/lib/layout/settings";
import { firstName, message } from "@/lib/format";
import type { ProjectEntryRow, ProjectRow, SelectionMode } from "@/lib/database.types";

/*
 * Stand-in path for a mark chosen but not yet uploaded. The composer draws a
 * picture by its storage path and a Blob picked a second ago has none, so this
 * carries it as far as the canvas; Save uploads the Blob and writes the real
 * path. Prefixed so it cannot collide with anything storage hands back.
 */
const PENDING_LOGO = "pending:cover-logo";

/**
 * Name tags, set where name tags live.
 *
 * Everything on this screen is stored on the directory, because a tag is one of
 * the two ways a directory prints and there is no second list of people to keep
 * in step. But none of that is a reason to make somebody open the book's own
 * form - with its cover, its page count and its index - to move a badge's
 * heading down a size. So the tag settings are read and written here, and the
 * directory's page keeps a line saying what they come to and a way over.
 *
 * Only the fields a tag actually prints are offered. The rest of the settings
 * are loaded, held and written back as they were found, and the save is guarded
 * on the version this form opened on - so this screen cannot restyle the book,
 * and cannot quietly put back a book setting somebody else changed meanwhile.
 */
export function TagsEditPage() {
  const { id } = useParams();
  const { canEdit } = useAuth();
  const { entries, authorName } = useDirectory();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  /** Who the directory prints, kept as loaded so the count and the drawn name are the real ones. */
  const [selection, setSelection] = useState<{
    mode: SelectionMode;
    tagIds: string[];
    entries: ProjectEntryRow[];
  } | null>(null);

  const [logoBlob, setLogoBlob] = useState<Blob | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** The version this form opened on, as a fingerprint for the save. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [changed, setChanged] = useState<{ at: string; by: string | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setSettings(null);
    fetchProject(id)
      .then((loaded) => {
        if (!active) return;
        setProject(loaded.project);
        setSettings(normalizeSettings(loaded.project.settings));
        setSelection({
          mode: loaded.project.selection_mode,
          tagIds: loaded.tagIds,
          entries: loaded.entries,
        });
        setOpenedAt(loaded.project.updated_at);
        setChanged({ at: loaded.project.updated_at, by: loaded.project.updated_by ?? null });
        setStale(false);
      })
      .catch((cause) => active && setError(message(cause)));
    return () => {
      active = false;
    };
  }, [id]);

  const safeSettings = useMemo(() => (settings ? normalizeSettings(settings) : null), [settings]);

  /**
   * One tag per person: a household prints its members, not one between them.
   * The same rule composeTags uses, so the count here is the count that prints.
   */
  const people = useMemo(() => {
    if (!selection || !safeSettings) return [];
    const included = resolveEntries(entries, {
      mode: selection.mode,
      tagIds: selection.tagIds,
      entries: selection.entries,
      wholeFamily: safeSettings.groupWholeFamily,
    });
    return included.flatMap((entry) =>
      entry.type === "household" ? entry.household.members : [entry.person],
    );
  }, [entries, selection, safeSettings]);

  /**
   * Font metrics, so the drawing breaks a name where the PDF will break it. A
   * tag can be set in two faces at once; the loaded metrics measure any of
   * them, and the name's is the one worth defaulting to.
   */
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const nameFont = safeSettings?.tagNameFont ?? "sans";
  useEffect(() => {
    let active = true;
    void loadMetrics(nameFont).then((loaded) => {
      if (active) setMetrics(loaded);
    });
    return () => {
      active = false;
    };
  }, [nameFont]);

  const pendingLogoUrl = useMemo(
    () => (logoBlob ? URL.createObjectURL(logoBlob) : null),
    [logoBlob],
  );
  useEffect(
    () => () => {
      if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    },
    [pendingLogoUrl],
  );

  /** The settings as they would print this second, mark and all. */
  const drawnSettings = useMemo(() => {
    if (!safeSettings) return null;
    return {
      ...safeSettings,
      coverLogoPath: logoRemoved ? "" : logoBlob ? PENDING_LOGO : safeSettings.coverLogoPath,
    };
  }, [safeSettings, logoBlob, logoRemoved]);

  // The saved mark, fetched once per path rather than per keystroke.
  const [savedLogoUrl, setSavedLogoUrl] = useState<Map<string, string>>(new Map());
  const storedLogoPath = safeSettings?.coverLogoPath ?? "";
  useEffect(() => {
    if (!storedLogoPath) return;
    let active = true;
    void getPhotoUrls([storedLogoPath]).then((urls) => {
      if (active) setSavedLogoUrl(urls);
    });
    return () => {
      active = false;
    };
  }, [storedLogoPath]);

  const logoUrls = useMemo(() => {
    const urls = new Map(savedLogoUrl);
    if (pendingLogoUrl) urls.set(PENDING_LOGO, pendingLogoUrl);
    return urls;
  }, [savedLogoUrl, pendingLogoUrl]);

  /**
   * One tag, drawn on somebody the directory actually prints.
   *
   * The first thing anyone checks is whether their own name fits, and the
   * longest name in the congregation is what decides how big every tag in the
   * run is set.
   */
  const tagPreview = useMemo(() => {
    if (!metrics || !drawnSettings) return null;
    const person = people[0];
    const name = person ? `${firstName(person)} ${person.last_name}`.trim() : "";
    return composeTagPreview(drawnSettings, metrics, name || "Madison Johnston");
  }, [metrics, drawnSettings, people]);

  if (!settings || !safeSettings || !project) {
    if (error) {
      return (
        <div className="page">
          <Notice kind="error">{error}</Notice>
          <p style={{ marginTop: 12 }}>
            <Link className="btn" to="/tags">
              Back to name tags
            </Link>
          </p>
        </div>
      );
    }
    return <LoadingScreen label="Loading name tags…" />;
  }

  const perSheet = tagsPerSheet(safeSettings);
  const sheets = Math.ceil(people.length / perSheet);
  const hasLogo = Boolean(logoRemoved ? false : logoBlob || safeSettings.coverLogoPath);

  /*
   * Whether the band could carry the church's name at all.
   *
   * Only white and the app's ink are available to reverse out of it, and a
   * mid-tone is too dark for one and too pale for the other - the composer takes
   * the better of the two, and on some colours the better of the two is still
   * not good. Nothing can fix that but a different colour, so it is said here
   * rather than quietly printed.
   */
  const paleBand = safeSettings.tagStyle === "banner" && bandContrast(safeSettings.tagAccent) < 4.5;

  function set(patch: Partial<ProjectSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    await store(false);
  }

  /**
   * Throws this browser's changes away and shows the tags as somebody else left
   * them. Reading the directory again is what makes the form honest - the
   * values on screen were chosen against a version that is no longer current.
   */
  async function discardMine() {
    if (!id) return;
    setSaving(true);
    try {
      const loaded = await fetchProject(id);
      setProject(loaded.project);
      setSettings(normalizeSettings(loaded.project.settings));
      setSelection({
        mode: loaded.project.selection_mode,
        tagIds: loaded.tagIds,
        entries: loaded.entries,
      });
      setLogoBlob(null);
      setLogoRemoved(false);
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
   * Writes the directory back, tag settings and all.
   *
   * `force` drops the check that it has not moved since this form opened - only
   * reached from the button offered when it has, so overwriting somebody is a
   * decision rather than an accident. That guard is also what keeps this screen
   * honest about the settings it does not show: it writes the whole row, so it
   * has to refuse when the book half of it has changed underneath.
   */
  async function store(force: boolean) {
    if (!canEdit || !id || !safeSettings) return;
    setSaving(true);
    setError(null);
    try {
      // Upload before deleting, never the other way round: this runs on a phone
      // on church wifi, and removing first would mean a failed upload took the
      // existing mark with it.
      const current = safeSettings.coverLogoPath;
      let coverLogoPath = current;
      if (logoBlob) {
        coverLogoPath = await uploadPhoto("covers", logoBlob);
        if (current) await removePhoto(current);
      } else if (logoRemoved && current) {
        await removePhoto(current);
        coverLogoPath = "";
      }

      const saved = { ...safeSettings, coverLogoPath };
      const written = await updateProject(
        id,
        { settings: saved as unknown as Record<string, unknown> },
        force ? null : openedAt,
      );

      setSettings(saved);
      setLogoBlob(null);
      setLogoRemoved(false);
      setProject(written);
      setOpenedAt(written.updated_at);
      setChanged({ at: written.updated_at, by: written.updated_by ?? null });
      setStale(false);
      setSavedAt(Date.now());
    } catch (cause) {
      setStale(isStaleWrite(cause));
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page form">
      <div className="page-head">
        <div className="grow">
          <h1>{project.name}</h1>
          <div className="sub">
            {people.length} name tag{people.length === 1 ? "" : "s"} · {perSheet} to a sheet · about{" "}
            {sheets} sheet{sheets === 1 ? "" : "s"} of paper
          </div>
          {changed ? <ChangedNote updatedAt={changed.at} author={authorName(changed.by)} /> : null}
        </div>
        <div className="row tight">
          <Link className="btn" to={`/projects/${project.id}/tags`}>
            Preview &amp; print
          </Link>
          {canEdit ? (
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
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
      {savedAt ? <Notice kind="ok">Saved. Open the preview to see the sheet.</Notice> : null}

      <form onSubmit={save}>
        {/* Down the tag, in the order it is read: the rectangle itself, then
            what is above the name, then the name and the line under it, then
            the paper it is all cut out of. Two columns on a desk, one on a
            phone, and the same order either way - which is also why the drawing
            has the first column to itself. It is the tallest thing here, and
            the three cards of words beside it come to about its height. */}
        <div className="grid two" style={{ marginTop: 16 }}>
          <div>
            <div className="card">
              <div className="card-head">
                <h2>The tag</h2>
              </div>
              <div className="card-body">
                {tagPreview ? (
                  <figure className="tag-figure">
                    <CoverCanvas
                      page={tagPreview.page}
                      width={tagPreview.width}
                      height={tagPreview.height}
                      photoUrls={logoUrls}
                      typeface={tagPreview.typeface}
                      maxHeight={260}
                    />
                    <figcaption className="hint">
                      {TAG_SIZES[safeSettings.tagSize].label}, at the size it prints
                      {people.length ? ", on somebody this directory actually prints" : ""}. Redraws
                      as you change anything below.
                    </figcaption>
                  </figure>
                ) : (
                  <p className="hint tag-figure">Drawing the tag…</p>
                )}

                <Field
                  label="Size"
                  hint="Match the holders you have. As many as fit go on a sheet, centred, to be cut apart."
                  htmlFor="tag_size"
                >
                  <select
                    id="tag_size"
                    value={settings.tagSize}
                    disabled={!canEdit}
                    onChange={(event) => set({ tagSize: event.target.value as TagSizeName })}
                  >
                    {(Object.keys(TAG_SIZES) as TagSizeName[]).map((key) => (
                      <option key={key} value={key}>
                        {TAG_SIZES[key].label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Style"
                  htmlFor="tag_style"
                  hint={TAG_STYLES[safeSettings.tagStyle].hint}
                >
                  <select
                    id="tag_style"
                    value={settings.tagStyle}
                    disabled={!canEdit}
                    onChange={(event) => set({ tagStyle: event.target.value as TagStyle })}
                  >
                    {(Object.keys(TAG_STYLES) as TagStyle[]).map((key) => (
                      <option key={key} value={key}>
                        {TAG_STYLES[key].label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Colour"
                  htmlFor="tag_accent"
                  hint={paleBand ? undefined : "The band, the rule and the line under the name."}
                >
                  <div className="colour-field">
                    <input
                      id="tag_accent"
                      type="color"
                      value={safeSettings.tagAccent}
                      disabled={!canEdit}
                      onChange={(event) => set({ tagAccent: event.target.value })}
                    />
                    {TAG_ACCENTS.map((accent) => (
                      <button
                        key={accent.value}
                        type="button"
                        className={`swatch${safeSettings.tagAccent === accent.value ? " on" : ""}`}
                        style={{ background: accent.value }}
                        title={accent.label}
                        aria-label={accent.label}
                        aria-pressed={safeSettings.tagAccent === accent.value}
                        disabled={!canEdit}
                        onClick={() => set({ tagAccent: accent.value })}
                      />
                    ))}
                  </div>
                  {paleBand ? (
                    <span className="hint warn-hint">
                      Neither white nor black reads well on this colour, so the church's name on the
                      band will be hard to make out. A darker or paler one fixes it — or use the
                      Classic style, which prints on the paper instead.
                    </span>
                  ) : null}
                </Field>

                {safeSettings.tagStyle === "classic" ? (
                  <Checkbox
                    label="A line under the heading"
                    hint="A hairline in the colour above, between the church's name and the person's. Most printed badges have none."
                    checked={settings.tagHeadRule}
                    disabled={!canEdit}
                    onChange={(value) => set({ tagHeadRule: value })}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="card-head">
                <h2>Above the name</h2>
              </div>
              <div className="card-body">
                {/* The mark and the church's name are the book's as well. Said
                    plainly here rather than discovered later: somebody who
                    retypes the church's name on a tag has retyped it on the
                    cover and along the top of every page inside. */}
                <Notice>
                  These two are the book's as well — a directory and its tags carry the same mark
                  and the same name.
                </Notice>

                <Field
                  label="Church name"
                  hint="Above the name on every tag, and on the book's cover."
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

                <Field label="The mark">
                  <PhotoInput
                    path={logoRemoved ? null : settings.coverLogoPath || null}
                    initials=""
                    shape="square"
                    hint="Any shape — fitted whole, never cropped. It prints at the top of the tag, and at the top of the cover"
                    disabled={!canEdit}
                    onChange={(blob, removed) => {
                      setLogoBlob(blob);
                      setLogoRemoved(removed);
                    }}
                  />
                </Field>

                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field
                    label="The church's name"
                    htmlFor="tag_heading_size"
                    hint="How big it prints above the name."
                  >
                    <select
                      id="tag_heading_size"
                      value={settings.tagHeadingSize}
                      disabled={!canEdit || settings.tagStyle === "plain"}
                      onChange={(event) =>
                        set({ tagHeadingSize: event.target.value as TagHeadingSize })
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </Field>

                  <Field
                    label="The mark's size"
                    htmlFor="tag_logo_size"
                    hint={
                      safeSettings.tagStyle === "plain"
                        ? "Just the name prints no mark."
                        : hasLogo
                          ? "As a share of the tag's height."
                          : "Add a mark above to use this."
                    }
                  >
                    <select
                      id="tag_logo_size"
                      value={settings.tagLogoSize}
                      disabled={!canEdit || settings.tagStyle === "plain"}
                      onChange={(event) => set({ tagLogoSize: event.target.value as TagLogoSize })}
                    >
                      <option value="none">No mark</option>
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>The name and the line under it</h2>
              </div>
              <div className="card-body">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="The name" htmlFor="tag_name_font">
                    <select
                      id="tag_name_font"
                      value={settings.tagNameFont}
                      disabled={!canEdit}
                      onChange={(event) => set({ tagNameFont: event.target.value as Typeface })}
                    >
                      {TYPEFACES.map((face) => (
                        <option key={face} value={face}>
                          {TYPEFACE_LABELS[face]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="The small print" htmlFor="tag_small_font">
                    <select
                      id="tag_small_font"
                      value={settings.tagSmallFont}
                      disabled={!canEdit}
                      onChange={(event) => set({ tagSmallFont: event.target.value as Typeface })}
                    >
                      {TYPEFACES.map((face) => (
                        <option key={face} value={face}>
                          {TYPEFACE_LABELS[face]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {/* Spaced like the field it explains: a p.hint has no bottom
                    margin of its own, and the label of the next field was
                    landing on the last line of this one. */}
                <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
                  The name is set in the first, the church's name and the line underneath in the
                  second. Sans serif is the one to beat across a hall; a serif church name over a
                  sans serif name is the printed-badge look. Neither has anything to do with the
                  face the book is set in.
                </p>

                <Field
                  label="The line underneath"
                  hint="Printed small under the name. Leave it empty for none."
                  htmlFor="tag_line"
                >
                  <input
                    id="tag_line"
                    type="text"
                    value={settings.tagLine}
                    placeholder="We are a Christ-centered Acts 1:8 Family"
                    disabled={!canEdit}
                    onChange={(event) => set({ tagLine: event.target.value })}
                  />
                </Field>

                <p className="hint">
                  A long name breaks over two lines and shrinks until it fits, so every tag in a run
                  is cut to the same size whatever the name on it. A colour too pale to read is
                  darkened for the small print, so the band keeps the colour you picked and the
                  words on the paper stay legible.
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>The paper</h2>
              </div>
              <div className="card-body">
                <Field
                  label="Paper"
                  hint="The same sheet the book prints on — tags simply use it portrait."
                  htmlFor="page_size"
                >
                  <select
                    id="page_size"
                    value={settings.pageSize}
                    disabled={!canEdit}
                    onChange={(event) => set({ pageSize: event.target.value as PageSizeName })}
                  >
                    {(Object.keys(PAGE_SIZES) as PageSizeName[]).map((key) => (
                      <option key={key} value={key}>
                        {PAGE_SIZES[key].label.replace(/\s*\(.*\)$/, "")} portrait
                      </option>
                    ))}
                  </select>
                </Field>

                <Notice>
                  <strong>
                    {perSheet} tag{perSheet === 1 ? "" : "s"} on one sheet of paper
                  </strong>{" "}
                  — centred, with a pale line round each one to cut along. Print on card if you have
                  it; ordinary paper curls inside a holder.
                </Notice>
              </div>
            </div>
          </div>
        </div>

        {canEdit ? (
          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <Link className="btn" to={`/projects/${project.id}/tags`}>
              Preview &amp; print
            </Link>
            <Link className="btn ghost" to="/tags">
              Back
            </Link>
          </div>
        ) : (
          <Notice kind="warn">You have read-only access. You can still preview and print.</Notice>
        )}

        {/* Who is in the directory is the directory's own question - the same
            list prints as a book - so it is asked once, there, and pointed at
            from here rather than answered twice. */}
        <div className="form-decision">
          <p className="hint" style={{ marginBottom: 0 }}>
            Everybody in <strong>{project.name}</strong> gets a tag. To change who that is, edit{" "}
            <Link to={`/projects/${project.id}`}>the directory</Link>.
          </p>
        </div>
      </form>
    </div>
  );
}
