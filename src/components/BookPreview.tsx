import { Fragment, memo, useEffect, useRef, useState } from "react";
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

/**
 * What a preview needs to hand back a line of type for editing in place.
 *
 * The composer marks a run with the setting it came from (TextRun.field); this
 * says what that setting currently holds, what to show when it holds nothing,
 * and where to put what gets typed. A preview given none of this draws the
 * same page as ever - the book's does, and the tag's did until the day this
 * was written.
 */
export interface EditableRuns {
  value: (field: string) => string;
  placeholder: (field: string) => string;
  onChange: (field: string, value: string) => void;
  /**
   * Which line is being typed into, and which has been left.
   *
   * A preview that stands a placeholder in for an emptied line has to know
   * when to stop: a line nobody is editing is not on the tag, and drawing it
   * anyway would have the screen showing type the paper will not print - and
   * laying the rest of the tag out around it.
   */
  onFocus?: (field: string) => void;
  onBlur?: (field: string) => void;
}

/**
 * A run of type that can be typed over where it is drawn.
 *
 * A real input rather than a contentEditable div, and rather than a div that
 * swaps itself for an input when clicked: an input is the one of the three
 * React can hold the value of without fighting the browser for the caret, and
 * the tag re-fits its type on every keystroke - the name shrinks, the heading
 * re-measures - so the element being typed into is re-rendered constantly. It
 * carries the run's own metrics, so what is typed is set in the face, size,
 * weight and alignment it will print in.
 */
function EditableRun({
  run,
  fontStack,
  editable,
}: {
  run: TextRun & { field: string };
  fontStack: string;
  editable: EditableRuns;
}) {
  return (
    <input
      type="text"
      className="run-edit"
      value={editable.value(run.field)}
      placeholder={editable.placeholder(run.field)}
      aria-label={editable.placeholder(run.field)}
      onChange={(event) => editable.onChange(run.field, event.target.value)}
      onFocus={() => editable.onFocus?.(run.field)}
      onBlur={() => editable.onBlur?.(run.field)}
      /* Both of these are already committed - the page has been redrawn on
         every keystroke - so both mean the same thing here: done. Enter has to
         be caught whatever it means, because this sits inside the form whose
         submit button is Save. */
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      style={{ ...runStyle(run, fontStack), height: `${run.size * 1.25}pt` }}
    />
  );
}

function runStyle(run: TextRun, fontStack: string): React.CSSProperties {
  return {
    position: "absolute",
    left: `${run.x}pt`,
    top: `${run.y}pt`,
    width: `${run.w}pt`,
    fontSize: `${run.size}pt`,
    lineHeight: 1,
    // A run that names its own family gets it - which is how a name tag shows
    // its name and its small print in the two faces it will print in.
    fontFamily: run.face ? (CSS_FONT_STACKS[run.face] ?? fontStack) : fontStack,
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
  editable,
}: {
  page: BookPage;
  photoUrls: Map<string, string>;
  fontStack: string;
  editable?: EditableRuns;
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

          {card.runs.map((run, i) =>
            editable && run.field ? (
              <EditableRun
                key={i}
                run={run as TextRun & { field: string }}
                fontStack={fontStack}
                editable={editable}
              />
            ) : (
              <div key={i} style={runStyle(run, fontStack)}>
                {run.text}
              </div>
            ),
          )}
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

/** CSS pixels per PostScript point. */
const PX_PER_PT = 96 / 72;

/**
 * One page, drawn on its own, fitted to the box it is given.
 *
 * The book preview draws sheets - a whole piece of paper, six records on it,
 * fold lines down the middle, captioned "Sheet 1 of 4". That is the right
 * picture for checking an imposition and the wrong one for setting a cover,
 * where the question is only ever "what does this one page look like".
 *
 * It draws through the same `Page` the sheets use, off the same composed model
 * the PDF writer consumes, so it is a proof of the print rather than an
 * impression of it: if the title wraps to two lines here it wraps to two lines
 * on paper.
 */
export function CoverCanvas({
  page,
  width,
  height,
  photoUrls,
  typeface,
  editable,
}: {
  page: BookPage;
  width: number;
  height: number;
  photoUrls: Map<string, string>;
  typeface: Typeface;
  /** Given, the lines the composer marked can be typed over where they sit. */
  editable?: EditableRuns;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const fontStack = CSS_FONT_STACKS[typeface] ?? CSS_FONT_STACKS.sans;

  /*
   * Measured, not assumed - in both directions.
   *
   * The holder is drawn a box by the stylesheet and the paper is fitted inside
   * it, whichever of the two edges is the tighter. That is what lets the same
   * canvas be a column-wide picture on a phone and fill a pinned preview pane
   * on a desk without either of them naming a number of pixels here: on a
   * phone the box carries the paper's own proportions and the width decides,
   * and in a pane that is as tall as the window the height does.
   *
   * It matters that the box is never sized by what is in it - `aspect-ratio`
   * on a phone, a stretched flex item in a pane - because this reads the box
   * back to decide what to put in it. A box that hugged its contents would
   * only ever confirm the scale it already had.
   */
  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    const measure = () => {
      const room = { width: box.clientWidth, height: box.clientHeight };
      if (room.width <= 0 || room.height <= 0) return;
      setScale(Math.min(1, room.width / (width * PX_PER_PT), room.height / (height * PX_PER_PT)));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, [width, height]);

  return (
    <div
      ref={holder}
      className="cover-canvas"
      /* The paper's own proportions, for the stylesheet to shape the box with
         where nothing else is deciding its height. */
      style={{ "--paper": `${width} / ${height}` } as React.CSSProperties}
    >
      <div
        className="cover-canvas-paper"
        style={{
          width: `${width * PX_PER_PT * scale}px`,
          height: `${height * PX_PER_PT * scale}px`,
        }}
      >
        <div
          className="sheet"
          style={{
            width: `${width}pt`,
            height: `${height}pt`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <Page page={page} photoUrls={photoUrls} fontStack={fontStack} editable={editable} />
        </div>
      </div>
    </div>
  );
}
