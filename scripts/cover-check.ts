import { composeBook, composeCoverPage, type BookPage } from "@/lib/layout/compose";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  placeCoverPart,
  type CoverPlacements,
  type ProjectSettings,
} from "@/lib/layout/settings";
import { pdfMetrics } from "@/lib/layout/pdf";
import { buildEntries, type DirectoryData } from "@/lib/entries";
import type { HouseholdRow } from "@/lib/database.types";
import { check } from "./check";

/**
 * The cover has no scrolling and no reflow to save it: everything is placed
 * absolutely, so a long vision statement or a long church name either fits or
 * prints over the address. These are the shapes a real cover comes in.
 */
const household: HouseholdRow = {
  id: "h1",
  display_name: "The Johnston Family",
  sort_name: "Johnston",
  address_line1: "412 Cedar Lane",
  address_line2: null,
  city: "Fairhaven",
  state: "OH",
  postal_code: "44092",
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
  "To worship together, serve our community and welcome everyone who comes through our doors, in this town and beyond, through teaching, fellowship, service and the steady care of every family and every generation entrusted to us, in every season of their lives.";

const cases: [string, Partial<ProjectSettings>][] = [
  [
    "everything",
    {
      churchName: "Fairhaven Community Church",
      coverTitle: "2026 Spring Directory",
      coverStatement:
        "OUR MISSION\nTo worship together, serve our community, and welcome everyone.",
      coverContact: "123 Main Street\nFairhaven, OH 44092\n(216) 555-0142",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  ["title only", { churchName: "", coverTitle: "Church Directory" }],
  [
    "no photo, no logo",
    {
      churchName: "Fairhaven Community Church",
      coverTitle: "2026 Spring Directory",
      coverStatement: "OUR MISSION\nTo worship together.",
      coverContact: "123 Main Street\nFairhaven, OH 44092",
    },
  ],
  ["photo but nothing else", { churchName: "", coverTitle: "", coverPhotoPath: "a.jpg" }],
  [
    "a very long statement",
    {
      churchName: "Fairhaven Community Church",
      coverTitle: "2026 Spring Directory",
      coverStatement: LONG,
      coverContact: "123 Main Street\nFairhaven, OH 44092\n(216) 555-0142\noffice@example.org",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  [
    "a very long church name",
    {
      churchName: "The Fairhaven Community Church of Northfield Valley, Ohio",
      coverTitle: "2026 Spring Directory",
      coverContact: "Fairhaven, OH 44092",
    },
  ],
  [
    // The shape from the office: a short headline sitting on top of everything
    // else, which is what squeezed the picture flat.
    "a short title with everything else",
    {
      churchName: "Fairhaven Community Church",
      coverTitle: "2026",
      coverSubtitle: "2026 Spring Directory",
      coverStatement:
        "OUR MISSION...\nTo worship together, serve our community and welcome everyone who comes through our doors, in this town and beyond.",
      coverContact:
        "123 Main Street\nPO Box 100\nFairhaven, OH 44092\n(216) 555-0142\noffice@example.org",
      coverPhotoPath: "a.jpg",
      coverLogoPath: "b.jpg",
    },
  ],
  [
    "one column",
    {
      columns: 1,
      churchName: "Fairhaven Community Church",
      coverTitle: "2026 Spring Directory",
      coverPhotoPath: "a.jpg",
      coverContact: "123 Main Street\nFairhaven, OH 44092",
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

// ---------------------------------------------------------------------------
// Moving the parts about
//
// A cover can be arranged by hand: each part carries an offset from wherever
// the composer put it, and a picture carries a size. The offsets are applied
// to the finished page and never fed back into the stack, which is what these
// hold - that moving one part moves that part, all of it, and nothing else.
//
// And that nothing can be dragged off the paper. There is no scroll bar on a
// printed cover and no way to find a title that has been left twelve inches
// past the edge of it, so every placement is clamped to the page, by the
// composer, once, for the screen and the PDF alike.
// ---------------------------------------------------------------------------

const arranged: ProjectSettings = {
  ...DEFAULT_SETTINGS,
  churchName: "Fairhaven Community Church",
  coverTitle: "2026 Spring Directory",
  coverStatement: "OUR MISSION...\nTo worship together, serve our community, and welcome everyone.",
  coverContact: "123 Main Street\nFairhaven, OH 44092\n(216) 555-0142",
  coverPhotoPath: "a.jpg",
  coverLogoPath: "b.jpg",
};

/** The cover as it composes with these placements, in page coordinates. */
const withPlacements = (coverPlacements: CoverPlacements) =>
  composeCoverPage({ ...arranged, coverPlacements }, metrics);

/** The top-left corner of everything belonging to one part. */
function cornerOf(page: BookPage, part: string): { x: number; y: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const run of page.runs) if (run.field === part) (xs.push(run.x), ys.push(run.y));
  for (const rule of page.rules) if (rule.field === part) (xs.push(rule.x), ys.push(rule.y));
  for (const slot of page.photos)
    if (slot.field === part) (xs.push(slot.box.x), ys.push(slot.box.y));
  return xs.length ? { x: Math.min(...xs), y: Math.min(...ys) } : null;
}

/** Everything on the page that is not this part, as one comparable string. */
function everythingElse(page: BookPage, part: string): string {
  return JSON.stringify([
    page.runs.filter((r) => r.field !== part).map((r) => [r.x, r.y, r.size, r.text]),
    page.rules.filter((r) => r.field !== part).map((r) => [r.x, r.y, r.w]),
    page.photos.filter((p) => p.field !== part).map((p) => [p.box.x, p.box.y, p.box.w, p.box.h]),
  ]);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const still = withPlacements({});

console.log("\nmoving the parts of a cover about\n");

for (const part of ["churchName", "coverTitle", "coverStatement", "coverContact", "coverPhoto"]) {
  const was = cornerOf(still.page, part);
  const moved = withPlacements({ [part]: { dx: 12, dy: -18, scale: 1 } });
  const now = cornerOf(moved.page, part);

  check(
    `${part}: arrives exactly where it was dragged`,
    !!was && !!now && near(now.x, was.x + 12) && near(now.y, was.y - 18),
    was && now
      ? `${was.x.toFixed(1)},${was.y.toFixed(1)} -> ${now.x.toFixed(1)},${now.y.toFixed(1)}`
      : "not on the cover",
  );
  check(
    `${part}: takes the whole of itself and nothing else`,
    everythingElse(still.page, part) === everythingElse(moved.page, part),
    "something else on the cover moved with it",
  );
}

// The two hairlines are drawn as objects of their own and read as part of the
// block above or below them: the flourish belongs to the title, and the short
// rule over the address belongs to the address.
{
  const moved = withPlacements({ coverTitle: { dx: 0, dy: -40, scale: 1 } });
  const flourish = moved.page.rules.find((rule) => rule.field === "coverTitle");
  const before = still.page.rules.find((rule) => rule.field === "coverTitle");
  check(
    "the flourish under the title goes with the title",
    !!flourish && !!before && near(flourish.y, before.y - 40),
    `${before?.y.toFixed(1)} -> ${flourish?.y.toFixed(1)}`,
  );
}

// Nothing may leave the paper, however far the pointer went.
for (const [name, placement] of [
  ["dragged off the left", { dx: -900, dy: 0, scale: 1 }],
  ["dragged off the right", { dx: 900, dy: 0, scale: 1 }],
  ["dragged off the top", { dx: 0, dy: -900, scale: 1 }],
  ["dragged off the foot", { dx: 0, dy: 900, scale: 1 }],
] as const) {
  const moved = withPlacements({ coverTitle: placement, coverPhoto: placement });
  const { page, width, height } = moved;
  const lefts = [
    ...page.runs.map((r) => r.x + (r.w - metrics.widthOf(r.text, r.size, r.weight)) / 2),
    ...page.photos.map((p) => p.box.x),
  ];
  const rights = [
    ...page.runs.map((r) => r.x + (r.w + metrics.widthOf(r.text, r.size, r.weight)) / 2),
    ...page.photos.map((p) => p.box.x + p.box.w),
  ];
  const tops = [...page.runs.map((r) => r.y), ...page.photos.map((p) => p.box.y)];
  const bottoms = [
    ...page.runs.map((r) => r.y + metrics.lineHeight(r.size)),
    ...page.photos.map((p) => p.box.y + p.box.h),
  ];

  check(
    `${name}: everything is still on the paper, inside the two rules`,
    Math.min(...lefts) >= -0.5 &&
      Math.max(...rights) <= width + 0.5 &&
      Math.min(...tops) >= 6 - 0.5 &&
      Math.max(...bottoms) <= height - 6 + 0.5,
    `${Math.min(...lefts).toFixed(1)}..${Math.max(...rights).toFixed(1)} of ${width.toFixed(0)}, ` +
      `${Math.min(...tops).toFixed(1)}..${Math.max(...bottoms).toFixed(1)} of ${height.toFixed(0)}`,
  );
}

// A picture is made bigger about its own middle: growing it from a corner
// would walk it down the page as it went.
{
  const was = still.page.photos.find((slot) => slot.field === "coverPhoto")!;
  const middle = { x: was.box.x + was.box.w / 2, y: was.box.y + was.box.h / 2 };
  const half = withPlacements({ coverPhoto: { dx: 0, dy: 0, scale: 0.5 } });
  const now = half.page.photos.find((slot) => slot.field === "coverPhoto")!;

  check(
    "a picture taken to half the size is half the size",
    near(now.box.w, was.box.w * 0.5) && near(now.box.h, was.box.h * 0.5),
    `${was.box.w.toFixed(0)}x${was.box.h.toFixed(0)} -> ${now.box.w.toFixed(0)}x${now.box.h.toFixed(0)}`,
  );
  check(
    "and stays about its own middle",
    near(now.box.x + now.box.w / 2, middle.x) && near(now.box.y + now.box.h / 2, middle.y),
    `${middle.x.toFixed(1)},${middle.y.toFixed(1)} -> ${(now.box.x + now.box.w / 2).toFixed(1)},${(now.box.y + now.box.h / 2).toFixed(1)}`,
  );

  // Growing works the same way, up to the paper: this photograph is composed
  // at nearly the full width of the cover, so there is only a little room left
  // in it - which is itself the point of the cap below.
  const grown = withPlacements({ coverPhoto: { dx: 0, dy: 0, scale: 1.05 } });
  const wider = grown.page.photos.find((slot) => slot.field === "coverPhoto")!;
  check(
    "and a picture with room to grow grows by what it was asked for",
    near(wider.box.w, was.box.w * 1.05) && near(wider.box.x + wider.box.w / 2, middle.x),
    `${was.box.w.toFixed(1)} -> ${wider.box.w.toFixed(1)}`,
  );

  const huge = withPlacements({ coverPhoto: { dx: 0, dy: 0, scale: 40 } });
  const capped = huge.page.photos.find((slot) => slot.field === "coverPhoto")!;
  check(
    "a picture cannot be made bigger than the paper",
    capped.box.w <= huge.width + 0.5 && capped.box.h <= huge.height - 12 + 0.5,
    `${capped.box.w.toFixed(0)}x${capped.box.h.toFixed(0)} on ${huge.width.toFixed(0)}x${huge.height.toFixed(0)}`,
  );
  check(
    "and keeps its shape while it is stopped",
    near(capped.box.w / capped.box.h, was.box.w / was.box.h),
    `${(capped.box.w / capped.box.h).toFixed(3)} against ${(was.box.w / was.box.h).toFixed(3)}`,
  );
}

// What the composer reports having used is what it actually did - the editor
// drags against those numbers, so a difference here is a drag that fights back.
{
  const asked = {
    coverTitle: { dx: 18, dy: 9, scale: 1 },
    coverPhoto: { dx: -900, dy: 0, scale: 1 },
  };
  const moved = withPlacements(asked);
  const was = cornerOf(still.page, "coverPhoto")!;
  const now = cornerOf(moved.page, "coverPhoto")!;

  check(
    "an untroubled placement is reported back as it was asked for",
    !!moved.placed.coverTitle &&
      near(moved.placed.coverTitle.dx, 18) &&
      near(moved.placed.coverTitle.dy, 9),
    JSON.stringify(moved.placed.coverTitle),
  );
  check(
    "a clamped one is reported as the distance it actually went",
    !!moved.placed.coverPhoto && near(moved.placed.coverPhoto.dx, now.x - was.x),
    `${moved.placed.coverPhoto?.dx.toFixed(1)} against ${(now.x - was.x).toFixed(1)}`,
  );
}

// A part that is not on this cover keeps what was stored for it and changes
// nothing: filling the field in again should find it where it was left.
{
  const empty = { ...arranged, coverSubtitle: "", coverPlacements: {} };
  const placed = {
    ...empty,
    coverPlacements: { coverSubtitle: { dx: 40, dy: 40, scale: 1 } },
  };
  check(
    "a placement on a part that is not on the cover draws the same cover",
    everythingElse(composeCoverPage(empty, metrics).page, "coverSubtitle") ===
      everythingElse(composeCoverPage(placed, metrics).page, "coverSubtitle"),
    "the cover changed around a part that is not on it",
  );
}

// What comes back out of the database, which is anything at all.
{
  const read = (stored: unknown) => normalizeSettings({ coverPlacements: stored }).coverPlacements;

  check("placements that are not there read as none", JSON.stringify(read(undefined)) === "{}");
  check("nor are an array one", JSON.stringify(read([1, 2, 3])) === "{}");
  check("nor is a string", JSON.stringify(read("coverTitle")) === "{}");
  check(
    "a part nobody has heard of is dropped",
    JSON.stringify(read({ coverBanner: { dx: 5, dy: 5, scale: 1 } })) === "{}",
  );
  check(
    "a part at rest is dropped rather than stored as three zeroes",
    JSON.stringify(read({ coverTitle: { dx: 0, dy: 0, scale: 1 } })) === "{}",
  );
  check(
    "a NaN is read as no movement at all",
    JSON.stringify(read({ coverTitle: { dx: Number.NaN, dy: 12, scale: "big" } })) ===
      JSON.stringify({ coverTitle: { dx: 0, dy: 12, scale: 1 } }),
  );
  check(
    "a size beyond what a picture may be is brought back to it",
    read({ coverPhoto: { dx: 0, dy: 0, scale: 900 } })?.coverPhoto?.scale === 4,
    JSON.stringify(read({ coverPhoto: { dx: 0, dy: 0, scale: 900 } })),
  );
}

console.log("");

// What the editor writes down as a part is dragged, which is the one part of
// this that is not about a cover at all: a drag says how far the pointer has
// come since it last said so, and the answer is added to where the part is
// currently drawn rather than to what was stored for it. Those differ exactly
// when the paper has stopped a part moving, and a drag that fights back at the
// edge - two inches of pointer to pay off before the title moves a hair - is
// the thing this rule exists to prevent.
{
  const drag = (stored: CoverPlacements, dx: number) => {
    const drawn = composeCoverPage({ ...arranged, coverPlacements: stored }, metrics).placed;
    return placeCoverPart(stored, drawn, "coverTitle", (from) => ({ ...from, dx: from.dx + dx }));
  };

  // Out to the left edge in one long pull, well past it, and straight back.
  const pushed = drag({}, -400);
  const atTheEdge = composeCoverPage({ ...arranged, coverPlacements: pushed }, metrics);
  const stopped = atTheEdge.placed.coverTitle!.dx;
  /** The left-hand edge of the title's own type, which is what is kept on the paper. */
  const inkLeft = Math.min(
    ...atTheEdge.page.runs
      .filter((run) => run.field === "coverTitle")
      .map((run) => run.x + (run.w - metrics.widthOf(run.text, run.size, run.weight)) / 2),
  );
  const back = drag(pushed, 40);
  const was = cornerOf(still.page, "coverTitle")!;
  const now = cornerOf(
    composeCoverPage({ ...arranged, coverPlacements: back }, metrics).page,
    "coverTitle",
  )!;

  check(
    "a title dragged well past the left edge stops against it",
    stopped > -400 && near(inkLeft, 0),
    `went ${stopped.toFixed(1)} of the 400 the pointer travelled, type at ${inkLeft.toFixed(1)}`,
  );
  check(
    "and coming back moves it the moment the pointer turns round",
    near(now.x - was.x, stopped + 40),
    `${(now.x - was.x).toFixed(1)} against ${(stopped + 40).toFixed(1)}`,
  );

  // And the other rule the editor leans on: a part put back where it was
  // composed is forgotten, not stored as three zeroes.
  const home = placeCoverPart(
    { coverTitle: { dx: 12, dy: 0, scale: 1 } },
    {},
    "coverTitle",
    () => ({
      dx: 0,
      dy: 0,
      scale: 1,
    }),
  );
  check("a part put back where it was composed is forgotten", !("coverTitle" in home));
}

console.log("");
