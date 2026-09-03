import { useCallback, useEffect, useState, type RefObject } from "react";
import type { BookModel } from "@/lib/layout/compose";
import { computeGeometry } from "@/lib/layout/compose";

/**
 * How much of the book to show at once.
 *
 * A slider was the wrong control for this. The useful sizes are not points on a
 * continuum, they are three specific things a person wants to look at, and on a
 * phone all but one of them was unreadable - dragging to find the size where a
 * name becomes legible is not a task anybody should be given.
 *
 * The sheet is the piece of paper: landscape, folded down the middle, with two
 * book pages side by side on it. So:
 *
 *   page    one page of the finished booklet, filling the screen. What a
 *           reader holds. The sheet is wider than the screen at this size, so
 *           it scrolls sideways between the two halves.
 *   sheet   the whole piece of paper, both halves. What comes out of a printer.
 *   spread  two sheets at once, for running an eye down the whole book.
 */
export type ZoomLevel = "page" | "sheet" | "spread";

export const ZOOM_LEVELS: { value: ZoomLevel; label: string; title: string }[] = [
  { value: "page", label: "Page", title: "One page of the booklet" },
  { value: "sheet", label: "Sheet", title: "One whole sheet of paper, both halves" },
  { value: "spread", label: "Two", title: "Two sheets at once" },
];

/** CSS pixels per PostScript point. */
const PX_PER_PT = 96 / 72;

/** Room left around the paper so it does not touch the edge of the screen. */
const CANVAS_PADDING = 32;
const SPREAD_GAP = 20;

/**
 * The scale that makes the chosen level fit the width it has been given.
 *
 * Measured rather than assumed: the container is asked how wide it is, so a
 * phone, a drawer-narrowed desktop and a print preview all land at the size
 * that actually fits rather than one that was guessed at build time.
 */
export function usePreviewZoom(
  book: BookModel | null,
  container: RefObject<HTMLElement | null>,
  initial: ZoomLevel = "sheet",
) {
  const [level, setLevel] = useState<ZoomLevel>(initial);
  const [scale, setScale] = useState(0.7);

  const measure = useCallback(() => {
    if (!book) return;
    const available = (container.current?.clientWidth ?? window.innerWidth) - CANVAS_PADDING * 2;
    if (available <= 0) return;

    const geo = computeGeometry(book.settings);
    const sheetPx = book.width * PX_PER_PT;
    // One page plus the margin beside it, so a page at this size sits on paper
    // rather than being trimmed flush to its own text.
    const pagePx = (geo.pageWidth + geo.margin) * PX_PER_PT;

    const wanted =
      level === "page"
        ? available / pagePx
        : level === "spread"
          ? (available - SPREAD_GAP) / (2 * sheetPx)
          : available / sheetPx;

    // Never so small the type is a smudge, never so large a sheet cannot be
    // seen whole at the sizes above it.
    setScale(Math.min(2.5, Math.max(0.12, wanted)));
  }, [book, container, level]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return { level, setLevel, scale };
}

/**
 * The three sizes as one control. Segmented rather than a dropdown because
 * there are three of them and switching between them is the whole point of
 * being on this screen.
 */
export function PreviewZoom({
  value,
  onChange,
}: {
  value: ZoomLevel;
  onChange: (level: ZoomLevel) => void;
}) {
  return (
    <div className="zoom-levels" role="group" aria-label="How much of the book to show">
      {ZOOM_LEVELS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`zoom-level${option.value === value ? " active" : ""}`}
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
