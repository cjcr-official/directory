/**
 * That the stylesheet does not quietly redefine its own components.
 *
 * One stylesheet, five thousand lines, and a class named for what it is rather
 * than for where it is used - `.panel-foot` is the ruled bar along the bottom
 * of a card, and five screens put their buttons in one. Wanting something
 * footer-shaped on a sixth screen, the quickest thing to write is
 * `.panel-foot` again, near the bottom of the sheet, with the two or three
 * declarations that screen wants.
 *
 * Which works, on that screen. What it also does, silently, is re-style the
 * other five: the second rule wins for every property it names, so
 * `margin-top: auto` - the one line that makes four panel feet sit level
 * across a row - became `12px` on all of them, and the sixth screen inherited
 * a raised background and two rounded corners from the rule it thought it was
 * replacing. Nothing failed. The page it was written for looked right in
 * review, because that was the page being looked at.
 *
 * So: a class may be declared once at the top level of the sheet, and as often
 * as it likes inside an at-rule, which is where a component legitimately
 * answers for a narrow screen, a theme, or print. A second top-level rule for
 * the same class is either a component being restyled from a distance or a
 * name being used for two things, and both want a new name instead.
 *
 * Run with: npm run sheet:check
 */

import { readFileSync } from "node:fs";
import { check } from "./check";

const css = readFileSync("src/styles/app.css", "utf8");

/**
 * The sheet with its prose taken out but its shape kept: comments become the
 * same number of blank lines they occupied, so a line number in a failure is
 * a line number in the file somebody has open.
 */
const clean = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

/**
 * Where each top-level selector is declared, by line.
 *
 * Brace depth is the whole of it: a rule inside `@media` is nested, and those
 * are the repeats that are meant to be there. Tracked by hand rather than by
 * regex because the sheet nests, and a regex that matches `selector { ... }`
 * cannot tell a rule from the inside of a media block.
 */
function topLevelRules(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  let depth = 0;
  let prelude = "";
  let line = 1;

  for (const c of clean) {
    if (c === "\n") line += 1;

    if (c === "{") {
      const selector = prelude.trim().replace(/\s+/g, " ");
      if (depth === 0 && selector && !selector.startsWith("@")) {
        const at = found.get(selector) ?? [];
        at.push(line);
        found.set(selector, at);
      }
      depth += 1;
      prelude = "";
    } else if (c === "}") {
      depth -= 1;
      prelude = "";
    } else if (c === ";" && depth === 0) {
      // An at-statement - `@import`, `@charset` - which has no block.
      prelude = "";
    } else {
      prelude += c;
    }
  }
  return found;
}

const rules = topLevelRules();

/**
 * Only the plain single-class rules. A selector list, a descendant selector or
 * anything with a pseudo-class in it is a narrowing of some other rule and is
 * expected to appear repeatedly; `.card` on its own, twice, is the accident.
 */
const components = [...rules].filter(([selector]) => /^\.[A-Za-z0-9_-]+$/.test(selector));

check(
  "every component class is declared once at the top level of the sheet",
  components.every(([, at]) => at.length === 1),
  components
    .filter(([, at]) => at.length > 1)
    .map(([selector, at]) => `${selector} at ${at.join(", ")}`)
    .join("; "),
);

// That the check is looking at something: if the parser breaks, or the file
// moves, "none of them are declared twice" is true of an empty list too.
check(
  "the sheet was actually read",
  components.length > 100,
  `only found ${components.length} component classes`,
);

// And the specific pairing the above was written for, named so a failure says
// what it means rather than just which line.
check(
  ".panel-foot is a card's foot and nothing else redefines it",
  (rules.get(".panel-foot") ?? []).length === 1,
  `declared at ${(rules.get(".panel-foot") ?? []).join(", ") || "nowhere"}`,
);
