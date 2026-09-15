import fs from "node:fs";
import path from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { buildEntries } from "../src/lib/entries";
import { composeBook } from "../src/lib/layout/compose";
import { composeTags, tagsPerSheet } from "../src/lib/layout/tags";
import { pdfMetrics, renderPdf } from "../src/lib/layout/pdf";
import { DEFAULT_SETTINGS, normalizeSettings, recordsPerSheet } from "../src/lib/layout/settings";
import { buildDemoData } from "../src/lib/demo";
import { STANDARD_FONTS } from "../src/lib/layout/metrics";
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
    // The sample carries a full cover so this run renders one every time. CI
    // builds this book, so a cover that cannot be drawn - a picture the
    // renderer never fetched, artwork left off the sheet - fails here rather
    // than at the printer.
    coverStatement:
      "OUR VISION\nTo be a God-glorifying, Spirit-filled community of believers, " +
      "discipling one another & impacting the world for Christ.",
    coverContact:
      "505 West 5th Street\nP.O. Box 368\nFairhaven, MT 59859\n406.555.0100\noffice@example.org",
    coverPhotoPath: "covers/building.jpg",
    coverLogoPath: "covers/logo.jpg",
    footerText: "Please keep this directory for church use only.",
    showBirthdays: true,
    showAnniversary: true,
    // Read only by the tag sheet below, and set here so that CI renders a tag
    // with every piece of furniture on it: a mark, a heading, a coloured band
    // and a line underneath.
    tagStyle: "banner",
    tagLine: "We are glad you are here",
    tagAccent: "#7b2430",
    tagSmallFont: "serif",
  });

  const metrics = await pdfMetrics(settings.typeface);
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

  /*
   * And the same congregation as a sheet of name tags, written beside the book.
   *
   * Not for the look of it: the tags are the one thing this app prints that
   * sets two families of type on one piece of paper, and the renderer picks the
   * font per run to do it. That is a mistake that composes cleanly, passes every
   * check that reads the model, and only shows up as the wrong font in a file -
   * so CI has to make the file.
   */
  const tagPath = outPath.replace(/(\.pdf)?$/i, "-name-tags.pdf");
  const tags = composeTags(entries, settings, metrics);
  const tagBytes = await renderPdf(tags, async (photoPath) => portraits.get(photoPath) ?? null, {
    title: `${settings.coverTitle} - name tags`,
  });
  fs.writeFileSync(tagPath, tagBytes);

  // Read back out of the file what it actually set the type in. The settings
  // above ask for the names in one family and the small print in another, and
  // nothing else in this project can tell whether the renderer honoured that:
  // the model is right either way, and a name drawn in the wrong font is a
  // perfectly valid PDF.
  const faces = await facesUsed(tagBytes);
  // Asked as "did each family reach the paper" rather than by naming the exact
  // fonts: which weight a tag draws is the composer's business and changes with
  // the design - the first version of this check named Times-Roman, and making
  // the line at the foot bold broke it without anything being wrong. What must
  // never change is that both chosen families are in the file.
  const missing = [settings.tagNameFont, settings.tagSmallFont]
    .filter((face, at, all) => all.indexOf(face) === at)
    .filter((face) => {
      const family = Object.values(STANDARD_FONTS[face]);
      return !faces.some((name) => family.includes(name as (typeof family)[number]));
    });
  if (missing.length) {
    throw new Error(
      `the name tags were set in ${faces.join(", ") || "nothing"} - nothing from ` +
        `${missing.join(" or ")}, so the faces the settings asked for did not all reach the paper`,
    );
  }

  const people = demo.people.length;
  console.log(
    `records .......... ${book.recordCount} (${demo.households.length} families, ${people} people)`,
  );
  console.log(
    `per sheet ........ ${recordsPerSheet(settings)} (${settings.rows} per half x ${settings.columns} halves)`,
  );
  console.log(`book pages ....... ${book.pageCount}`);
  console.log(`sheets of paper .. ${book.sheets.length}`);
  console.log(`index lines ...... ${book.index.length}`);
  console.log(`size ............. ${(bytes.length / 1024).toFixed(0)} KB`);
  console.log(`written .......... ${outPath}`);
  console.log(
    `name tags ........ ${tags.recordCount} people, ${tags.sheets.length} sheets at ${tagsPerSheet(settings)} a sheet`,
  );
  console.log(`written .......... ${tagPath}`);
}

/** The fonts one PDF's first page really draws with, as they are named in it. */
async function facesUsed(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  if (!fonts) return [];

  const names = new Set<string>();
  for (const [, ref] of fonts.entries()) {
    const font = page.node.context.lookup(ref, PDFDict);
    names.add(font.lookup(PDFName.of("BaseFont"), PDFName).asString().replace(/^\//, ""));
  }
  return [...names].sort();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
