/**
 * Light or dark, and how this device asked to be shown.
 *
 * Three choices, not two: light, dark, and the device's own - which is the one
 * most people actually want, because a phone that turns itself dark in the
 * evening should turn this dark with it. So the *preference* is one of three
 * and the *theme* is one of two, and the difference between them is the whole
 * of this file.
 *
 * The resolving happens here rather than in the stylesheet. A stylesheet can
 * read the device's preference perfectly well, but only by carrying the dark
 * palette twice - once under prefers-color-scheme for the people who chose
 * nothing, and once under an attribute for the people who chose dark - and two
 * copies of forty colours is two copies that can drift apart. So this settles
 * the question in one place and writes the answer onto <html> as data-theme,
 * and the sheet has one dark block keyed to that.
 *
 * The preference is kept per device, in localStorage, and deliberately not in
 * the database: the sign-in screen is drawn before anybody knows who is
 * looking, the phone in a pocket and the office desktop want different answers
 * on the same account, and a colour scheme is not worth a network round trip
 * to find out.
 */

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const STORAGE_KEY = "church-directory:theme";
const DARK = "(prefers-color-scheme: dark)";

/** Everything else is treated as "system", including a key that is not there. */
function parse(value: string | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

function stored(): ThemeChoice {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing, or storage switched off. The device's own preference
    // is a good enough answer, and a better one than failing to start.
    return "system";
  }
}

let choice: ThemeChoice = stored();

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** What the device itself is set to, right now. */
export function deviceTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia(DARK).matches ? "dark" : "light";
}

export function themeFor(preference: ThemeChoice): Theme {
  return preference === "system" ? deviceTheme() : preference;
}

/** The preference somebody picked: one of three. */
export function getThemeChoice(): ThemeChoice {
  return choice;
}

/** The theme actually on screen: one of two. */
export function getTheme(): Theme {
  return themeFor(choice);
}

/**
 * Writes the answer where the stylesheet can see it.
 *
 * color-scheme comes with it, on the element rather than in the sheet, because
 * it is what the browser reads for the things the sheet cannot reach: the
 * scrollbars, the date picker, the autofill wash over a filled-in field. A
 * dark app with a white date picker is worse than a light app.
 */
function apply(): void {
  const root = document.documentElement;
  const theme = getTheme();
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not worth failing over: the app is simply back to the device's
    // preference the next time it opens.
  }
  apply();
  announce();
}

/** For a React component that wants to re-render when either of them changes. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Called once, from main.tsx, before React renders anything.
 *
 * Before, and not from inside a component: a card painted white and then
 * repainted dark a frame later is a flash of the wrong screen, and it lands on
 * exactly the people who chose dark because a bright screen hurts to look at.
 *
 * The listener is the other half. Somebody who chose "the device's own" and
 * then leaves the app open through sunset has asked for it to follow, so it
 * follows without a reload.
 */
export function startTheme(): void {
  apply();
  if (typeof matchMedia !== "function") return;
  matchMedia(DARK).addEventListener("change", () => {
    if (choice !== "system") return;
    apply();
    announce();
  });
}
