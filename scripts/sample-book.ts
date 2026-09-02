import fs from "node:fs";
import path from "node:path";
import { buildEntries } from "../src/lib/entries";
import { composeBook } from "../src/lib/layout/compose";
import { pdfMetrics, renderPdf } from "../src/lib/layout/pdf";
import { DEFAULT_SETTINGS, normalizeSettings, recordsPerSheet } from "../src/lib/layout/settings";
import { buildDemoData } from "../src/lib/demo";
import { placeholderPortrait } from "./png";

/**
 * Renders a sample directory from invented data.
 *
 *   npm run sample:pdf -- out.pdf
 *
 * Useful for reviewing the print layout, checking a settings change, or
 * showing a committee what the book will look like before anyone types in a
 * single real address.
 */
async function main() {
  const outPath = path.resolve(process.argv[2] ?? "sample-directory.pdf");

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
    churchName: "Fairhaven Community Church",
    coverTitle: "Church Directory",
    coverSubtitle: "Spring 2026",
    footerText: "Please keep this directory for church use only.",
    showBirthdays: true,
    showAnniversary: true,
  });

  const metrics = await pdfMetrics();
  const book = composeBook(entries, settings, metrics);

  const portraits = new Map<string, Uint8Array>();
  book.photoPaths.forEach((photoPath, i) => {
    portraits.set(photoPath, new Uint8Array(placeholderPortrait(i + 1)));
  });

  const bytes = await renderPdf(book, async (photoPath) => portraits.get(photoPath) ?? null, {
    showFoldGuides: true,
    title: settings.coverTitle,
  });

  fs.writeFileSync(outPath, bytes);

  const people = demo.people.length;
  console.log(`records .......... ${book.recordCount} (${demo.households.length} families, ${people} people)`);
  console.log(`per sheet ........ ${recordsPerSheet(settings)} (${settings.rows} per half x ${settings.columns} halves)`);
  console.log(`book pages ....... ${book.pageCount}`);
  console.log(`sheets of paper .. ${book.sheets.length}`);
  console.log(`index lines ...... ${book.index.length}`);
  console.log(`size ............. ${(bytes.length / 1024).toFixed(0)} KB`);
  console.log(`written .......... ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
