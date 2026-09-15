import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookPreview } from "@/components/BookPreview";
import { PreviewZoom, usePreviewZoom } from "@/components/PreviewZoom";
import { LoadingScreen, Notice } from "@/components/ui";
import { buildDemoData } from "@/lib/demo";
import { makeDemoPortrait } from "@/lib/demoPortraits";
import { buildEntries } from "@/lib/entries";
import { failureMessage } from "@/lib/staleBuild";
import { composeBook, type BookModel } from "@/lib/layout/compose";
import { loadMetrics } from "@/lib/layout/metrics";
import { DEFAULT_SETTINGS, normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";
import { composeTags, tagsPerSheet } from "@/lib/layout/tags";

/**
 * A full sample directory built from invented families, with no database and no
 * account. It is here so a committee can see exactly what the book will look
 * like - and how many sheets of paper it takes - before anyone types in a
 * single real address.
 *
 * `tags` shows the same invented congregation as a sheet of name tags. The two
 * are one page because they are one directory printed two ways, and because the
 * tags are the half of this app somebody is most likely to want to look at
 * before they have typed in anybody at all.
 */
export function SamplePage({ tags = false }: { tags?: boolean }) {
  const [book, setBook] = useState<BookModel | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [photoBlobs, setPhotoBlobs] = useState<Map<string, Blob>>(new Map());
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { level, setLevel, scale } = usePreviewZoom(book, canvasRef);

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
          // Only the tag sheet reads these, and only the sample sets them: a
          // tag with nothing under the name would show half of what the styles
          // can do.
          tagLine: "We are glad you are here",
          tagAccent: "#2f6d63",
        });

        const metrics = await loadMetrics(tags ? settings.tagNameFont : settings.typeface);
        if (!active) return;

        const composed = tags
          ? composeTags(entries, settings, metrics)
          : composeBook(entries, settings, metrics);
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
        if (active) setError(failureMessage(cause));
      }
    })();

    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [tags]);

  async function download() {
    if (!book) return;
    setBuilding(true);
    try {
      const { renderPdf } = await import("@/lib/layout/pdf");
      const bytes = await renderPdf(
        book,
        async (path) => {
          const blob = photoBlobs.get(path);
          return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
        },
        { showFoldGuides: !tags, title: "Sample church directory" },
      );

      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = tags ? "sample-name-tags.pdf" : "sample-church-directory.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBuilding(false);
    }
  }

  if (error)
    return (
      <div className="page">
        <Notice kind="error">{error}</Notice>
      </div>
    );
  if (!book)
    return <LoadingScreen label={tags ? "Laying out the tags…" : "Building a sample directory…"} />;

  return (
    <div className="preview">
      <style>{`@page { size: ${book.width}pt ${book.height}pt; margin: 0; }`}</style>

      <header className="preview-bar">
        <div className="preview-bar-main">
          <Link className="preview-back" to="/" aria-label="Back">
            <span aria-hidden>←</span>
          </Link>
          <div className="preview-titles">
            <h1 className="preview-title">{tags ? "Sample name tags" : "Sample directory"}</h1>
            <div className="preview-stats">
              <span>
                <strong>{book.recordCount}</strong> {tags ? "name tags" : "records"}
              </span>
              {tags ? null : (
                <span>
                  <strong>{book.pageCount}</strong> pages
                </span>
              )}
              <span>
                <strong>{book.sheets.length}</strong> sheets
              </span>
              <span>
                {tags ? tagsPerSheet(book.settings) : recordsPerSheet(book.settings)} to a sheet
              </span>
            </div>
          </div>
        </div>

        <div className="preview-tools">
          <Link className="btn on-dark" to={tags ? "/sample" : "/sample/tags"}>
            {tags ? "The book" : "Name tags"}
          </Link>

          <PreviewZoom value={level} onChange={setLevel} />

          <span className="preview-tools-spacer" />

          <button
            type="button"
            className="btn primary"
            disabled={building}
            onClick={() => void download()}
          >
            {building ? "Building…" : tags ? "Download sample tags" : "Download sample PDF"}
          </button>
        </div>
      </header>

      <main className="preview-canvas" ref={canvasRef}>
        <div className="preview-notice screen-only">
          <Notice>
            Every name, address, photograph and phone number below is invented.{" "}
            {tags ? (
              <>
                This is the exact layout your own name tags will print in:{" "}
                <strong>{tagsPerSheet(book.settings)} to a sheet</strong>, portrait, cut apart along
                the pale lines. The size, the style, the two faces and the colour are all set on the
                directory's own page.
              </>
            ) : (
              <>
                This is the exact layout your own directory will print in: landscape paper, folded
                down the middle, three records on each half —{" "}
                <strong>six families to a sheet</strong>.
              </>
            )}
          </Notice>
        </div>

        <BookPreview
          book={book}
          photoUrls={photoUrls}
          zoom={scale}
          level={level}
          guides={!tags}
          limit={12}
        />
      </main>
    </div>
  );
}
