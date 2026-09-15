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
import { bandContrast, composeTagPreview, planTag, tagsPerSheet } from "@/lib/layout/tags";
import { TYPEFACES, TYPEFACE_LABELS, loadMetrics, type Metrics } from "@/lib/layout/metrics";
import {
  PAGE_SIZES,
  TAG_ACCENTS,
  TAG_PT_MAX,
  TAG_PT_MIN,
  TAG_PT_STEPS,
  TAG_SIZES,
  TAG_STYLES,
  normalizeSettings,
  type PageSizeName,
  type ProjectSettings,
  type TagLogoSize,
  type TagSizeName,
  type TagStyle,
  type Typeface,
} from "@/lib/layout/settings";
import { firstName, message } from "@/lib/format";
import type { ProjectEntryRow, ProjectRow, SelectionMode } from "@/lib/database.types";

/*
 * Stand-in path for a logo chosen but not yet uploaded. The composer draws a
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

  /** The settings as they would print this second, logo and all. */
  const drawnSettings = useMemo(() => {
    if (!safeSettings) return null;
    return {
      ...safeSettings,
      coverLogoPath: logoRemoved ? "" : logoBlob ? PENDING_LOGO : safeSettings.coverLogoPath,
    };
  }, [safeSettings, logoBlob, logoRemoved]);

  // The saved logo, fetched once per path rather than per keystroke.
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
  const previewName = useMemo(() => {
    const person = people[0];
    const name = person ? `${firstName(person)} ${person.last_name}`.trim() : "";
    return name || "Madison Johnston";
  }, [people]);

  const tagPreview = useMemo(
    () =>
      metrics && drawnSettings ? composeTagPreview(drawnSettings, metrics, previewName) : null,
    [metrics, drawnSettings, previewName],
  );

  /**
   * What the drawn name actually came out at, in points.
   *
   * The number in the box is the size when the name fits at it and the most it
   * will be set when it does not, so the one thing worth saying back is which
   * of those just happened. Found by where the run sits rather than by what it
   * says: a church name long enough to be shrunk is also long enough to be cut
   * short, and then it no longer matches the field that set it.
   */
  const drawnNamePt = useMemo(() => {
    if (!tagPreview || !drawnSettings || !metrics) return null;
    const plan = planTag(drawnSettings, metrics);
    const run = tagPreview.page.cards[0]?.runs.find(
      (candidate) => candidate.y >= plan.nameTop - 0.5 && candidate.y < plan.nameBottom,
    );
    return run ? run.size : null;
  }, [tagPreview, drawnSettings, metrics]);

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
  /*
   * What the box did, said back.
   *
   * A size is a promise this app keeps until it cannot: the name is stepped
   * down when it would otherwise run off the card. That is worth knowing at the
   * moment it happens rather than at the guillotine, and it is the one thing
   * the drawing above cannot say on its own - a tag that reads well gives no
   * sign that it was asked for something larger.
   */
  const askedNamePt = safeSettings.tagNamePt;
  const shrunk = drawnNamePt !== null && drawnNamePt < askedNamePt - 0.01;
  const nameSizeHint = shrunk
    ? `Shrunk to ${drawnNamePt}pt — ${previewName} does not fit at ${askedNamePt}pt.`
    : "Longer names shrink to fit.";
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
      // existing logo with it.
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
    <div className="page form desk-page">
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
      {savedAt ? <Notice kind="ok">Saved.</Notice> : null}

      <form onSubmit={save}>
        {/* Offered by all three boxes. Once per page rather than once per box:
            it is the same ladder every time, and three copies of it would be
            three copies of it in the DOM. */}
        <datalist id="tag-pt-steps">
          {TAG_PT_STEPS.map((pt) => (
            <option key={pt} value={pt} />
          ))}
        </datalist>

        {/* The settings on the left, the tag itself on the right, and down
            the tag in the order it prints: the card, then its header, its
            name, the line under it, and the paper it is cut out of.

            The settings scroll inside their own column and the drawing stays
            where it is. Every setting here is a question the drawing answers -
            is that name still readable, does the church name still fit beside
            the logo - and answering it should not mean scrolling back up. On
            a phone the two stack and the drawing leads. */}
        <div className="desk">
          <div className="desk-settings">
            <section className="card" aria-labelledby="tags-tag">
              <div className="card-head">
                <h2 id="tags-tag">Tag</h2>
              </div>
              <div className="card-body">
                <Field label="Size" htmlFor="tag_size" hint="Match your badge holders.">
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
                  label="Accent colour"
                  htmlFor="tag_accent"
                  hint={paleBand ? undefined : "Band, rules and footer line."}
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
                  {/* Only when it is true, and then in one line: the long
                      version of this was three, and the fix is a colour. */}
                  {paleBand ? (
                    <span className="hint warn-hint">
                      Too mid-toned to read the church name on. Pick darker or paler.
                    </span>
                  ) : null}
                </Field>
              </div>
            </section>

            <section className="card" aria-labelledby="tags-header">
              {/* The one thing on this screen that reaches past it, said once
                  here rather than twice under the two fields it applies to. */}
              <div className="card-head column">
                <h2 id="tags-header">Header</h2>
                <span className="muted small">Shared with the book&rsquo;s cover</span>
              </div>
              <div className="card-body">
                <Field label="Church name" htmlFor="church_name">
                  <input
                    id="church_name"
                    type="text"
                    value={settings.churchName}
                    placeholder="Fairhaven Community Church"
                    disabled={!canEdit}
                    onChange={(event) => set({ churchName: event.target.value })}
                  />
                </Field>

                <Field label="Logo">
                  <PhotoInput
                    path={logoRemoved ? null : settings.coverLogoPath || null}
                    initials=""
                    shape="square"
                    hint="Any shape, fitted whole"
                    disabled={!canEdit}
                    onChange={(blob, removed) => {
                      setLogoBlob(blob);
                      setLogoRemoved(removed);
                    }}
                  />
                </Field>

                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Church name size" htmlFor="tag_heading_pt">
                    <PointSize
                      id="tag_heading_pt"
                      value={settings.tagHeadingPt}
                      disabled={!canEdit || settings.tagStyle === "plain"}
                      onChange={(pt) => set({ tagHeadingPt: pt })}
                    />
                  </Field>

                  <Field
                    label="Logo size"
                    htmlFor="tag_logo_size"
                    hint={hasLogo || safeSettings.tagStyle === "plain" ? undefined : "Add a logo."}
                  >
                    <select
                      id="tag_logo_size"
                      value={settings.tagLogoSize}
                      disabled={!canEdit || settings.tagStyle === "plain"}
                      onChange={(event) => set({ tagLogoSize: event.target.value as TagLogoSize })}
                    >
                      <option value="none">None</option>
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </Field>
                </div>

                <Field
                  label="Small print font"
                  htmlFor="tag_small_font"
                  hint="Church name and footer line."
                >
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

                {safeSettings.tagStyle === "classic" ? (
                  <Checkbox
                    label="Rule under the header"
                    checked={settings.tagHeadRule}
                    disabled={!canEdit}
                    onChange={(value) => set({ tagHeadRule: value })}
                  />
                ) : null}
              </div>
            </section>

            <section className="card" aria-labelledby="tags-name">
              <div className="card-head">
                <h2 id="tags-name">Name</h2>
              </div>
              <div className="card-body">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Size" htmlFor="tag_name_pt">
                    <PointSize
                      id="tag_name_pt"
                      value={settings.tagNamePt}
                      disabled={!canEdit}
                      onChange={(pt) => set({ tagNamePt: pt })}
                    />
                  </Field>
                  <Field label="Font" htmlFor="tag_name_font">
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
                </div>
                {/* Under the pair rather than on the size alone: it is about
                    what the two of them just did to this name. */}
                <p className="hint">{nameSizeHint}</p>
              </div>
            </section>

            <section className="card" aria-labelledby="tags-footer">
              <div className="card-head">
                <h2 id="tags-footer">Footer line</h2>
              </div>
              <div className="card-body">
                <div className="grid" style={{ gridTemplateColumns: "1fr 108px", gap: 12 }}>
                  <Field label="Text" htmlFor="tag_line" hint="Leave empty for none.">
                    <input
                      id="tag_line"
                      type="text"
                      value={settings.tagLine}
                      placeholder="We are a Christ-centered Acts 1:8 Family"
                      disabled={!canEdit}
                      onChange={(event) => set({ tagLine: event.target.value })}
                    />
                  </Field>
                  <Field label="Size" htmlFor="tag_line_pt">
                    <PointSize
                      id="tag_line_pt"
                      value={settings.tagLinePt}
                      disabled={!canEdit || !settings.tagLine.trim()}
                      onChange={(pt) => set({ tagLinePt: pt })}
                    />
                  </Field>
                </div>
              </div>
            </section>

            <section className="card" aria-labelledby="tags-paper">
              <div className="card-head">
                <h2 id="tags-paper">Paper</h2>
              </div>
              <div className="card-body">
                <Field
                  label="Sheet"
                  htmlFor="page_size"
                  hint={`${perSheet} per sheet, centred, with cut lines. Shared with the book.`}
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
              </div>
            </section>

            {/* Save and the way out. Preview & print is not repeated here -
                it is in the head, and a screen with two of the same button has
                one of them too many. */}
            {canEdit ? (
              <div className="row" style={{ marginTop: 18 }}>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <Link className="btn ghost" to="/tags">
                  Back
                </Link>
              </div>
            ) : (
              <Notice kind="warn">
                You have read-only access. You can still preview and print.
              </Notice>
            )}

            {/* Who is in the directory is the directory's own question - the
                same list prints as a book - so it is asked once, there, and
                pointed at from here rather than answered twice. */}
            <div className="form-decision">
              <p className="hint" style={{ marginBottom: 0 }}>
                Everyone in this directory gets a tag.{" "}
                <Link to={`/projects/${project.id}`}>Edit the directory</Link> to change who.
              </p>
            </div>
          </div>

          <div className="desk-stage">
            <section className="card" aria-labelledby="tags-preview">
              <div className="card-head">
                <h2 id="tags-preview">Preview</h2>
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
                    />
                    {/* Two facts rather than a sentence: which rectangle, and
                        on whom. The second is the reason this is drawn on
                        somebody the directory prints. */}
                    <figcaption className="hint">
                      {TAG_SIZES[safeSettings.tagSize].label} · {previewName}
                    </figcaption>
                  </figure>
                ) : (
                  <p className="hint tag-figure">Drawing the tag…</p>
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
 * A type size in points, the way Word asks for one.
 *
 * A number rather than a list of words, because a church that prints its own
 * badges has them in Word already and "medium" is not something anybody can
 * hold up against the thing on their desk. Word's own ladder is offered as
 * suggestions rather than as the choices, so fourteen point is one tap and
 * thirteen and a half is still allowed.
 *
 * The unit is drawn beside the box rather than typed into it: a number input
 * that says "14pt" holds no number at all, and the arrows and the phone's
 * keypad are worth more than the two letters.
 *
 * Half-typed values are left alone here and clamped where they are used, which
 * is what the rows and columns boxes on the directory's own form do - a field
 * that corrects itself between two keystrokes cannot be typed into.
 */
function PointSize({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  disabled?: boolean;
  onChange: (points: number) => void;
}) {
  return (
    <div className="pt-field">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={TAG_PT_MIN}
        max={TAG_PT_MAX}
        step={0.5}
        list="tag-pt-steps"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="pt-unit">pt</span>
    </div>
  );
}
