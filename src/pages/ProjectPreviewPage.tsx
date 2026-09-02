import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { BookPreview } from "@/components/BookPreview";
import { LoadingScreen, Notice } from "@/components/ui";
import { fetchProject } from "@/lib/queries";
import { downloadPhoto, getPhotoUrls } from "@/lib/photos";
import { composeBook, type BookModel } from "@/lib/layout/compose";
import { loadMetrics } from "@/lib/layout/metrics";
import { normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";
import { resolveEntries } from "@/lib/projectEntries";
import type { ProjectRow } from "@/lib/database.types";

/** Sheets drawn on screen before the rest is left to the PDF. */
const PREVIEW_SHEET_LIMIT = 40;

export function ProjectPreviewPage() {
  const { id } = useParams();
  const { entries } = useDirectory();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [book, setBook] = useState<BookModel | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  /** Set while printing so every sheet is in the DOM, not just the preview's. */
  const [printingAll, setPrintingAll] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;

    (async () => {
      try {
        const loaded = await fetchProject(id);
        if (!active) return;
        setProject(loaded.project);

        const settings = normalizeSettings(loaded.project.settings);
        const included = resolveEntries(entries, {
          mode: loaded.project.selection_mode,
          tagIds: loaded.tagIds,
          entries: loaded.entries,
        });

        const metrics = await loadMetrics();
        if (!active) return;

        const composed = composeBook(included, settings, metrics);
        setBook(composed);

        if (composed.photoPaths.length) {
          const urls = await getPhotoUrls(composed.photoPaths);
          if (active) setPhotoUrls(urls);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      active = false;
    };
  }, [id, entries]);

  // Fit a sheet to the window the first time, so nothing needs scrolling sideways.
  useEffect(() => {
    if (!book) return;
    const fit = () => {
      const available = (canvasRef.current?.clientWidth ?? window.innerWidth) - 48;
      // 1pt = 1/72in and CSS renders at 96dpi, so a point is 96/72 CSS pixels.
      setZoom(Math.min(1.1, Math.max(0.25, available / (book.width * (96 / 72)))));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [book]);

  const settings = useMemo(
    () => (project ? normalizeSettings(project.settings) : null),
    [project],
  );

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
      link.download = `${project.name.replace(/[^\w\d-]+/g, "-").toLowerCase()}.pdf`;
      link.click();
      // Give the browser a moment to start the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  }

  if (error) {
    return (
      <div className="page">
        <Notice kind="error">{error}</Notice>
        <p style={{ marginTop: 12 }}><Link className="btn" to="/projects">Back to directories</Link></p>
      </div>
    );
  }

  if (!book || !project || !settings) return <LoadingScreen label="Laying out the book…" />;

  const truncated = book.sheets.length > PREVIEW_SHEET_LIMIT;

  return (
    <div>
      {/* The @page rule has to match the composed sheet or the browser's own
          print dialog would scale it and the fold would drift. */}
      <style>{`@page { size: ${book.width}pt ${book.height}pt; margin: 0; }`}</style>

      <div className="preview-bar">
        <Link className="btn ghost" to={`/projects/${project.id}`}>← {project.name}</Link>

        <span className="muted small nowrap">
          {book.recordCount} records · {book.pageCount} pages · {book.sheets.length} sheets ·{" "}
          {recordsPerSheet(settings)} to a sheet
        </span>

        <span className="spacer" />

        <label className="row tight small nowrap" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showGuides}
            onChange={(event) => setShowGuides(event.target.checked)}
          />
          Fold guides
        </label>

        <label className="row tight small nowrap" style={{ gap: 6 }}>
          Zoom
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={zoom}
            style={{ width: 110 }}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>

        {progress ? (
          <span className="row tight">
            <span className="progress-track">
              <div style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
            </span>
          </span>
        ) : null}

        <button type="button" className="btn" onClick={() => setPrintingAll(true)}>
          {printingAll ? "Preparing…" : "Print"}
        </button>
        <button type="button" className="btn primary" disabled={building} onClick={() => void generatePdf()}>
          {building ? "Building PDF…" : "Download PDF"}
        </button>
      </div>

      {settings.bookletOrder ? (
        <div className="screen-only" style={{ padding: "10px 18px 0" }}>
          <Notice>
            <strong>Booklet order is on.</strong> The pages below are arranged for printing
            double-sided, folding the whole stack down the middle and stapling the spine — so they
            will look shuffled here and read correctly once folded. Print double-sided, flipping on
            the <em>short</em> edge.
          </Notice>
        </div>
      ) : null}

      {truncated ? (
        <div className="screen-only" style={{ padding: "10px 18px 0" }}>
          <Notice kind="warn">
            Showing the first {PREVIEW_SHEET_LIMIT} of {book.sheets.length} sheets to keep this
            screen quick. Printing and the downloaded PDF both use all of them.
          </Notice>
        </div>
      ) : null}

      <div className="preview-canvas" ref={canvasRef}>
        <BookPreview
          book={book}
          photoUrls={photoUrls}
          zoom={zoom}
          limit={printingAll ? undefined : PREVIEW_SHEET_LIMIT}
        />
      </div>
    </div>
  );
}
