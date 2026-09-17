/**
 * Who a group's email actually goes to, and who it must not.
 *
 * The bug this exists for is silent and sends real email. A choir booklet
 * prints the whole Alvarez family because Ana sings, which is right for a
 * printed card and wrong for a mailing list: send the choir letter that way
 * and it reaches her husband and both children every week, and nobody
 * notices for a year because it looks like it worked.
 *
 * So the selection is pinned here - who is reached, at which address, and who
 * has left a group and must lose its tag - along with MD5, which is how
 * Mailchimp names a contact and is therefore load-bearing for every tag call.
 *
 * Run with: npm run mailchimp:check
 */

import { buildEntries, type DirectoryData } from "@/lib/entries";
import { chunk, isEmailish, rosterFor, tagChanges } from "@/lib/mailchimp";
import { md5, subscriberHash } from "../worker/md5";
import { missingSettings, settingsOf } from "../worker/settings";
import { describeKey, keyFingerprint } from "../worker/mailchimp";
import type { HouseholdRow, PersonRow } from "@/lib/database.types";
import { createHash } from "node:crypto";
import { check, same } from "./check";

/** An MD5 nobody here wrote, to check the one in worker/ against. */
const nodeMd5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

function household(over: Partial<HouseholdRow>): HouseholdRow {
  return {
    id: "h",
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

function person(over: Partial<PersonRow>): PersonRow {
  return {
    id: "p",
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

const CHOIR = { id: "t-choir", name: "Choir", color: "#2f6d63", description: null, created_at: "" };
const NEWS = {
  id: "t-news",
  name: "Newsletter",
  color: "#3f7cac",
  description: null,
  created_at: "",
};

console.log("\nthe family a booklet prints, and the one person an email is for");
{
  const data: DirectoryData = {
    households: [household({ id: "h1", sort_name: "Alvarez", display_name: "The Alvarez Family" })],
    people: [
      person({
        id: "ana",
        first_name: "Ana",
        last_name: "Alvarez",
        household_id: "h1",
        household_role: "head",
        email: "ana@example.org",
      }),
      person({
        id: "ben",
        first_name: "Ben",
        last_name: "Alvarez",
        household_id: "h1",
        household_role: "spouse",
        email: "ben@example.org",
      }),
      person({
        id: "cal",
        first_name: "Cal",
        last_name: "Alvarez",
        household_id: "h1",
        household_role: "child",
        email: "cal@example.org",
      }),
    ],
    tags: [CHOIR],
    householdTags: [],
    personTags: [{ person_id: "ana", tag_id: CHOIR.id }],
  };

  const roster = rosterFor(buildEntries(data), CHOIR.id);
  same(
    "only the chorister is emailed, not her household",
    roster.recipients.map((r) => r.email),
    ["ana@example.org"],
  );
  same("and she is named as herself", roster.recipients[0].label, "Alvarez, Ana");
  same("at her own address", roster.recipients[0].via, "person");
  same("nobody is left unreachable", roster.unreachable, []);
}

console.log("\na family put in a group as a family");
{
  const data: DirectoryData = {
    households: [
      household({
        id: "h2",
        sort_name: "Baker",
        display_name: "The Baker Family",
        email: "bakers@example.org",
      }),
      household({ id: "h3", sort_name: "Carter", display_name: "The Carter Family" }),
      household({ id: "h4", sort_name: "Diaz", display_name: "The Diaz Family" }),
    ],
    people: [
      person({
        id: "bob",
        first_name: "Bob",
        last_name: "Baker",
        household_id: "h2",
        household_role: "head",
      }),
      person({
        id: "bea",
        first_name: "Bea",
        last_name: "Baker",
        household_id: "h2",
        household_role: "spouse",
      }),
      person({
        id: "cass",
        first_name: "Cass",
        last_name: "Carter",
        household_id: "h3",
        household_role: "head",
        email: "cass@example.org",
      }),
      person({
        id: "col",
        first_name: "Col",
        last_name: "Carter",
        household_id: "h3",
        household_role: "spouse",
        email: "col@example.org",
      }),
      person({
        id: "dee",
        first_name: "Dee",
        last_name: "Diaz",
        household_id: "h4",
        household_role: "head",
      }),
    ],
    tags: [NEWS],
    householdTags: [
      { household_id: "h2", tag_id: NEWS.id },
      { household_id: "h3", tag_id: NEWS.id },
      { household_id: "h4", tag_id: NEWS.id },
    ],
    personTags: [],
  };

  const roster = rosterFor(buildEntries(data), NEWS.id);
  same(
    "the family with its own address is written to once",
    roster.recipients.filter((r) => r.email === "bakers@example.org").length,
    1,
  );
  same(
    "under the family's name",
    roster.recipients.find((r) => r.email === "bakers@example.org")?.label,
    "The Baker Family",
  );
  same(
    "but greeted as the head of the household",
    roster.recipients.find((r) => r.email === "bakers@example.org")?.firstName,
    "Bob",
  );
  same(
    "a family with no address of its own is reached through its members",
    roster.recipients
      .filter((r) => r.email.endsWith("@example.org") && r.label.startsWith("Carter"))
      .map((r) => r.email)
      .sort(),
    ["cass@example.org", "col@example.org"],
  );
  same("and one with no address anywhere is named as unreachable", roster.unreachable, [
    "The Diaz Family",
  ]);
}

console.log("\nnames in a sentence, rather than filed names");
{
  const data: DirectoryData = {
    households: [],
    people: [
      person({ id: "dee", first_name: "Dee", last_name: "Diaz" }),
      person({ id: "eve", first_name: "Eve", last_name: "Ellis" }),
    ],
    tags: [CHOIR],
    householdTags: [],
    personTags: [
      { person_id: "dee", tag_id: CHOIR.id },
      { person_id: "eve", tag_id: CHOIR.id },
    ],
  };

  // "Diaz, Dee, Ellis, Eve" is four people to anybody reading it.
  same("two unreachable people read as two", rosterFor(buildEntries(data), CHOIR.id).unreachable, [
    "Dee Diaz",
    "Eve Ellis",
  ]);
}

console.log("\none mailbox, however many people share it");
{
  const data: DirectoryData = {
    households: [household({ id: "h5", sort_name: "Fox", display_name: "The Fox Family" })],
    people: [
      person({
        id: "fay",
        first_name: "Fay",
        last_name: "Fox",
        household_id: "h5",
        household_role: "head",
        email: "Foxes@Example.ORG",
      }),
      person({
        id: "fred",
        first_name: "Fred",
        last_name: "Fox",
        household_id: "h5",
        household_role: "spouse",
        email: "foxes@example.org",
      }),
      person({ id: "gus", first_name: "Gus", last_name: "Gray", email: " GUS@example.org " }),
    ],
    tags: [CHOIR],
    householdTags: [],
    personTags: [
      { person_id: "fay", tag_id: CHOIR.id },
      { person_id: "fred", tag_id: CHOIR.id },
      { person_id: "gus", tag_id: CHOIR.id },
    ],
  };

  const roster = rosterFor(buildEntries(data), CHOIR.id);
  same("a shared address is one contact, not two", roster.recipients.map((r) => r.email).sort(), [
    "foxes@example.org",
    "gus@example.org",
  ]);
  check(
    "every address is lower-cased and trimmed, which is how Mailchimp keys them",
    roster.recipients.every((r) => r.email === r.email.trim().toLowerCase()),
  );
}

console.log("\nsomebody with no address of their own, in a family that has one");
{
  const data: DirectoryData = {
    households: [
      household({
        id: "h6",
        sort_name: "Hall",
        display_name: "The Hall Family",
        email: "halls@example.org",
      }),
    ],
    people: [
      person({
        id: "hal",
        first_name: "Hal",
        last_name: "Hall",
        household_id: "h6",
        household_role: "head",
      }),
      person({
        id: "hana",
        first_name: "Hana",
        last_name: "Hall",
        household_id: "h6",
        household_role: "spouse",
        email: "not an address",
      }),
    ],
    tags: [CHOIR],
    householdTags: [],
    personTags: [
      { person_id: "hal", tag_id: CHOIR.id },
      { person_id: "hana", tag_id: CHOIR.id },
    ],
  };

  const roster = rosterFor(buildEntries(data), CHOIR.id);
  same(
    "they are reached at the family's address",
    roster.recipients.map((r) => r.email),
    ["halls@example.org"],
  );
  same("and the screen can say that is where it came from", roster.recipients[0].via, "household");
  same("nonsense in an email box does not become an address", roster.unreachable, []);
}

console.log("\nwhat is actually in an email box");
{
  for (const bad of [
    "",
    "   ",
    "555-1234",
    "ask Jean",
    "ana@",
    "@example.org",
    "a b@example.org",
    "ana@example",
  ]) {
    check(`refused: ${JSON.stringify(bad)}`, !isEmailish(bad));
  }
  for (const good of ["ana@example.org", "a.b+c@sub.example.co.uk", " Ana@Example.ORG "]) {
    check(`accepted: ${JSON.stringify(good)}`, isEmailish(good));
  }
}

console.log("\nwho keeps the tag and who loses it");
{
  const wanted = [
    {
      email: "ana@example.org",
      firstName: "Ana",
      lastName: "A",
      via: "person" as const,
      label: "A, Ana",
    },
    {
      email: "ben@example.org",
      firstName: "Ben",
      lastName: "B",
      via: "person" as const,
      label: "B, Ben",
    },
  ];
  const changes = tagChanges(wanted, ["ANA@example.org", "zoe@example.org", "zoe@example.org", ""]);

  same("everyone in the group is tagged, whether or not they already were", changes.active, [
    "ana@example.org",
    "ben@example.org",
  ]);
  same("and whoever has left it loses the tag", changes.inactive, ["zoe@example.org"]);
  check(
    "a chorister who left does not keep getting the choir letter",
    changes.inactive.includes("zoe@example.org"),
  );
  check("somebody still in it is never untagged", !changes.inactive.includes("ana@example.org"));
}

console.log("\nsplitting a congregation into calls Mailchimp will accept");
{
  const many = Array.from({ length: 1201 }, (_, i) => `p${i}@example.org`);
  const runs = chunk(many, 500);
  same("a congregation of 1,201 is three calls", runs.length, 3);
  same(
    "of 500, 500 and the remainder",
    runs.map((run) => run.length),
    [500, 500, 201],
  );
  check(
    "and no call is over the limit Mailchimp will accept",
    runs.every((run) => run.length <= 500),
  );
  same("exactly 500 is one call, not two", chunk(many.slice(0, 500), 500).length, 1);
  same("501 is two", chunk(many.slice(0, 501), 500).length, 2);
  same("nothing is lost", runs.flat().length, many.length);
  same("and the order is kept", runs.flat()[700], many[700]);
  same("an empty list is no calls at all", chunk([], 500).length, 0);
}

console.log("\nMD5, which is how Mailchimp names a contact");
{
  // RFC 1321, appendix A.5. If these drift, every tag call addresses the wrong
  // contact - or none - and Mailchimp reports success either way.
  const vectors: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];
  for (const [input, want] of vectors) {
    same(`RFC 1321: ${JSON.stringify(input.slice(0, 24))}`, md5(input), want);
  }

  // Checked against an implementation nobody here wrote. The padding block is
  // decided at 56 bytes and again at 64, and a hand-written MD5 gets those
  // wrong without ever throwing - it simply returns a confident wrong answer,
  // which Mailchimp would accept as the name of a contact that does not exist.
  const lengths = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000];
  const boundaries = lengths.every((n) => md5("x".repeat(n)) === nodeMd5("x".repeat(n)));
  check(`agrees with node:crypto at ${lengths.join(", ")} bytes`, boundaries);

  const awkward = ["Ávila", "Señora O'Brien", "家族", "a@b.c", "\u0000\u0001", "  spaced  "];
  check(
    "and on the names actually in a church directory",
    awkward.every((text) => md5(text) === nodeMd5(text)),
  );

  check("every digest is lower-case hex", /^[0-9a-f]{32}$/.test(md5("The Alvarez Family")));

  same(
    "a contact is keyed by the lower-cased address, however it was typed",
    subscriberHash(" Ana@Example.ORG "),
    md5("ana@example.org"),
  );
}

console.log("\nwhat a key looks like after somebody pastes it on a phone");
{
  // The exact failure this exists for: a leading space that the datacenter
  // check accepts - "-us14" still parses off the end - and that Mailchimp then
  // rejects as an invalid key, sending the office off to regenerate a key that
  // was never wrong.
  //
  // Deliberately not shaped like a real key. Written as thirty-two hex
  // characters and a datacenter, which is what a Mailchimp key looks like, this
  // fixture is indistinguishable from the real thing to a scanner - and GitHub
  // push protection duly refused the commit that first carried it. A test
  // fixture is not worth teaching anybody to click past that warning.
  const pasted = settingsOf({
    MAILCHIMP_API_KEY: " example-not-a-real-key-us14\n",
    SUPABASE_URL: "  https://abcdefgh.supabase.co///  ",
    SUPABASE_ANON_KEY: "\tanon.key.value ",
  });

  same(
    "a space in front of the key is not part of the key",
    pasted.key,
    "example-not-a-real-key-us14",
  );
  same("nor is a newline behind it", pasted.key.endsWith("us14"), true);
  same(
    "trailing slashes come off the Supabase URL",
    pasted.supabaseUrl,
    "https://abcdefgh.supabase.co",
  );
  same("and the anon key is trimmed too", pasted.anonKey, "anon.key.value");

  // The URL is joined to a path directly, so this is the thing that actually
  // broke: //rest/v1/rpc/is_editor is not a route Supabase answers.
  same(
    "so the editor check is asked at a real address",
    `${pasted.supabaseUrl}/rest/v1/rpc/is_editor`,
    "https://abcdefgh.supabase.co/rest/v1/rpc/is_editor",
  );

  same(
    "a URL with no slash to strip is left alone",
    settingsOf({ SUPABASE_URL: "https://a.supabase.co" }).supabaseUrl,
    "https://a.supabase.co",
  );
}

console.log("\nwhat the screen is told is missing");
{
  same("nothing set at all", missingSettings({}), [
    "MAILCHIMP_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
  ]);
  same(
    "a setting that holds only spaces is missing, not set",
    missingSettings({
      MAILCHIMP_API_KEY: "   ",
      SUPABASE_URL: "https://a.supabase.co",
      SUPABASE_ANON_KEY: "k",
    }),
    ["MAILCHIMP_API_KEY"],
  );
  same(
    "all three in place",
    missingSettings({
      MAILCHIMP_API_KEY: "k-us14",
      SUPABASE_URL: "https://a.supabase.co",
      SUPABASE_ANON_KEY: "k",
    }),
    [],
  );
}

console.log("\nsaying what is wrong with a key without saying the key");
{
  // Deliberately not real-key-shaped where it need not be; the one that has to
  // be is built from pieces so no scanner sees a key in this file.
  const shaped = `${"a1b2c3d4".repeat(4)}-us14`;

  const whole = describeKey(shaped);
  check(
    "a whole key is reported as whole",
    whole.includes("which is the shape a Mailchimp key has"),
  );
  check("and the reader is sent to check it is still Active", whole.includes("Active"));
  check("and to check the account's datacenter", whole.includes('begins "us14."'));
  check("the length is stated", whole.includes(`${shaped.length} characters`));

  const half = describeKey("a1b2c3d4-us14");
  check("a half-pasted key is reported as half", half.includes("only part of it was pasted"));
  check("and says what the shape should be", half.includes("32 characters, a dash"));

  const weird = describeKey(`${"a1b2c3d4".repeat(4)}\u00a0-us14`);
  check("a stray character in the middle is named", weird.includes("should not be in a key"));

  const fingerprint = keyFingerprint(shaped);
  check("the fingerprint is six hex characters", /^[0-9a-f]{6}$/.test(fingerprint));
  check("it is in the message", whole.includes(fingerprint));
  same("the same key always marks the same", keyFingerprint(shaped), fingerprint);
  check(
    "a different key marks differently, which is the whole point after a rotation",
    keyFingerprint(`${"b2c3d4e5".repeat(4)}-us14`) !== fingerprint,
  );
  // Salted, so the mark is not a value anybody could have precomputed against a
  // key they already hold.
  check("and the mark is not simply the key's own digest", fingerprint !== md5(shaped).slice(0, 6));

  // The whole point: none of this hands the key to whoever is reading.
  for (const description of [whole, half, weird]) {
    check(
      "the key itself is never in the message",
      !description.includes(shaped) && !description.includes("a1b2c3d4a1b2c3d4"),
    );
  }
}
