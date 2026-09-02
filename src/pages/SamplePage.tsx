import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookPreview } from "@/components/BookPreview";
import { LoadingScreen, Notice } from "@/components/ui";
import { buildDemoData } from "@/lib/demo";
import { makeDemoPortrait } from "@/lib/demoPortraits";
import { buildEntries } from "@/lib/entries";
import { composeBook, type BookModel } from "@/lib/layout/compose";
import { loadMetrics } from "@/lib/layout/metrics";
import { DEFAULT_SETTINGS, normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";

/**
 * A full sample directory built from invented families, with no database and no
 * account. It is here so a committee can see exactly what the book will look
 * like - and how many sheets of paper it takes - before anyone types in a
 * single real address.
 */
export function SamplePage() {
  const [book, setBook] = useState<BookModel | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [photoBlobs, setPhotoBlobs] = useState<Map<string, Blob>>(new Map());
  const [zoom, setZoom] = useState(0.7);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const created: string[] = [];

    (async () => {
      try {
        const demo = buildDemoData();
        const entries = buildEntries({
          households: demo.households,
          people: demo.people,
          tags: demo.tags,
          householdTags: demo.householdTags,
          personTags: demo.personTags,
        });

        const settings = normalizeSettings({
          ...DEFAULT_SETTINGS,
          churchName: "Fairhaven Community Church",
          coverSubtitle: "Sample — not real people",
          footerText: "Sample directory",
          showBirthdays: true,
          showAnniversary: true,
        });

        const metrics = await loadMetrics();
        if (!active) return;

        const composed = composeBook(entries, settings, metrics);
        setBook(composed);

        const urls = new Map<string, string>();
        const blobs = new Map<string, Blob>();
        for (const [i, path] of composed.photoPaths.entries()) {
          const blob = await makeDemoPortrait(i + 1);
          const url = URL.createObjectURL(blob);
          created.push(url);
          urls.set(path, url);
          blobs.set(path, blob);
        }
        if (!active) return;
        setPhotoUrls(urls);
        setPhotoBlobs(blobs);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!book) return;
    const fit = () => {
      const available = (canvasRef.current?.clientWidth ?? window.innerWidth) - 48;
      setZoom(Math.min(1.1, Math.max(0.25, available / (book.width * (96 / 72)))));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [book]);

  async function download() {
    if (!book) return;
    setBuilding(true);
    try {
      const { renderPdf } = await import("@/lib/layout/pdf");
      const bytes = await renderPdf(book, async (path) => {
        const blob = photoBlobs.get(path);
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      }, { showFoldGuides: true, title: "Sample church directory" });

      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sample-church-directory.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  }

  if (error) return <div className="page"><Notice kind="error">{error}</Notice></div>;
  if (!book) return <LoadingScreen label="Building a sample directory…" />;

  return (
    <div>
      <style>{`@page { size: ${book.width}pt ${book.height}pt; margin: 0; }`}</style>

      <div className="preview-bar">
        <Link className="btn ghost" to="/">← Back</Link>
        <strong className="small">Sample directory</strong>
        <span className="muted small nowrap">
          {book.recordCount} records · {recordsPerSheet(book.settings)} to a sheet ·{" "}
          {book.sheets.length} sheets · {book.pageCount} pages
        </span>
        <span className="spacer" />
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
        <button type="button" className="btn primary" disabled={building} onClick={() => void download()}>
          {building ? "Building…" : "Download sample PDF"}
        </button>
      </div>

      <div className="screen-only" style={{ padding: "12px 18px 0" }}>
        <Notice>
          Every name, address, photograph and phone number below is invented. This is the exact
          layout your own directory will print in: landscape paper, folded down the middle, three
          records on each half — <strong>six families to a sheet</strong>.
        </Notice>
      </div>

      <div className="preview-canvas" ref={canvasRef}>
        <BookPreview book={book} photoUrls={photoUrls} zoom={zoom} limit={12} />
      </div>
    </div>
  );
}
