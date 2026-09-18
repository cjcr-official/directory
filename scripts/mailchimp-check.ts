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
import {
  chunk,
  composeEmail,
  isEmailish,
  isPublicMailbox,
  rosterFor,
  tagChanges,
} from "@/lib/mailchimp";
import { md5, subscriberHash } from "../worker/md5";
import { missingSettings, settingsOf } from "../worker/settings";
import { describeKey, keyFingerprint, listAudiences, taggedAddresses } from "../worker/mailchimp";
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
  same(
    "and one with no address anywhere is named as unreachable",
    roster.unreachable.map((one) => one.name),
    ["The Diaz Family"],
  );
  same(
    "carrying the id of the record to go and fix",
    roster.unreachable.map((one) => `${one.type}:${one.id}`),
    ["household:h4"],
  );
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
  const stranded = rosterFor(buildEntries(data), CHOIR.id).unreachable;
  same(
    "two unreachable people read as two",
    stranded.map((one) => one.name),
    ["Dee Diaz", "Eve Ellis"],
  );
  same(
    "and each links to their own record",
    stranded.map((one) => `${one.type}:${one.id}`),
    ["person:dee", "person:eve"],
  );
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
  check("a whole key is reported as whole", whole.includes("the shape a Mailchimp key has"));
  check("and the reader is sent to check it is still Active", whole.includes("Active"));
  check("and to check the account's datacenter", whole.includes('begins "us14."'));
  check("the length is stated", whole.includes(`${shaped.length} characters`));

  const half = describeKey("a1b2c3d4-us14");
  check("a half-pasted key is reported as half", half.includes("only part of it was pasted"));
  check("and says what the shape should be", half.includes("32 characters, a dash"));

  const weird = describeKey(`${"a1b2c3d4".repeat(4)}\u00a0-us14`);
  check("a stray character in the middle is named", weird.includes("should not be in a key"));

  check(
    "the opening four characters are shown, which is what Mailchimp's own key list shows",
    whole.includes(`starts "${shaped.slice(0, 4)}"`),
  );
  check(
    "and the reader is told what a missing or struck-through entry means",
    whole.includes("struck") && whole.includes("holding an old key"),
  );

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

  // The whole point: four characters is what Mailchimp already prints; the
  // twenty-eight that actually protect the account never appear.
  const secretPart = shaped.slice(4, shaped.lastIndexOf("-"));
  for (const description of [whole, half, weird]) {
    check(
      "the key itself is never in the message",
      !description.includes(shaped) && !description.includes(secretPart),
    );
  }
  check(
    "and nor is any run of it beyond the four Mailchimp shows",
    !whole.includes(shaped.slice(0, 5)),
  );
}

