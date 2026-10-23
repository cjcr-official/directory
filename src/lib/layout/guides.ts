import type { Box } from "./compose";

/**
 * The centring guides on the cover, and what they do to a part dragged near
 * one.
 *
 * Two of them: down the middle of the paper and across it. A cover is a page
 * set centred, and the one thing a hand dragging a title about cannot do by
 * eye at two fifths of true size is put it back on the middle to the point.
 * So a part whose middle comes within reach of a guide is pulled onto it, and
 * the guide lights up to say so.
 *
 * Pure, and in points throughout: the canvas converts its reach from screen
 * pixels before it asks, and the composer's own clamping still has the last
 * word on where anything may sit.
 */

/** Which of the two guides a part is sitting on. */
export interface Snapped {
  /** On the line down the middle: centred left to right. */
  x: boolean;
  /** On the line across the middle: centred top to bottom. */
  y: boolean;
}

export const NOT_SNAPPED: Snapped = { x: false, y: false };

/**
 * How far to shift a part whose ink is `box` so it sits on whichever guides it
 * is within `reach` of, and which ones those are.
 *
 * Each axis is decided on its own: a title dragged down the page should stay
 * on the line down the middle without being pulled onto the one across it.
 */
export function snapToCentre(
  box: Box,
  paper: { width: number; height: number },
  reach: number,
): { dx: number; dy: number; snapped: Snapped } {
  const offX = paper.width / 2 - (box.x + box.w / 2);
  const offY = paper.height / 2 - (box.y + box.h / 2);
  const x = Number.isFinite(offX) && Math.abs(offX) <= reach;
  const y = Number.isFinite(offY) && Math.abs(offY) <= reach;
  return { dx: x ? offX : 0, dy: y ? offY : 0, snapped: { x, y } };
}

/*
 * Whether the guides are showing is a choice about this screen on this
 * device, kept the way the theme and the table columns are: in localStorage,
 * and never in the directory's settings, where it would turn up on somebody
 * else's screen and in every backup.
 */
const STORAGE_KEY = "cover-guides";

export function readGuides(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private browsing, or storage switched off: on, which is the default.
    return true;
  }
}

export function rememberGuides(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Back to on the next time this device opens a cover. Not worth failing over.
  }
}
