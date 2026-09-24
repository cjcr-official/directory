import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { BookPreview } from "@/components/BookPreview";
import { PreviewZoom, usePreviewZoom } from "@/components/PreviewZoom";
import { LoadingScreen, Notice } from "@/components/ui";
import { PrintAs, PrintAsNotice, SheetCount, usePrintAll, usePrintAs } from "@/components/PrintAs";
import { fetchProject } from "@/lib/queries";
import { downloadPhoto, getPhotoUrls } from "@/lib/photos";
import { composeBook, type BookModel } from "@/lib/layout/compose";
import { loadMetrics, type Metrics } from "@/lib/layout/metrics";
import { normalizeSettings, recordsPerSheet, type ProjectSettings } from "@/lib/layout/settings";
import { composeTags, tagsPerSheet } from "@/lib/layout/tags";
import { resolveEntries } from "@/lib/projectEntries";
import type { DirectoryEntry } from "@/lib/entries";
import type { ProjectRow } from "@/lib/database.types";
import { failureMessage } from "@/lib/staleBuild";

/** Sheets drawn on screen before the rest is left to the PDF. */
const PREVIEW_SHEET_LIMIT = 40;

export function ProjectPreviewPage({ tags = false }: { tags?: boolean }) {
  const { id } = useParams();
  const { entries } = useDirectory();

  const [project, setProject] = useState<ProjectRow | null>(null);
  /**
   * What the document is composed from, together with which of the two views
   * loaded it.
   *
   * Both views are this one component - /projects/:id/preview and
   * /projects/:id/tags differ only by a prop - and React Router reuses the
   * instance when one replaces the other. So the inputs are stored with the
   * answer to "which was this loaded as", and `book` below is derived from
   * them. A sheet composed for the other view cannot reach the screen, rather
   * than reaching it until the effect happens to run again.
   *
   * The inputs rather than the finished model, because whether the book is
   * imposed as a booklet is chosen here, at print time, and flipping it lays
   * the book out again without going back to the database.
   */
  const [loaded, setLoaded] = useState<{
    tags: boolean;
    included: DirectoryEntry[];
    settings: ProjectSettings;
    metrics: Metrics;
  } | null>(null);
  const { booklet, setBooklet, canFold } = usePrintAs(loaded?.settings ?? null);
  const book = useMemo<BookModel | null>(() => {
    if (!loaded || loaded.tags !== tags) return null;
    // Both composers hand back the same model, so the preview, the photo
    // fetch, the download and the progress bar below need no opinion about
    // which one made it.
    return tags
      ? composeTags(loaded.included, loaded.settings, loaded.metrics)
      : composeBook(loaded.included, { ...loaded.settings, bookletOrder: booklet }, loaded.metrics);
  }, [loaded, tags, booklet]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  /** Printing before the photo links arrive would print every face as initials. */
  const [photosReady, setPhotosReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const printAll = usePrintAll(async () => {
    if (!book?.photoPaths.length) return;
    // Signed for an hour: fetched again here, so a preview left open that long
    // does not print its later sheets with pictures that no longer load.
    const urls = await getPhotoUrls(book.photoPaths);
    flushSync(() => setPhotoUrls(urls));
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const { level, setLevel, scale } = usePreviewZoom(book, canvasRef);

  useEffect(() => {
    if (!id) return;
    let active = true;

    (async () => {
      try {
        // A failure belongs to the attempt that produced it. Switching views,
        // or arriving at another project, is a fresh attempt and starts clean -
        // otherwise the error screen outlives the thing that went wrong and
        // there is no way back to a working page but a reload.
        setError(null);
        setPhotosReady(false);
        const fetched = await fetchProject(id);
        if (!active) return;
        setProject(fetched.project);

        const settings = normalizeSettings(fetched.project.settings);
        const included = resolveEntries(entries, {
          mode: fetched.project.selection_mode,
          tagIds: fetched.tagIds,
          entries: fetched.entries,
          wholeFamily: settings.groupWholeFamily,
        });

        // Tags are set in their own faces, and can be set in two at once, so
        // the family the measurements default to is the tag's rather than the
        // book's. Either way the loaded metrics can measure in any of them.
        const metrics = await loadMetrics(tags ? settings.tagNameFont : settings.typeface);
        if (!active) return;

        setLoaded({ tags, included, settings, metrics });

        // The same photographs whichever order the pages are printed in, so
        // they are fetched once for the book as it was loaded.
        const model = tags
          ? composeTags(included, settings, metrics)
          : composeBook(included, settings, metrics);

        if (model.photoPaths.length) {
          const urls = await getPhotoUrls(model.photoPaths);
          if (active) setPhotoUrls(urls);
        }
        if (active) setPhotosReady(true);
      } catch (cause) {
        if (active) setError(failureMessage(cause));
      }
    })();

    return () => {
      active = false;
    };
  }, [id, entries, tags]);

  const settings = useMemo(() => (project ? normalizeSettings(project.settings) : null), [project]);

  async function generatePdf() {
    if (!book || !project) return;
    setBuilding(true);
    setProgress({ done: 0, total: 1 });
    try {
      // pdf-lib is a large dependency; it only loads when someone actually
      // asks for a file.
      const { renderPdf } = await import("@/lib/layout/pdf");
      const bytes = await renderPdf(book, downloadPhoto, {
        showFoldGuides: showGuides,
        title: project.name,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stem = project.name.replace(/[^\w\d-]+/g, "-").toLowerCase();
      link.download = tags ? `${stem}-name-tags.pdf` : `${stem}.pdf`;
      link.click();
      // Give the browser a moment to start the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  }

  if (error) {
    return (
      <div className="page">
        <Notice kind="error">{error}</Notice>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" to={tags ? "/tags" : "/projects"}>
            {tags ? "Back to name tags" : "Back to directories"}
          </Link>
        </p>
      </div>
    );
  }

  if (!book || !project || !settings)
    return <LoadingScreen label={tags ? "Laying out the tags…" : "Laying out the book…"} />;

  const truncated = book.sheets.length > PREVIEW_SHEET_LIMIT;

  return (
    <div className="preview">
      {/* The @page rule has to match the composed sheet or the browser's own
          print dialog would scale it and the fold would drift. */}
      <style>{`@page { size: ${book.width}pt ${book.height}pt; margin: 0; }`}</style>

      <header className="preview-bar">
        <div className="preview-bar-main">
          {/* Back where this was opened from, which is now two different
              screens: the tag sheet is reached from Name tags and set there,
              the book from the directory's own page. */}
          <Link
            className="preview-back"
            to={tags ? `/tags/${project.id}` : `/projects/${project.id}`}
            aria-label="Back"
          >
            <span aria-hidden>←</span>
          </Link>
          <div className="preview-titles">
            <h1 className="preview-title">{project.name}</h1>
            <div className="preview-stats">
              <span>
                <strong>{book.recordCount}</strong>{" "}
                {tags
                  ? book.recordCount === 1
                    ? "name tag"
                    : "name tags"
                  : book.recordCount === 1
                    ? "record"
                    : "records"}
              </span>
              {tags ? null : (
                <span>
                  <strong>{book.pageCount}</strong> {book.pageCount === 1 ? "page" : "pages"}
                </span>
              )}
              <SheetCount book={book} booklet={!tags && booklet && canFold} />
              <span>
                {tags ? tagsPerSheet(settings) : recordsPerSheet(settings)} to a{" "}
                {!tags && booklet && canFold ? "side" : "sheet"}
              </span>
            </div>
          </div>
        </div>

        <div className="preview-tools">
          {tags || !canFold ? null : <PrintAs booklet={booklet} onChange={setBooklet} />}

          {/* Tags are cut apart, not folded, so there is no fold to guide. */}
          {tags ? null : (
            <label className="preview-check">
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(event) => setShowGuides(event.target.checked)}
              />
              Fold guides
            </label>
          )}

          <PreviewZoom value={level} onChange={setLevel} />

          <span className="preview-tools-spacer" />

          <button
            type="button"
            className="btn on-dark"
            disabled={!photosReady || printAll.preparing}
            onClick={() => void printAll.print()}
          >
            {!photosReady ? "Loading photos…" : printAll.preparing ? "Preparing…" : "Print"}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={building}
            onClick={() => void generatePdf()}
          >
            {building ? "Building PDF…" : "Download PDF"}
          </button>
        </div>

        {progress ? (
          <div className="preview-progress" role="progressbar">
            <div
              style={{
                width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </div>
        ) : null}
      </header>

      <main className="preview-canvas" ref={canvasRef}>
        {!tags && canFold ? <PrintAsNotice booklet={booklet} /> : null}

        {truncated ? (
          <div className="preview-notice screen-only">
            <Notice kind="warn">
              Showing the first {PREVIEW_SHEET_LIMIT} of {book.sheets.length} sheets to keep this
              screen quick. Printing and the downloaded PDF both use all of them — print with the{" "}
              <strong>Print</strong> button above, which waits for every photograph, rather than the
              browser's menu.
            </Notice>
          </div>
        ) : null}

        <BookPreview
          book={book}
          photoUrls={photoUrls}
          zoom={scale}
          level={level}
          guides={showGuides}
          limit={printAll.allDrawn ? undefined : PREVIEW_SHEET_LIMIT}
        />
      </main>
    </div>
  );
}
