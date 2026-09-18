import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import {
  COLORS,
  type BookModel,
  type BookPage,
  type Box,
  type PhotoSlot,
  type TextRun,
} from "@/lib/layout/compose";
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
  /**
   * Whether this setting may hold more than one line.
   *
   * Asked of the field and not of what is on screen this second, because the
   * answer decides whether the caret is sitting in an input or a textarea. A
   * title that is one line until the word that tips it over two would swap one
   * control for the other mid-word, and take the caret with it.
   */
  multiline?: (field: string) => boolean;
  /** Extra styling for a line the composer transformed on its way in. */
  style?: (field: string) => React.CSSProperties | undefined;
}

/**
 * What a preview needs to let the parts of a cover be moved about on it.
 *
 * The composer marks every run, rule and picture with the part of the cover it
 * belongs to; this says what to do when one of them is dragged. Movement is
 * reported as a delta against the drawing as it currently stands rather than
 * as a position, because the composer has the last word on where a part may
 * sit - it keeps everything on the paper - and reporting it this way is what
 * lets a drag that has run off the edge come straight back when it turns
 * round, instead of first paying back the distance it went past it.
 *
 * A preview given none of this draws exactly the page it always did, which is
 * what the book's preview and the name tag's both want.
 */
export interface MovableParts {
  /** What this part is, in the words a handle can be labelled with. */
  label: (part: string) => string;
  /** Points right and down from where the part is drawn now. */
  onMove: (part: string, dx: number, dy: number) => void;
  /** A multiple of the size the picture is drawn at now. Pictures only. */
  onResize: (part: string, by: number) => void;
}

/** The same, once the canvas has said what it is scaled to. */
interface Moving extends MovableParts {
  /** Screen pixels into points on the paper. */
  points: (px: number) => number;
}

/** How far a pointer may wander before it is dragging something rather than aiming at it. */
const DRAG_SLOP = 4;

/**
 * How long a finger has to be held still before it is holding something.
 *
 * The cover is most of a phone screen and the page under it scrolls, so a
 * finger that arrives and moves is scrolling - that is what it has always done
 * here - and only a finger that arrives and waits has said it means this
 * particular line of type. The same bargain the phone's own home screen makes,
 * for the same reason.
 */
const HOLD_MS = 320;

/** How far in from the edge of the paper the handles sit, in screen pixels. */
const GRIP_INSET = 13;

/** A nudge from the keyboard, in points, and the same with Shift held. */
const NUDGE = 1;
const NUDGE_FAR = 10;
/** And what + and - do to a picture. */
const NUDGE_SCALE = 1.06;

/**
 * A pointer that might be about to drag something that has another use.
 *
 * Every part of this is about the other use. A line of type on the cover is
 * also a field, and a cover on a phone is also a page that scrolls, so the
 * pointer going down on one cannot mean "move this" until it has said so:
 * with a mouse by moving a few pixels, and with a finger by staying still long
 * enough that it cannot have meant to scroll. Until then nothing is prevented
 * and nothing is captured, and the browser goes on doing what it would have
 * done - which is the whole trick, because a scroll that has already started
 * cannot be called back.
 *
 * `atOnce` is for a handle, which is a target somebody aimed at and has no
 * other use to protect.
 */
function dragFrom(
  event: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
  options: { atOnce?: boolean } = {},
): void {
  const from = event.currentTarget as HTMLElement;
  const finger = event.pointerType === "touch";
  const pointer = event.pointerId;
  const started = { x: event.clientX, y: event.clientY };
  let last = started;
  let dragging = false;
  let owed = { x: 0, y: 0 };
  let frame = 0;
  let held = 0;

  /* A finger that is dragging a part is not scrolling the page. It has to be
     said in a listener of its own, and a non-passive one: React's touch
     handlers are passive and cannot refuse anything. It is added only once the
     drag has begun - after HOLD_MS of stillness on a finger - so there is
     never a scroll already under way to argue with. */
  const stayPut = (moving: TouchEvent) => moving.preventDefault();

  function begin() {
    if (dragging) return;
    dragging = true;
    document.body.classList.add("moving-a-part");
    window.addEventListener("touchmove", stayPut, { passive: false });
    /* The pointer went down on something that takes a caret and the browser
       has already given it one. This is a move, not a visit. */
    if (!options.atOnce && document.activeElement === from) from.blur();
    window.getSelection()?.removeAllRanges();
  }

  /* One report a frame, whatever rate the pointer speaks at. Every one of them
     recomposes the cover and redraws it, and a gaming mouse has a thousand
     things to say a second. */
  function settle() {
    frame = 0;
    const { x, y } = owed;
    owed = { x: 0, y: 0 };
    if (x || y) onMove(x, y);
  }

  function move(moving: PointerEvent) {
    if (moving.pointerId !== pointer) return;
    if (!dragging) {
      const far = Math.max(
        Math.abs(moving.clientX - started.x),
        Math.abs(moving.clientY - started.y),
      );
      if (far <= DRAG_SLOP) return;
      // A finger that moved before it had been held still is scrolling the
      // page, and the page is welcome to it.
      if (finger) return finish(false);
      begin();
    }
    owed = { x: owed.x + moving.clientX - last.x, y: owed.y + moving.clientY - last.y };
    last = { x: moving.clientX, y: moving.clientY };
    if (!frame) frame = requestAnimationFrame(settle);
  }

  function finish(moved = dragging) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("touchmove", stayPut);
    if (held) window.clearTimeout(held);
    if (frame) {
      cancelAnimationFrame(frame);
      settle();
    }
    document.body.classList.remove("moving-a-part");
    if (moved) swallowTheClick();
  }

  function up() {
    finish();
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);

  if (options.atOnce) begin();
  else if (finger) held = window.setTimeout(begin, HOLD_MS);
}

