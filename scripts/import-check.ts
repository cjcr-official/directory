/**
 * What an import would write, put to the file formats it will actually be
 * handed.
 *
 * planImport makes every judgement an import makes and touches no database, so
 * the cases that decide whether a congregation arrives intact can be asked
 * directly: a household spread over three rows, a date stored as a number, the
 * same file imported twice, a person who is already here under a nickname.
 * None of those are reachable by pressing the button on a healthy file, which
 * is exactly why they need a test.
 *
 * The .xlsx half builds a workbook with this app's own ZIP writer rather than
 * shipping a fixture, so what the reader is asked to read is the shape Excel
 * writes: a shared string table, cells that name their own column, and gaps
 * where a cell is empty.
 *
 * Run with: npm run import:check
 */

import { readSheet } from "@/lib/sheet";
import { planImport, toIsoDate, type LiveForImport } from "@/lib/importPlan";
import { buildZip } from "@/lib/zip";
import { check, same } from "./check";

const EMPTY: LiveForImport = { households: [], people: [] };

/** Ids that read as themselves in a failure message, rather than as UUIDs. */
function counter(): () => string {
  let at = 0;
  return () => `id-${(at += 1)}`;
}

const HEADERS = [
  "Person ID",
  "First Name",
  "Last Name",
  "Nickname",
  "Gender",
  "Birthdate",
  "Anniversary",
  "Child",
  "Marital Status",
  "Status",
  "Medical Notes",
  "Home Email",
  "Mobile Phone Number",
  "Home Phone Number",
  "Home Address Street Line 1",
  "Home Address City",
  "Home Address State",
  "Home Address Zip Code",
  "Household ID",
  "Household Name",
  "Household Primary Contact",
  "Background Check Created At",
  "Background Check Expires On",
  "Grade",
];

/** A row as an object, so a fixture names its fields rather than counting commas. */
function row(values: Partial<Record<(typeof HEADERS)[number], string>>): string[] {
  return HEADERS.map((header) => values[header] ?? "");
}

