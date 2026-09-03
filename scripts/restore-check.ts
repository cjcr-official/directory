/**
 * What a restore would write, checked against the archives that go wrong.
 *
 * selectRows makes every judgement a restore makes and touches no database, so
 * the awkward cases can be put to it directly: a backup taken while a group was
 * half-deleted, a person whose family is in neither the file nor the directory,
 * a link that is already there. None of those are reachable by pressing the
 * button on a healthy congregation, which is exactly why they need a test.
 *
 * Run with: npm run restore:check
 */

import { readBackup, selectRows, type BackupFile, type LiveDirectory } from "@/lib/restorePlan";
import { buildZip } from "@/lib/zip";
import type { HouseholdRow, PersonRow, ProjectRow, TagRow } from "@/lib/database.types";

let failures = 0;

function check(what: string, got: unknown, want: unknown): void {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failures += 1;
  console.log(
    `  ${same ? "ok  " : "FAIL"} ${what}${same ? "" : `  got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`,
  );
}

const WHEN = "2026-01-01T00:00:00+00:00";

function household(id: string, name: string, photo: string | null = null): HouseholdRow {
  return {
    id,
    display_name: name,
    sort_name: name,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    phone: null,
    email: null,
    anniversary: null,
    photo_path: photo,
    notes: null,
    is_active: true,
    created_at: WHEN,
    updated_at: WHEN,
  };
}

function person(id: string, householdId: string | null, photo: string | null = null): PersonRow {
  return {
    id,
    household_id: householdId,
    household_role: householdId ? "head" : null,
    first_name: id,
    last_name: "Person",
    preferred_name: null,
    email: null,
    phone: null,
    date_of_birth: null,
    anniversary: null,
    use_household_address: true,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    photo_path: photo,
    notes: null,
    sort_order: 0,
    is_active: true,
    created_at: WHEN,
    updated_at: WHEN,
  };
}

const tag = (id: string): TagRow => ({
  id,
  name: id,
  color: "#000000",
  description: null,
  created_at: WHEN,
});

const project = (id: string): ProjectRow => ({
  id,
  name: id,
  kind: "directory",
  description: null,
  selection_mode: "all",
  settings: {},
  created_at: WHEN,
  updated_at: WHEN,
});

function backup(over: Partial<BackupFile> = {}): BackupFile {
  return {
    format: "church-directory-backup",
    version: 1,
    takenAt: WHEN,
    households: [household("h1", "Smith"), household("h2", "Jones")],
    people: [person("p1", "h1"), person("p2", "h1"), person("p3", "h2")],
    tags: [tag("t1"), tag("t2")],
    householdTags: [{ household_id: "h1", tag_id: "t1" }],
    personTags: [{ person_id: "p1", tag_id: "t2" }],
    projects: [
      {
        project: project("pr1"),
        tagIds: ["t1"],
        entries: [
          { project_id: "pr1", entry_type: "household", ref_id: "h1", position: 0 },
          { project_id: "pr1", entry_type: "person", ref_id: "p3", position: 1 },
        ],
      },
    ],
    photosIncluded: true,
    missingPhotos: [],
    ...over,
  };
}

const EMPTY: LiveDirectory = {
  households: [],
  people: [],
  tags: [],
  projects: [],
  householdTags: [],
  personTags: [],
};
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

// ---------------------------------------------------------------------------

console.log("\nan empty directory, adding back what is missing");
{
  const rows = selectRows(backup(), EMPTY, "missing");
  check("every family goes in", ids(rows.households), ["h1", "h2"]);
  check("every person goes in", ids(rows.people), ["p1", "p2", "p3"]);
  check("every group goes in", ids(rows.tags), ["t1", "t2"]);
  check("the directory goes in", ids(rows.projects), ["pr1"]);
  check("its group survives", rows.projectTags.length, 1);
  check("both its entries survive", rows.projectEntries.length, 2);
  check("nobody is orphaned", rows.orphaned, 0);
}

console.log("\nnothing has been lost - restoring must be a no-op");
{
  const file = backup();
  const live: LiveDirectory = {
    households: file.households,
    people: file.people,
    tags: file.tags,
    projects: file.projects.map((p) => p.project),
    householdTags: file.householdTags,
    personTags: file.personTags,
  };
  const existing = new Set(["h:h1:t1", "p:p1:t2"]);
  const rows = selectRows(file, live, "missing", existing);
  check("no family rewritten", rows.households.length, 0);
  check("no person rewritten", rows.people.length, 0);
  check("no group rewritten", rows.tags.length, 0);
  check("no directory rewritten", rows.projects.length, 0);
  check("no link rewritten", rows.householdTags.length + rows.personTags.length, 0);
}

console.log("\none family was deleted, and work has happened since");
{
  const file = backup();
  // h1 and its two people are gone. h3 was added after the backup was taken.
  const live: LiveDirectory = {
    households: [household("h2", "Jones"), household("h3", "New")],
    people: [person("p3", "h2"), person("p4", "h3")],
    tags: file.tags,
    projects: file.projects.map((p) => p.project),
    householdTags: [],
    personTags: [{ person_id: "p1", tag_id: "t2" }],
  };
  const rows = selectRows(file, live, "missing", new Set(["p:p1:t2"]));
  check("only the deleted family comes back", ids(rows.households), ["h1"]);
  check("only its people come back", ids(rows.people), ["p1", "p2"]);
  check(
    "they are still in their family",
    rows.people.every((p) => p.household_id === "h1"),
    true,
  );
  check("its group link is restored", rows.householdTags, [{ household_id: "h1", tag_id: "t1" }]);
  check("a link already there is left alone", rows.personTags.length, 0);
  check("nothing about h3 or p4 is touched", ids(rows.households).includes("h3"), false);
  check("nobody is orphaned", rows.orphaned, 0);
}

console.log("\na link was lost but its records were not");
{
  const file = backup();
  const live: LiveDirectory = {
    households: file.households,
    people: file.people,
    tags: file.tags,
    projects: [],
    householdTags: [],
    personTags: [],
  };
  // Both ends are alive; the link between them is not recorded any more.
  const rows = selectRows(file, live, "missing", new Set());
  check("the missing link is put back", rows.householdTags, [{ household_id: "h1", tag_id: "t1" }]);
  check("and the person's", rows.personTags, [{ person_id: "p1", tag_id: "t2" }]);
  check("without rewriting the records", rows.households.length + rows.people.length, 0);
}

console.log("\nreplacing everything");
{
  const file = backup();
  const live: LiveDirectory = {
    households: [household("h9", "Later")],
    people: [person("p9", "h9")],
    tags: [tag("t9")],
    projects: [project("pr9")],
    householdTags: [],
    personTags: [],
  };
  const rows = selectRows(file, live, "replace", new Set(["h:h1:t1"]));
  check("the file's families all go in", ids(rows.households), ["h1", "h2"]);
  check("the file's people all go in", ids(rows.people), ["p1", "p2", "p3"]);
  check("the file's groups all go in", ids(rows.tags), ["t1", "t2"]);
  check("nothing of the live directory is written", ids(rows.households).includes("h9"), false);
  check("links are not skipped as already-there", rows.householdTags.length, 1);
}

console.log("\na backup taken while a family was being deleted");
{
  // p3 points at h2, which is not in the file and not in the directory.
  const file = backup({
    households: [household("h1", "Smith")],
    people: [person("p1", "h1"), person("p3", "h2")],
  });
  const rows = selectRows(file, EMPTY, "missing");
  check("everybody still comes back", ids(rows.people), ["p1", "p3"]);
  const stray = rows.people.find((p) => p.id === "p3");
  check("the one with no family comes back without one", stray?.household_id, null);
  check("and without a role in it", stray?.household_role, null);
  check("the other keeps their family", rows.people.find((p) => p.id === "p1")?.household_id, "h1");
  check("it is reported", rows.orphaned, 1);
}

console.log("\na person whose family survived in the directory");
{
  const file = backup({ households: [], people: [person("p1", "h1")], householdTags: [] });
  const live: LiveDirectory = { ...EMPTY, households: [household("h1", "Smith")] };
  const rows = selectRows(file, live, "missing");
  check("keeps it", rows.people[0]?.household_id, "h1");
  check("and is not counted as orphaned", rows.orphaned, 0);
}

console.log("\nlinks and entries pointing at things that will not exist");
{
  const file = backup({
    tags: [tag("t1")], // t2 is gone from the file
    householdTags: [
      { household_id: "h1", tag_id: "t1" },
      { household_id: "h1", tag_id: "t2" }, // dangling group
      { household_id: "hX", tag_id: "t1" }, // dangling family
    ],
    personTags: [{ person_id: "p1", tag_id: "t2" }], // dangling group
    projects: [
      {
        project: project("pr1"),
        tagIds: ["t1", "t2"],
        entries: [
          { project_id: "pr1", entry_type: "household", ref_id: "h1", position: 0 },
          { project_id: "pr1", entry_type: "household", ref_id: "hX", position: 1 },
          { project_id: "pr1", entry_type: "person", ref_id: "pX", position: 2 },
        ],
      },
    ],
  });
  const rows = selectRows(file, EMPTY, "missing");
  check("only the whole family link is written", rows.householdTags, [
    { household_id: "h1", tag_id: "t1" },
  ]);
  check("the dangling person link is dropped", rows.personTags.length, 0);
  check("the dangling directory group is dropped", rows.projectTags, [
    { project_id: "pr1", tag_id: "t1" },
  ]);
  check(
    "only the entry that resolves survives",
    rows.projectEntries.map((e) => e.ref_id),
    ["h1"],
  );
}

console.log("\nphotographs");
{
  const file = backup({
    households: [household("h1", "Smith", "households/a.jpg")],
    people: [person("p1", "h1", "people/b.jpg"), person("p2", "h1", "people/gone.jpg")],
  });
  const photos = new Map<string, Uint8Array>([
    ["households/a.jpg", new Uint8Array([1])],
    ["people/b.jpg", new Uint8Array([2])],
    ["people/unreferenced.jpg", new Uint8Array([3])],
  ]);
  const rows = selectRows(file, EMPTY, "missing", new Set(), photos);
  check("only pictures that are in the archive", rows.photoPaths.sort(), [
    "households/a.jpg",
    "people/b.jpg",
  ]);

  const none = selectRows(file, EMPTY, "missing");
  check("a records-only backup asks for none", none.photoPaths.length, 0);

  const live: LiveDirectory = { ...EMPTY, households: file.households, people: file.people };
  const nothingMissing = selectRows(file, live, "missing", new Set(), photos);
  check("and none when no record is being written", nothingMissing.photoPaths.length, 0);
}

console.log("\nan archive with nothing in it");
{
  const rows = selectRows(
    backup({
      households: [],
      people: [],
      tags: [],
      householdTags: [],
      personTags: [],
      projects: [],
    }),
    EMPTY,
    "missing",
  );
  const total =
    rows.households.length + rows.people.length + rows.tags.length + rows.projects.length;
  check("writes nothing rather than throwing", total, 0);
}

// ---------------------------------------------------------------------------
// The whole path: an archive shaped exactly as backup.ts writes one, read back
// through the ZIP reader and the parser.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

/** directory.json with the same keys buildBackup puts in it. */
function archive(file: Partial<BackupFile> = {}, extra: { name: string; data: Uint8Array }[] = []) {
  const full = { ...backup(), ...file };
  return buildZip([
    { name: "README.txt", data: enc.encode("CHURCH DIRECTORY - BACKUP") },
    { name: "families.csv", data: enc.encode("Family name\n") },
    { name: "people.csv", data: enc.encode("Last name\n") },
    { name: "groups.csv", data: enc.encode("Group\n") },
    { name: "directory.json", data: enc.encode(JSON.stringify(full, null, 2)) },
    ...extra,
  ]);
}

async function refuses(what: string, bytes: Uint8Array, expect: RegExp): Promise<void> {
  try {
    await readBackup(bytes, EMPTY);
    failures += 1;
    console.log(`  FAIL ${what}  it was accepted`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const ok = expect.test(message);
    if (!ok) failures += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  said "${message}"`}`);
  }
}

console.log("\nreading a whole archive back");
{
  const plan = await readBackup(
    archive({}, [
      { name: "photos/households/a.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "photos/people/b.jpg", data: new Uint8Array([4, 5]) },
    ]),
    EMPTY,
  );
  check("families are counted", plan.inFile.households, 2);
  check("people are counted", plan.inFile.people, 3);
  check("groups are counted", plan.inFile.tags, 2);
  check("directories are counted", plan.inFile.projects, 1);
  check("all of them read as missing from an empty directory", plan.missing.people, 3);
  check("nothing is newer than the backup", plan.newerThanBackup.people, 0);
  check(
    "the date it was taken is understood",
    plan.takenAt?.toISOString(),
    "2026-01-01T00:00:00.000Z",
  );
  check("photographs are keyed without the photos/ prefix", [...plan.photos.keys()].sort(), [
    "households/a.jpg",
    "people/b.jpg",
  ]);
  check("and their bytes survive", [...(plan.photos.get("people/b.jpg") ?? [])], [4, 5]);
}

console.log("\nreading it against a directory that has moved on");
{
  const file = backup();
  const live: LiveDirectory = {
    households: [household("h2", "Jones"), household("h3", "New")],
    people: [person("p3", "h2"), person("p4", "h3")],
    tags: file.tags,
    projects: [],
    householdTags: [],
    personTags: [{ person_id: "p1", tag_id: "t2" }],
  };
  const plan = await readBackup(archive(), live);
  check("one family is missing", plan.missing.households, 1);
  check("two people are missing", plan.missing.people, 2);
  check("one directory is missing", plan.missing.projects, 1);
  check("one family is newer than the backup", plan.newerThanBackup.households, 1);
  check("one person is newer than the backup", plan.newerThanBackup.people, 1);
}

console.log("\nfiles that are not a backup");
{
  await refuses("a PDF", enc.encode("%PDF-1.7 ..."), /does not look like a ZIP|Choose the .zip/);
  await refuses(
    "a ZIP with no directory.json",
    buildZip([{ name: "families.csv", data: enc.encode("a,b\n") }]),
    /no directory.json/,
  );
  await refuses(
    "somebody else's ZIP",
    buildZip([{ name: "directory.json", data: enc.encode('{"format":"something-else"}') }]),
    /not one this app wrote/,
  );
  await refuses(
    "damaged JSON",
    buildZip([{ name: "directory.json", data: enc.encode("{ not json") }]),
    /damaged and will not read/,
  );
  await refuses(
    "a backup from a newer app",
    buildZip([
      {
        name: "directory.json",
        data: enc.encode('{"format":"church-directory-backup","version":9}'),
      },
    ]),
    /newer version of this app/,
  );
  await refuses(
    "a hand-edited file with its records taken out",
    buildZip([
      {
        name: "directory.json",
        data: enc.encode('{"format":"church-directory-backup","version":1,"households":[]}'),
      },
    ]),
    /missing its records/,
  );
}

console.log("\nan older backup with no directories in it");
{
  // Written before projects were included. It should read, not throw.
  const plan = await readBackup(
    buildZip([
      {
        name: "directory.json",
        data: enc.encode(
          JSON.stringify({
            format: "church-directory-backup",
            version: 1,
            takenAt: WHEN,
            households: [household("h1", "Smith")],
            people: [person("p1", "h1")],
            tags: [],
          }),
        ),
      },
    ]),
    EMPTY,
  );
  check("it reads", plan.inFile.households, 1);
  check("with no directories", plan.inFile.projects, 0);
  check("and no links", plan.file.householdTags.length + plan.file.personTags.length, 0);
  const rows = selectRows(plan.file, EMPTY, "missing");
  check("and restores what it does have", ids(rows.households), ["h1"]);
}

console.log("\ncounting what is missing, so the page can say so before writing");
{
  const file = backup();
  const whole: LiveDirectory = {
    households: file.households,
    people: file.people,
    tags: file.tags,
    projects: file.projects.map((p) => p.project),
    householdTags: file.householdTags,
    personTags: file.personTags,
  };

  const nothing = await readBackup(archive(), whole);
  check("an untouched directory is missing no records", nothing.missing.people, 0);
  check("and no group labels", nothing.missing.links, 0);

  // The records all survived; one group label against one of them did not.
  // This is the case the page would otherwise call "nothing is missing".
  const lostLink = await readBackup(archive(), { ...whole, householdTags: [] });
  check("a lost group label is counted", lostLink.missing.links, 1);
  check("even though every record is present", lostLink.missing.households, 0);
  const rows = selectRows(lostLink.file, { ...whole, householdTags: [] }, "missing");
  check("and restoring would put it back", rows.householdTags, [
    { household_id: "h1", tag_id: "t1" },
  ]);

  const lostBoth = await readBackup(archive(), {
    ...whole,
    householdTags: [],
    personTags: [],
  });
  check("both kinds of link are counted", lostBoth.missing.links, 2);
}

console.log(failures === 0 ? "\nno problems found in this pass" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