/**
 * The click at the end of a drag, which is not a click.
 *
 * Let through, it puts the caret in the line that has just been moved and
 * opens the keyboard over the cover on a phone. It is taken in the capturing
 * phase before it reaches anything, and given up on after a moment: a browser
 * that never sends one would otherwise leave a listener behind to eat
 * somebody's next real click.
 */
function swallowTheClick(): void {
  const eat = (click: MouseEvent) => {
    click.preventDefault();
    click.stopPropagation();
  };
  window.addEventListener("click", eat, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 400);
}

/** Which way a key moves a part, in points. */
function nudgeFor(key: string, step: number): [number, number] | null {
  if (key === "ArrowLeft") return [-step, 0];
  if (key === "ArrowRight") return [step, 0];
  if (key === "ArrowUp") return [0, -step];
  if (key === "ArrowDown") return [0, step];
  return null;
}

/**
 * The handle on a part of the cover.
 *
 * It is the answer to three separate things, which is why it is worth the room
 * it takes on the drawing. A line with the caret in it cannot be dragged by
 * its own type - the pointer is placing the caret and selecting words there -
 * and this can still move it. A keyboard cannot drag anything at all, and this
 * is a button on the tab ring that the arrow keys nudge a point at a time, ten
 * with Shift held. And a part that can be moved has to say so to somebody who
 * has never been told, which nothing in a drawing of a finished page otherwise
 * does.
 *
 * Drawn in screen pixels rather than in the paper's own points: the counter
 * scale undoes whatever the canvas is scaled to, so the handle is the same
 * size to a hand on a phone as on a desk, where the paper behind it is not.
 *
 * Every one of them sits in the margin down the left-hand edge of the paper,
 * at the height of the part it belongs to, rather than against the part
 * itself. A cover is set centred and its type runs nearly the full measure, so
 * a handle at the left edge of the title's own box is a handle sitting on the
 * first letter of the title - and the drawing has to go on being a drawing of
 * the printed page.
 */
function PartGrip({
  part,
  box,
  moving,
  picture,
}: {
  part: string;
  box: Box;
  moving: Moving;
  /** A picture can be made bigger as well as moved, so + and - do something. */
  picture?: boolean;
}) {
  return (
    <button
      type="button"
      className="part-grip"
      aria-label={`Move ${moving.label(part)}`}
      style={{ left: `${moving.points(GRIP_INSET)}pt`, top: `${box.y + box.h / 2}pt` }}
      onPointerDown={(event) => {
        /* Or the browser takes the focus for the button, and a line that is
           only on the cover for as long as it is being typed in would vanish
           from under the hand that reached for it. */
        event.preventDefault();
        dragFrom(event, (dx, dy) => moving.onMove(part, moving.points(dx), moving.points(dy)), {
          atOnce: true,
        });
      }}
      onKeyDown={(event) => {
        const by = nudgeFor(event.key, event.shiftKey ? NUDGE_FAR : NUDGE);
        if (by) {
          event.preventDefault();
          moving.onMove(part, by[0], by[1]);
          return;
        }
        if (!picture) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          moving.onResize(part, NUDGE_SCALE);
        } else if (event.key === "-") {
          event.preventDefault();
          moving.onResize(part, 1 / NUDGE_SCALE);
        }
      }}
    >
      {/* Six dots: the grip every list of draggable rows has worn for twenty
          years, and the one shape that reads as "take hold of this" at eleven
          pixels across. */}
      <svg viewBox="0 0 10 16" aria-hidden>
        {[3, 8, 13].map((y) => (
          <Fragment key={y}>
            <circle cx="3" cy={y} r="1.35" />
            <circle cx="7" cy={y} r="1.35" />
          </Fragment>
        ))}
      </svg>
    </button>
  );
}

