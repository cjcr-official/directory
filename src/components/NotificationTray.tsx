import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Avatar } from "@/components/ui";
import { describeWhen, fullName, join, labelledHouseholdName, personPhotoPath } from "@/lib/format";
import {
  addedBy,
  newestArrival,
  newToYou,
  readSeen,
  recentlyAdded,
  rememberSeen,
  subscribeSeen,
} from "@/lib/notifications";

/**
 * How many arrivals the panel lists.
 *
 * Enough for a fortnight in an ordinary church office, or for a family typed
 * in one evening, and few enough that the panel is read rather than scrolled.
 * The number on the bell is not capped by it: being told twelve when it is
 * forty would be a lie in the one place the tray has to be trusted.
 */
const LISTED = 12;

function Bell() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d="M18 8.5a6 6 0 10-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.7 19.5a2 2 0 01-3.4 0" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The bell, and the people who have arrived behind it.
 *
 * A directory is kept by more than one person and the app gave no sign of it:
 * everybody's work lands in the same alphabetical list, where a family added
 * on Tuesday is four names that were not there before and look exactly like
 * the four hundred that were. The office found out at the print run, or when
 * somebody typed the same person in twice.
 *
 * People, not families: a person is what gets added, a family is a grouping
 * laid over records that already exist, and counting both would announce one
 * arrival twice.
 *
 * Which of them are new to *this* reader is worked out in lib/notifications,
 * against a marker kept per account on this device. Opening the panel moves
 * the marker on, which is what clears the count - while the panel is open it
 * goes on drawing against the marker it opened with, so opening it never
 * wipes the thing it was opened to read.
 */
