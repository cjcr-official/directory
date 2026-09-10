/**
 * Which columns a browse table draws, remembered per device.
 *
 * A congregation that has never recorded a birthday still gets a birthday
 * column, a hundred rows deep in em dashes, and an office that keeps no email
 * addresses gets another one beside it. Seven columns is the right table for
 * the directory that fills all seven and the wrong one for everybody else, so
 * which of them appear is a choice somebody makes rather than a decision taken
 * here.
 *
 * What is stored is the columns turned *off*, not the ones left on. The
 * difference shows up on the day a column is added: stored as a list of what
 * to show, a new column would be missing for everyone who had ever opened the
 * picker, and missing silently - nothing on the screen would say a column
 * existed at all. Stored as a list of what to hide, a new column arrives
 * switched on, in front of the people who can then turn it off.
 *
 * Per device and in localStorage, like the theme and for the same reasons: a
 * phone and an office desktop are two screens with room for different numbers
 * of columns, and this is not worth a column in the database or a round trip
 * to fetch it. A phone draws a browse list as cards rather than as a table, so
 * on a phone the question does not arise.
 */

const PREFIX = "church-directory:columns:";

/** Everything unreadable is treated as "nothing hidden" - the whole table. */
function hiddenSet(stored: string | null): Set<string> {
  if (!stored) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set();
  }
}

/**
 * The columns to draw, from what a device stored and what the table has.
 *
 * The order comes from `all` rather than from storage: the order the columns
 * read in is the table's business, and only which of them appear is the
 * reader's. A stored key that is no longer a column is ignored, so a column
 * that gets renamed or dropped leaves nothing behind it.
 */
export function shownColumns<K extends string>(stored: string | null, all: readonly K[]): K[] {
  const hidden = hiddenSet(stored);
  return all.filter((key) => !hidden.has(key));
}

export function readColumns<K extends string>(table: string, all: readonly K[]): K[] {
  try {
    return shownColumns(localStorage.getItem(PREFIX + table), all);
  } catch {
    // Private browsing, or storage switched off. The whole table is a fine
    // answer, and a better one than failing to draw it.
    return [...all];
  }
}

export function rememberColumns<K extends string>(
  table: string,
  shown: readonly K[],
  all: readonly K[],
): void {
  const hidden = all.filter((key) => !shown.includes(key));
  try {
    localStorage.setItem(PREFIX + table, JSON.stringify(hidden));
  } catch {
    // Not worth failing over: the table is simply back to all of its columns
    // the next time this device opens it.
  }
}
