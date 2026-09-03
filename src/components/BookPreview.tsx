import { Fragment, memo } from "react";
import { COLORS, type BookModel, type BookPage, type TextRun } from "@/lib/layout/compose";
import { CSS_FONT_STACKS, type Typeface } from "@/lib/layout/metrics";

interface Props {
  book: BookModel;
  /** Storage path -> displayable URL. Missing entries fall back to initials. */
  photoUrls: Map<string, string>;
  /** 1 renders at true size; the preview screen scales to fit the window. */
  zoom: number;
  /** Only decides the layout around the paper; the scale arrives as zoom. */
  level?: "page" | "sheet" | "spread";
  /**
   * Draw the dashed line down each fold. Matches the option the PDF is written
   * with, so the toggle that sets it can be seen doing something here rather
   * than only in a file that has not been made yet.
   */
  guides?: boolean;
  /** Limits how many sheets are drawn, to keep a large book responsive. */
  limit?: number;
}

function runStyle(run: TextRun, fontStack: string): React.CSSProperties {
  return {
    position: "absolute",
    left: `${run.x}pt`,
    top: `${run.y}pt`,
    width: `${run.w}pt`,
    fontSize: `${run.size}pt`,
    lineHeight: 1,
    fontFamily: fontStack,
    fontWeight: run.weight === "bold" ? 700 : 400,
    fontStyle: run.weight === "italic" ? "italic" : "normal",
    color: run.color,
    textAlign: run.align,
    whiteSpace: "pre",
    // The composer has already broken every line using real Helvetica metrics,
    // so nothing here may re-wrap or the preview would stop matching the PDF.
    overflow: "visible",
  };
}

/**
 * One half-sheet.
 *
 * Memoised, and worth it: a page is a few hundred absolutely positioned
 * elements and the screen draws up to eighty of them at once. None of them
 * depend on the zoom - that is a transform on the sheet above - or on the fold
 * guides, so without this every touch of either control would reconcile the
 * whole book to arrive back at the same DOM.
 */
const Page = memo(function Page({
  page,
  photoUrls,
  fontStack,
}: {
  page: BookPage;
  photoUrls: Map<string, string>;
  fontStack: string;
}) {
  return (
    <Fragment>
      {page.fills.map((fill, i) => (
        <div
          key={`fill-${i}`}
          style={{
            position: "absolute",
            left: `${fill.x}pt`,
            top: `${fill.y}pt`,
            width: `${fill.w}pt`,
            height: `${fill.h}pt`,
            background: fill.color ?? "transparent",
            border: fill.borderColor ? `0.5pt solid ${fill.borderColor}` : undefined,
            borderRadius: fill.radius ? `${fill.radius}pt` : undefined,
            boxSizing: "border-box",
          }}
        />
      ))}

      {/* The cover's own pictures, drawn under everything else - the same
          slots the PDF draws, so the screen and the paper agree. */}
      {page.photos.map((slot, i) => {
        const url = slot.path ? photoUrls.get(slot.path) : undefined;
        if (!url) return null;
        return (
          <img
            key={`page-photo-${i}`}
            src={url}
            alt=""
            style={{
              position: "absolute",
              left: `${slot.box.x}pt`,
              top: `${slot.box.y}pt`,
              width: `${slot.box.w}pt`,
              height: `${slot.box.h}pt`,
              objectFit: slot.fit === "fill" ? "cover" : "contain",
            }}
          />
        );
      })}

      {page.cards.map((card) => (
        <Fragment key={`${card.entryType}-${card.entryId}`}>
          {card.style === "box" ? (
            <div
              style={{
                position: "absolute",
                left: `${card.box.x}pt`,
                top: `${card.box.y}pt`,
                width: `${card.box.w}pt`,
                height: `${card.box.h}pt`,
                border: `0.5pt solid ${COLORS.border}`,
                boxSizing: "border-box",
              }}
            />
          ) : null}

          {card.rules.map((rule, i) => (
            <div
              key={`card-rule-${i}`}
              style={{
                position: "absolute",
                left: `${rule.x}pt`,
                top: `${rule.y}pt`,
                width: `${rule.w}pt`,
                height: 0,
                borderTop: `0.5pt solid ${rule.color}`,
              }}
            />
          ))}

          {card.photo
            ? (() => {
                const url = card.photo.path ? photoUrls.get(card.photo.path) : undefined;
                const box = card.photo.box;
                const common: React.CSSProperties = {
                  position: "absolute",
                  left: `${box.x}pt`,
                  top: `${box.y}pt`,
                  width: `${box.w}pt`,
                  height: `${box.h}pt`,
                };
                return url ? (
                  <img
                    src={url}
                    alt=""
                    style={{
                      ...common,
                      objectFit: card.photo.fit === "fill" ? "cover" : "contain",
                      border: `0.4pt solid ${COLORS.photoEdge}`,
                      boxSizing: "border-box",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      ...common,
                      background: COLORS.placeholder,
                      color: COLORS.soft,
                      border: `0.4pt solid ${COLORS.photoEdge}`,
                      boxSizing: "border-box",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: fontStack,
                      fontWeight: 700,
                      fontSize: `${Math.min(box.w, box.h) * 0.32}pt`,
                    }}
                  >
                    {card.photo.initials}
                  </div>
                );
              })()
            : null}

          {card.runs.map((run, i) => (
            <div key={i} style={runStyle(run, fontStack)}>
              {run.text}
            </div>
          ))}
        </Fragment>
      ))}

      {page.rules.map((rule, i) => (
        <div
          key={`rule-${i}`}
          style={{
            position: "absolute",
            left: `${rule.x}pt`,
            top: `${rule.y}pt`,
            width: `${rule.w}pt`,
            height: 0,
            borderTop: `0.5pt solid ${rule.color}`,
          }}
        />
      ))}

      {page.runs.map((run, i) => (
        <div key={`run-${i}`} style={runStyle(run, fontStack)}>
          {run.text}
        </div>
      ))}
    </Fragment>
  );
});

/**
 * Draws the composed book as HTML, from the very same page model the PDF
 * writer consumes. Nothing here decides a position or breaks a line - it only
 * paints what the composer already worked out, which is what lets the screen
 * be trusted as a proof of the print.
 */
export function BookPreview({
  book,
  photoUrls,
  zoom,
  limit,
  level = "sheet",
  guides = true,
}: Props) {
  const sheets = limit ? book.sheets.slice(0, limit) : book.sheets;
  const fontStack = CSS_FONT_STACKS[book.typeface as Typeface] ?? CSS_FONT_STACKS.sans;

  return (
    <div className={`sheet-stack level-${level}`}>
      {sheets.map((sheet) => (
        <div key={sheet.index} className="sheet-holder">
          <div className="sheet-caption screen-only">
            Sheet {sheet.index + 1} of {book.sheets.length}
          </div>
          {/* At page size the paper is wider than the screen, so the frame
              scrolls between the two halves rather than the page doing it. */}
          <div
            className="sheet-frame"
            style={{ width: `${book.width * zoom}pt`, height: `${book.height * zoom}pt` }}
          >
            <div
              className="sheet"
              style={{
                width: `${book.width}pt`,
                height: `${book.height}pt`,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {(guides ? sheet.foldX : []).map((x, i) => (
                <div
                  key={`fold-${i}`}
                  className="fold-line"
                  style={{ left: `${x}pt`, top: "14pt", height: `${book.height - 28}pt` }}
                />
              ))}
              {sheet.pages.map((page, i) => (
                <Page
                  key={`${sheet.index}-${i}`}
                  page={page}
                  photoUrls={photoUrls}
                  fontStack={fontStack}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