function csv(rows: string[][]): Uint8Array {
  const quote = (value: string) => (/[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [HEADERS, ...rows].map((line) => line.map(quote).join(","));
  return new TextEncoder().encode(lines.join("\r\n"));
}

/**
 * The same rows as a workbook.
 *
 * Text goes in the shared string table the way Excel writes it, and numbers go
 * in bare - which is how a date arrives from a .xlsx, and the reason toIsoDate
 * has to know about 1899.
 */
function xlsx(rows: string[][]): Uint8Array {
  const grid = [HEADERS, ...rows];
  const strings: string[] = [];
  const index = new Map<string, number>();
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const letter = (at: number) => {
    let name = "";
    for (let n = at + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
  };

  const body = grid
    .map((line, r) => {
      const cells = line
        .map((value, c) => {
          const ref = `${letter(c)}${r + 1}`;
          // An empty cell is written out as well, closing itself, because
          // that is what a real workbook does and it is what the reader has
          // to get past to keep the columns lined up.
          if (!value) return `<c r="${ref}" s="1"/>`;
          if (/^\d+(\.\d+)?$/.test(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          let at = index.get(value);
          if (at === undefined) {
            at = strings.length;
            index.set(value, at);
            strings.push(value);
          }
          return `<c r="${ref}" t="s"><v>${at}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const encoder = new TextEncoder();
  return buildZip([
    {
      name: "xl/sharedStrings.xml",
      data: encoder.encode(
        `<?xml version="1.0"?><sst count="${strings.length}">` +
          strings.map((text) => `<si><t>${escape(text)}</t></si>`).join("") +
          `</sst>`,
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(
        `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`,
      ),
    },
  ]);
}

const SIEBERTS = [
  row({
    "First Name": "Jason",
    "Last Name": "Siebert",
    Gender: "Male",
    Birthdate: "28551",
    Anniversary: "36365",
    "Marital Status": "Married",
    Status: "active",
    "Mobile Phone Number": "(216) 555-0188",
    "Home Phone Number": "(216) 555-0142",
    "Home Email": "jason@example.org",
    "Home Address Street Line 1": "18 Sycamore Lane",
    "Home Address City": "Fairhaven",
    "Home Address State": "OH",
    "Home Address Zip Code": "44092",
    "Household ID": "25700387",
    "Household Name": "Siebert Household",
    "Household Primary Contact": "1",
    "Background Check Created At": "45000",
    "Background Check Expires On": "46919",
    Grade: "",
  }),
  row({
    "First Name": "Margaret",
    "Last Name": "Siebert",
    Nickname: "Maggie",
    Gender: "Female",
    "Marital Status": "Married",
    "Home Address Street Line 1": "18 Sycamore Lane",
    "Home Address City": "Fairhaven",
    "Home Address Zip Code": "44092",
    "Household ID": "25700387",
    "Household Name": "Siebert Household",
    "Household Primary Contact": "0",
  }),
  row({
    "First Name": "Ezra",
    "Last Name": "Siebert",
    Child: "1",
    Birthdate: "2015-04-02",
    "Household ID": "25700387",
    "Household Name": "Siebert Household",
    "Home Address Street Line 1": "18 Sycamore Lane",
    "Home Address City": "Fairhaven",
    "Home Address Zip Code": "44092",
    Grade: "4",
  }),
];

console.log("\nthe dates a spreadsheet hands over\n");

same("a workbook's number is days from the last day of 1899", toIsoDate("28551"), "1978-03-02");
same("the one the sample background check expires on", toIsoDate("46919"), "2028-06-15");
same("Planning Center's own CSV is already ISO", toIsoDate("2015-04-02"), "2015-04-02");
same(
  "a timestamp keeps its day and drops the clock",
  toIsoDate("2015-04-02T18:30:00Z"),
  "2015-04-02",
);
same("a spreadsheet that has been through Excel is American", toIsoDate("4/2/2015"), "2015-04-02");
same("an empty cell is not a date", toIsoDate(""), null);
same("and neither is a word", toIsoDate("unknown"), null);

console.log("\na household spread over three rows\n");

const sheet = await readSheet("export.csv", csv(SIEBERTS));
same("every heading is read", sheet.headers.length, HEADERS.length);
same("three people", sheet.rows.length, 3);

const plan = planImport("export.csv", sheet, EMPTY, counter());
same("one family", plan.households.length, 1);
same("three people", plan.people.length, 3);
same(
  "named for the surname, not for Planning Center's own wording",
  plan.households[0].display_name,
  "The Siebert Family",
);
same("filed under the surname", plan.households[0].sort_name, "Siebert");
same("the address is the family's", plan.households[0].address_line1, "18 Sycamore Lane");
same("so is the town", plan.households[0].city, "Fairhaven");
same("the landline is the family's", plan.households[0].phone, "(216) 555-0142");
same("and so is the anniversary", plan.households[0].anniversary, "1999-07-24");

const [jason, maggie, ezra] = plan.people;
same("the primary contact is the head", jason.household_role, "head");
same("the married one beside them is the spouse", maggie.household_role, "spouse");
same("and the child is a child", ezra.household_role, "child");
same("a nickname is kept as the name they go by", maggie.preferred_name, "Maggie");
same("a first name that is also the nickname is not repeated", jason.preferred_name, null);
same("the mobile wins over the landline", jason.phone, "(216) 555-0188");
same("the birthday comes across", jason.date_of_birth, "1978-03-02");
same(
  "a background check keeps both of its dates",
  [jason.background_check_on, jason.background_check_due],
  ["2023-03-15", "2028-06-15"],
);
same(
  "everybody at the family's address shares it",
  plan.people.map((person) => person.use_household_address),
  [true, true, true],
);
same("so nobody carries a copy of it", jason.address_line1, null);
same("the anniversary is not said twice", jason.anniversary, null);
check(
  "the family's own id is what the people point at",
  plan.people.every((person) => person.household_id === plan.households[0].id),
);
same("a column nothing reads is reported rather than dropped quietly", plan.unmapped, ["Grade"]);

console.log("\nthe same rows as a workbook\n");

const book = await readSheet("export.xlsx", xlsx(SIEBERTS));
same("a workbook reads back as the same headings", book.headers, sheet.headers);
same("and the same people", book.rows.length, 3);
const fromBook = planImport("export.xlsx", book, EMPTY, counter());
same(
  "a number in a date column is still a birthday",
  fromBook.people[0].date_of_birth,
  "1978-03-02",
);
same(
  "and the family is the same family",
  fromBook.households[0].display_name,
  "The Siebert Family",
);
same("a cell left empty does not shift the row", fromBook.people[2].first_name, "Ezra");

console.log("\nimporting the same file twice\n");

const live: LiveForImport = {
  households: plan.households.map((house) => ({
    id: house.id,
    display_name: house.display_name,
    sort_name: house.sort_name,
  })),
  people: plan.people.map((person) => ({
    first_name: person.first_name,
    last_name: person.last_name,
    preferred_name: person.preferred_name,
    household_id: person.household_id,
  })),
};

const again = planImport("export.csv", sheet, live, counter());
same("the family is already here", again.households.length, 0);
same("and so is everybody in it", again.people.length, 0);
same("all three are counted as already here", again.alreadyHere, 3);

console.log("\nand a fourth person arriving into a family that is already here\n");

const withNewChild = await readSheet(
  "export.csv",
  csv([
    ...SIEBERTS,
    row({
      "First Name": "Tabitha",
      "Last Name": "Siebert",
      Child: "1",
      "Household ID": "25700387",
      "Household Name": "Siebert Household",
      "Home Address Street Line 1": "18 Sycamore Lane",
      "Home Address Zip Code": "44092",
    }),
  ]),
);
const joining = planImport("export.csv", withNewChild, live, counter());
same("no second family", joining.households.length, 0);
same("just the one person", joining.people.length, 1);
same("who joins the family that is here", joining.people[0].household_id, live.households[0].id);
same("counted as joining", joining.joining, 1);
same("the other three are left alone", joining.alreadyHere, 3);

console.log("\ntwo families of the same name, and a row that is not a person\n");

const twoSmiths = await readSheet(
  "export.csv",
  csv([
    row({
      "First Name": "John",
      "Last Name": "Smith",
      "Household ID": "1",
      "Household Name": "Smith Household",
      "Household Primary Contact": "1",
      "Home Address Street Line 1": "1 Main St",
    }),
    row({
      "First Name": "Peter",
      "Last Name": "Smith",
      "Household ID": "2",
      "Household Name": "Smith Household",
      "Household Primary Contact": "1",
      "Home Address Street Line 1": "9 Elm St",
    }),
    row({ Status: "active", Grade: "6" }),
  ]),
);
const smiths = planImport("export.csv", twoSmiths, EMPTY, counter());
same("two families", smiths.households.length, 2);
same(
  "told apart by the head, because two identical cards are a mistake in a book",
  smiths.households.map((house) => house.display_name),
  ["The John Smith Family", "The Peter Smith Family"],
);
same("a row with no name in it is not a person", smiths.people.length, 2);
same("and is counted as one that was left out", smiths.unnamed, 1);

console.log("\nan export of individuals, with no household id in it\n");

const loose = await readSheet(
  "export.csv",
  csv([
    row({
      "First Name": "Ada",
      "Last Name": "Bell",
      "Home Address Street Line 1": "12 Vine St",
      "Home Address Zip Code": "44092",
    }),
    row({
      "First Name": "Clara",
      "Last Name": "Bell",
      "Home Address Street Line 1": "12 Vine St",
      "Home Address Zip Code": "44092",
    }),
    row({
      "First Name": "Dora",
      "Last Name": "Bell",
      "Home Address Street Line 1": "88 Far Rd",
      "Home Address Zip Code": "44092",
    }),
  ]),
);
const bells = planImport("export.csv", loose, EMPTY, counter());
same("a shared surname and a shared address is a family", bells.households.length, 2);
same(
  "two under one roof and one under another",
  bells.people.filter((person) => person.household_id === bells.households[0].id).length,
  2,
);
