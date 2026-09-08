/**
 * How the line saying who last touched a record reads.
 *
 * "Changed on Tuesday by Anne" is one of the few strings in the app that is
 * wrong silently. A weekday that has drifted a day, a date missing the year it
 * happened in, or a name appearing against a row nobody signed - none of them
 * throw, none of them look broken, and all of them are believed. An office
 * uses this line to decide who to ask about an address, so being confidently
 * wrong is worse here than saying nothing.
 *
 * The cases below are the ones that move: the boundary between "yesterday" and
 * a weekday, the boundary between a weekday and a date, the turn of the year,
 * and every shape of missing data.
 *
 *   npm run changed:check
 */
import { describeChange, describeWhen } from "../src/lib/format";

const fails: string[] = [];
let ran = 0;

function check(what: string, got: string, want: string): void {
  ran += 1;
  if (got === want) {
    console.log(`PASS  ${what} — ${got === "" ? "(nothing)" : got}`);
  } else {
    fails.push(`${what}\n        wanted: ${want}\n        got:    ${got}`);
    console.log(`FAIL  ${what} — wanted ${want}, got ${got}`);
  }
}

/**
 * Local time throughout, because that is what describeWhen works in - a
 * timestamp is shown as the day it was in the room where somebody typed it.
 * Building the fixtures the same way keeps this test from passing in one
 * timezone and failing in another, which is exactly the bug it would be least
 * able to explain.
 */
function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}
const iso = (date: Date) => date.toISOString();

// Wednesday 4 March 2026, mid-afternoon. Every "now" below is this.
const now = at(2026, 3, 4, 15);

console.log("\nwhen a record was last written\n");

check("the same afternoon", describeWhen(iso(at(2026, 3, 4, 9)), now), "today");
check("a minute ago", describeWhen(iso(at(2026, 3, 4, 14)), now), "today");
// Not 24 hours ago - the day before. Eleven at night and one in the morning
// are fourteen hours apart and two different days, and "yesterday" is what a
// person calls the second one.
check("late last night", describeWhen(iso(at(2026, 3, 3, 23)), now), "yesterday");
check("early yesterday", describeWhen(iso(at(2026, 3, 3, 1)), now), "yesterday");

check("two days back", describeWhen(iso(at(2026, 3, 2)), now), "on Monday");
check("five days back", describeWhen(iso(at(2026, 2, 27)), now), "on Friday");
// Six days is the last one a weekday can be trusted for. At seven it would be
// the same weekday as today, and "on Wednesday" would be ambiguous between
// this morning and a week ago.
check("six days back", describeWhen(iso(at(2026, 2, 26)), now), "on Thursday");
check("seven days back", describeWhen(iso(at(2026, 2, 25)), now), "on 25 February");

check("earlier this year", describeWhen(iso(at(2026, 1, 9)), now), "on 9 January");
// The year appears only when it is not this one. Without it, a change from
// fourteen months ago would read as a fortnight ago.
check("last year", describeWhen(iso(at(2025, 12, 31)), now), "on 31 December 2025");
check("years back", describeWhen(iso(at(2019, 7, 4)), now), "on 4 July 2019");

// A clock that is behind can date a change tomorrow. A weekday would be a
// guess; the date is at least what was recorded.
check("a clock running ahead", describeWhen(iso(at(2026, 3, 5)), now), "on 5 March");

console.log("\nnothing to say\n");

check("no timestamp", describeWhen(null, now), "");
check("undefined", describeWhen(undefined, now), "");
check("an empty string", describeWhen("", now), "");
check("something that is not a date", describeWhen("last Tuesday", now), "");

console.log("\nthe whole line\n");

const tuesday = iso(at(2026, 3, 3));

check(
  "who and when",
  describeChange(tuesday, "Anne Whitfield", now),
  "Changed yesterday by Anne Whitfield",
);
// A row older than 0005, or one a service-role tool wrote, has a time and no
// author. It says when and stops rather than naming somebody it does not know.
check("a time but no author", describeChange(tuesday, null, now), "Changed yesterday");
check("an author that is only spaces", describeChange(tuesday, "   ", now), "Changed yesterday");
check("an author but no time", describeChange(null, "Anne Whitfield", now), "");
check("neither", describeChange(null, null, now), "");

console.log("");
if (fails.length) {
  console.error(`${fails.length} of ${ran} failed:\n`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`all ${ran} passed`);
