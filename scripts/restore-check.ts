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
import { toCsv } from "@/lib/csv";
import type { HouseholdRow, PersonRow, ProjectRow, TagRow } from "@/lib/database.types";
import { check, same } from "./check";

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
    gender: null,
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
    background_check_on: null,
    background_check_due: null,
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
  same("every family goes in", ids(rows.households), ["h1", "h2"]);
  same("every person goes in", ids(rows.people), ["p1", "p2", "p3"]);
  same("every group goes in", ids(rows.tags), ["t1", "t2"]);
  same("the directory goes in", ids(rows.projects), ["pr1"]);
  same("its group survives", rows.projectTags.length, 1);
  same("both its entries survive", rows.projectEntries.length, 2);
  same("nobody is orphaned", rows.orphaned, 0);
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
  same("no family rewritten", rows.households.length, 0);
  same("no person rewritten", rows.people.length, 0);
  same("no group rewritten", rows.tags.length, 0);
  same("no directory rewritten", rows.projects.length, 0);
  same("no link rewritten", rows.householdTags.length + rows.personTags.length, 0);
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
  same("only the deleted family comes back", ids(rows.households), ["h1"]);
  same("only its people come back", ids(rows.people), ["p1", "p2"]);
  same(
    "they are still in their family",
    rows.people.every((p) => p.household_id === "h1"),
    true,
  );
  same("its group link is restored", rows.householdTags, [{ household_id: "h1", tag_id: "t1" }]);
  same("a link already there is left alone", rows.personTags.length, 0);
  same("nothing about h3 or p4 is touched", ids(rows.households).includes("h3"), false);
  same("nobody is orphaned", rows.orphaned, 0);
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
  same("the missing link is put back", rows.householdTags, [{ household_id: "h1", tag_id: "t1" }]);
  same("and the person's", rows.personTags, [{ person_id: "p1", tag_id: "t2" }]);
  same("without rewriting the records", rows.households.length + rows.people.length, 0);
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
  same("the file's families all go in", ids(rows.households), ["h1", "h2"]);
  same("the file's people all go in", ids(rows.people), ["p1", "p2", "p3"]);
  same("the file's groups all go in", ids(rows.tags), ["t1", "t2"]);
  same("nothing of the live directory is written", ids(rows.households).includes("h9"), false);
  same("links are not skipped as already-there", rows.householdTags.length, 1);
}

console.log("\na backup taken while a family was being deleted");
{
  // p3 points at h2, which is not in the file and not in the directory.
  const file = backup({
    households: [household("h1", "Smith")],
    people: [person("p1", "h1"), person("p3", "h2")],
  });
  const rows = selectRows(file, EMPTY, "missing");
  same("everybody still comes back", ids(rows.people), ["p1", "p3"]);
  const stray = rows.people.find((p) => p.id === "p3");
  same("the one with no family comes back without one", stray?.household_id, null);
  same("and without a role in it", stray?.household_role, null);
  same("the other keeps their family", rows.people.find((p) => p.id === "p1")?.household_id, "h1");
  same("it is reported", rows.orphaned, 1);
}

console.log("\na person whose family survived in the directory");
{
  const file = backup({ households: [], people: [person("p1", "h1")], householdTags: [] });
  const live: LiveDirectory = { ...EMPTY, households: [household("h1", "Smith")] };
  const rows = selectRows(file, live, "missing");
  same("keeps it", rows.people[0]?.household_id, "h1");
  same("and is not counted as orphaned", rows.orphaned, 0);
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
  same("only the whole family link is written", rows.householdTags, [
    { household_id: "h1", tag_id: "t1" },
  ]);
  same("the dangling person link is dropped", rows.personTags.length, 0);
  same("the dangling directory group is dropped", rows.projectTags, [
    { project_id: "pr1", tag_id: "t1" },
  ]);
  same(
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
  same("only pictures that are in the archive", rows.photoPaths.sort(), [
    "households/a.jpg",
    "people/b.jpg",
  ]);

  const none = selectRows(file, EMPTY, "missing");
  same("a records-only backup asks for none", none.photoPaths.length, 0);

  const live: LiveDirectory = { ...EMPTY, households: file.households, people: file.people };
  const nothingMissing = selectRows(file, live, "missing", new Set(), photos);
  same("and none when no record is being written", nothingMissing.photoPaths.length, 0);
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
  same("writes nothing rather than throwing", total, 0);
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
    check(what, false, "it was accepted");
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause);
    check(what, expect.test(said), `said "${said}"`);
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
  same("families are counted", plan.inFile.households, 2);
  same("people are counted", plan.inFile.people, 3);
  same("groups are counted", plan.inFile.tags, 2);
  same("directories are counted", plan.inFile.projects, 1);
  same("all of them read as missing from an empty directory", plan.missing.people, 3);
  same("nothing is newer than the backup", plan.newerThanBackup.people, 0);
  same(
    "the date it was taken is understood",
    plan.takenAt?.toISOString(),
    "2026-01-01T00:00:00.000Z",
  );
  same("photographs are keyed without the photos/ prefix", [...plan.photos.keys()].sort(), [
    "households/a.jpg",
    "people/b.jpg",
  ]);
  same("and their bytes survive", [...(plan.photos.get("people/b.jpg") ?? [])], [4, 5]);
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
  same("one family is missing", plan.missing.households, 1);
  same("two people are missing", plan.missing.people, 2);
  same("one directory is missing", plan.missing.projects, 1);
  same("one family is newer than the backup", plan.newerThanBackup.households, 1);
  same("one person is newer than the backup", plan.newerThanBackup.people, 1);
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
  same("it reads", plan.inFile.households, 1);
  same("with no directories", plan.inFile.projects, 0);
  same("and no links", plan.file.householdTags.length + plan.file.personTags.length, 0);
  const rows = selectRows(plan.file, EMPTY, "missing");
  same("and restores what it does have", ids(rows.households), ["h1"]);
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
  same("an untouched directory is missing no records", nothing.missing.people, 0);
  same("and no group labels", nothing.missing.links, 0);

  // The records all survived; one group label against one of them did not.
  // This is the case the page would otherwise call "nothing is missing".
  const lostLink = await readBackup(archive(), { ...whole, householdTags: [] });
  same("a lost group label is counted", lostLink.missing.links, 1);
  same("even though every record is present", lostLink.missing.households, 0);
  const rows = selectRows(lostLink.file, { ...whole, householdTags: [] }, "missing");
  same("and restoring would put it back", rows.householdTags, [
    { household_id: "h1", tag_id: "t1" },
  ]);

  const lostBoth = await readBackup(archive(), {
    ...whole,
    householdTags: [],
    personTags: [],
  });
  same("both kinds of link are counted", lostBoth.missing.links, 2);
}

