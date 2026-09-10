/**
 * What the tray says has arrived since somebody last looked.
 *
 * Every way this can be wrong is quiet. A marker compared as text instead of
 * as an instant announces nobody; a boundary an hour out announces the same
 * person twice; counting your own typing makes a badge nobody believes, and a
 * first sight that treats a whole congregation as unread makes one nobody can
 * clear. None of them throws, and all of them look like the app working.
 *
 * So the cases below are the ones that move: the moment either side of the
 * marker, a reader's own additions, a row somebody else has since edited, a
 * device that has never looked, and the shapes of timestamp a database and a
 * backup can actually produce.
 *
 *   npm run notifications:check
 */
import {
  addedBy,
  newestArrival,
  newToYou,
  readSeen,
  recentlyAdded,
  rememberSeen,
  subscribeSeen,
  type Arrival,
} from "../src/lib/notifications";
import { check, same } from "./check";

const ANNE = "anne-0000-0000-0000-000000000001";
const RAY = "ray-00000-0000-0000-000000000002";

interface Row extends Arrival {
  id: string;
}

/** A person, as the tray sees one: when they appeared, and who wrote the row. */
function row(id: string, created: string, by?: string | null, edited?: string): Row {
  const person: Row = { id, created_at: created, updated_at: edited ?? created };
  if (by !== undefined) person.updated_by = by;
  return person;
}

const ids = (people: Row[]) => people.map((person) => person.id);

// A week in a church office. Anne types Monday, Tuesday and Thursday in; Ray
// adds a family over the weekend.
const MON = "2026-03-02T09:15:00+00:00";
const TUE = "2026-03-03T14:40:00+00:00";
const THU = "2026-03-05T10:05:00+00:00";
const SAT = "2026-03-07T11:00:00+00:00";
const SUN = "2026-03-08T16:30:00+00:00";

const directory = [
  row("mon", MON, ANNE),
  row("tue", TUE, ANNE),
  row("thu", THU, ANNE),
  row("sat", SAT, RAY),
  row("sun", SUN, RAY),
];

console.log("\nwho added a person, where the row can still say\n");

same("nobody has touched it since", addedBy(row("a", MON, ANNE)), ANNE);
// updated_by is the last writer, not the creator. Once somebody else has
// corrected the record it can no longer name who added it, and the tray says
// nothing rather than naming the wrong person.
same("somebody has since corrected it", addedBy(row("a", MON, RAY, TUE)), null);
// Two ordinary absences: a database that has not run 0005, and a row written
// by the seed script or a restore, where there was no signed-in person.
same("a database without the column", addedBy({ created_at: MON, updated_at: MON }), null);
same("written by a tool", addedBy(row("a", MON, null)), null);

console.log("\nwhat is new to a reader\n");

// The case the whole tray exists for: Ray added a family over the weekend and
// Anne has not looked since Tuesday.
same("added since the marker", ids(newToYou(directory, TUE, ANNE)), ["sun", "sat"]);
same("newest first", ids(newToYou(directory, MON, RAY)), ["thu", "tue"]);

// The boundary. The marker is the created_at of a record that has been shown,
// so that record is behind it, not in front of it - otherwise the same person
// is announced again every time the panel is opened.
same("the record the marker names", ids(newToYou(directory, SUN, ANNE)), []);
same("a moment after it", ids(newToYou(directory, "2026-03-08T16:30:01+00:00", ANNE)), []);
same("a moment before it", ids(newToYou(directory, "2026-03-08T16:29:59+00:00", ANNE)), ["sun"]);

// Your own work is not news. Anne typed Thursday's record in herself, and it
// is the one row after the marker that her tray does not count.
same("a reader's own additions", ids(newToYou(directory, TUE, ANNE)).includes("thu"), false);
// The same week, read by the other administrator: what is new depends on who
// is asking, which is the whole reason the marker is per account.
same("the same week to somebody else", ids(newToYou(directory, TUE, RAY)), ["thu"]);

// A row Anne added and Ray has since corrected can no longer say who added
// it, so it is announced to her as well. That is the harmless direction: the
// other way round is silence about an arrival.
same(
  "your own row, edited by somebody else",
  ids(newToYou([row("late", SUN, RAY, "2026-03-09T09:00:00+00:00")], TUE, ANNE)),
  ["late"],
);

// Signed out, or an account whose id is not known yet. Everything after the
// marker counts - there is nobody for a row to belong to.
same("no reader to leave out", ids(newToYou(directory, TUE, null)), ["sun", "sat", "thu"]);

