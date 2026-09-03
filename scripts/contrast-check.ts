/**
 * That text stays readable against what it is printed on.
 *
 * A colour token is one line, and nudging it is the easiest change in the
 * stylesheet to make without thinking - which is how --ink-3 came to sit at
 * 4.37:1 on white and 4.06:1 on the canvas, under the 4.5:1 small text needs,
 * on every screen in the app at once. Nothing looked broken. It was just
 * harder to read than it should have been for anyone whose eyes are not young,
 * which in a church directory is a good part of who is using it.
 *
 * The pairs below are written out rather than discovered, because knowing what
 * sits on what needs a browser and this deliberately does not: it reads the
 * tokens straight out of the stylesheet and does the arithmetic, so it runs in
 * milliseconds and CI needs nothing installed. Add a pair when you introduce
 * one.
 *
 * Run with: npm run contrast:check
 */

import { readFileSync } from "node:fs";

/** WCAG AA: 4.5:1 for body text, 3:1 once it is large or bold. */
const AA_TEXT = 4.5;
const AA_LARGE = 3;

const css = readFileSync("src/styles/app.css", "utf8");

/** The custom properties declared on bare :root. */
function tokens(): Map<string, string> {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const found = new Map<string, string>();
  for (const line of root.split("\n")) {
    const match = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line);
    if (match) found.set(match[1], match[2]);
  }
  return found;
}

const palette = tokens();

function channel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  let raw = hex.replace("#", "");
  if (raw.length === 3) raw = [...raw].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((at) => channel(parseInt(raw.slice(at, at + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function colour(name: string): string {
  const value = palette.get(name);
  if (!value) throw new Error(`${name} is not declared on :root any more`);
  return value;
}

interface Pair {
  what: string;
  fg: string;
  bg: string;
  /** Large or bold text is allowed 3:1. */
  large?: boolean;
}

/** Combinations the app actually puts on screen. */
const PAIRS: Pair[] = [
  { what: "body text on a card", fg: "--ink", bg: "--paper" },
  { what: "body text on the canvas", fg: "--ink", bg: "--canvas" },
  { what: "secondary text on a card", fg: "--ink-2", bg: "--paper" },
  { what: "secondary text on the canvas", fg: "--ink-2", bg: "--canvas" },
  // The one that was failing: hints, muted figures, table detail columns.
  { what: "hints and muted text on a card", fg: "--ink-3", bg: "--paper" },
  { what: "hints and muted text on the canvas", fg: "--ink-3", bg: "--canvas" },
  { what: "avatar initials on the soft accent", fg: "--ink-2", bg: "--accent-soft" },
  { what: "links and accents on a card", fg: "--accent", bg: "--paper" },
  { what: "links and accents on the canvas", fg: "--accent", bg: "--canvas" },
  { what: "a primary button's label", fg: "--accent-ink", bg: "--accent" },
  { what: "error text on a card", fg: "--danger", bg: "--paper" },
  { what: "error text on its own notice", fg: "--danger", bg: "--danger-soft" },
  { what: "warning text on its own notice", fg: "--ink", bg: "--warn-soft" },
  { what: "accent text on the soft accent", fg: "--accent", bg: "--accent-soft" },
];

let failures = 0;

console.log(`\nreading ${palette.size} colour tokens from src/styles/app.css\n`);

for (const pair of PAIRS) {
  const need = pair.large ? AA_LARGE : AA_TEXT;
  const fg = colour(pair.fg);
  const bg = colour(pair.bg);
  const got = contrast(fg, bg);
  const passes = got >= need;
  if (!passes) failures += 1;
  console.log(
    `  ${passes ? "ok  " : "FAIL"} ${got.toFixed(2).padStart(5)}:1  (needs ${need})  ` +
      `${pair.what}  ${fg} on ${bg}`,
  );
}

console.log(
  failures === 0 ? "\nno problems found in this pass" : `\n${failures} PAIR(S) BELOW THE THRESHOLD`,
);
process.exit(failures === 0 ? 0 : 1);
