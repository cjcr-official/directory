/**
 * Whether somebody's background check has run out, and what the app says so.
 *
 * A date comparison looks like the last thing that needs a test until you
 * notice how many of the ways it goes wrong are silent. A due date parsed
 * through `new Date()` lands at UTC midnight and reads as yesterday west of
 * Greenwich, so a check due today is announced a day early - or, on the other
 * side, the day after it lapsed. A boundary drawn with `<` instead of `<=`
 * drops the person due today, which is the one day of the three years that
 * anything actually has to happen. A renewal three years on from 29 February
 * has no date to land on. And a congregation of four hundred people with no
 * checks recorded must come out as four hundred people nobody is tracking,
 * not four hundred overdue: that mistake would put the entire directory behind
 * the bell on the first afternoon and teach the office to stop looking.
 *
 * None of those throws. Every one of them looks exactly like the app working.
 *
 *   npm run background:check
 */
import {
  checkState,
  daysUntilDue,
  describeDue,
  DUE_SOON_DAYS,
  needingAttention,
  suggestDue,
  wantsAttention,
  type Checked,
} from "../src/lib/backgroundChecks";
import { check, same } from "./check";

/** Nine in the morning on Tuesday 3 March 2026, wherever this is running. */
const NOW = new Date(2026, 2, 3, 9, 0, 0);

/** A person, as this file sees one: two dates, either of which may be missing. */
function person(due: string | null, done: string | null = null): Checked {
  return { background_check_on: done, background_check_due: due };
}

const ids = (people: { id: string }[]) => people.map((one) => one.id);

console.log("\nwhere a person stands, counted in whole days\n");

same("due today", daysUntilDue(person("2026-03-03"), NOW), 0);
same("due tomorrow", daysUntilDue(person("2026-03-04"), NOW), 1);
same("a day past", daysUntilDue(person("2026-03-02"), NOW), -1);
// Across a month end and a leap year, where counting by hand goes wrong.
same("two months out", daysUntilDue(person("2026-05-02"), NOW), 60);
same("last year", daysUntilDue(person("2025-03-03"), NOW), -365);
same("nothing to count to", daysUntilDue(person(null), NOW), null);
same("a due date that is not one", daysUntilDue(person("some time in March"), NOW), null);

console.log("\nthe day is the day it is where somebody is reading the screen\n");

// The whole reason these are compared as calendar days rather than instants.
// Both of these are Tuesday the 3rd in the room; a date parsed as an instant
// would put the second one on Monday for anybody west of Greenwich, and the
// person due today would be announced as a day overdue.
same("first thing", daysUntilDue(person("2026-03-03"), new Date(2026, 2, 3, 0, 30)), 0);
same("last thing", daysUntilDue(person("2026-03-03"), new Date(2026, 2, 3, 23, 30)), 0);
// And the day really does turn over: a minute later is a minute into
// Wednesday, and yesterday's date is now behind.
same("just past midnight", daysUntilDue(person("2026-03-03"), new Date(2026, 2, 4, 0, 1)), -1);

console.log("\nuntracked is not overdue\n");

// The one that would have been unbearable. Most of a congregation is never
// checked - a directory is not a staff register - and reading those as lapsed
// would be four hundred names behind the bell.
same("nothing recorded at all", checkState(person(null), NOW), "untracked");
same("nobody to nag about", wantsAttention(person(null), NOW), false);
// A check done and no renewal date on it. Still nothing to say - there is no
// day to say it on - but not the same silence: the form offers a date.
same("done, with no renewal date", checkState(person(null, "2024-06-12"), NOW), "untracked");
same("a due date nobody can read", checkState(person("last spring"), NOW), "untracked");

console.log("\nthe two boundaries\n");

same("overdue by a day", checkState(person("2026-03-02"), NOW), "overdue");
// Today is due, not clear. It is the one day in three years on which somebody
// has to do something.
same("due today", checkState(person("2026-03-03"), NOW), "due-soon");
same("inside the window", checkState(person("2026-05-01"), NOW), "due-soon");
same("the last day of the window", checkState(person("2026-05-02"), NOW), "due-soon");
same("a day past the window", checkState(person("2026-05-03"), NOW), "clear");
same("years out", checkState(person("2029-06-12"), NOW), "clear");
check(
  "the window is where the module says it is",
  daysUntilDue(person("2026-05-02"), NOW) === DUE_SOON_DAYS,
  `${DUE_SOON_DAYS} days`,
);

console.log("\nthe line the tray, the table and the form all say\n");

same("nothing to report", describeDue(person(null), NOW), "");
same("today", describeDue(person("2026-03-03"), NOW), "Due today");
same("tomorrow", describeDue(person("2026-03-04"), NOW), "Due tomorrow");
same("this week", describeDue(person("2026-03-09"), NOW), "Due in 6 days");
// Days stop being useful somewhere around a fortnight: "in 43 days" is a
// number nobody converts.
same("a few weeks", describeDue(person("2026-04-15"), NOW), "Due in 6 weeks");
// Past the window nobody is doing anything this month, so the date itself is
// the useful fact rather than a countdown.
same("further out than that", describeDue(person("2029-06-12"), NOW), "Due 12 June 2029");
same("one day over", describeDue(person("2026-03-02"), NOW), "Overdue by 1 day");
same("a fortnight over", describeDue(person("2026-02-17"), NOW), "Overdue by 2 weeks");
same("months over", describeDue(person("2025-10-03"), NOW), "Overdue by 5 months");
// Months stop being a number anybody converts somewhere short of two years.
same("nearly two years over", describeDue(person("2024-06-03"), NOW), "Overdue by 21 months");
same("years over", describeDue(person("2023-03-03"), NOW), "Overdue by 3 years");
same("a very long time over", describeDue(person("2019-09-03"), NOW), "Overdue by 6 years");

console.log("\nthe list the tray works down\n");

const congregation = [
  { id: "clear", ...person("2029-01-01") },
  { id: "lapsed", ...person("2025-11-01") },
  { id: "untracked", ...person(null) },
  { id: "soon", ...person("2026-04-20") },
  { id: "long-lapsed", ...person("2024-02-02") },
  { id: "unreadable", ...person("whenever") },
];

// Most overdue first: this is a list to work down, and the top of it has been
// waiting longest.
same("the ones wanting attention, worst first", ids(needingAttention(congregation, NOW)), [
  "long-lapsed",
  "lapsed",
  "soon",
]);
same("an empty directory", ids(needingAttention([], NOW)), []);
same(
  "a directory where nobody is checked",
  ids(needingAttention([{ id: "a", ...person(null) }], NOW)),
  [],
);

console.log("\nthe date the form suggests, three years on\n");

same("an ordinary date", suggestDue("2024-06-12"), "2027-06-12");
same("the end of a month", suggestDue("2026-01-31"), "2029-01-31");
// 29 February has no anniversary in three years' time. Landing on the 28th
// keeps the renewal in the month somebody expected it in; rolling forward
// would put it in March.
same("a check done on a leap day", suggestDue("2024-02-29"), "2027-02-28");
same("and where the year it lands on has one", suggestDue("2024-02-29", 4), "2028-02-29");
same("a church that renews yearly", suggestDue("2026-06-12", 1), "2027-06-12");
// Nothing to count from, and no guess worth making from it.
same("no date to count from", suggestDue(null), null);
same("something that is not a date", suggestDue("June some time"), null);

// The suggestion has to survive the round trip, or the form would treat its
// own suggestion as somebody's typing and stop following the other date.
const suggested = suggestDue("2024-06-12");
same("a suggestion is a date the module can read again", daysUntilDue(person(suggested), NOW), 466);
