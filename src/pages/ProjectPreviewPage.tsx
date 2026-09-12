import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { BookPreview } from "@/components/BookPreview";
import { PreviewZoom, usePreviewZoom } from "@/components/PreviewZoom";
import { LoadingScreen, Notice } from "@/components/ui";
import { fetchProject } from "@/lib/queries";
import { downloadPhoto, getPhotoUrls } from "@/lib/photos";
import { composeBook, type BookModel } from "@/lib/layout/compose";
import { loadMetrics } from "@/lib/layout/metrics";
import { normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";
import { composeTags, tagsPerSheet } from "@/lib/layout/tags";
import { resolveEntries } from "@/lib/projectEntries";
import type { ProjectRow } from "@/lib/database.types";
import { failureMessage } from "@/lib/staleBuild";

/** Sheets drawn on screen before the rest is left to the PDF. */
const PREVIEW_SHEET_LIMIT = 40;

export function ProjectPreviewPage({ tags = false }: { tags?: boolean }) {
  const { id } = useParams();
  const { entries } = useDirectory();

  const [project, setProject] = useState<ProjectRow | null>(null);
  /**
   * The composed document, together with which of the two views composed it.
   *
   * Both views are this one component - /projects/:id/preview and
   * /projects/:id/tags differ only by a prop - and React Router reuses the
   * instance when one replaces the other. So the model is stored with the
   * answer to "which was this composed as", and `book` below is derived from
   * the pair. A sheet composed for the other view cannot reach the screen,
   * rather than reaching it until the effect happens to run again.
   */
  const [composed, setComposed] = useState<{ tags: boolean; model: BookModel } | null>(null);
  const book = composed && composed.tags === tags ? composed.model : null;
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  /** Set while printing so every sheet is in the DOM, not just the preview's. */
  const [printingAll, setPrintingAll] = useState(false);
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
        const loaded = await fetchProject(id);
        if (!active) return;
        setProject(loaded.project);

        const settings = normalizeSettings(loaded.project.settings);
        const included = resolveEntries(entries, {
          mode: loaded.project.selection_mode,
          tagIds: loaded.tagIds,
          entries: loaded.entries,
          wholeFamily: settings.groupWholeFamily,
        });

        const metrics = await loadMetrics(settings.typeface);
        if (!active) return;

        // Both composers hand back the same model, so the preview, the photo
        // fetch, the download and the progress bar below need no opinion about
        // which one made it.
        const model = tags
          ? composeTags(included, settings, metrics)
          : composeBook(included, settings, metrics);
        setComposed({ tags, model });

        if (model.photoPaths.length) {
          const urls = await getPhotoUrls(model.photoPaths);
          if (active) setPhotoUrls(urls);
        }
      } catch (cause) {
        if (active) setError(failureMessage(cause));
      }
    })();

    return () => {
      active = false;
    };
  }, [id, entries, tags]);

  const settings = useMemo(() => (project ? normalizeSettings(project.settings) : null), [project]);

  /**
   * The preview caps how many sheets it draws to stay responsive, but the
   * browser prints the DOM - so a long book has to be fully rendered first, or
   * the printout silently stops at the cap.
   */
  useEffect(() => {
    if (!printingAll) return;
    // One frame for React to commit the remaining sheets, one for layout.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        setPrintingAll(false);
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [printingAll]);

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
          <Link className="preview-back" to={`/projects/${project.id}`} aria-label="Back">
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
              <span>
                <strong>{book.sheets.length}</strong>{" "}
                {book.sheets.length === 1 ? "sheet" : "sheets"}
              </span>
              <span>{tags ? tagsPerSheet(settings) : recordsPerSheet(settings)} to a sheet</span>
            </div>
          </div>
        </div>

        <div className="preview-tools">
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

          <button type="button" className="btn on-dark" onClick={() => setPrintingAll(true)}>
            {printingAll ? "Preparing…" : "Print"}
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
        {settings.bookletOrder ? (
          <div className="preview-notice screen-only">
            <Notice>
              <strong>Booklet order is on.</strong> The pages below are arranged for printing
              double-sided, folding the whole stack down the middle and stapling the spine — so they
              will look shuffled here and read correctly once folded. Print double-sided, flipping
              on the <em>short</em> edge.
            </Notice>
          </div>
        ) : null}

        {truncated ? (
          <div className="preview-notice screen-only">
            <Notice kind="warn">
              Showing the first {PREVIEW_SHEET_LIMIT} of {book.sheets.length} sheets to keep this
              screen quick. Printing and the downloaded PDF both use all of them.
            </Notice>
          </div>
        ) : null}

        <BookPreview
          book={book}
          photoUrls={photoUrls}
          zoom={scale}
          level={level}
          guides={showGuides}
          limit={printingAll ? undefined : PREVIEW_SHEET_LIMIT}
        />
      </main>
    </div>
  );
}
