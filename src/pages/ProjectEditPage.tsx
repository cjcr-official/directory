import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import {
  Caret,
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
  demoteMainDirectory,
  fetchProject,
  fetchProjects,
  isStaleWrite,
  restoreMainDirectory,
  setProjectEntries,
  setProjectTags,
  updateProject,
  type ProjectWithSelection,
} from "@/lib/queries";
import type { EntryType, ProjectKind, ProjectRow, SelectionMode } from "@/lib/database.types";
import { directoryKinds, mainDirectoryId, type DirectoryKind } from "@/lib/directoryKind";
import {
  COVER_PARTS,
  DEFAULT_SETTINGS,
  NOTE_PAGES_MAX,
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
import {
  isPicked,
  pickList,
  resolveEntries,
  togglePick,
  type PickRow,
  type Selection,
} from "@/lib/projectEntries";
import { labelledHouseholdName, message } from "@/lib/format";
import { getPhotoUrls, removePhoto, uploadPhoto } from "@/lib/photos";
import { CoverCanvas, type MovableParts } from "@/components/BookPreview";
import {
  composeBackPreview,
  composeCoverPage,
  composeLeadershipPreview,
} from "@/lib/layout/compose";
import { readGuides, rememberGuides } from "@/lib/layout/guides";
import { tagsPerSheet } from "@/lib/layout/tags";
import { TYPEFACE_LABELS, loadMetrics, type Metrics } from "@/lib/layout/metrics";
import { PhotoInput } from "@/components/PhotoInput";
import { LeadershipEditor } from "@/components/LeadershipEditor";
import { BackCoverEditor } from "@/components/BackCoverEditor";
import { currentStaff } from "@/lib/layout/backCover";
import { currentLeadership, leadershipGroups } from "@/lib/layout/leadership";

/*
 * Stand-in storage paths for cover artwork that has been chosen but not yet
 * uploaded. The composer draws a picture by its path, so these carry a fresh
 * Blob as far as the canvas. They never reach the database: Save uploads the
 * Blob and writes the real path.
 */
const PENDING_LOGO = "pending:cover-logo";
const PENDING_PHOTO = "pending:cover-photo";

/**
 * The cover's lines that come from a setting, and the grey words each shows
 * while it is empty and being typed in. Named for what belongs on the paper,
 * because they are read on the cover rather than beside a field.
 */
const COVER_PLACEHOLDER: Record<string, string> = {
  churchName: "Your church's name",
  coverTitle: "The book's title",
  coverSubtitle: "A subtitle",
  coverStatement: "A verse, or a sentence about the congregation",
  coverContact: "The address, and how to reach the office",
};

/** The cover lines that may run to more than one line. */
const COVER_MULTILINE = new Set(["coverStatement", "coverContact", "coverTitle", "coverSubtitle"]);

/**
 * What each part of the cover is called when a handle names it - read aloud
 * as "Move the church's name", so they are words for the thing on the paper.
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

/** The pages the preview can show, in the order they print. */
type Stage = "cover" | "leadership" | "back";
const STAGE_LABELS: Record<Stage, string> = {
  cover: "Cover",
  leadership: "Leadership",
  back: "Back",
};

/** The settings that are a plain on/off switch. */
type Flag = {
  [K in keyof ProjectSettings]: ProjectSettings[K] extends boolean ? K : never;
}[keyof ProjectSettings];

/** A hand-picked record is held as "household:id" or "person:id". */
function splitKey(key: string): { entry_type: EntryType; ref_id: string } {
  const [entry_type, ref_id] = key.split(":");
  return { entry_type: entry_type as EntryType, ref_id };
}

/**
 * The parts of a panel's summary that apply, separated the same way in every
 * panel so they read as a set.
 */
function listOr(parts: (string | false)[], none: string): string {
  return parts.filter(Boolean).join(" · ") || none;
}

/** What "Print as" does, given who is included. */
function printAsHint(wholeFamily: boolean, mode: SelectionMode): string {
  const what = wholeFamily
    ? "One card per family, with the family's details. Someone with no family gets a card of their own."
    : "One card per person, with only their own details. Without a photo of their own, the family photo is used.";
  const how =
    mode === "tags"
      ? wholeFamily
        ? "Anyone in a group brings their whole family. Groups stay live: anyone added to one prints next time."
        : "Only the people in the groups print. Groups stay live: anyone added to one prints next time."
      : mode === "manual"
        ? wholeFamily
          ? "To pick people one at a time, for name tags say, print as individuals."
          : "Only the people ticked print, each with a card and a name tag of their own."
        : "";
  return how ? `${what} ${how}` : what;
}

export function ProjectEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const { entries, tags, authorName, reload, personById, people, personTags } = useDirectory();
  const isNew = !id;

  const [name, setName] = useState("Church Directory");
  const [kind, setKind] = useState<DirectoryKind>("group");
  /** Every directory, to know which one is the main one. */
  const [directories, setDirectories] = useState<ProjectRow[] | null>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<SelectionMode>("all");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  /**
   * Cover artwork chosen but not yet uploaded. Nothing reaches storage until
   * the directory is saved, so backing out leaves no orphan file behind.
   */
  const [coverBlobs, setCoverBlobs] = useState<{ photo?: Blob | null; logo?: Blob | null }>({});
  const [coverRemoved, setCoverRemoved] = useState<{ photo?: boolean; logo?: boolean }>({});

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * The version the editing started from, as a fingerprint for the save. Kept
   * apart from `changed`, which follows whatever the last write returned.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  /** When this directory was last written, and by whom. */
  const [changed, setChanged] = useState<{ at: string; by: string | null } | null>(null);

  const set = useCallback((patch: Partial<ProjectSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  /** Puts a directory, as the database has it, onto the form. */
  const applyLoaded = useCallback(
    (projectId: string, loaded: ProjectWithSelection, all: ProjectRow[]) => {
      setDirectories(all);
      setName(loaded.project.name);
      setKind(directoryKinds(all).get(projectId) ?? "group");
      setDescription(loaded.project.description ?? "");
      setMode(loaded.project.selection_mode);
      setTagIds(loaded.tagIds);
      setPicked(loaded.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
      setSettings(normalizeSettings(loaded.project.settings));
      setOpenedAt(loaded.project.updated_at);
      setChanged({ at: loaded.project.updated_at, by: loaded.project.updated_by ?? null });
      setStale(false);
    },
    [],
  );

  // A new directory is the main one when there is none yet, and a group one
  // otherwise.
  useEffect(() => {
    if (id) return;
    let active = true;
    fetchProjects()
      .then((all) => {
        if (!active) return;
        setDirectories(all);
        setKind(mainDirectoryId(all) ? "group" : "main");
      })
      .catch((cause) => setError(message(cause)));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    Promise.all([fetchProject(id), fetchProjects()])
      .then(([loaded, all]) => {
        if (active) applyLoaded(id, loaded, all);
      })
      .catch((cause) => setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, applyLoaded]);

  /** The directory that is the main one now, and what it is called. */
  const currentMain = directories ? mainDirectoryId(directories) : null;
  const currentMainName =
    directories?.find((row) => row.id === currentMain)?.name ?? "the main directory";

  const selection: Selection = useMemo(
    () => ({
      mode,
      tagIds,
      wholeFamily: settings.groupWholeFamily,
      entries: picked.map((key, position) => ({
        project_id: id ?? "",
        ...splitKey(key),
        position,
      })),
    }),
    [mode, tagIds, picked, id, settings.groupWholeFamily],
  );

  const included = useMemo(() => resolveEntries(entries, selection), [entries, selection]);

  // The checklist is the one place a family is picked by its name alone, so it
  // carries the office's label. Not added in buildEntries, because `title` is
  // also what the printed card and the index are composed from.
  const pickable = useMemo(
    () => pickList(entries, settings.groupWholeFamily, labelledHouseholdName),
    [entries, settings.groupWholeFamily],
  );
  // The rows/columns inputs can hold a half-typed or empty value; the summary
  // and the saved record both use the clamped version.
  const safeSettings = useMemo(() => normalizeSettings(settings), [settings]);
  /*
   * The offices, with each group's members and each person's name as their
   * records have them now - what the list shows, the page draws and Save
   * writes.
   */
  const groups = useMemo(
    () => leadershipGroups(tags, personTags, people),
    [tags, personTags, people],
  );
  const leadership = useMemo(
    () => currentLeadership(settings.leadership, personById, groups),
    [settings.leadership, personById, groups],
  );
  const backStaff = useMemo(
    () => currentStaff(settings.backStaff, personById, groups),
    [settings.backStaff, personById, groups],
  );
  const perSheet = recordsPerSheet(safeSettings);
  const sheets = Math.ceil(included.length / perSheet);

  // --- the pages, drawn -------------------------------------------------------

  /**
   * Font metrics for the book's typeface, so the canvas breaks lines where the
   * PDF will. Fetched, so the drawing appears a moment after the card.
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

  /** Object URLs for artwork picked but not yet uploaded. */
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

  /** The settings as they would print this second, artwork and all. */
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
      leadership: currentLeadership(safeSettings.leadership, personById, groups),
      backStaff: currentStaff(safeSettings.backStaff, personById, groups),
    }),
    [safeSettings, coverBlobs, coverRemoved, personById, groups],
  );

  /*
   * The cover line being typed in. An emptied line is not on the cover at all,
   * which would make the box vanish under the caret - so while it has the
   * caret it stands in with grey words, and no longer than that.
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

  const leadershipPreview = useMemo(
    () =>
      metrics && safeSettings.includeLeadership
        ? composeLeadershipPreview(drawnSettings, metrics)
        : null,
    [metrics, safeSettings.includeLeadership, drawnSettings],
  );
  const backPreview = useMemo(
    () => (metrics && safeSettings.includeBack ? composeBackPreview(drawnSettings, metrics) : null),
    [metrics, safeSettings.includeBack, drawnSettings],
  );

  /**
   * Which page the preview shows. It follows the panel being worked in, and
   * the switch over it changes it by hand.
   */
  const [stage, setStage] = useState<Stage>("cover");
  const stages: Stage[] = [
    "cover",
    ...(leadershipPreview ? (["leadership"] as const) : []),
    ...(backPreview ? (["back"] as const) : []),
  ];
  const showing: Stage = stages.includes(stage) ? stage : "cover";

  /*
   * Where each part of the cover actually ended up, and what its ink covers.
   * A drag is measured against what is on screen, and held in refs so the
   * handlers below never need rebuilding mid-drag.
   */
  const placedRef = useRef<CoverPlacements>({});
  placedRef.current = coverPage?.placed ?? {};
  const boxesRef = useRef<NonNullable<typeof coverPage>["boxes"]>({});
  boxesRef.current = coverPage?.boxes ?? {};

  /** Whether the centring guides are drawn, and pull a dragged part onto them. */
  const [guides, setGuides] = useState(readGuides);

  /** One part of the cover, moved or resized from where it is drawn now. */
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

  /** The cover's handles - only where this person may change the directory. */
  const movableCover = useMemo<MovableParts | undefined>(
    () =>
      canEdit
        ? {
            label: (part) => COVER_PART_LABELS[part as CoverPart] ?? "this",
            onMove: (part, dx, dy) =>
              place(part, (from) => ({ ...from, dx: from.dx + dx, dy: from.dy + dy })),
            onResize: (part, by) => place(part, (from) => ({ ...from, scale: from.scale * by })),
            box: (part) => boxesRef.current[part as CoverPart],
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
   * The cover's own type, edited where it is drawn. Writes go through the same
   * set() the form's fields use, so the two never disagree.
   */
  const editableCover = useMemo(
    () => ({
      value: (field: string) => (settings[field as keyof ProjectSettings] as string) ?? "",
      placeholder: (field: string) => COVER_PLACEHOLDER[field] ?? "",
      multiline: (field: string) => COVER_MULTILINE.has(field),
      onChange: (field: string, value: string) => set({ [field]: value }),
      onFocus: (field: string) => setEditing(field),
      onBlur: (field: string) => setEditing((current) => (current === field ? null : current)),
      /*
       * The church's name prints in spaced capitals, which no field can hold,
       * so its box wears that shape in CSS. The tracking also follows the last
       * letter and pushes a centred line left; half of it back as an indent
       * puts it where the composed line sits.
       */
      style: (field: string) =>
        field === "churchName"
          ? ({ textTransform: "uppercase", letterSpacing: "0.28em", textIndent: "0.14em" } as const)
          : undefined,
    }),
    [settings, set],
  );

  // Saved artwork, fetched once per set of paths rather than per keystroke.
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

  // --- what each panel comes to, said on its lid ------------------------------

  const summary = useMemo(
    () => ({
      cover: safeSettings.includeCover
        ? listOr(
            [
              safeSettings.coverTitle.trim(),
              safeSettings.coverSubtitle.trim(),
              drawnSettings.coverLogoPath !== "" && "logo",
              drawnSettings.coverPhotoPath !== "" && "photograph",
            ],
            "Blank cover",
          )
        : "Not printed",
      tags: listOr(
        [
          TAG_SIZES[safeSettings.tagSize].label,
          `${tagsPerSheet(safeSettings)} to a sheet`,
          TAG_STYLES[safeSettings.tagStyle].label.toLowerCase(),
          TYPEFACE_LABELS[safeSettings.tagNameFont].toLowerCase(),
          `${safeSettings.tagNamePt}pt names`,
          safeSettings.tagLine.trim() !== "" && "a line underneath",
        ],
        "",
      ),
      page: listOr(
        [
          `${paperName(safeSettings.pageSize)} landscape`,
          `${recordsPerSheet(safeSettings)} to a sheet`,
          TYPEFACE_LABELS[safeSettings.typeface].toLowerCase(),
          safeSettings.textScale === "large" ? "large text" : "normal text",
        ],
        "",
      ),
      record: listOr(
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
      ),
      book: listOr(
        [
          safeSettings.includeIndex && "index",
          safeSettings.notePages > 0 &&
            `${safeSettings.notePages} note ${safeSettings.notePages === 1 ? "page" : "pages"}`,
          safeSettings.runningHeader && "running header",
          safeSettings.showLetterTabs && "letter tabs",
          safeSettings.showPageNumbers && "page numbers",
          safeSettings.footerText.trim() !== "" && "footer note",
        ],
        "nothing extra",
      ),
    }),
    [safeSettings, drawnSettings.coverLogoPath, drawnSettings.coverPhotoPath],
  );

  if (loading) return <LoadingScreen label="Loading directory…" />;

  /** An on/off setting as a checkbox. */
  const flag = (key: Flag, label: string, hint?: string) => (
    <Checkbox
      label={label}
      hint={hint}
      checked={settings[key]}
      disabled={!canEdit}
      onChange={(value) => set({ [key]: value })}
    />
  );

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    await store(false);
  }

  /**
   * Throws this browser's changes away and shows the directory as somebody
   * else left it - the values on screen came from a version no longer current.
   */
  async function discardMine() {
    if (!id) return;
    setSaving(true);
    try {
      const [loaded, all] = await Promise.all([fetchProject(id), fetchProjects()]);
      applyLoaded(id, loaded, all);
      setError(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Writes the directory. `force` drops the check that it has not changed since
   * it was opened - reached only from the button offered when it has, so
   * overwriting somebody is a decision rather than an accident.
   */
  async function store(force: boolean) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      /*
       * Upload before deleting, and delete only after the row is written: a
       * failed upload or a stale write must never take the existing artwork
       * with it.
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
      const saved = {
        ...safeSettings,
        ...cover,
        leadership: currentLeadership(safeSettings.leadership, personById, groups),
        backStaff: currentStaff(safeSettings.backStaff, personById, groups),
      };

      const payload = {
        name: name.trim() || "Untitled directory",
        kind: kind as ProjectKind,
        description: description.trim() || null,
        selection_mode: mode,
        settings: saved as unknown as Record<string, unknown>,
      };

      // There is one main directory. Choosing Main hands the role over: the
      // current one becomes a group directory first, because the database
      // refuses two at once, and gets it back if this save then fails.
      //
      // A database that has not run 0012 knows only "directory" and "event"
      // and has no main directory to hand over, so there the directory is
      // saved with the old kind it accepts.
      const beforeKinds = (cause: unknown) => /projects_kind_check/.test(message(cause));
      let handingOver = kind === "main" && currentMain && currentMain !== id ? currentMain : null;
      if (handingOver) {
        try {
          await demoteMainDirectory(handingOver);
        } catch (cause) {
          if (!beforeKinds(cause)) throw cause;
          handingOver = null;
        }
      }
      const write = (body: typeof payload) =>
        id ? updateProject(id, body, force ? null : openedAt) : createProject(body);
      let project: ProjectRow;
      try {
        try {
          project = await write(payload);
        } catch (cause) {
          if (!beforeKinds(cause)) throw cause;
          project = await write({ ...payload, kind: kind === "event" ? "event" : "directory" });
        }
      } catch (cause) {
        if (handingOver) await restoreMainDirectory(handingOver).catch(() => undefined);
        throw cause;
      }
      if (handingOver || !id) setDirectories(await fetchProjects());
      for (const path of discard) await removePhoto(path);

      await setProjectTags(project.id, mode === "tags" ? tagIds : []);
      await setProjectEntries(project.id, mode === "manual" ? picked.map(splitKey) : []);

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
      setError(
        /projects_one_main/.test(message(cause))
          ? "Another directory was made the main one while this was open. Reload it and choose again."
          : message(cause),
      );
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
            {included.length} record{included.length === 1 ? "" : "s"} · {perSheet} to a sheet ·
            about {sheets} sheet{sheets === 1 ? "" : "s"} of paper
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
        {/* The settings on the left, the page they make on the right. On a
            phone the two stack and the preview leads (see .desk-stage).

            Who it is for and who is in it stay open; everything else is a
            panel that opens, in the order the book prints, each saying on its
            lid what it is currently set to. */}
        <div className="desk">
          <div className="desk-settings">
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

                  <Field
                    label="Kind"
                    htmlFor="project_kind"
                    hint={
                      kind === "main"
                        ? currentMain && currentMain !== id
                          ? `There is one main directory. Saving makes this it, and “${currentMainName}” becomes a group directory.`
                          : "The church's main directory. There is only one."
                        : kind === "group"
                          ? "For a group — the choir, the deacons, the youth."
                          : "For one event — a retreat, a picnic, a conference."
                    }
                  >
                    <select
                      id="project_kind"
                      value={kind}
                      disabled={!canEdit}
                      onChange={(event) => setKind(event.target.value as DirectoryKind)}
                    >
                      <option value="main">Main</option>
                      <option value="group">Group</option>
                      <option value="event">Event</option>
                    </select>
                  </Field>
                </div>

                <Field label="Description" htmlFor="project_description">
                  <textarea
                    id="project_description"
                    rows={2}
                    value={description}
                    placeholder="Optional"
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
                <Field
                  label="Include"
                  htmlFor="mode"
                  hint={
                    mode === "all"
                      ? "Everyone marked “include in printed directories” prints, in alphabetical order."
                      : undefined
                  }
                >
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
                  <TagPicker
                    tags={tags}
                    selected={tagIds}
                    disabled={!canEdit}
                    onChange={setTagIds}
                  />
                ) : null}

                {mode === "manual" ? (
                  <ManualPicker
                    rows={pickable}
                    people={!settings.groupWholeFamily}
                    picked={picked}
                    disabled={!canEdit}
                    onChange={setPicked}
                  />
                ) : null}

                <div className="form-decision">
                  <Field
                    label="Print as"
                    htmlFor="print_as"
                    hint={printAsHint(settings.groupWholeFamily, mode)}
                  >
                    <select
                      id="print_as"
                      value={settings.groupWholeFamily ? "family" : "person"}
                      disabled={!canEdit}
                      onChange={(event) =>
                        set({ groupWholeFamily: event.target.value === "family" })
                      }
                    >
                      <option value="family">Families</option>
                      <option value="person">Individuals</option>
                    </select>
                  </Field>
                </div>
              </div>
            </section>

            {/* Top of the cover to the bottom, so the form reads down the page
                it makes - after the switch that decides whether it prints. */}
            <Disclosure title="Cover" summary={summary.cover} onFocus={() => setStage("cover")}>
              {flag(
                "includeCover",
                "Print a cover page",
                "Off starts the book at the first record.",
              )}

              {/* PhotoInput carries its own hint, ending without a full stop
                  because it adds one after the size of the picture chosen. */}
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
            </Disclosure>

            <LeadershipEditor
              settings={settings}
              sections={leadership}
              groups={groups}
              disabled={!canEdit}
              onFocus={() => setStage("leadership")}
              onChange={(patch) => {
                set(patch);
                if (patch.includeLeadership !== false) setStage("leadership");
              }}
            />

            <BackCoverEditor
              settings={settings}
              staff={backStaff}
              groups={groups}
              disabled={!canEdit}
              onFocus={() => setStage("back")}
              onChange={(patch) => {
                set(patch);
                if (patch.includeBack !== false) setStage("back");
              }}
            />

            <Disclosure title="Page setup" summary={summary.page}>
              {/* A book of half-pages prints on landscape paper whichever size
                  is picked, so the label names both. */}
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

              <div className="grid pair">
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
                <strong>{perSheet} to a sheet</strong> — {safeSettings.rows} down each half,{" "}
                {safeSettings.columns} across. Folded down the middle, that is a{" "}
                {safeSettings.pageSize === "a4" ? "A5" : "half-letter"} booklet
                {safeSettings.columns === 2
                  ? " — and it prints as one: the pages are put in folding order when you print, with Flat there beside it for a PDF to email."
                  : "."}
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
            </Disclosure>

            <Disclosure title="Each record" summary={summary.record}>
              {flag("showPhotos", "Photographs")}
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
              {flag("showMembers", "Family members' names")}
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
                      <option value="compact">First names only</option>
                      <option value="detailed">A line each, with their own contact details</option>
                    </select>
                  </Field>
                </div>
              ) : null}
              {flag("showAddress", "Address")}
              {flag("showPhone", "Phone numbers")}
              {flag("showEmail", "Email addresses")}
              {flag("showBirthdays", "Birthdays")}
              {flag("showAnniversary", "Family anniversaries")}
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

            <Disclosure title="Inside the book" summary={summary.book}>
              {flag(
                "includeIndex",
                "Alphabetical index at the back",
                "Every person by surname, with the page their family is on.",
              )}
              <div className="form-decision">
                <Field
                  label="Note pages at the back"
                  hint="Ruled pages after everything else, headed Notes, for writing in by hand."
                  htmlFor="note_pages"
                >
                  <select
                    id="note_pages"
                    value={settings.notePages}
                    disabled={!canEdit}
                    onChange={(event) => set({ notePages: Number(event.target.value) })}
                  >
                    {Array.from({ length: NOTE_PAGES_MAX + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "None" : n === 1 ? "1 page" : `${n} pages`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {flag("runningHeader", "Church name in the running header")}
              {flag("showLetterTabs", "Letter tabs (A, B, C…)")}
              {flag("showPageNumbers", "Page numbers")}
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

            {/* Name tags are set on their own screen; this row says what they
                come to and leads there. */}
            {id ? (
              <Link className="card link-panel" to={`/tags/${id}`}>
                <span className="disclosure-titles">
                  <span className="disclosure-title">Name tags</span>
                  <span className="disclosure-summary">{summary.tags}</span>
                </span>
                <Caret className="link-panel-mark" />
              </Link>
            ) : null}

            {canEdit ? (
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

            {/* Not one of the ways to leave the page, so kept apart from them. */}
            {canEdit && id ? (
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
                <h2 id="book-preview">Preview</h2>
                {/* A switch only once there is a second page to show. */}
                {stages.length > 1 ? (
                  <div className="row tight stage-switch" role="group" aria-label="Page to show">
                    {stages.map((view) => (
                      <button
                        key={view}
                        type="button"
                        className={`btn small${showing === view ? " on" : ""}`}
                        aria-pressed={showing === view}
                        onClick={() => setStage(view)}
                      >
                        {STAGE_LABELS[view]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="card-body">
                {showing === "leadership" && leadershipPreview ? (
                  <LeadershipFigure preview={leadershipPreview} />
                ) : showing === "back" && backPreview ? (
                  backPreview.page ? (
                    <figure className="cover-figure">
                      <CoverCanvas
                        page={backPreview.page}
                        width={backPreview.width}
                        height={backPreview.height}
                        photoUrls={coverUrls}
                        typeface={backPreview.typeface}
                      />
                      <figcaption className="hint">
                        The last page of the book. Redraws as you type.
                      </figcaption>
                    </figure>
                  ) : (
                    <p className="hint cover-figure">
                      Nothing to print yet. Add the hours, a member of staff, or a motto.
                    </p>
                  )
                ) : coverPage ? (
                  <figure className="cover-figure">
                    <CoverCanvas
                      page={coverPage.page}
                      width={coverPage.width}
                      height={coverPage.height}
                      photoUrls={coverUrls}
                      typeface={coverPage.typeface}
                      editable={editableCover}
                      movable={movableCover}
                      guides={guides}
                    />
                    <figcaption className="hint">
                      {paperName(safeSettings.pageSize)} landscape ·{" "}
                      {TYPEFACE_LABELS[safeSettings.typeface].toLowerCase()}
                      {canEdit ? (
                        <>
                          <span className="tag-figure-tip">
                            Click a line to change it. Drag a line or picture to move it — on a
                            phone, hold it first — or use its handle and the arrow keys. Drag a
                            picture&rsquo;s corner to resize it.
                          </span>
                          <span className="cover-tools">
                            <Checkbox
                              label="Centring guides"
                              checked={guides}
                              onChange={(on) => {
                                setGuides(on);
                                rememberGuides(on);
                              }}
                            />
                            {moved.length ? (
                              <span className="cover-moved">
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
                          </span>
                        </>
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
 * The leadership page, drawn through the same canvas as the cover. A list long
 * enough to run onto a second page gets a button for each page.
 */
function LeadershipFigure({ preview }: { preview: ReturnType<typeof composeLeadershipPreview> }) {
  const [chosen, setChosen] = useState(0);
  const index = Math.min(chosen, preview.pages.length - 1);
  const page = preview.pages[index];
  if (!page) {
    return (
      <p className="hint cover-figure">
        Nothing to print yet. Give the page a heading, or put somebody in an office.
      </p>
    );
  }
  return (
    <figure className="cover-figure">
      <CoverCanvas
        page={page}
        width={preview.width}
        height={preview.height}
        photoUrls={NO_PHOTOS}
        typeface={preview.typeface}
      />
      <figcaption className="hint">
        {preview.pages.length > 1 ? (
          <span className="row tight" role="group" aria-label="Leadership pages">
            Runs to {preview.pages.length} pages:
            {preview.pages.map((each, i) => (
              <button
                key={each.number}
                type="button"
                className={`btn small${i === index ? " on" : ""}`}
                aria-pressed={i === index}
                onClick={() => setChosen(i)}
              >
                Page {each.number}
              </button>
            ))}
          </span>
        ) : (
          <>Page {page.number}, straight after the cover. Redraws as you type.</>
        )}
      </figcaption>
    </figure>
  );
}

const NO_PHOTOS = new Map<string, string>();

/**
 * One line of the checklist. Memoised, with a toggle that never changes
 * identity, so ticking one box re-renders that box rather than every record.
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

/**
 * Checklist of every record, for the hand-picked mode: the families, or -
 * printed as individuals - every person.
 */
function ManualPicker({
  rows,
  people,
  picked,
  onChange,
  disabled,
}: {
  rows: PickRow[];
  people: boolean;
  picked: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const chosen = useMemo(() => new Set(picked), [picked]);
  /** Counted by line, so a family ticked whole counts as everyone in it. */
  const count = useMemo(() => rows.filter((row) => isPicked(chosen, row)).length, [rows, chosen]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.title.toLowerCase().includes(needle));
  }, [rows, query]);

  // Read through refs so the toggle keeps one identity and the rows' memo holds.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const rowsRef = useRef(byKey);
  rowsRef.current = byKey;

  const onToggle = useCallback(
    (entryKey: string, on: boolean) => {
      const row = rowsRef.current.get(entryKey);
      if (row) onChange(togglePick(pickedRef.current, row, on));
    },
    [onChange],
  );

  return (
    <div>
      <div className="toolbar picker-toolbar">
        <input
          className="search"
          type="search"
          placeholder={people ? "Search people…" : "Search records…"}
          aria-label={people ? "Search people" : "Search records"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted small">{count} chosen</span>
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
        {visible.map((row) => (
          <PickerRow
            key={row.key}
            entryKey={row.key}
            label={row.title}
            checked={isPicked(chosen, row)}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
        {!visible.length ? <p className="muted small">Nothing matches.</p> : null}
      </div>
    </div>
  );
}
