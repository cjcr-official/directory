/**
 * The failure that is not a bug: a browser asking for a file the deploy took
 * away.
 *
 * Not every file this app needs arrives with the first page. The PDF engine is
 * 176 kB gzipped and only two screens use it, so it is fetched when somebody
 * opens the preview or presses Download; the Supabase client and the shared
 * pieces of the app come as their own chunks alongside the entry. All of them
 * are named with a hash of their contents, and a deploy replaces those names.
 *
 * So a copy of the app that has been open across a deploy - which on a phone,
 * where the app is suspended rather than closed, is most copies of it - asks for
 * a file that is no longer there, and the request fails. UpdateGate exists to
 * move a browser off an old build before that happens, and it does most of the
 * time: it polls, and it checks whenever the app returns to the foreground. What
 * it cannot cover is the gap between a deploy landing and the next check, which
 * is exactly when somebody presses Download on a screen that has been sitting
 * open since this morning.
 *
 * It reads as a crash and it is not one. The build is simply old, and a reload
 * fixes it completely, so this recognises the case and reloads - once.
 *
 * Once is the whole difficulty. A reload that lands on the same missing file
 * would reload again, and an app that reloads for ever is worse than an app
 * showing an error, because there is no moment in it long enough to read
 * anything or press anything. So an attempt is written down before the reload
 * and read back after it, and a second failure inside the window below stops
 * trying and shows the screen instead.
 */

import { message } from "./format";

const ATTEMPT_KEY = "church-directory:stale-build-reload";

/**
 * How long a recorded attempt counts for.
 *
 * Long enough to cover the reload and the first taps after it - the point is to
 * catch the same failure happening straight away. Short enough that a genuine
 * stale build a fortnight later is a fresh case and gets its own reload, rather
 * than being refused one by a note left over from last month.
 */
const ATTEMPT_WINDOW_MS = 60 * 1000;

/**
 * Whether this is a module the browser could not fetch, rather than code that
 * threw.
 *
 * Matched on the message because there is nothing else to match on: a failed
 * dynamic import rejects with a plain TypeError, and the wording is the only
 * part that says what happened. Every browser words it differently, so all of
 * them are listed - Chromium's "Failed to fetch dynamically imported module",
 * Firefox's "error loading dynamically imported module", Safari's "Importing a
 * module script failed", and Vite's own line for a stylesheet that went with
 * the chunk.
 *
 * Erring towards no is deliberate. Calling a real crash stale would reload the
 * app in front of somebody whose work is not coming back; calling a stale chunk
 * a crash shows them a screen with a Reload button on it, which is the same
 * remedy one tap further away.
 */
export function isStaleBuildError(cause: unknown): boolean {
  const text =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : typeof cause === "string"
        ? cause
        : "";
  if (!text) return false;

  return (
    /failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /importing a module script failed/i.test(text) ||
    /unable to preload css/i.test(text) ||
    // Chromium's wording when the script itself 404s rather than the fetch
    // failing, which is what a replaced hash actually produces.
    /dynamically imported module.*\b(404|not found)\b/i.test(text)
  );
}

/** Nothing recorded, or recorded long enough ago to have been a different day. */
function attemptedRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    // A clock that has gone backwards would otherwise make an old note look
    // like the future and hold off every reload from here on.
    return at <= Date.now() && Date.now() - at < ATTEMPT_WINDOW_MS;
  } catch {
    // Private browsing, or storage switched off. Without somewhere to write the
    // note there is no way to tell a first failure from a second, and a loop is
    // the worse of the two mistakes - so this answers "already tried".
    return true;
  }
}

/**
 * Reloads onto the build the server is actually serving, if that has not just
 * been tried.
 *
 * Returns true when a reload is under way, so the caller can show the screen
 * that says so rather than an error nobody needs to read. False means it has
 * been tried already and did not help, and the caller should say something.
 */
export function reloadForStaleBuild(): boolean {
  // A phone that has simply lost signal produces the same rejection as a
  // replaced chunk, and reloading it does not fetch the missing file - it
  // throws the running app away and lands on the browser's own offline page,
  // from which there is no way back into the directory. Offline, the screen
  // saying so is the better answer.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (attemptedRecently()) return false;
  try {
    sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));
  } catch {
    // attemptedRecently answers true when storage will not answer, so this is
    // only reached where writing is possible; a throw here is still survivable.
  }
  window.location.reload();
  return true;
}

/**
 * The line to put on screen for a failure, or null when the app has started
 * reloading to fix it itself.
 *
 * For the screens that catch their own errors rather than letting the boundary
 * have them. The preview and the sample book both fetch the PDF engine when
 * somebody asks for a file, inside a try that shows whatever went wrong - so
 * after a deploy an administrator pressing Download got "Failed to fetch
 * dynamically imported module", which names the cause accurately and helps
 * nobody. Wrapping `message` in this hands those cases the same reload the
 * boundary would give them, and leaves every other failure worded as it was.
 */
export function failureMessage(cause: unknown, fallback?: string): string | null {
  if (isStaleBuildError(cause) && reloadForStaleBuild()) return null;
  return message(cause, fallback);
}

/**
 * Vite's own warning that a module it preloaded could not be fetched.
 *
 * It fires before the import that needs the module rejects, and cancelling the
 * event is what stops Vite throwing on top of it. Handling it here means the
 * ordinary case - a tap on a nav link right after a deploy - is a reload rather
 * than an error boundary, so nobody sees a crash screen for something that was
 * never broken.
 *
 * Called once, from main.tsx.
 */
export function watchForStaleChunks(): void {
  window.addEventListener("vite:preloadError", (event) => {
    // Reload, or let it through to the error boundary, which will say plainly
    // that reloading did not help rather than trying again.
    if (reloadForStaleBuild()) event.preventDefault();
  });
}