console.log("\na device that has never looked\n");

// The one that would have been unbearable: no marker means nothing is known
// to have been read, not that nothing has been. A new phone would otherwise
// open on a badge counting the whole congregation.
same("nothing stored", ids(newToYou(directory, null, ANNE)), []);
same("something unreadable stored", ids(newToYou(directory, "last Tuesday", ANNE)), []);

console.log("\ntimestamps as a database and a backup actually write them\n");

// Compared as instants, never as text. PostgREST writes "+00:00", a backup
// round-tripped through JSON writes "Z", and a project on local time writes
// an offset - all three are the same moment written three ways, and string
// comparison gets two of the three wrong.
same(
  "the same instant, spelt differently",
  ids(newToYou([row("z", "2026-03-08T16:30:00Z", RAY)], SUN, ANNE)),
  [],
);
same(
  "an offset that is not UTC",
  ids(newToYou([row("mt", "2026-03-08T09:30:00-07:00", RAY)], SUN, ANNE)),
  [],
);
same(
  "an hour later in another zone",
  ids(newToYou([row("mt", "2026-03-08T10:30:00-07:00", RAY)], SUN, ANNE)),
  ["mt"],
);

// A row that cannot be placed in time is left out rather than sorted to one
// end, where it would either sit permanently at the top of the panel or be
// announced for ever.
const undateable = [...directory, row("nonsense", "not a date", RAY)];
same("an unreadable created_at", ids(newToYou(undateable, TUE, ANNE)), ["sun", "sat"]);
same("and out of the list too", ids(recentlyAdded(undateable, 12)).includes("nonsense"), false);

console.log("\nwhat the panel lists\n");

// Not only the unread ones: a panel that empties itself when it is opened has
// nothing to say the second time.
same("newest first, whoever added them", ids(recentlyAdded(directory, 12)), [
  "sun",
  "sat",
  "thu",
  "tue",
  "mon",
]);
same("capped at the limit", ids(recentlyAdded(directory, 2)), ["sun", "sat"]);
same("fewer than the limit", ids(recentlyAdded([row("one", MON, ANNE)], 12)), ["one"]);
same("an empty directory", ids(recentlyAdded([], 12)), []);

console.log("\nthe marker the tray stores when it is opened\n");

// Verbatim, not rebuilt from a Date: rounding the microseconds off would
// leave the newest arrival a hair in front of the marker meant to cover it,
// and it would be new for ever.
const precise = "2026-03-08T16:30:00.123456+00:00";
same(
  "the newest created_at, as written",
  newestArrival([row("a", MON), row("b", precise)]),
  precise,
);
check(
  "microseconds survive",
  newestArrival([row("b", precise)]) === precise,
  "the marker was rebuilt from a Date",
);
same("nobody in the directory yet", newestArrival([]), null);
same("nothing dateable in it", newestArrival([row("nonsense", "not a date")]), null);

// Opening the panel is what clears the count: mark through the newest record
// there is, and ask again.
const marker = newestArrival(directory) as string;
same("everything is read once the panel opens", ids(newToYou(directory, marker, ANNE)), []);
same(
  "and the next arrival is new again",
  ids(newToYou([...directory, row("mon-next", "2026-03-09T08:00:00+00:00", RAY)], marker, ANNE)),
  ["mon-next"],
);

console.log("\nremembering what has been read, where nothing can be stored\n");

// Node has no localStorage at all, which is the case this has to survive on a
// phone: private browsing, or storage switched off. The marker is held in
// memory as well as written, so a visit can still clear its own count - it
// simply starts again tomorrow.
same("nothing read yet", readSeen(ANNE), null);
rememberSeen(ANNE, SUN);
same("read back after storing", readSeen(ANNE), SUN);
same("another account is another reader", readSeen(RAY), null);
same("nobody signed in", readSeen(null), null);

// The bell is rendered twice and only ever drawn once. The copy that is not
// on screen has to hear that the marker moved, or it comes back carrying a
// count that was read on the other one - which is what a phone turned on its
// side does, since 852px is a desk as far as the stylesheet is concerned.
let told = 0;
const stop = subscribeSeen(() => {
  told += 1;
});
rememberSeen(ANNE, "2026-03-09T08:00:00+00:00");
same("the other bell is told", told, 1);
stop();
rememberSeen(ANNE, SUN);
same("and stops being told once it is gone", told, 1);
