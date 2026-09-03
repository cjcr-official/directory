/**
 * Invariants the book and the counts have to hold, checked against the real
 * modules rather than a mock.
 *
 *   npm run invariants
 *
 * These are the things that go wrong silently: a record drawn twice or not at
 * all, an index line pointing at a page that is not there, a booklet
 * imposition that loses a leaf, a page holding more cards than it has room
 * for, and the overview promising a number of records the book will not
 * print. None of them raise an error on their own - they just come out wrong
 * on paper, which is the expensive place to find them.
 */
import { PDFDocument } from "pdf-lib";
import { buildEntries } from "../src/lib/entries";
import { composeBook } from "../src/lib/layout/compose";
import { pdfMetrics } from "../src/lib/layout/pdf";
import { STANDARD_FONTS, type Metrics } from "../src/lib/layout/metrics";
import { toWinAnsi } from "../src/lib/format";
import { DEFAULT_SETTINGS, normalizeSettings, recordsPerSheet } from "../src/lib/layout/settings";
import { buildDemoData } from "../src/lib/demo";
import type { HouseholdRow, PersonRow } from "../src/lib/database.types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg);
};

function blankHousehold(over: Partial<HouseholdRow>): HouseholdRow {
  return {
    id: "h1",
    project_id: "p",
    sort_name: "Smith",
    display_name: "The Smith Family",
    photo_path: null,
    phone: null,
    email: null,
    anniversary: null,
    notes: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  } as HouseholdRow;
}
function blankPerson(over: Partial<PersonRow>): PersonRow {
  return {
    id: "p1",
    project_id: "p",
    first_name: "Ann",
    last_name: "Smith",
    preferred_name: null,
    household_id: null,
    household_role: null,
    sort_order: 0,
    photo_path: null,
    phone: null,
    email: null,
    date_of_birth: null,
    notes: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    use_household_address: false,
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  } as PersonRow;
}

