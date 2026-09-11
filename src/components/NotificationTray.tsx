import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { Avatar } from "@/components/ui";
import type { HouseholdRow, PersonRow } from "@/lib/database.types";
import { describeWhen, fullName, personPhotoPath } from "@/lib/format";
import { checkState, describeDue, needingAttention } from "@/lib/backgroundChecks";
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
 * One person in the panel: their face, their name, and one line about them.
 *
 * Shared by both lists on purpose. They say different things - one is who
 * arrived, the other is whose clearance has run out - but they are the same
 * row, and two lists of the same congregation that indent differently is the
 * sort of thing nobody names and everybody notices.
 */
function TrayRow({
  person,
  household,
  onFollow,
  tag,
  line,
}: {
  person: PersonRow;
  household: HouseholdRow | null;
  onFollow: () => void;
  /** Sits beside the name. */
  tag?: ReactNode;
  /** The line underneath it. */
  line: ReactNode;
}) {
  return (
    <li className="tray-item">
      <Link className="tray-link" to={`/people/${person.id}`} onClick={onFollow}>
        <Avatar
          path={personPhotoPath(person, household)}
          initials={`${person.first_name[0] ?? ""}${person.last_name[0] ?? ""}`}
        />
        <span className="tray-who">
          <span className="tray-name">
            {fullName(person)}
            {tag}
          </span>
          {line}
        </span>
      </Link>
    </li>
  );
}

