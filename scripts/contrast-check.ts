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
 * Every pair is asked twice, once of each theme. Dark is where this matters
 * most and where it is least likely to be noticed: the palette was written in
 * one sitting by somebody looking at a bright screen, and a green lifted far
 * enough to be pretty on a near-black card is very easily not lifted far
 * enough to be read on it.
 *
 * Run with: npm run contrast:check
 */

import { readFileSync } from "node:fs";
import { check } from "./check";

/** WCAG AA: 4.5:1 for body text, 3:1 once it is large or bold. */
const AA_TEXT = 4.5;
const AA_LARGE = 3;

const css = readFileSync("src/styles/app.css", "utf8");

/** The colour custom properties declared by one rule, given its selector. */
function tokens(selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`${selector} is not in the stylesheet any more`);
  const block = css.slice(at, css.indexOf("}", at));
  const found = new Map<string, string>();
  for (const line of block.split("\n")) {
    const match = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line);
    if (match) found.set(match[1], match[2]);
  }
  return found;
}

const light = tokens(":root");

/**
 * Dark is the light palette with the dark block laid over it, which is what a
 * browser does with the same two rules. Writing it that way here is not a
 * convenience: a token the dark block does not name is then checked at the
 * value the app really uses after dark - the light one - rather than being
 * skipped for being absent, which is how a colour left out of the dark block
 * by accident gets caught.
 */
const dark = new Map([...light, ...tokens(':root[data-theme="dark"]')]);

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

function colour(palette: Map<string, string>, name: string): string {
  const value = palette.get(name);
  if (!value) throw new Error(`${name} is not declared by either palette any more`);
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
  // A card is --raised and a field is --paper. They are one colour in the
  // light theme, which is why one of them stood in for both here for as long
  // as there was only a light theme; dark sets a card, a field and the page to
  // three different grounds, so both have to be asked.
  { what: "body text on a card", fg: "--ink", bg: "--raised" },
  { what: "body text in a field", fg: "--ink", bg: "--paper" },
  { what: "body text on the canvas", fg: "--ink", bg: "--canvas" },
  { what: "secondary text on a card", fg: "--ink-2", bg: "--raised" },
  { what: "secondary text on the canvas", fg: "--ink-2", bg: "--canvas" },
  // The one that was failing: hints, muted figures, table detail columns.
  { what: "hints and muted text on a card", fg: "--ink-3", bg: "--raised" },
  { what: "a placeholder in a field", fg: "--ink-3", bg: "--paper" },
  { what: "hints and muted text on the canvas", fg: "--ink-3", bg: "--canvas" },
  { what: "avatar initials on the soft accent", fg: "--ink-2", bg: "--accent-soft" },
  { what: "links and accents on a card", fg: "--accent", bg: "--raised" },
  { what: "links and accents on the canvas", fg: "--accent", bg: "--canvas" },
  { what: "a primary button's label", fg: "--accent-ink", bg: "--accent" },
  { what: "error text on a card", fg: "--danger", bg: "--raised" },
  // These three named the wrong foreground for years. A notice does not print
  // its text in --danger or --ink; it prints it in the deeper shade the rule
  // actually sets, which used to be a hex written into the stylesheet where no
  // token existed and so nothing here could reach it. The pass was green and
  // measuring a colour the app never put on screen.
  { what: "error text on its own notice", fg: "--danger-deep", bg: "--danger-soft" },
  { what: "warning text on its own notice", fg: "--warn-deep", bg: "--warn-soft" },
  { what: "confirmation text on its own notice", fg: "--accent-deep", bg: "--accent-soft" },
  { what: "a warning pill's label", fg: "--warn-deep", bg: "--warn-soft" },
  // The tray says how long a background check has left in the warning colour
  // and how long ago it lapsed in the danger one, both straight onto the
  // panel rather than onto a tint of their own.
  { what: "a check coming due, in the tray", fg: "--warn-deep", bg: "--raised" },
  { what: "accent text on the soft accent", fg: "--accent", bg: "--accent-soft" },
];

console.log(
  `\nreading ${light.size} colour tokens and ${dark.size} after dark ` + `from src/styles/app.css`,
);

for (const [theme, palette] of [
  ["light", light],
  ["dark", dark],
] as const) {
  console.log(`\n  ${theme}\n`);
  for (const pair of PAIRS) {
    const need = pair.large ? AA_LARGE : AA_TEXT;
    const fg = colour(palette, pair.fg);
    const bg = colour(palette, pair.bg);
    const got = contrast(fg, bg);
    check(
      `${got.toFixed(2).padStart(5)}:1  (needs ${need})  ${pair.what}  ${fg} on ${bg}`,
      got >= need,
    );
  }
}