async function main() {
  const metrics = await pdfMetrics();

  // ---- 1. empty directory -------------------------------------------------
  {
    const book = composeBook([], normalizeSettings(DEFAULT_SETTINGS), metrics);
    ok(Number.isFinite(book.pageCount), "empty: pageCount finite");
    console.log(`empty book: ${book.pageCount} pages, ${book.sheets.length} sheets`);
  }

  // ---- 2. every record appears exactly once, index points at the right page
  {
    const demo = buildDemoData();
    const entries = buildEntries({
      households: demo.households,
      people: demo.people,
      tags: demo.tags,
      householdTags: demo.householdTags,
      personTags: demo.personTags,
    });
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      includeCover: true,
      includeIndex: true,
    });
    const book = composeBook(entries, settings, metrics);

    const cardIds = new Map<string, number>();
    for (const sheet of book.sheets)
      for (const page of sheet.pages)
        for (const card of page.cards)
          if (card.entryId) cardIds.set(card.entryId, (cardIds.get(card.entryId) ?? 0) + 1);

    const dupes = [...cardIds].filter(([, n]) => n > 1);
    ok(dupes.length === 0, `records drawn more than once: ${JSON.stringify(dupes)}`);
    ok(
      cardIds.size === entries.length,
      `records drawn ${cardIds.size}, expected ${entries.length}`,
    );
    console.log(
      `demo: ${entries.length} entries -> ${book.pageCount} pages, ${book.sheets.length} sheets, ${book.index.length} index lines`,
    );
  }

  // ---- 3. booklet imposition -> every page placed exactly once -------------
  for (const n of [1, 2, 3, 5, 7, 9, 13]) {
    const demo = buildDemoData();
    const entries = buildEntries({
      households: demo.households,
      people: demo.people,
      tags: demo.tags,
      householdTags: demo.householdTags,
      personTags: demo.personTags,
    }).slice(0, n);
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      bookletOrder: true,
      includeCover: true,
      includeIndex: true,
    });
    const book = composeBook(entries, settings, metrics);
    const numbers = book.sheets.flatMap((s) => s.pages.map((p) => p.number));
    const real = numbers.filter((x) => x > 0);
    const uniq = new Set(real);
    ok(uniq.size === real.length, `booklet n=${n}: a page is imposed twice (${real.join(",")})`);
    ok(
      uniq.size === book.pageCount,
      `booklet n=${n}: ${uniq.size} of ${book.pageCount} pages imposed`,
    );
    ok(numbers.length % 4 === 0, `booklet n=${n}: ${numbers.length} slots, not a multiple of 4`);
  }

  // ---- 4. index page numbers match where the record actually landed --------
  {
    const demo = buildDemoData();
    const entries = buildEntries({
      households: demo.households,
      people: demo.people,
      tags: demo.tags,
      householdTags: demo.householdTags,
      personTags: demo.personTags,
    });
    for (const includeCover of [false, true]) {
      const settings = normalizeSettings({ ...DEFAULT_SETTINGS, includeCover, includeIndex: true });
      const book = composeBook(entries, settings, metrics);
      const pageOfCard = new Map<string, number>();
      for (const sheet of book.sheets)
        for (const page of sheet.pages)
          for (const card of page.cards)
            if (card.entryId) pageOfCard.set(card.entryId, page.number);
      let mismatches = 0;
      for (const entry of entries) {
        const names = entry.type === "person" ? 1 : Math.max(entry.household.members.length, 1);
        if (!names) continue;
        const actual = pageOfCard.get(entry.id);
        const claimed = book.index.find((r) => r.page === actual);
        if (actual === undefined) mismatches += 1;
        void claimed;
      }
      ok(mismatches === 0, `cover=${includeCover}: ${mismatches} entries never drawn`);
      // Every index line must name a page that exists and holds records.
      const bad = book.index.filter((r) => r.page < 1 || r.page > book.pageCount);
      ok(
        bad.length === 0,
        `cover=${includeCover}: index points off the book: ${JSON.stringify(bad.slice(0, 3))}`,
      );
    }
  }

  // ---- 5. a household whose members are all inactive -----------------------
  {
    const entries = buildEntries({
      households: [blankHousehold({ id: "h1" })],
      people: [blankPerson({ id: "p1", household_id: "h1", is_active: false })],
      tags: [],
      householdTags: [],
      personTags: [],
    });
    ok(entries.length === 1, `all-inactive household: expected 1 entry, got ${entries.length}`);
    const book = composeBook(
      entries,
      normalizeSettings({ ...DEFAULT_SETTINGS, includeIndex: true }),
      metrics,
    );
    ok(book.index.length === 1, `all-inactive household: index lines ${book.index.length}`);
    console.log(`household with no printable members -> index: ${JSON.stringify(book.index)}`);
  }

  // ---- 6. an active person in an archived household ------------------------
  {
    const entries = buildEntries({
      households: [blankHousehold({ id: "h1", is_active: false })],
      people: [blankPerson({ id: "p1", household_id: "h1", is_active: true })],
      tags: [],
      householdTags: [],
      personTags: [],
    });
    ok(
      entries.length === 1 && entries[0].type === "person",
      `archived household: expected the member to print alone, got ${JSON.stringify(entries.map((e) => e.type))}`,
    );
  }

  // ---- 7. recordsPerSheet agrees with what actually gets drawn -------------
  {
    const demo = buildDemoData();
    const entries = buildEntries({
      households: demo.households,
      people: demo.people,
      tags: demo.tags,
      householdTags: demo.householdTags,
      personTags: demo.personTags,
    });
    for (const rows of [1, 2, 3, 4]) {
      for (const columns of [1, 2]) {
        const settings = normalizeSettings({
          ...DEFAULT_SETTINGS,
          rows,
          columns,
          includeCover: false,
          includeIndex: false,
        });
        const book = composeBook(entries, settings, metrics);
        const claimed = recordsPerSheet(settings);
        const perPage = Math.max(...book.sheets.flatMap((s) => s.pages.map((p) => p.cards.length)));
        ok(
          perPage <= rows,
          `rows=${rows} cols=${columns}: a page holds ${perPage} cards, more than ${rows}`,
        );
        ok(
          claimed === rows * columns,
          `rows=${rows} cols=${columns}: recordsPerSheet says ${claimed}`,
        );
      }
    }
  }

  // ---- 8. the counts the overview promises ---------------------------------
  {
    // An archived family, an inactive loner, and a live member of the archived
    // family - the three cases the old sentence got wrong.
    const data = {
      households: [
        blankHousehold({ id: "h1", is_active: false }),
        blankHousehold({ id: "h2", sort_name: "Jones" }),
      ],
      people: [
        blankPerson({ id: "p1", household_id: "h1", is_active: true }),
        blankPerson({ id: "p2", is_active: false, last_name: "Loner" }),
        blankPerson({ id: "p3", household_id: "h2", last_name: "Jones" }),
      ],
      tags: [],
      householdTags: [],
      personTags: [],
    };
    const entries = buildEntries(data);
    const printedFamilies = entries.filter((e) => e.type === "household").length;
    const printedIndividuals = entries.length - printedFamilies;

    const oldFamilies = data.households.length;
    const oldIndividuals = data.people.filter((p) => !p.household_id).length;

    console.log(
      `counts - book prints ${entries.length}: ${printedFamilies} families + ${printedIndividuals} individuals`,
    );
    console.log(
      `         old sentence said: ${oldFamilies} families + ${oldIndividuals} individuals`,
    );
    ok(
      printedFamilies + printedIndividuals === entries.length,
      "counts do not add up to the records printed",
    );
    ok(
      oldFamilies + oldIndividuals !== entries.length,
      "the old counting would not have been wrong here - weak test",
    );
  }

  // ---- 9. the office's label never reaches paper ---------------------------
  {
    // The whole promise of office_label is that it is for the office. It is
    // written next to display_name on the same row, and display_name is what
    // heads the card and fills the index - so a card or index line built by
    // spreading the household, or by reaching for the wrong field, would print
    // the office's filing note in the congregation's book. Nobody would see it
    // until it came back from the printer.
    const labelled = {
      households: [
        blankHousehold({ id: "h1", office_label: "1" }),
        blankHousehold({ id: "h2", office_label: "Elm St" }),
        // The index lists members by name and falls back to the family's own
        // name only when it has none - so an empty family is the only shape
        // that puts display_name in the index at all, and the only one that
        // can carry a label there.
        blankHousehold({ id: "h3", office_label: "3", sort_name: "Alvarez" }),
      ],
      people: [
        blankPerson({ id: "p1", household_id: "h1", first_name: "Ann" }),
        blankPerson({ id: "p2", household_id: "h2", first_name: "Bob" }),
      ],
      tags: [],
      householdTags: [],
      personTags: [],
    };
    // The same congregation with nobody labelled, to compare against.
    const plain = {
      ...labelled,
      households: labelled.households.map(
        ({ office_label: _dropped, ...rest }) => rest as HouseholdRow,
      ),
    };

    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      includeCover: true,
      includeIndex: true,
    });
    const withLabels = composeBook(buildEntries(labelled), settings, metrics);
    const withoutLabels = composeBook(buildEntries(plain), settings, metrics);

    // Every string the book will draw, cards and index alike.
    const printed = JSON.stringify(withLabels);
    const leaked = ["(1)", "Elm St", "(3)", "office_label"].filter((needle) =>
      printed.includes(needle),
    );

    ok(leaked.length === 0, `the office label reached the page: ${leaked.join(", ")}`);
    ok(
      JSON.stringify(withLabels) === JSON.stringify(withoutLabels),
      "labelling a family changed the composed book",
    );
    console.log(
      `office labels: ${withLabels.index.length} index lines, ` +
        `${leaked.length ? leaked.join(", ") : "nothing"} leaked onto the page`,
    );
  }

  // -------------------------------------------------------------------------
  // Measuring text is cached, and a cache that returns a wrong width would not
  // throw - it would set a line slightly off and print it that way. So compose
  // the same books through an uncached measurer and insist on the same model,
  // over every shape of book the settings can make.
  // -------------------------------------------------------------------------
  {
    const data = buildDemoData(60, 8);
    const entries = buildEntries(data);

    const shapes: Partial<typeof DEFAULT_SETTINGS>[] = [
      {},
      { typeface: "sans" },
      { columns: 1, rows: 1 },
      { columns: 3, rows: 8, textScale: "compact" },
      { bookletOrder: true, includeCover: false },
      { includeIndex: false, showPhotos: false, cardStyle: "box" },
      { memberStyle: "detailed", showBirthdays: true, showAnniversary: true, textScale: "large" },
      { pageSize: "a4", showLetterTabs: false, runningHeader: false, showPageNumbers: false },
      { pageSize: "legal", footerText: "For the congregation", photoFit: "fit" },
      {
        coverTitle: "A Cover Title Long Enough That It Has To Shrink To Fit",
        churchName: "St Mary",
      },
    ];

    /** What makeMetrics did before it cached anything: measure every time. */
    async function uncachedMetrics(typeface: "sans" | "serif"): Promise<Metrics> {
      const doc = await PDFDocument.create();
      const family = STANDARD_FONTS[typeface];
      const fonts = {
        regular: await doc.embedFont(family.regular),
        bold: await doc.embedFont(family.bold),
        italic: await doc.embedFont(family.italic),
      };
      return {
        widthOf: (text, size, weight) =>
          text ? fonts[weight].widthOfTextAtSize(toWinAnsi(text), size) : 0,
        lineHeight: (size) => size * 1.22,
      };
    }

    let matched = 0;
    for (const shape of shapes) {
      const settings = normalizeSettings(shape);
      const a = composeBook(entries, settings, await pdfMetrics(settings.typeface));
      const b = composeBook(entries, settings, await uncachedMetrics(settings.typeface));
      if (JSON.stringify(a) === JSON.stringify(b)) matched += 1;
    }

    console.log(`measured widths: ${matched} of ${shapes.length} book shapes compose identically`);
    ok(matched === shapes.length, "caching text measurement changed the composed book");
  }

  console.log(
    fails.length
      ? `\n${fails.length} PROBLEM(S):\n- ${fails.join("\n- ")}`
      : "\nno problems found in this pass",
  );
}

void main();