export function NotificationTray() {
  const { profile } = useAuth();
  const { people, householdById, authorName } = useDirectory();
  const accountId = profile?.id ?? null;

  const [open, setOpen] = useState(false);
  /**
   * What this reader has been shown, read from where both bells keep it -
   * this component is rendered twice and they have to agree. Moved on by
   * opening the panel.
   */
  const seen = useSyncExternalStore(subscribeSeen, () => readSeen(accountId));
  /** The marker the open panel draws against, frozen where it stood on opening. */
  const [showing, setShowing] = useState<string | null>(() => readSeen(accountId));
  const [anchor, setAnchor] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  /**
   * A first sight is not an unread pile.
   *
   * Somebody signing in on a new phone has read nothing on it, and without
   * this the whole congregation would be announced to them as though it had
   * arrived that morning. The marker is seeded with the newest record there
   * is, so the tray starts empty and fills with whatever happens next.
   *
   * Keyed on the account alone. `people` is deliberately not a dependency:
   * the directory is loaded before the shell draws, and re-running this on
   * every reload would walk the marker past arrivals nobody had been shown.
   */
  useEffect(() => {
    const stored = readSeen(accountId);
    const marker = stored ?? newestArrival(people) ?? new Date().toISOString();
    if (!stored) rememberSeen(accountId, marker);
    setShowing(marker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  /** New to this reader, and the number on the bell. */
  const unread = useMemo(() => newToYou(people, seen, accountId), [people, seen, accountId]);
  /** The same as of the moment the panel opened - what carries the New tags. */
  const fresh = useMemo(
    () => new Set(newToYou(people, showing, accountId).map((person) => person.id)),
    [people, showing, accountId],
  );
  const listed = useMemo(() => recentlyAdded(people, LISTED), [people]);

  const close = useCallback(() => {
    setOpen(false);
    setShowing(seen);
  }, [seen]);

  /*
   * Installed to the Home Screen, the strip behind the home indicator is
   * painted from the document's background rather than from anything drawn
   * over it - and on a phone this panel is the whole screen, in its own
   * colour. So the document has to be told the sheet is up, or it ends on a
   * band of the page underneath. The stylesheet also says this with
   * :has(.tray-panel); this is the half that cannot fail to match, exactly as
   * the drawer does it in AppShell.
   */
  useEffect(() => {
    document.documentElement.classList.toggle("tray-open", open);
    return () => document.documentElement.classList.remove("tray-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      // Back to the bell rather than to the top of the document, as the
      // column picker does.
      button.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    // The panel is pinned to where the bell was when it opened, and a window
    // that changes size takes the bell somewhere else.
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  function toggle() {
    if (open) {
      close();
      return;
    }

    /*
     * Where the panel hangs.
     *
     * Measured rather than left to the stylesheet, because the bell sits in
     * two places - the top bar on a phone, the sidebar on a desk - and the
     * sidebar scrolls, so a panel positioned inside it would be cut off at
     * that edge. Fixed to the viewport at the bell's own corner instead. The
     * measurements go out as custom properties, which leaves the phone rules
     * free to override them with an ordinary rule and stretch the panel
     * across the screen.
     */
    const at = button.current?.getBoundingClientRect();
    setAnchor({
      "--tray-top": `${Math.round((at?.bottom ?? 0) + 8)}px`,
      "--tray-left": `${Math.round(at?.left ?? 0)}px`,
    } as CSSProperties);
    setOpen(true);

    // Everything the app is holding has now been put in front of them. The
    // marker is the newest record rather than the clock, so a browser running
    // a few minutes fast cannot mark the next few minutes of arrivals read.
    rememberSeen(accountId, newestArrival(people) ?? new Date().toISOString());
  }

  const count = unread.length;
  const label = count
    ? `What's new: ${count} ${count === 1 ? "person" : "people"} added since you last looked`
    : "What's new";

  return (
    <div className="tray">
      <button
        type="button"
        ref={button}
        className={`tray-btn${count ? " unread" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        <Bell />
        <span className="tray-btn-label">What&apos;s new</span>
        {count ? (
          <span className="tray-count" aria-hidden>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* As the column picker's: somewhere harmless to click, so closing
              the panel does not also open whatever was underneath it. */}
          <div className="tray-scrim" onClick={close} />
          {/* A group rather than a dialog, as the column picker is: nothing
              here traps the focus or waits for an answer, and saying dialog
              to a screen reader promises both. */}
          <div
            className="tray-panel"
            id={panelId}
            role="group"
            aria-label="What's new"
            style={anchor}
          >
            <div className="tray-head">
              <span className="tray-title">What&apos;s new</span>
              <span className="muted small tray-state">
                {fresh.size
                  ? `${fresh.size} since you last looked`
                  : listed.length
                    ? "Nothing new"
                    : "Nothing yet"}
              </span>
              {/* On a phone this panel is the screen, so there is no outside
                  left to tap: the way out has to be in the sheet itself. On a
                  desk the stylesheet hides it, where anywhere-but-here and
                  Escape already close a panel that small. */}
              <button
                type="button"
                className="tray-close"
                aria-label="Close what's new"
                onClick={close}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {listed.length ? (
              <ul className="tray-list">
                {listed.map((person) => {
                  const household = person.household_id
                    ? (householdById.get(person.household_id) ?? null)
                    : null;
                  const author = addedBy(person);
                  const who = author && author === accountId ? "you" : authorName(author);
                  const when = describeWhen(person.created_at);
                  return (
                    <li key={person.id} className="tray-item">
                      <Link className="tray-link" to={`/people/${person.id}`} onClick={close}>
                        <Avatar
                          path={personPhotoPath(person, household)}
                          initials={`${person.first_name[0] ?? ""}${person.last_name[0] ?? ""}`}
                        />
                        <span className="tray-who">
                          <span className="tray-name">
                            {fullName(person)}
                            {fresh.has(person.id) ? <span className="tray-new">New</span> : null}
                          </span>
                          <span className="muted small">
                            {join([
                              when ? `Added ${when}${who ? ` by ${who}` : ""}` : null,
                              household ? labelledHouseholdName(household) : null,
                            ])}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="tray-empty muted small">
                Nobody has been added to the directory yet. When somebody is, they will show up
                here.
              </p>
            )}

            <Link className="tray-foot" to="/people" onClick={close}>
              All people
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