// ---------------------------------------------------------------------------
// A deleted family. The database does not delete a family's members with it -
// it clears their link to the family and leaves them in the directory - so the
// case the restore exists for is a family missing and its people present,
// each with no family at all.
// ---------------------------------------------------------------------------

console.log("\na deleted family, as the database leaves it");
{
  const file = backup();
  const afterDelete: LiveDirectory = {
    ...EMPTY,
    households: [household("h2", "Jones")],
    people: [person("p1", null), person("p2", null), person("p3", "h2")],
    tags: file.tags,
    projects: [project("pr1")],
  };
  const rows = selectRows(file, afterDelete, "missing");
  same("the family comes back", ids(rows.households), ["h1"]);
  same("its members are not written again", rows.people.length, 0);
  same(
    "they are put back into it, with their role",
    rows.reattach.map((row) => [row.id, row.household_id, row.household_role]).sort(),
    [
      ["p1", "h1", "head"],
      ["p2", "h1", "head"],
    ],
  );
  same("nobody else is moved", rows.reattach.length, 2);

  const plan = await readBackup(archive(), afterDelete);
  same("the preview counts them", plan.missing.reattach, 2);
  same("and does not call them missing people", plan.missing.people, 0);

  // Moved into another family since, or taken out of this one while it still
  // exists: both were done on purpose, and both are left alone.
  const moved: LiveDirectory = {
    ...afterDelete,
    people: [person("p1", "h2"), person("p2", null), person("p3", "h2")],
  };
  same(
    "somebody since moved into another family stays there",
    selectRows(file, moved, "missing").reattach.map((row) => row.id),
    ["p2"],
  );
  const leftOnPurpose: LiveDirectory = {
    ...afterDelete,
    households: [household("h1", "Smith"), household("h2", "Jones")],
  };
  same(
    "somebody taken out of a family that still exists is not put back",
    selectRows(file, leftOnPurpose, "missing").reattach.length,
    0,
  );
  same(
    "replacing writes everyone afresh instead",
    selectRows(file, afterDelete, "replace").reattach.length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Photographs: pictures missing from records that are still here, cover
// artwork, and what a replace leaves behind in storage.
// ---------------------------------------------------------------------------

console.log("\nphotographs of records that are still here");
{
  const file = backup({
    households: [household("h1", "Smith", "households/a.jpg"), household("h2", "Jones")],
    people: [person("p1", "h1", "people/b.jpg"), person("p2", "h1"), person("p3", "h2")],
    projects: [
      {
        project: { ...project("pr1"), settings: { coverPhotoPath: "covers/c.jpg" } },
        tagIds: [],
        entries: [],
      },
    ],
  });
  const photos = new Map([
    ["households/a.jpg", new Uint8Array([1])],
    ["people/b.jpg", new Uint8Array([2])],
    ["covers/c.jpg", new Uint8Array([3])],
  ]);
  const everything: LiveDirectory = {
    ...EMPTY,
    households: file.households,
    people: file.people,
    tags: file.tags,
    projects: file.projects.map((row) => row.project),
  };

  const lostOne = selectRows(
    file,
    { ...everything, storedPhotos: new Set(["households/a.jpg", "covers/c.jpg"]) },
    "missing",
    new Set(),
    photos,
  );
  same("a picture gone from a surviving record is put back", lostOne.photoPaths, ["people/b.jpg"]);
  same("and counted as a repair", lostOne.repairedPhotos, 1);

  const lostCover = selectRows(
    file,
    { ...everything, storedPhotos: new Set(["households/a.jpg", "people/b.jpg"]) },
    "missing",
    new Set(),
    photos,
  );
  same("so is a directory's cover", lostCover.photoPaths, ["covers/c.jpg"]);

  same(
    "nothing is uploaded when every picture is there",
    selectRows(
      file,
      { ...everything, storedPhotos: new Set(photos.keys()) },
      "missing",
      new Set(),
      photos,
    ).photoPaths.length,
    0,
  );
  same(
    "nor when storage could not be listed",
    selectRows(file, { ...everything, storedPhotos: null }, "missing", new Set(), photos).photoPaths
      .length,
    0,
  );

  const restoringAll = selectRows(file, EMPTY, "missing", new Set(), photos);
  same(
    "a restored directory brings its cover with it",
    restoringAll.photoPaths.includes("covers/c.jpg"),
    true,
  );

  const replaced = selectRows(
    file,
    {
      ...everything,
      storedPhotos: new Set([
        "households/a.jpg",
        "people/b.jpg",
        "covers/c.jpg",
        "people/added-since.jpg",
        "elsewhere/kept.jpg",
      ]),
    },
    "replace",
    new Set(),
    photos,
  );
  same("a replace does not re-upload pictures already there", replaced.photoPaths.length, 0);
  same(
    "and clears only pictures in the directory's folders that nothing points at",
    replaced.photosToRemove,
    ["people/added-since.jpg"],
  );
  same(
    "adding back never clears anything",
    selectRows(
      file,
      { ...everything, storedPhotos: new Set(["people/added-since.jpg"]) },
      "missing",
      new Set(),
      photos,
    ).photosToRemove.length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Archives that have been handled: unzipped and zipped up again, or damaged.
// ---------------------------------------------------------------------------

console.log("\nan archive that was unzipped and zipped up again");
{
  const inner = archive({}, [{ name: "photos/people/b.jpg", data: new Uint8Array([4, 5]) }]);
  // Rebuild it the way Finder's Compress would: everything one folder down,
  // plus the resource forks macOS adds beside it.
  const { readZip } = await import("@/lib/unzip");
  const entries = await readZip(inner);
  const folder = "church-directory-backup-2026-09-23/";
  const rezipped = buildZip([
    ...entries.map((entry) => ({ name: folder + entry.name, data: entry.data })),
    { name: `__MACOSX/${folder}._directory.json`, data: new Uint8Array([0]) },
  ]);
  const plan = await readBackup(rezipped, EMPTY);
  same("it reads", plan.inFile.households, 2);
  same("its photographs are found", [...plan.photos.keys()], ["people/b.jpg"]);

  const twoBackups = buildZip([
    ...entries.map((entry) => ({ name: `one/${entry.name}`, data: entry.data })),
    ...entries.map((entry) => ({ name: `two/${entry.name}`, data: entry.data })),
  ]);
  await refuses(
    "two backups zipped together are refused rather than guessed between",
    twoBackups,
    /no directory\.json/,
  );
}

console.log("\na damaged archive");
{
  const marker = [9, 8, 7, 6, 5, 4, 3, 2];
  const bytes = archive({}, [
    { name: "photos/people/good.jpg", data: new Uint8Array([1, 2]) },
    { name: "photos/people/bad.jpg", data: new Uint8Array(marker) },
  ]);
  const at = bytes.findIndex((_, i) => marker.every((value, k) => bytes[i + k] === value));
  bytes[at + 3] ^= 0xff;

  const plan = await readBackup(bytes, EMPTY);
  same(
    "a photograph that fails its checksum is left out",
    [...plan.photos.keys()],
    ["people/good.jpg"],
  );
  same("and counted", plan.damagedPhotos, 1);

  const json = archive();
  const text = enc.encode('"format": "church-directory-backup"');
  const where = json.findIndex((_, i) => text.every((value, k) => json[i + k] === value));
  json[where + 12] ^= 0x01;
  await refuses("a damaged directory.json is refused", json, /damaged/);
}

console.log("\nthe spreadsheets in a backup");
{
  const csv = toCsv(
    ["Name", "Notes"],
    [
      ['=HYPERLINK("http://x")', "+1 then"],
      ["@SUM(A1)", "-5"],
      ["Plain", 42],
      [-3, "ok"],
    ],
  );
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");
  same("a formula is written as text", lines[1], `"'=HYPERLINK(""http://x"")",'+1 then`);
  same("so are @ and -", lines[2], "'@SUM(A1),'-5");
  same("ordinary text and numbers are untouched", lines[3], "Plain,42");
  same("a negative number stays a number", lines[4], "-3,ok");
}
