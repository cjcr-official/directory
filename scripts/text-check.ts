/**
 * That a character nobody can see cannot stop the book being printed.
 *
 * The standard PDF fonts speak WinAnsi and pdf-lib does not skip what it cannot
 * encode - it throws. That is the right behaviour for a library and the wrong
 * thing to happen to a church office, because measuring is where it happens:
 * every string in a directory goes through widthOfTextAtSize before a single
 * page is laid out, so one bad character anywhere in the congregation stops the
 * whole book rather than spoiling one card. The preview showed "WinAnsi cannot
 * encode" where the pages should have been, the PDF button did the same, and
 * nothing named the record it came from.
 *
 * A tab was enough. An <input> strips carriage returns out of anything pasted
 * into it and leaves tabs alone, so a name copied out of a spreadsheet cell or
 * off a web page carries one in, invisibly; a restore writes whatever the backup
 * file holds and asks nothing at all. Two of the fields a church actually types
 * into - a surname, and the title on the cover - reach the measurer without
 * passing through wrapText, which is the only thing that was collapsing
 * whitespace.
 *
 * So toWinAnsi folds the control characters now, and this holds it there. The
 * first half asks the question of the function; the second asks it of a whole
 * composed book, because that is the failure that actually happened and a unit
 * test of the fold alone would not have caught the path to it.
 *
 *   npm run text:check
 */
import { toWinAnsi } from "../src/lib/format";
import { buildDemoData } from "../src/lib/demo";
import { buildEntries } from "../src/lib/entries";
import { composeBook } from "../src/lib/layout/compose";
import { loadMetrics } from "../src/lib/layout/metrics";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/lib/layout/settings";
import { check, same } from "./check";

const metrics = await loadMetrics("sans");

/** Written this way so the file itself stays free of control characters. */
const ch = (code: number) => String.fromCharCode(code);
const TAB = ch(9);
const LF = ch(10);
const CR = ch(13);

console.log("\nwhat the fold does with a character that has no glyph\n");

same("a tab becomes the gap it looks like", toWinAnsi(`Mary${TAB}Smith`), "Mary Smith");
same("so does a newline", toWinAnsi(`Mary${LF}Smith`), "Mary Smith");
same("and a carriage return", toWinAnsi(`Mary${CR}Smith`), "Mary Smith");
same("a Windows line ending is two gaps, not one glyph", toWinAnsi(`a${CR}${LF}b`), "a  b");
// Nothing about these says "space", so they leave no trace rather than a stray
// one - a name is not wider for having had a bell character in it.
same("a control that is not a gap simply goes", toWinAnsi(`Mary${ch(7)}Smith`), "MarySmith");
same("delete goes the same way", toWinAnsi(`Mary${ch(127)}Smith`), "MarySmith");
same("so does the C1 range Latin-1 leaves empty", toWinAnsi(`Mary${ch(0x9d)}Smith`), "MarySmith");

console.log("\nand that it has not started folding things it should leave alone\n");

same("an ordinary name is untouched", toWinAnsi("Mary Smith"), "Mary Smith");
// Latin-1 has the accented letters a congregation actually uses, so they are
// not folded at all - they are simply drawn. Only a letter from outside it
// gets reduced to its base, which is the case the fold was written for.
same("an accent WinAnsi has is left alone", toWinAnsi("\u00c1vila"), "\u00c1vila");
same("one it has not folds to its letter", toWinAnsi("\u0100vila"), "Avila");
same("a curly apostrophe still straightens", toWinAnsi("O\u2019Neil"), "O'Neil");
same("a non-breaking space is still a space", toWinAnsi("Mary\u00a0Smith"), "Mary Smith");
// Latin-1 has these, and a directory of European surnames is full of them.
same(
  "a letter WinAnsi does have survives",
  toWinAnsi("M\u00fcller-L\u00fcdenscheidt"),
  "M\u00fcller-L\u00fcdenscheidt",
);

console.log("\nmeasuring never throws, whatever is in the field\n");

for (const [what, code] of [
  ["a tab", 9],
  ["a newline", 10],
  ["a vertical tab", 11],
  ["a form feed", 12],
  ["a carriage return", 13],
  ["a null", 0],
  ["an escape", 27],
  ["a delete", 127],
] as const) {
  let threw = "";
  try {
    metrics.widthOf(toWinAnsi(`a${ch(code)}b`), 10, "regular");
  } catch (cause) {
    threw = cause instanceof Error ? cause.message : String(cause);
  }
  check(`${what} in a measured string`, threw === "", threw);
}

console.log("\nand a whole book still composes with one dirty field in it\n");

/** The demo congregation, with one field spoiled the way a paste spoils one. */
function composes(what: string, spoil: (data: ReturnType<typeof buildDemoData>) => void): void {
  const data = buildDemoData();
  spoil(data);
  let threw = "";
  try {
    composeBook(buildEntries(data), normalizeSettings({ ...DEFAULT_SETTINGS }), metrics);
  } catch (cause) {
    threw = cause instanceof Error ? cause.message : String(cause);
  }
  check(what, threw === "", threw);
}

// The surname is the one that broke it: it reaches the index line through
// truncate, which shortens without collapsing whitespace the way wrapText does.
composes("a tab in a surname", (data) => {
  data.people[0].last_name = `Smith${TAB}Jones`;
});
composes("a newline in a first name", (data) => {
  data.people[0].first_name = `Mary${LF}`;
});
composes("a tab in a family's name", (data) => {
  data.households[0].display_name = `The Smith${TAB}Family`;
});
composes("a tab on an address line", (data) => {
  data.households[0].address_line1 = `123 Main St${TAB}Apt 4`;
});

// The other one that broke it: the cover title is measured directly, to work
// out what size it has to shrink to.
{
  const data = buildDemoData();
  let threw = "";
  try {
    composeBook(
      buildEntries(data),
      normalizeSettings({ ...DEFAULT_SETTINGS, cover: true, coverTitle: `Our${TAB}Church` }),
      metrics,
    );
  } catch (cause) {
    threw = cause instanceof Error ? cause.message : String(cause);
  }
  check("a tab in the cover title", threw === "", threw);
}
