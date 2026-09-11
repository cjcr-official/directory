/**
 * Layout rules only WebKit breaks, held as facts about the stylesheet.
 *
 * First: that a form field cannot grow wider than the card it sits in.
 *
 * iOS keeps its own sizing for the date-family controls while the platform
 * appearance is on, and that sizing ignores box-sizing: the field comes out
 * its container's width PLUS its own padding either side. On a phone that put
 * "Date of birth" and "Anniversary" about 20px past the card edge, and it is
 * invisible on a desktop browser, so it survived several passes over the same
 * screens.
 *
 * Written as a rule about the stylesheet rather than a rendered page, in the
 * same spirit as contrast-check: knowing the real width needs a browser, and
 * a browser is not where this breaks - only WebKit is, which CI has not got.
 * What CI can hold is the rule that stopped it.
 *
 * Run with: npm run fields:check
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check } from "./check";

const css = readFileSync("src/styles/app.css", "utf8");

/** Every TypeScript file under src, as paths. */
function sourceFiles(dir = "src"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/** Every input type the app actually uses, read out of the source. */
function typesInUse(): Set<string> {
  const found = new Set<string>();
  for (const path of sourceFiles()) {
    for (const m of readFileSync(path, "utf8").matchAll(/type="([a-z-]+)"/g)) found.add(m[1]);
  }
  return found;
}

/** The declarations of every rule whose selector list mentions this type. */
function bodiesFor(type: string): string[] {
  const bodies: string[] = [];
  const needle = `input[type="${type}"]`;
  let from = 0;
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    if (open === -1 || close === -1) continue;
    // Only when the selector list runs unbroken from the match to the brace,
    // so a mention inside some other rule's body is not counted.
    if (!/[};]/.test(css.slice(at, open))) bodies.push(css.slice(open + 1, close));
  }
  return bodies;
}

/** Controls iOS sizes for itself unless the appearance is turned off. */
const PLATFORM_SIZED = ["date", "datetime-local", "month", "time", "week"];

const used = typesInUse();
const relevant = PLATFORM_SIZED.filter((type) => used.has(type));
check("the app uses at least one date-family field", relevant.length > 0, relevant.join(", "));

for (const type of relevant) {
  const bodies = bodiesFor(type);
  check(`${type}: the stylesheet styles it at all`, bodies.length > 0, `${bodies.length} rule(s)`);
  check(
    `${type}: the platform appearance is off`,
    bodies.some((b) => /(^|\s|-)appearance:\s*none/.test(b)),
    "needs -webkit-appearance: none, or iOS ignores box-sizing",
  );
  check(
    `${type}: it cannot outgrow its container`,
    bodies.some((b) => /max-width:\s*100%/.test(b)),
    "needs max-width: 100%",
  );
  check(
    `${type}: it can shrink inside a grid track`,
    bodies.some((b) => /min-width:\s*0/.test(b)),
    "needs min-width: 0",
  );
}

// The wrapper has to give way too, or a "1fr 1fr" row is held open by the
// field's own content and drags the page wider than the phone.
const fieldRule = css.slice(css.indexOf(".field {"), css.indexOf("}", css.indexOf(".field {")));
check(".field can shrink to its track", /min-width:\s*0/.test(fieldRule));

// And that no table row is asked to be a containing block.
//
// A row-wide link used to be a stretched ::after, which needs its <tr> to be
// one - and position: relative on a table row is undefined in CSS 2.1, so WebKit
// ignores it. Under 820px the row is display: grid and it worked. Above that the
// row is a real table-row, so every row's overlay escaped to the same ancestor,
// they stacked, and the last one took every click in the table: on a Mac, every
// click on People or Families opened the bottom record. Chromium honours it, so
// it looked right everywhere it was tested.
const rowRule = /\.list-table tbody tr \{[^}]*\}/.exec(css)?.[0] ?? "";
check(
  "no table row is asked to be a containing block",
  !/position:\s*relative/.test(rowRule),
  rowRule.replace(/\s+/g, " "),
);
check("and no row-wide overlay is hung off a link", !css.includes("row-link"), "");

/*
 * And that every date field in the app is the same component.
 *
 * iOS draws its own calendar for these, and that calendar has a Reset button
 * which empties the element through a path a controlled React input was not
 * hearing: the field went blank and the form went on holding the date, so a
 * date could be changed and not removed. On the device most of this app is
 * used from, that is most of what an optional date field is for.
 *
 * ui.tsx's DateInput is where that is dealt with, once, by reading the value
 * back off the element rather than waiting to be told. This is the rule that
 * stops a fifth date field being added the way the first four were - which is
 * a thing nobody would notice on a desk, where all of this works.
 */
const DATE_FIELD = join("src", "components", "ui.tsx");
const raw = sourceFiles().filter(
  (path) => path !== DATE_FIELD && readFileSync(path, "utf8").includes('type="date"'),
);
check(
  "every date field goes through DateInput",
  raw.length === 0,
  `${raw.join(", ")} draws its own - use DateInput from components/ui`,
);