/**
 * The bell, and what is waiting behind it.
 *
 * Two kinds of thing, and they are behind one bell because an office has one
 * habit, not two. A directory is kept by more than one person and the app gave
 * no sign of it: everybody's work lands in the same alphabetical list, where a
 * family added on Tuesday is four names that were not there before and look
 * exactly like the four hundred that were. And a background check quietly
 * expires - nothing on any screen changes on the day it does, and the way
 * that gets found out is somebody asking, years late, whether the person
 * driving the youth bus was ever cleared.
 *
 * People, not families: a person is what gets added and what gets checked, and
 * counting families as well would announce one arrival twice.
 *
 * The two behave differently and the difference is the point.
 *
 * An arrival is news, so it is measured against a marker kept per account on
 * this device - worked out in lib/notifications - and reading it is what makes
 * it stop counting. Opening the panel moves the marker on, which is what
 * clears that half of the count; while the panel is open it goes on drawing
 * against the marker it opened with, so opening it never wipes the thing it
 * was opened to read.
 *
 * A check that has run out is not news, it is work. It cannot be read away,
 * and the count only goes down when somebody records the renewal or archives
 * the person. That is a badge you cannot clear by looking at it, which is
 * normally how a badge earns its way into being ignored - and it is still the
 * right answer here, because the alternative is a reminder that stops
 * reminding, and because the number falling is exactly the thing the office is
 * trying to make happen.
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

  /** New to this reader, and half of the number on the bell. */
  const unread = useMemo(() => newToYou(people, seen, accountId), [people, seen, accountId]);
  /** The same as of the moment the panel opened - what carries the New tags. */
  const fresh = useMemo(
    () => new Set(newToYou(people, showing, accountId).map((person) => person.id)),
    [people, showing, accountId],
  );
  const listed = useMemo(() => recentlyAdded(people, LISTED), [people]);

  /**
   * Whose background check has run out, or is about to.
   *
   * Archived people are left out. A record kept out of every book is one the
   * office has already set aside - somebody who has moved away, or died - and
   * a reminder to renew their clearance is a reminder about nobody, which is
   * the kind of entry that teaches a person to stop reading the list.
   *
   * Not capped, unlike the arrivals above it. Twelve is the right number of
   * recent additions to show because the thirteenth is old news; every line
   * here is a job somebody still has to do, and an office with forty lapsed
   * checks is an office that needs to see forty. The panel scrolls.
   *
   * Worked out against the day this renders. A window left open across
   * midnight keeps yesterday's answer until something else pulls the
   * directory in again, which is a day's delay on a date three years in the
   * making.
   */
  const due = useMemo(
    () => needingAttention(people.filter((person) => person.is_active)),
    [people],
  );

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

    // Every arrival the app is holding has now been put in front of them. The
    // marker is the newest record rather than the clock, so a browser running
    // a few minutes fast cannot mark the next few minutes of arrivals read.
    // The checks are untouched: looking at a lapsed clearance does not renew
    // it.
    rememberSeen(accountId, newestArrival(people) ?? new Date().toISOString());
  }

  const count = unread.length + due.length;
  /**
   * What the bell says to a screen reader, and on hover.
   *
   * Both halves, spelt out, because "3" over a bell tells somebody there is
   * something to do and nothing about what - and the two halves are not the
   * same errand.
   */
  const label = [
    unread.length
      ? `${unread.length} ${unread.length === 1 ? "person" : "people"} added since you last looked`
      : null,
    due.length ? `${due.length} background ${due.length === 1 ? "check" : "checks"} due` : null,
  ].filter(Boolean);
  const title = label.length ? `Notices: ${label.join(", ")}` : "Notices";

  /* Sections only once there is more than one thing in here. A panel that is
     nothing but arrivals wants a heading over them as much as a one-item menu
     wants a title. */
  const sectioned = due.length > 0;

  return (
    <div className="tray">
      <button
        type="button"
        ref={button}
        className={`tray-btn${count ? " unread" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={title}
        title={title}
        onClick={toggle}
      >
        <Bell />
        <span className="tray-btn-label">Notices</span>
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
          <div className="tray-panel" id={panelId} role="group" aria-label="Notices" style={anchor}>
            <div className="tray-head">
              <span className="tray-title">Notices</span>
              <span className="muted small tray-state">
                {due.length && fresh.size
                  ? `${due.length} due · ${fresh.size} new`
                  : due.length
                    ? `${due.length} due`
                    : fresh.size
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
                aria-label="Close notices"
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

            {/* One box around everything between the head and the foot: on a
                phone this is the only thing that scrolls, and it has to hold
                whichever of the sections below are there. */}
            <div className="tray-body">
              {/* Checks first, because they are the half somebody has to do
                  something about. Who arrived is worth knowing; a clearance
                  that ran out in March is worth knowing today. */}
              {due.length ? (
                <>
                  <h3 className="tray-section">Background checks</h3>
                  <ul className="tray-list">
                    {due.map((person) => {
                      const household = person.household_id
                        ? (householdById.get(person.household_id) ?? null)
                        : null;
                      const late = checkState(person) === "overdue";
                      return (
                        <TrayRow
                          key={person.id}
                          person={person}
                          household={household}
                          onFollow={close}
                          line={
                            <span className={`small due-note${late ? " late" : ""}`}>
                              {describeDue(person)}
                            </span>
                          }
                        />
                      );
                    })}
                  </ul>
                </>
              ) : null}

              {sectioned ? <h3 className="tray-section">Recently added</h3> : null}

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
                      <TrayRow
                        key={person.id}
                        person={person}
                        household={household}
                        onFollow={close}
                        tag={fresh.has(person.id) ? <span className="tray-new">New</span> : null}
                        /* Who arrived and when, and nothing else. The family
                           was on this line too and it was the longest part of
                           it - a second name, in brackets, wrapping every row
                           onto three lines to repeat what the surname above
                           had already said. It is one tap away on the record
                           itself. */
                        line={
                          <span className="muted small">
                            {when ? `Added ${when}${who ? ` by ${who}` : ""}` : null}
                          </span>
                        }
                      />
                    );
                  })}
                </ul>
              ) : (
                <p className="tray-empty muted small">
                  Nobody has been added to the directory yet. When somebody is, they will show up
                  here.
                </p>
              )}
            </div>

            <Link className="tray-foot" to="/people" onClick={close}>
              All people
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
