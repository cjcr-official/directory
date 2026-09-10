/**
 * What a browse table draws after somebody has switched columns off.
 *
 * The stored value is a list of column keys in a browser's localStorage, which
 * makes it the one input to this app that nobody controls and nobody migrates:
 * it survives releases, it is edited by hand by the curious, and it is what a
 * device carries forward when the columns themselves are renamed. Every one of
 * those goes wrong quietly - a table comes back with a column missing, or with
 * one the reader turned off, and there is nothing on the screen to say why.
 *
 * So the cases below are the ones that are not the happy path: nothing stored,
 * something unreadable stored, a key for a column that no longer exists, and a
 * column added after a device had already made its choice.
 *
 *   npm run columns:check
 */
import { parseWidths, shownColumns } from "../src/lib/columns";
import { same } from "./check";

// The People table, in the order it reads in.
const ALL = ["family", "phone", "email", "birthday", "groups"] as const;

const stored = (...hidden: string[]) => JSON.stringify(hidden);

console.log("\nwhich columns a table draws\n");

same("a device that has never chosen", shownColumns(null, ALL), [...ALL]);
same("one column switched off", shownColumns(stored("email"), ALL), [
  "family",
  "phone",
  "birthday",
  "groups",
]);
same("several off", shownColumns(stored("phone", "email", "birthday"), ALL), ["family", "groups"]);
// A legitimate choice, and not the same as having chosen nothing: somebody who
// wants a list of names and faces and no more should get one.
same("all of them off", shownColumns(stored(...ALL), ALL), []);

console.log("\nthe order is the table's, not the storage's\n");

// Written back to front and with the ones still showing in between, because
// nothing stops a browser holding either. Which order the columns read in is
// the table's own business.
same("hidden keys in any order", shownColumns(stored("groups", "family"), ALL), [
  "phone",
  "email",
  "birthday",
]);

console.log("\na stored choice that has outlived the columns\n");

// The case the storage format exists for: a column added in a later release is
// not in anybody's hidden list, so it arrives switched on and in front of the
// people who can then turn it off - rather than missing, and missing silently.
same(
  "a column added since the choice was made",
  shownColumns(stored("email"), [...ALL, "gender"]),
  ["family", "phone", "birthday", "groups", "gender"],
);
same("a key that is no longer a column", shownColumns(stored("nickname", "email"), ALL), [
  "family",
  "phone",
  "birthday",
  "groups",
]);

console.log("\nnothing readable in storage\n");

// Every one of these is a table with columns missing if it is guessed at, so
// all of them mean the same thing: draw the lot.
same("an empty string", shownColumns("", ALL), [...ALL]);
same("not JSON at all", shownColumns("email,phone", ALL), [...ALL]);
same("JSON, but not a list", shownColumns('{"email":false}', ALL), [...ALL]);
same("the word null", shownColumns("null", ALL), [...ALL]);
same("an empty list", shownColumns("[]", ALL), [...ALL]);
// A list that is partly rubbish still knows its own mind about the rest.
same("a list with junk in it", shownColumns('["email",7,null]', ALL), [
  "family",
  "phone",
  "birthday",
  "groups",
]);

console.log("\nwidths somebody dragged\n");

same("nothing stored", parseWidths(null), {});
same("a column widened", parseWidths('{"email":270}'), { email: 270 });
same("several", parseWidths('{"name":190,"email":270}'), { name: 190, email: 270 });

// A width is a number of pixels or it is nothing. Each of these would
// otherwise reach the style attribute and take a column with it: a string
// width silently does nothing, a zero or a negative collapses the column to a
// line, and NaN takes the whole row's layout with it.
same("a width that is a string", parseWidths('{"email":"270"}'), {});
same("a width of zero", parseWidths('{"email":0}'), {});
same("a negative width", parseWidths('{"email":-40}'), {});
same("a null where a number was", parseWidths('{"email":null}'), {});
same("the good ones survive the bad", parseWidths('{"email":270,"name":"wide"}'), { email: 270 });

same("not JSON", parseWidths("email=270"), {});
same("a list, not an object", parseWidths('["email"]'), {});
same("the word null", parseWidths("null"), {});