/**
 * The corner of a picture, which makes it bigger.
 *
 * The picture grows about its own middle - growing from a corner walks it down
 * the page as it goes - so the corner has to be told how much bigger to make
 * it rather than where it now is: how far the pointer moved straight out from
 * the middle, against how far the corner already was from it. Which comes to
 * the corner following the pointer exactly, as a corner should.
 */
function PartCorner({ part, box, moving }: { part: string; box: Box; moving: Moving }) {
  return (
    <button
      type="button"
      className="part-corner"
      aria-label={`Resize ${moving.label(part)}`}
      style={{ left: `${box.x + box.w}pt`, top: `${box.y + box.h}pt` }}
      onPointerDown={(event) => {
        event.preventDefault();
        dragFrom(
          event,
          (dx, dy) => {
            const diagonal = Math.hypot(box.w, box.h);
            if (!diagonal) return;
            const out = (moving.points(dx) * box.w + moving.points(dy) * box.h) / diagonal;
            moving.onResize(part, 1 + out / (diagonal / 2));
          },
          { atOnce: true },
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "+") {
          event.preventDefault();
          moving.onResize(part, NUDGE_SCALE);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "-") {
          event.preventDefault();
          moving.onResize(part, 1 / NUDGE_SCALE);
        }
      }}
    />
  );
}

/**
 * The runs of one page, with the ones a setting produced offered back.
 *
 * A block that wrapped over three lines is three runs carrying one field, and
 * they are put back together here: the wrap belongs to the composer, and what
 * is typed into is the setting rather than whichever line the pointer landed
 * on. The box is the union of the lines - the first line's top, the last
 * line's bottom - so the control covers exactly the type it replaces.
 */
