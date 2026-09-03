import { composeBook } from "@/lib/layout/compose";
import { DEFAULT_SETTINGS, type ProjectSettings } from "@/lib/layout/settings";
import { pdfMetrics } from "@/lib/layout/pdf";
import { buildEntries, type DirectoryData } from "@/lib/entries";
import type { HouseholdRow } from "@/lib/database.types";

/**
 * The cover has no scrolling and no reflow to save it: everything is placed
 * absolutely, so a long vision statement or a long church name either fits or
 * prints over the address. These are the shapes a real cover comes in.
 */
let bad = 0;
const check = (n: string, pass: boolean, d = "") => {
  if (!pass) bad += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`);
};

const household: HouseholdRow = {
  id: "h1",
  display_name: "The Johnston Family",
  sort_name: "Johnston",
  address_line1: "412 Cedar Lane",
  address_line2: null,
  city: "Plains",
  state: "MT",
  postal_code: "59859",
  country: null,
  phone: null,
  email: null,
  anniversary: null,
  photo_path: null,
  notes: null,
  is_active: true,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};
const data: DirectoryData = {
  households: [household],
  people: [],
  tags: [],
  householdTags: [],
  personTags: [],
};

const metrics = await pdfMetrics("serif");

const LONG =
  "To be a God-glorifying, Spirit-filled community of believers, discipling one another and impacting the world for Christ, in this valley and beyond, through worship, teaching, fellowship, service and the faithful proclamation of the gospel to every generation entrusted to us.";

const cases: [string, Partial<ProjectSettings>][] = [
  [
    "everything",
    {
      churchName: "Plains Alliance Church",
      coverTitle: "2026 Spring Directory",
      coverStatement: "OUR VISION\nTo be a God-glorifying, Spirit-filled community of believers.",
      coverContact: "505 West 5th Street\nPlains, MT 59859\n406.826.3916",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  ["title only", { churchName: "", coverTitle: "Church Directory" }],
  [
    "no photo, no logo",
    {
      churchName: "Plains Alliance Church",
      coverTitle: "2026 Spring Directory",
      coverStatement: "OUR VISION\nTo be a God-glorifying community.",
      coverContact: "505 West 5th Street\nPlains, MT 59859",
    },
  ],
  ["photo but nothing else", { churchName: "", coverTitle: "", coverPhotoPath: "a.jpg" }],
  [
    "a very long statement",
    {
      churchName: "Plains Alliance Church",
      coverTitle: "2026 Spring Directory",
      coverStatement: LONG,
      coverContact: "505 West 5th Street\nPlains, MT 59859\n406.826.3916\noffice@cmaplains.org",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  [
    "a very long church name",
    {
      churchName: "The Christian and Missionary Alliance Church of Plains, Montana",
      coverTitle: "2026 Spring Directory",
      coverContact: "Plains, MT 59859",
    },
  ],
  [
    // The shape from the office: a short headline sitting on top of everything
    // else, which is what squeezed the picture flat.
    "a short title with everything else",
    {
      churchName: "Plains Alliance Church",
      coverTitle: "Yo",
      coverSubtitle: "2026 Spring Directory",
      coverStatement:
        "OUR VISION...\nTo be a God-glorifying, Spirit-filled community of believers, discipling one another & impacting the world for Christ.",
      coverContact:
        "505 West 5th Street\nP.O. Box 368\nPlains, MT 59859\n406.826.3916\noffice@cmaplains.org",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  [
    "one column",
    {
      columns: 1,
      churchName: "Plains Alliance Church",
      coverTitle: "2026 Spring Directory",
      coverPhotoPath: "a.jpg",
      coverContact: "505 West 5th Street\nPlains, MT 59859",
    },
  ],
];

for (const [name, overrides] of cases) {
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const book = composeBook(buildEntries(data), settings, metrics);
  const cover = book.sheets.flatMap((s) => s.pages).find((p) => p.kind === "cover");
  if (!cover) {
    check(name, false, "no cover page");
    continue;
  }

  // Page-local coordinates: subtract the page box origin.
  const ox = cover.box.x,
    oy = cover.box.y;
  const geoH = book.height - 2 * 28.8;
  const geoW = cover.box.w;

  const bottoms = [
    ...cover.runs.map((r) => r.y - oy + metrics.lineHeight(r.size)),
    ...cover.photos.map((s) => s.box.y - oy + s.box.h),
    ...cover.rules.map((r) => r.y - oy),
  ];
  const tops = [...cover.runs.map((r) => r.y - oy), ...cover.photos.map((s) => s.box.y - oy)];
  const lefts = [...cover.runs.map((r) => r.x - ox), ...cover.photos.map((s) => s.box.x - ox)];
  const rights = [
    ...cover.runs.map((r) => r.x - ox + r.w),
    ...cover.photos.map((s) => s.box.x - ox + s.box.w),
  ];

  const lowest = bottoms.length ? Math.max(...bottoms) : 0;
  const highest = tops.length ? Math.min(...tops) : geoH;
  const bands = cover.fills.filter((f) => f.color === "#2f6d63");

  check(
    `${name}: two rules frame the page`,
    bands.length === 2,
    bands.map((b) => Math.round(b.y - oy)).join(","),
  );
  check(
    `${name}: nothing runs past the bottom rule`,
    lowest <= geoH - 6 + 0.5,
    `lowest ${lowest.toFixed(1)} of ${(geoH - 6).toFixed(1)}`,
  );
  check(
    `${name}: nothing runs above the top rule`,
    highest >= 6 - 0.5,
    `highest ${highest.toFixed(1)}`,
  );
  check(
    `${name}: nothing runs off the sides`,
    (!lefts.length || Math.min(...lefts) >= -0.5) &&
      (!rights.length || Math.max(...rights) <= geoW + 0.5),
    `${lefts.length ? Math.min(...lefts).toFixed(1) : "-"}..${rights.length ? Math.max(...rights).toFixed(1) : "-"} of ${geoW.toFixed(1)}`,
  );

  for (const photo of cover.photos) {
    // The logo is fitted whole, so only the filled picture is cropped and only
    // its shape matters.
    if (photo.fit !== "fill") continue;
    const ratio = photo.box.w / photo.box.h;
    check(
      `${name}: the picture keeps its shape`,
      ratio > 1.6 && ratio < 1.95,
      `${photo.box.w.toFixed(0)}x${photo.box.h.toFixed(0)} = ${ratio.toFixed(2)}:1`,
    );
    check(
      `${name}: the picture is centred`,
      Math.abs(photo.box.x - ox + photo.box.w / 2 - geoW / 2) < 0.5,
      `${(photo.box.x - ox).toFixed(1)}`,
    );
  }

  if (overrides.coverContact) {
    const contactLines = cover.runs.filter((r) => Math.abs(r.size - 9.5) < 0.01);
    const last = contactLines.length ? Math.max(...contactLines.map((r) => r.y - oy)) : 0;
    check(
      `${name}: the address sits at the foot`,
      last > geoH * 0.72,
      `${last.toFixed(0)} of ${geoH.toFixed(0)}`,
    );
  }
  console.log("");
}

console.log(bad ? `${bad} failed` : "all passed");
process.exit(bad ? 1 : 0);
