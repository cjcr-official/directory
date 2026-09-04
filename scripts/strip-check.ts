/**
 * That nothing covering the phone screen leaves the strip behind the home
 * indicator belonging to something else.
 *
 * Installed to the Home Screen the app runs under the home indicator, and iOS
 * paints the strip there from the *document's* background - not from whatever
 * element is drawn over it, which stops at the viewport. So a full-screen
 * overlay with its own ground ends on a band of the old one: the loading
 * screen ended on a pale bar, and so did the open nav drawer.
 *
 * The fix each time is a document background to match, keyed off the overlay
 * with html:has(). This holds the pairing: every rule that covers the screen
 * and paints its own ground has to name a document background too.
 *
 * Written as a rule about the stylesheet rather than a rendered page, in the
 * same spirit as fields-check: seeing the strip needs an iPhone, and an
 * iPhone is not what CI has. What CI can hold is the rule that fixed it.
 *
 * Run with: npm run strip:check
 */

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/app.css", "utf8");

/**
 * The sheet with its prose taken out. Everything below reads the stylesheet
 * looking for rules, and a rule named in a comment is not a rule: the first
 * version of this check passed a missing html:has(.scrim), because the note
 * above the variables it is mixed from mentions it by name.
 */
const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

let failures = 0;
function check(name: string, pass: boolean, detail = ""): void {
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Every rule in the sheet, as a selector list and its declarations. */
function rules(): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of clean.matchAll(re)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    // Skip the at-rule preludes a nested block leaves behind.
    if (!selector || selector.startsWith("@")) continue;
    found.push({ selector, body: m[2] });
  }
  return found;
}

const all = rules();

/**
 * The class on each rule that covers the whole screen and paints its own
 * ground: fixed to every edge, or as tall as the viewport with a background
 * of its own. A ground of var(--canvas) is the document's own colour, so the
 * strip already matches and there is nothing to pair.
 */
function coversTheScreen(body: string): boolean {
  const fixedToEveryEdge = /position:\s*fixed/.test(body) && /inset:\s*0/.test(body);
  const viewportTall = /min-height:\s*100dvh/.test(body);
  if (!fixedToEveryEdge && !viewportTall) return false;
  const ground = body.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+)/);
  if (!ground) return false;
  return !ground[1].includes("--canvas");
}

const covers = new Set<string>();
for (const { selector, body } of all) {
  if (!coversTheScreen(body)) continue;
  for (const one of selector.split(",")) {
    const name = one.trim().match(/^\.[A-Za-z0-9_-]+/);
    if (name) covers.add(name[0]);
  }
}

check("the sheet has screens that cover the phone", covers.size > 0, [...covers].join(", "));

/** The overlays the document background is already keyed to. */
const paired = new Set([...clean.matchAll(/html:has\(\s*(\.[A-Za-z0-9_-]+)/g)].map((m) => m[1]));

for (const selector of [...covers].sort()) {
  check(
    `${selector}: the home-indicator strip is painted to match`,
    paired.has(selector),
    paired.has(selector)
      ? ""
      : `needs an html:has(${selector}) background, or iOS ends it on a band of the page behind`,
  );
}

/*
 * The drawer's strip is mixed rather than named, because it has to come out
 * the same colour as a translucent scrim over the canvas. That is only true
 * while both are made of the same two numbers.
 */
const scrim = all.find(
  (rule) =>
    rule.selector.split(",").some((one) => one.trim() === ".scrim") && /background/.test(rule.body),
);
const scrimGround = scrim?.body.match(/background:\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%/);
check("the scrim paints a translucent ink", Boolean(scrimGround), scrimGround?.[0] ?? "not found");

if (scrimGround) {
  const [, r, g, b, alpha] = scrimGround;
  const hex = "#" + [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  const ink = clean.match(/--scrim-ink:\s*(#[0-9a-f]{6})/i)?.[1];
  const strength = clean.match(/--scrim-alpha:\s*(\d+)%/)?.[1];
  check(
    `the strip is mixed from the scrim's own ink`,
    ink?.toLowerCase() === hex,
    `${ink} vs ${hex}`,
  );
  check(
    `the strip is mixed at the scrim's own strength`,
    strength === alpha,
    `${strength}% vs ${alpha}%`,
  );
  check(
    "and mixed into the canvas the scrim is drawn over",
    /html:has\(\.scrim\)\s*\{[^}]*color-mix\(in srgb, var\(--scrim-ink\) var\(--scrim-alpha\), var\(--canvas\)\)/.test(
      clean,
    ),
  );
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