console.log("\nasking the other way when the first way is refused");
{
  const KEY = "example-not-a-real-key-us20";
  const real = globalThis.fetch;

  /** Stands in for Mailchimp, recording how each request was authorized. */
  function stub(reply: (url: string, scheme: string) => { status: number; body: string }) {
    const seen: { url: string; scheme: string }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const header = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      const scheme = header.split(" ")[0] ?? "";
      seen.push({ url, scheme });
      const { status, body } = reply(url, scheme);
      return new Response(body, { status, headers: { "Content-Type": "application/json" } });
    }) as typeof globalThis.fetch;
    return seen;
  }

  const audiences = JSON.stringify({ lists: [{ id: "a", name: "A", stats: { member_count: 2 } }] });
  const refused = JSON.stringify({
    title: "API Key Invalid",
    detail: "Your API key may be invalid.",
  });

  // Basic works, as it normally does: asked once, and not asked again.
  {
    const seen = stub(() => ({ status: 200, body: audiences }));
    const found = await listAudiences(KEY);
    same("Basic alone is one request", seen.length, 1);
    same("and it is Basic", seen[0].scheme, "Basic");
    same("and the audiences come back", found.length, 1);
  }

  // Basic refused, Bearer accepted: the screen should never see an error.
  {
    const seen = stub((_url, scheme) =>
      scheme === "Basic" ? { status: 401, body: refused } : { status: 200, body: audiences },
    );
    const found = await listAudiences(KEY);
    same("a refused Basic is asked again", seen.length, 2);
    same("the second time as Bearer", seen[1].scheme, "Bearer");
    same("and the answer is used rather than the refusal", found[0].name, "A");
  }

  // Both refused: the error has to say so, and say what /ping made of it.
  {
    const seen = stub((url) =>
      url.endsWith("/ping") ? { status: 200, body: "{}" } : { status: 401, body: refused },
    );
    let message = "";
    try {
      await listAudiences(KEY);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    check(
      "both schemes are tried and then /ping",
      seen.length === 3 && seen[2].url.endsWith("/ping"),
    );
    check("the message rules the scheme out", message.includes("not the authorization scheme"));
    check(
      "and says the fault is this app's when /ping accepts the key",
      message.includes("fault is in this app's request"),
    );
    check("Mailchimp's own words survive", message.includes("API Key Invalid"));
  }

  // Both refused and /ping refused too: the account will not answer this key.
  {
    stub(() => ({ status: 401, body: refused }));
    let message = "";
    try {
      await listAudiences(KEY);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    check(
      "a refused /ping is reported as the account refusing",
      message.includes("refuses it too"),
    );
    // This stand-in is deliberately not shaped like a real key, so describeKey
    // takes its other branch - which is still a description of what is held.
    check("and the key is still described", message.includes("not the shape of a Mailchimp key"));
  }

  globalThis.fetch = real;
}

console.log("\nreading who has a tag off the contacts themselves");
{
  const KEY = "example-not-a-real-key-us20";
  const real = globalThis.fetch;
  const urls: string[] = [];

  function serve(pages: { email_address: string; tags: { name: string }[] }[][]) {
    urls.length = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("offset") ?? "0");
      const members = pages[offset / 1000] ?? [];
      return new Response(JSON.stringify({ members, total_items: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;
  }

  const member = (email: string, ...tags: string[]) => ({
    email_address: email,
    tags: tags.map((name) => ({ name })),
  });

  // The ordinary case, and the one the segments endpoint used to answer.
  {
    serve([
      [
        member("ana@example.org", "Choir"),
        member("ben@example.org", "Youth Group"),
        member("cal@example.org", "choir"),
      ],
    ]);
    const carrying = await taggedAddresses(KEY, "list1", "Choir");
    same("only the contacts carrying the tag come back", carrying, [
      "ana@example.org",
      "cal@example.org",
    ]);
    check("matched however the tag was capitalised", carrying.includes("cal@example.org"));
    same("and it took one call", urls.length, 1);
    check(
      "to the members endpoint, not to segments",
      urls[0].includes("/members?") && !urls[0].includes("segments"),
    );
  }

  // A tag nobody has yet - a group that has never been synced.
  {
    serve([[member("ana@example.org", "Youth Group")]]);
    same(
      "a tag nobody carries is nobody, not an error",
      await taggedAddresses(KEY, "list1", "Choir"),
      [],
    );
  }

  // A congregation bigger than one page. A half-read answer would untag
  // everybody past the first thousand, which is the bug worth preventing.
  {
    const first = Array.from({ length: 1000 }, (_, i) => member(`p${i}@example.org`, "Choir"));
    const second = [member("last@example.org", "Choir")];
    serve([first, second]);
    const carrying = await taggedAddresses(KEY, "list1", "Choir");
    same("a full page is followed by another", urls.length, 2);
    same("and nobody past the first page is lost", carrying.length, 1001);
    check("including the very last one", carrying.includes("last@example.org"));
    check("the second call asks for the next page", urls[1].includes("offset=1000"));
  }

  globalThis.fetch = real;
}

console.log("\nwhat somebody types, as an email");
{
  const typed =
    "Dear friends,\n\nPractice has moved to Thursday at 7pm.\nBring the green folder.\n\nThank you,\nThe Office";
  const { html, text } = composeEmail(typed, "Choir");

  // Mailchimp refuses to send a campaign with no unsubscribe link, and the law
  // in most places refuses one with no postal address. Both are merge tags it
  // fills in per recipient; both have to actually be in what we hand it.
  check("the unsubscribe link is in the HTML", html.includes("*|UNSUB|*"));
  check("and in the plain text, for a reader who refuses HTML", text.includes("*|UNSUB|*"));
  check("the postal address is in the HTML", html.includes("*|LIST:ADDRESS|*"));
  check("and in the plain text", text.includes("*|LIST:ADDRESS|*"));

  check("a blank line starts a paragraph", (html.match(/<p>/g) ?? []).length >= 3);
  check("a single newline is a line break", html.includes("Thursday at 7pm.<br />Bring"));
  check("the group is named, so the reader knows why they got it", html.includes("Choir"));
  check("and the words survive into the plain text", text.includes("Bring the green folder."));

  // Somebody's surname is not markup.
  const risky = composeEmail("Dear <b>everyone</b> & the O'Brien family", "Choir");
  check("angle brackets in what was typed are escaped", risky.html.includes("&lt;b&gt;everyone"));
  check("and ampersands", risky.html.includes("&amp; the"));
  check("but the plain text keeps them as typed", risky.text.includes("<b>everyone</b> & the"));

  // Nothing to say still produces something Mailchimp will accept: the
  // footer it refuses to send without is not part of what was typed.
  const empty = composeEmail("", "Choir");
  same("nothing typed is no paragraphs of its own", (empty.html.match(/<p>/g) ?? []).length, 0);
  check("but the unsubscribe link is still there", empty.html.includes("*|UNSUB|*"));
}

console.log("\nan address Mailchimp cannot authenticate");
{
  for (const free of ["office@gmail.com", "CHURCH@Hotmail.com", "a@yahoo.com", "b@icloud.com"]) {
    check(`flagged: ${free}`, isPublicMailbox(free));
  }
  for (const owned of ["office@thealliance.org", "hello@stmarys.church"]) {
    check(`not flagged: ${owned}`, !isPublicMailbox(owned));
  }
  check("nothing typed is not flagged", !isPublicMailbox(""));
}
