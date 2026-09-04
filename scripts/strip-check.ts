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
 * The drawer's strip is a colour written out rather than mixed, because
 * color-mix() is one more thing that can fail to parse on the one browser
 * this matters on - and a dropped declaration here looks exactly like no fix
 * at all. So the arithmetic happens here instead: the scrim composited over
 * the canvas has to be the colour the strip is painted.
 */
function channels(colour: string): number[] {
  const hex = colour.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return hex.slice(1).map((pair) => parseInt(pair, 16));
  return [...colour.matchAll(/\d+/g)].map((m) => Number(m[0])).slice(0, 3);
}

const scrim = all.find(
  (rule) =>
    rule.selector.split(",").some((one) => one.trim() === ".scrim") && /background/.test(rule.body),
);
const scrimGround = scrim?.body.match(/background:\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%/);
check("the scrim paints a translucent ink", Boolean(scrimGround), scrimGround?.[0] ?? "not found");

const canvas = clean.match(/--canvas:\s*(#[0-9a-f]{6})/i)?.[1];
check("the canvas it is drawn over is named", Boolean(canvas), canvas ?? "not found");

const stripSelectors =
  "html:has(.scrim), html.drawer-open, html:has(.scrim) body, html.drawer-open body";
const stripRule = clean.match(
  new RegExp(
    stripSelectors
      .split(", ")
      .map((one) => one.replace(/[.()]/g, "\\$&"))
      .join(",\\s*") + "\\s*\\{([^}]*)\\}",
  ),
);
const strip = stripRule?.[1].match(/background:\s*(rgb\([^)]*\)|#[0-9a-f]{6})/i)?.[1];
check(
  "the strip is keyed to the drawer on both elements, both ways",
  Boolean(stripRule),
  stripRule
    ? ""
    : `needs ${stripSelectors} - the strip is filled by one of html and body, and which one is not observable from here`,
);

/*
 * And the half that cannot fail to match only works while something actually
 * puts the class there.
 */
const shell = readFileSync("src/components/AppShell.tsx", "utf8");
const toggles = /documentElement\.classList\.toggle\(\s*"drawer-open"/.test(shell);
check(
  "the shell puts the class on the document",
  toggles,
  toggles ? "" : "needs AppShell to toggle drawer-open on documentElement",
);

check(
  "the strip is painted a plain colour",
  Boolean(strip) && !/color-mix|var\(/.test(strip ?? ""),
  strip ?? "no html:has(.scrim) background - iOS will end the drawer on a band of the page behind",
);

if (scrimGround && canvas && strip) {
  const [, ...ink] = scrimGround;
  const alpha = Number(ink.pop()) / 100;
  const over = channels(canvas);
  const want = ink.map((n, i) => Number(n) * alpha + over[i] * (1 - alpha));
  const got = channels(strip);
  const drift = Math.max(...want.map((n, i) => Math.abs(n - got[i])));
  check(
    "and it is the scrim composited over that canvas",
    drift <= 1,
    `wanted ${want.map((n) => n.toFixed(1)).join(", ")}, painted ${got.join(", ")}`,
  );
}

/*
 * And the other way a thing fails to reach the bottom of the phone, which is
 * how the drawer did it: a fixed box given top, bottom AND a height is
 * over-constrained, and the rules say bottom is the one that loses. That is
 * silent everywhere the height happens to equal the viewport - which is every
 * desktop browser - and wrong on an iPhone, where 100dvh in an installed app
 * comes up short by the height of the home indicator.
 */
for (const { selector, body } of all) {
  if (!/position:\s*fixed/.test(body)) continue;
  const stretched = /(^|[;\s])top:/.test(body) && /(^|[;\s])bottom:/.test(body);
  const height = body.match(/(?:^|[;\s])height:\s*([^;]+)/);
  if (!stretched || !height) continue;
  check(
    `${selector}: stretched top to bottom, so it must not also set a height`,
    false,
    `height: ${height[1].trim()} wins over bottom, and silently - drop it`,
  );
}

/*
 * And the one that cost the most to find. A standalone iOS app asking for a
 * translucent status bar is laid out from the top of the screen but told the
 * viewport is one status bar shorter than it is, so everything full-height
 * stops that far above the bottom of the phone. It is invisible in every
 * browser, because no browser but an installed iOS app does it.
 */
const head = readFileSync("index.html", "utf8");
const style = head.match(/apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/)?.[1];
check("the status bar style is set at all", Boolean(style), style ?? "not found");
check(
  "and it is not translucent",
  style !== "black-translucent",
  style === "black-translucent"
    ? "translucent costs the height of the top inset off the bottom of every screen"
    : `${style}`,
);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
