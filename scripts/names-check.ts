/**
 * Which names the forms treat as the same person, or the same family.
 *
 * A matcher that stops matching does not throw - the warning simply never
 * appears, and the second John Smith gets typed in. That is the failure this
 * counts.
 *
 * Run with: npm run names:check
 */

import {
  labelledHouseholdName,
  sameDisplayName,
  samePersonName,
  suggestOfficeLabel,
} from "@/lib/format";
import type { PersonRow } from "@/lib/database.types";

let failures = 0;

function check(what: string, got: unknown, want: unknown): void {
  const same = got === want;
  if (!same) failures += 1;
  console.log(`  ${same ? "ok  " : "FAIL"} ${what}${same ? "" : `  got ${String(got)}`}`);
}

type Named = Pick<PersonRow, "first_name" | "last_name" | "preferred_name">;
const who = (first: string, last: string, preferred: string | null = null): Named => ({
  first_name: first,
  last_name: last,
  preferred_name: preferred,
});

console.log("\nthe same person typed in twice");
{
  check("exactly the same name", samePersonName(who("John", "Smith"), who("John", "Smith")), true);
  check("different capitals", samePersonName(who("john", "SMITH"), who("John", "Smith")), true);
  check("stray spaces", samePersonName(who("  John ", " Smith  "), who("John", "Smith")), true);
  check(
    "an accent typed one time and not the other",
    samePersonName(who("María", "Ávila"), who("Maria", "Avila")),
    true,
  );
  check(
    "an apostrophe typed one time and not the other",
    samePersonName(who("Sean", "O'Neil"), who("Sean", "ONeil")),
    true,
  );
  check(
    "a hyphen against a space",
    samePersonName(who("Mary", "Anne-Jones"), who("Mary", "Anne Jones")),
    true,
  );
}

console.log("\nthe name somebody actually goes by");
{
  // Typing "Bill Smith" when William Smith is already here, and the reverse.
  check(
    "a preferred name matches the full one",
    samePersonName(who("Bill", "Smith"), who("William", "Smith", "Bill")),
    true,
  );
  check(
    "and the other way round",
    samePersonName(who("William", "Smith", "Bill"), who("Bill", "Smith")),
    true,
  );
  check(
    "two people who both go by Bill",
    samePersonName(who("William", "Smith", "Bill"), who("Robert", "Smith", "Bill")),
    true,
  );
  check(
    "a preferred name that matches nothing",
    samePersonName(who("William", "Smith", "Bill"), who("Robert", "Smith", "Bob")),
    false,
  );
}

console.log("\npeople who are not the same person");
{
  check("different first names", samePersonName(who("John", "Smith"), who("Jane", "Smith")), false);
  check("different surnames", samePersonName(who("John", "Smith"), who("John", "Jones")), false);
  check(
    "the names the other way round",
    samePersonName(who("John", "Smith"), who("Smith", "John")),
    false,
  );
  check(
    "a first name that is a prefix of another",
    samePersonName(who("Jon", "Smith"), who("Jonathan", "Smith")),
    false,
  );
}

console.log("\na half-typed name warns about nobody");
{
  // The form is empty or mid-word for most of its life; warning then would be
  // noise, and matching everyone with no surname would be worse.
  check("nothing typed yet", samePersonName(who("", ""), who("John", "Smith")), false);
  check("nothing typed on either side", samePersonName(who("", ""), who("", "")), false);
  check(
    "a name that is only punctuation",
    samePersonName(who("'", "-"), who("John", "Smith")),
    false,
  );
  check("only a first name so far", samePersonName(who("John", ""), who("John", "Smith")), false);
}

console.log("\nfamilies whose cards would read the same");
{
  check("the same name", sameDisplayName("The Smith Family", "The Smith Family"), true);
  check("punctuation and case", sameDisplayName("The O'Neil Family", "the oneil family"), true);
  check("different names", sameDisplayName("The Smith Family", "The Jones Family"), false);
  check("an empty name matches nothing", sameDisplayName("", ""), false);
  check("an empty name against a real one", sameDisplayName("", "The Smith Family"), false);
}

console.log("\ntelling two same-named families apart, in the office");
{
  const named = (display_name: string, office_label: string | null = null) => ({
    display_name,
    office_label,
  });

  check(
    "a family with no label reads exactly as before",
    labelledHouseholdName(named("The Johnston Family")),
    "The Johnston Family",
  );
  check(
    "a labelled family carries it beside the name",
    labelledHouseholdName(named("The Johnston Family", "2")),
    "The Johnston Family (2)",
  );
  check(
    "the label can be words rather than a number",
    labelledHouseholdName(named("The Johnston Family", "Elm St")),
    "The Johnston Family (Elm St)",
  );
  // An input that has been typed in and cleared holds "", and a row from a
  // database that has not run 0004 holds nothing at all. Neither is a label.
  check(
    "an empty label is no label",
    labelledHouseholdName(named("The Smith Family", "")),
    "The Smith Family",
  );
  check(
    "a label of only spaces is no label",
    labelledHouseholdName(named("The Smith Family", "   ")),
    "The Smith Family",
  );
  check(
    "a row from before the migration",
    labelledHouseholdName({ display_name: "The Smith Family" }),
    "The Smith Family",
  );
}

console.log("\nwhich number to suggest next");
{
  check("nobody is labelled yet", suggestOfficeLabel([]), "1");
  check("one family is already 1", suggestOfficeLabel(["1"]), "2");
  check("two are taken", suggestOfficeLabel(["1", "2"]), "3");
  check("they were not entered in order", suggestOfficeLabel(["3", "1"]), "2");
  check("blanks and nothings do not count", suggestOfficeLabel([null, undefined, "", "  "]), "1");
  check("stray spaces around a number still count", suggestOfficeLabel([" 1 "]), "2");
  check("a worded label does not consume a number", suggestOfficeLabel(["Elm St"]), "1");
  check("a worded label alongside a numbered one", suggestOfficeLabel(["Elm St", "1"]), "2");

  // The point of the gap: a family that leaves must not renumber the ones that
  // stay. If 2 moves away, the office still knows the other two as 1 and 3,
  // and the next family to need a label takes the 2 that came free - rather
  // than every card and every habit shifting by one.
  check("a family that left leaves its number free", suggestOfficeLabel(["1", "3"]), "2");
  check("and the one after that", suggestOfficeLabel(["1", "2", "3"]), "4");
}

console.log(failures === 0 ? "\nno problems found in this pass" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
