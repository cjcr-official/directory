/**
 * Who has arrived in the directory since somebody last looked.
 *
 * A congregation is kept by two or three people who are rarely at the same
 * desk on the same afternoon, and until now a person added on Tuesday was
 * invisible to everybody else: the app drew the same list of names it drew
 * before, only one longer. Nobody found out until the print run, or until the
 * second half of a family was typed in twice.
 *
 * What counts as new is a fact about a reader and not about a row - two
 * administrators looking at one directory have been shown different halves of
 * it - so each browser keeps a marker: the moment through which its reader has
 * been shown everything. Everything after that marker is the tray, and the
 * rows it is worked out from are the ones the app already holds in memory.
 *
 * The marker is a created_at the database wrote, never a clock reading taken
 * here. A browser's clock is its own business: a phone running four minutes
 * fast would write a marker into the future and quietly mark the next four
 * minutes of arrivals as already seen. Two values the database wrote are the
 * one comparison no clock can spoil.
 *
 * Kept per device in localStorage, like the theme and the column choices, and
 * keyed by account on top of that - a church office computer is shared, and
 * the next person to sign in on it has not read anything.
 */

const SEEN = "church-directory:new-people-seen:";

/**
 * The part of a person this file reasons about.
 *
 * Narrower than PersonRow on purpose: everything below is about when a record
 * appeared and who put it there, so a test can put three fields to it rather
 * than inventing a congregation. The functions stay generic, so what goes in
 * as a PersonRow comes back out as one.
 */
export interface Arrival {
  created_at: string;
  updated_at: string;
  /** Absent on a database that has not run migration 0005. */
  updated_by?: string | null;
}

/** Milliseconds, or null for a timestamp that cannot be read as one. */
function at(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Who added this person, where the row can still say.
 *
 * There is no created_by column, and updated_by is the *last* writer - so it
 * names the person who added the record only while nobody has written it
 * since. created_at and updated_at are set from the same now() on insert, so
 * a row whose two timestamps still agree has never been edited and its author
 * is its creator.
 *
 * Anything else answers null, which reads as "nobody can say" rather than as
 * a guess. That errs towards announcing a person to somebody who already knew
 * about them - a row you added and somebody else has since corrected - which
 * is the harmless direction. The other way round is silence about an arrival.
 */
export function addedBy(person: Arrival): string | null {
  const born = at(person.created_at);
  return born !== null && born === at(person.updated_at) ? (person.updated_by ?? null) : null;
}

/** Newest first, and anything undateable left out - it cannot be placed. */
function newestFirst<T extends Arrival>(people: readonly T[]): T[] {
  return people
    .filter((person) => at(person.created_at) !== null)
    .map((person) => ({ person, born: at(person.created_at) as number }))
    .sort((a, b) => b.born - a.born)
    .map((dated) => dated.person);
}

/**
 * The people added since the marker that this reader had no hand in.
 *
 * Their own additions are left out. Somebody who has just typed a family in
 * does not need a badge telling them about the four people they typed, and a
 * tray that counts your own work is a tray you learn to ignore.
 */
export function newToYou<T extends Arrival>(
  people: readonly T[],
  seenAt: string | null,
  viewerId: string | null,
): T[] {
  const since = at(seenAt);
  // No marker yet, so this browser has no idea what its reader has already
  // been shown. The honest answer to that is nothing - the alternative is a
  // whole congregation announced as though it arrived this morning.
  if (since === null) return [];

  return newestFirst(people).filter((person) => {
    if ((at(person.created_at) as number) <= since) return false;
    return !(viewerId && addedBy(person) === viewerId);
  });
}

/**
 * The most recent arrivals, whoever added them and whoever has seen them.
 *
 * This is what the tray lists, rather than only the unread ones: a panel that
 * empties itself the moment it is opened has nothing to say the second time,
 * and "who has been added lately" is worth an answer on any day of the week.
 * Your own additions belong here too - leaving them out would make a record
 * you just saved look as though it had not been.
 */
export function recentlyAdded<T extends Arrival>(people: readonly T[], limit: number): T[] {
  return newestFirst(people).slice(0, limit);
}

/**
 * When the most recent arrival arrived, or null for a directory with nobody
 * in it yet.
 *
 * Two callers, one question. It is the marker to store once a reader has been
 * shown everything the app is holding, and it is also the point the app asks
 * the database about when it wants to know whether anything has landed since.
 *
 * Returned exactly as the database wrote it, not re-serialised through a Date,
 * which would round the microseconds off and leave the newest arrival a hair
 * in front of the marker meant to cover it - new for ever.
 */
export function newestArrival(people: readonly Arrival[]): string | null {
  let newest: number | null = null;
  let marker: string | null = null;
  for (const person of people) {
    const born = at(person.created_at);
    if (born === null || (newest !== null && born <= newest)) continue;
    newest = born;
    marker = person.created_at;
  }
  return marker;
}

/**
 * What each account has been shown, and everything that wants to know.
 *
 * Held in memory as well as in storage, and for two reasons. The bell is
 * rendered twice - once on the phone's bar, once in the sidebar - and only
 * one of the two is ever drawn; left to their own copies they would disagree
 * the moment a window crossed the width where the layout changes, which a
 * phone turned on its side does (852px is a desk as far as the stylesheet is
 * concerned), and the bell that had not been opened would still be carrying a
 * count somebody had already read. The second reason is a browser that will
 * not store anything at all - private mode, or storage switched off - where
 * an in-memory marker at least lasts as long as the visit.
 */
const markers = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * What this account has been shown, on this device.
 *
 * Null covers two cases that want the same treatment: a reader who has never
 * opened the app on this browser, and a browser that will not answer at all.
 * Both mean nothing is known to have been read, and newToYou answers nothing
 * rather than everything.
 */
export function readSeen(accountId: string | null): string | null {
  if (!accountId) return null;
  const held = markers.get(accountId);
  if (held) return held;
  try {
    const stored = localStorage.getItem(SEEN + accountId);
    if (stored) markers.set(accountId, stored);
    return stored;
  } catch {
    return null;
  }
}

export function rememberSeen(accountId: string | null, marker: string): void {
  if (!accountId) return;
  markers.set(accountId, marker);
  try {
    localStorage.setItem(SEEN + accountId, marker);
  } catch {
    // A device that cannot remember starts its tray fresh tomorrow. That is a
    // worse tray, not a broken app - and this visit still works.
  }
  for (const listener of listeners) listener();
}

/** Tells both bells when the marker moves. Returns the way to stop listening. */
export function subscribeSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
