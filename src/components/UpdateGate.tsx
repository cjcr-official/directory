import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { APP_VERSION, fetchDeployedVersion } from "@/lib/version";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Long enough that the screen reads as an answer rather than a flicker. */
const SHOW_SCREEN_MS = 900;
const FIRST_CHECK_MS = 5000;
const ATTEMPT_KEY = "directory:update-attempt";
const MAX_ATTEMPTS = 2;

type Attempt = { version: string; count: number };

function readAttempt(): Attempt | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Attempt).version === "string" &&
      typeof (parsed as Attempt).count === "number"
    ) {
      return parsed as Attempt;
    }
    return null;
  } catch {
    // Private browsing can make sessionStorage throw on read. Losing the
    // loop guard is survivable; crashing the app over it is not.
    return null;
  }
}

function writeAttempt(attempt: Attempt | null): void {
  try {
    if (attempt) sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    else sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* see readAttempt */
  }
}

function UpdatingScreen() {
  return (
    <div className="update-screen" role="status" aria-live="polite">
      <div className="update-screen-inner">
        <Logo className="update-screen-logo" />
        <span className="spinner on-dark" aria-hidden />
        <p className="update-screen-title">Updating the directory</p>
        <p className="update-screen-sub">Fetching the newest version.</p>
      </div>
    </div>
  );
}

/**
 * Notices when the copy of the app running in this browser is older than the
 * one being served, and moves it onto the new one.
 *
 * This matters most on a phone. Added to the Home Screen the app is suspended
 * rather than closed, so a single page load can stay alive for weeks - long
 * enough to be several deploys behind without anything on screen suggesting
 * it. Reopening the app is therefore the main moment we check.
 *
 * A reload throws away anything unsaved, so it never happens over the top of
 * someone's typing: that case gets a bar they can act on when they are ready.
 */
export function UpdateGate() {
  const { pathname } = useLocation();
  const [pending, setPending] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const editedRef = useRef(false);

  // Arriving on the version we were chasing means the update worked, so the
  // loop guard starts clean for whatever comes next.
  useEffect(() => {
    const attempt = readAttempt();
    if (attempt && attempt.version === APP_VERSION) writeAttempt(null);
  }, []);

  useEffect(() => {
    const onEdit = (event: Event) => {
      const target = event.target;
      // Inside a form specifically: a search box or a filter is not work
      // anyone minds retyping, and treating it as such would hold the update
      // back on every browse screen.
      if (target instanceof HTMLElement && target.closest("form")) editedRef.current = true;
    };
    // Capture, so it still sees events from fields that stop propagation.
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);

  // A navigation ends whatever was being filled in - it was either saved or
  // abandoned - so there is nothing left for a reload to lose.
  useEffect(() => {
    editedRef.current = false;
    setDismissed(false);
  }, [pathname]);

  useEffect(() => {
    const controller = new AbortController();
    const run = () => {
      void fetchDeployedVersion(controller.signal).then((deployed) => {
        if (deployed && deployed !== APP_VERSION) setPending(deployed);
      });
    };

    // Not during the first paint; the initial load has better uses for the
    // connection.
    const first = window.setTimeout(run, FIRST_CHECK_MS);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
    };
  }, []);

  const beginUpdate = useCallback((target: string) => {
    const attempt = readAttempt();
    writeAttempt({
      version: target,
      count: attempt && attempt.version === target ? attempt.count + 1 : 1,
    });
    setUpdating(true);
  }, []);

  useEffect(() => {
    if (!updating) return;
    const timer = window.setTimeout(() => window.location.reload(), SHOW_SCREEN_MS);
    return () => clearTimeout(timer);
  }, [updating]);

  // The preview renders a book and the backup builds a zip file; neither is a
  // form, and neither should be interrupted halfway.
  const busy = pathname === "/backup" || pathname.endsWith("/preview");

  useEffect(() => {
    if (!pending || updating) return;
    // editedRef is a ref rather than state on purpose - typing must not
    // re-render the whole app. This effect re-runs on navigation, which is
    // also where the flag is cleared, so the pair stays in step.
    if (editedRef.current || busy) return;

    // Reloading into the same old version means something upstream is serving
    // stale HTML. Trying forever would leave the app in a reload loop, which
    // is worse than being a version behind.
    const attempt = readAttempt();
    if (attempt && attempt.version === pending && attempt.count >= MAX_ATTEMPTS) return;

    beginUpdate(pending);
  }, [pending, updating, busy, pathname, beginUpdate]);

  if (updating) return <UpdatingScreen />;
  if (!pending || dismissed) return null;

  return (
    <div className="update-bar" role="status">
      <span className="update-bar-text">
        A newer version of the directory is ready. Finish what you are doing, then reload.
      </span>
      <span className="row tight update-bar-actions">
        <button type="button" className="btn primary small" onClick={() => beginUpdate(pending)}>
          Reload now
        </button>
        <button type="button" className="btn ghost small" onClick={() => setDismissed(true)}>
          Later
        </button>
      </span>
    </div>
  );
}
