import { Fragment } from "react";
import { COLORS, type BookModel, type BookPage, type TextRun } from "@/lib/layout/compose";

interface Props {
  book: BookModel;
  /** Storage path -> displayable URL. Missing entries fall back to initials. */
  photoUrls: Map<string, string>;
  /** 1 renders at true size; the preview screen scales to fit the window. */
  zoom: number;
  /** Limits how many sheets are drawn, to keep a large book responsive. */
  limit?: number;
}

const FONT_STACK = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

function runStyle(run: TextRun): React.CSSProperties {
  return {
    position: "absolute",
    left: `${run.x}pt`,
    top: `${run.y}pt`,
    width: `${run.w}pt`,
    fontSize: `${run.size}pt`,
    lineHeight: 1,
    fontFamily: FONT_STACK,
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

function Page({ page, photoUrls }: { page: BookPage; photoUrls: Map<string, string> }) {
  return (
    <Fragment>
      {page.cards.map((card) => (
        <Fragment key={`${card.entryType}-${card.entryId}`}>
          {card.border ? (
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

          {card.photo ? (
            (() => {
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
                  style={{ ...common, objectFit: card.photo.fit === "fill" ? "cover" : "contain" }}
                />
              ) : (
                <div
                  style={{
                    ...common,
                    background: COLORS.placeholder,
                    color: COLORS.soft,
                    display: "grid",
                    placeItems: "center",
                    fontFamily: FONT_STACK,
                    fontWeight: 700,
                    fontSize: `${Math.min(box.w, box.h) * 0.32}pt`,
                  }}
                >
                  {card.photo.initials}
                </div>
              );
            })()
          ) : null}

          {card.runs.map((run, i) => (
            <div key={i} style={runStyle(run)}>{run.text}</div>
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
        <div key={`run-${i}`} style={runStyle(run)}>{run.text}</div>
      ))}
    </Fragment>
  );
}

/**
 * Draws the composed book as HTML, from the very same page model the PDF
 * writer consumes. Nothing here decides a position or breaks a line - it only
 * paints what the composer already worked out, which is what lets the screen
 * be trusted as a proof of the print.
 */
export function BookPreview({ book, photoUrls, zoom, limit }: Props) {
  const sheets = limit ? book.sheets.slice(0, limit) : book.sheets;

  return (
    <div className="sheet-stack">
      {sheets.map((sheet) => (
        <div
          key={sheet.index}
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
            {sheet.foldX.map((x, i) => (
              <div
                key={`fold-${i}`}
                className="fold-line"
                style={{ left: `${x}pt`, top: "14pt", height: `${book.height - 28}pt` }}
              />
            ))}
            {sheet.pages.map((page, i) => (
              <Page key={`${sheet.index}-${i}`} page={page} photoUrls={photoUrls} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