function renderRuns(
  runs: TextRun[],
  fontStack: string,
  prefix: string,
  editable?: EditableRuns,
  moving?: Moving,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!editable || !run.field) {
      out.push(
        <div key={`${prefix}-${i}`} style={runStyle(run, fontStack)}>
          {run.text}
        </div>,
      );
      continue;
    }
    let end = i;
    while (end + 1 < runs.length && runs[end + 1].field === run.field) end += 1;
    const last = runs[end];
    const lines = end - i + 1;
    // The composer's own leading, read back off the lines rather than guessed
    // at: the gap between two of them is what it used, exactly. One line has no
    // gap to read, so it falls back to the ratio the book is set on.
    const leading = lines > 1 ? (last.y - run.y) / (lines - 1) : run.size * 1.25;
    const height = last.y - run.y + leading;
    out.push(
      <EditableRun
        key={`${prefix}-${i}`}
        run={run as TextRun & { field: string }}
        fontStack={fontStack}
        editable={editable}
        moving={moving}
        height={height}
        leading={leading}
      />,
    );
    // The handle sits against the block as a whole rather than against the
    // line the pointer happened to land on, for the same reason the control
    // does: what is being moved is the setting, not one line of its wrap.
    if (moving) {
      out.push(
        <PartGrip
          key={`${prefix}-${i}-grip`}
          part={run.field}
          box={{ x: run.x, y: run.y, w: run.w, h: height }}
          moving={moving}
        />,
      );
    }
    i = end;
  }
  return out;
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
  moving,
  height,
  leading,
}: {
  run: TextRun & { field: string };
  fontStack: string;
  editable: EditableRuns;
  moving?: Moving;
  height: number;
  leading: number;
}) {
  const multiline = editable.multiline?.(run.field) ?? false;
  const common = {
    className: "run-edit",
    value: editable.value(run.field),
    placeholder: editable.placeholder(run.field),
    "aria-label": editable.placeholder(run.field),
    onFocus: () => editable.onFocus?.(run.field),
    onBlur: () => editable.onBlur?.(run.field),
    /* Dragged where it is drawn, as long as it is not the line being typed in.
       There the pointer is placing a caret, picking out a word, sweeping over
       three of them - so a focused line is moved by its handle instead, which
       is one of the things the handle is for. */
    onPointerDown: (event: React.PointerEvent) => {
      if (!moving || event.currentTarget.matches(":focus")) return;
      dragFrom(event, (dx, dy) => moving.onMove(run.field, moving.points(dx), moving.points(dy)));
    },
    style: {
      ...runStyle(run, fontStack),
      height: `${height}pt`,
      lineHeight: `${leading}pt`,
      ...editable.style?.(run.field),
    },
  };

  /* Escape means done, and so does Enter on a line that cannot hold two. On a
     block that can, Enter is a line break and is left alone - but it still has
     to be stopped from reaching the form, whose submit button is Save. Both
     are already committed either way: the page has been redrawn on every
     keystroke. */
  if (multiline) {
    return (
      <textarea
        {...common}
        /* Both of these have to be said here rather than in the stylesheet:
           runStyle sets white-space and overflow inline - a composed run is
           pre-broken and must never re-wrap - and an inline declaration is not
           something a rule can argue with. Left alone, the box did not wrap at
           all: one long line ran off its right edge and the second line of the
           paragraph was never drawn. */
        style={{ ...common.style, whiteSpace: "pre-wrap", overflow: "hidden auto" }}
        onChange={(event) => editable.onChange(run.field, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <input
      {...common}
      type="text"
      onChange={(event) => editable.onChange(run.field, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
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
 * One of the page's own pictures - the cover's logo and its photograph.
 *
 * A slot is a rectangle the composer set aside, and a picture that is fitted
 * rather than filled does not use all of it: a square logo in a band the width
 * of the page is drawn in the middle with white either side of it. Both
 * renderers have always letterboxed it, and on paper that is the whole story.
 *
 * On a cover being arranged it is not, because the parts of the page can be
 * taken hold of. The thing being taken hold of has to be the picture - not the
 * band it was centred in, whose corner is an inch of empty paper away from the
 * logo it would size, and whose left-hand end is empty paper that would drag
 * the logo if it were pressed. So once the picture has loaded and its own
 * shape is known, the element is drawn at the rectangle the picture actually
 * occupies. It looks exactly the same; it is simply the picture.
 */
function PagePhoto({ slot, url, moving }: { slot: PhotoSlot; url: string; moving?: Moving }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const part = slot.field;
  const move = moving && part ? moving : null;
  const box = slot.fit === "fit" && natural ? fittedIn(slot.box, natural) : slot.box;

  return (
    <Fragment>
      <img
        src={url}
        alt=""
        /* The browser's own picture drag - the one that ends in another tab or
           in somebody's downloads - is not this one. */
        draggable={false}
        className={move ? "movable-picture" : undefined}
        onLoad={(event) =>
          setNatural({
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
        onPointerDown={
          move && part
            ? (event) =>
                dragFrom(event, (dx, dy) => move.onMove(part, move.points(dx), move.points(dy)))
            : undefined
        }
        style={{
          position: "absolute",
          left: `${box.x}pt`,
          top: `${box.y}pt`,
          width: `${box.w}pt`,
          height: `${box.h}pt`,
          objectFit: slot.fit === "fill" ? "cover" : "contain",
        }}
      />
      {move && part ? (
        <Fragment>
          <PartGrip part={part} box={box} moving={move} picture />
          <PartCorner part={part} box={box} moving={move} />
        </Fragment>
      ) : null}
    </Fragment>
  );
}

/** The rectangle a picture of this shape actually occupies inside its slot. */
function fittedIn(box: Box, natural: { w: number; h: number }): Box {
  if (natural.w <= 0 || natural.h <= 0) return box;
  const scale = Math.min(box.w / natural.w, box.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
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
  moving,
}: {
  page: BookPage;
  photoUrls: Map<string, string>;
  fontStack: string;
  editable?: EditableRuns;
  /** Given, the parts the composer marked can be dragged about the page. */
  moving?: Moving;
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
        return <PagePhoto key={`page-photo-${i}-${url}`} slot={slot} url={url} moving={moving} />;
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

          {renderRuns(card.runs, fontStack, `card-${card.entryId}`, editable)}
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

      {renderRuns(page.runs, fontStack, "run", editable, moving)}
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
  movable,
}: {
  page: BookPage;
  width: number;
  height: number;
  photoUrls: Map<string, string>;
  typeface: Typeface;
  /** Given, the lines the composer marked can be typed over where they sit. */
  editable?: EditableRuns;
  /** Given, the parts the composer marked can be dragged about the page. */
  movable?: MovableParts;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const fontStack = CSS_FONT_STACKS[typeface] ?? CSS_FONT_STACKS.sans;

  /*
   * A drag speaks in screen pixels and the paper is measured in points, so
   * whatever the canvas has fitted itself to is the exchange rate between
   * them. Kept here rather than asked of the caller because this is the one
   * place that knows the scale - and it changes under a drag when the window
   * is resized mid-move.
   */
  const moving: Moving | undefined = useMemo(
    () => (movable ? { ...movable, points: (px: number) => px / (scale * PX_PER_PT) } : undefined),
    [movable, scale],
  );

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
          className={moving ? "sheet can-move" : "sheet"}
          style={
            {
              width: `${width}pt`,
              height: `${height}pt`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              /* What a handle has to be scaled by to undo that: a grip is a
                 target for a finger, not part of the drawing, and shrinking
                 with the paper would leave it six pixels across on a phone. */
              "--part-counter": scale ? 1 / scale : 1,
            } as React.CSSProperties
          }
        >
          <Page
            page={page}
            photoUrls={photoUrls}
            fontStack={fontStack}
            editable={editable}
            moving={moving}
          />
        </div>
      </div>
    </div>
  );
}
