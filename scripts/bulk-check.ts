/**
 * That changing many people at once changes what it was asked to, and only
 * that.
 *
 * A bulk edit's mistakes are quiet and they are multiplied. Writing a value
 * onto somebody who already had it stamps their record as changed by whoever
 * pressed the button. Taking a family's members out of it without copying the
 * family's address down leaves each of them a card with no address. Two
 * people joining a family on the same place puts the newcomer above the head
 * of the household. A line added to the notes twice, because the save was
 * pressed again after a dropped connection, is a line that says it twice. And
 * every one of those would happen to a dozen people in one press.
 *
 * None of it needs a database: the plan is worked out before anything is
 * written, and this puts it to the plan.
 *
 *   npm run bulk:check
 */

import {
  asksNothing,
  describeNow,
  NO_CHANGES,
  planBulkEdit,
  type BulkChanges,
  type BulkContext,
  type BulkPlan,
} from "@/lib/bulkEdit";
import type { HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import { sortMembers } from "@/lib/entries";
import { check, same } from "./check";

const WHEN = "2026-01-01T00:00:00Z";

function household(id: string, name: string, line1: string | null = null): HouseholdRow {
  return {
    id,
    display_name: name,
    sort_name: name,
    address_line1: line1,
    address_line2: null,
    city: line1 ? "Akron" : null,
    state: line1 ? "OH" : null,
    postal_code: line1 ? "44301" : null,
    country: null,
    phone: null,
    email: null,
    anniversary: null,
    photo_path: null,
    notes: null,
    is_active: true,
    created_at: WHEN,
    updated_at: WHEN,
  };
}

function person(id: string, patch: Partial<PersonRow> = {}): PersonRow {
  return {
    id,
    household_id: null,
    household_role: null,
    first_name: id,
    last_name: "Siebert",
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
    photo_path: null,
    photo_fit: null,
    notes: null,
    background_check_on: null,
    background_check_due: null,
    sort_order: 0,
    is_active: true,
    created_at: WHEN,
    updated_at: `${WHEN}-${id}`,
    ...patch,
  };
}

const tag = (id: string, name: string): TagRow => ({
  id,
  name,
  color: "#2f6d63",
  description: null,
  created_at: WHEN,
});

const SIEBERTS = household("h1", "The Siebert Family", "12 Elm St");
const JONESES = household("h2", "The Jones Family", "4 Oak Ave");

const JASON = person("jason", {
  household_id: "h1",
  household_role: "head",
  sort_order: 0,
  gender: "male",
  date_of_birth: "1978-03-02",
  notes: "Usher",
});
const AMY = person("amy", {
  household_id: "h1",
  household_role: "spouse",
  sort_order: 1,
  gender: "female",
  use_household_address: false,
  address_line1: "9 Pine Rd",
  city: "Kent",
});
const KID = person("kid", {
  household_id: "h1",
  household_role: "child",
  sort_order: 2,
  date_of_birth: "2010-01-01",
});
const SOLO = person("solo", {
  last_name: "Person",
  address_line1: "1 Main St",
  phone: "2165550101",
  photo_path: "people/solo.jpg",
});
const TOM = person("tom", {
  household_id: "h2",
  household_role: "head",
  last_name: "Jones",
  sort_order: 0,
});

const EVERYONE = [JASON, AMY, KID, SOLO, TOM];
const CHOIR = tag("t1", "Choir");
const YOUTH = tag("t2", "Youth");

const LINKS: Record<string, string[]> = { jason: ["t1"], kid: ["t2"] };

function contextFor(people: PersonRow[]): BulkContext {
  const households = new Map([SIEBERTS, JONESES].map((row) => [row.id, row]));
  return {
    householdById: households,
    membersOf: (id) => sortMembers(people.filter((one) => one.household_id === id)),
    tagsOfPerson: (id) => LINKS[id] ?? [],
    tags: [CHOIR, YOUTH],
  };
}

const CONTEXT = contextFor(EVERYONE);

/** The changes, with only the named ones moved off "keep". */
function asking(patch: Partial<BulkChanges>): BulkChanges {
  return { ...NO_CHANGES, ...patch };
}

function plan(people: PersonRow[], patch: Partial<BulkChanges>, context = CONTEXT): BulkPlan {
  return planBulkEdit(people, asking(patch), context);
}

/** What one person's write comes to, wherever the plan put it. */
function patchOf(result: BulkPlan, id: string): Record<string, unknown> | undefined {
  const guarded = result.guarded.find((row) => row.id === id);
  if (guarded) return guarded.patch;
  return result.shared.find((group) => group.ids.includes(id))?.patch;
}

/** A person as they would read back after the plan was written. */
function after(people: PersonRow[], result: BulkPlan): PersonRow[] {
  return people.map((one) => ({ ...one, ...patchOf(result, one.id) }));
}

console.log("\nnothing asked, nothing done\n");
{
  const result = plan(EVERYONE, {});
  check("asking for nothing is recognised", asksNothing(NO_CHANGES));
  same("nobody is touched", result.touched, []);
  same("no writes", [result.shared.length, result.guarded.length], [0, 0]);
  same("and nothing to say", result.lines, []);
}

console.log("\nonly the people a change changes\n");
{
  const result = plan([JASON, AMY, KID, SOLO], { gender: { mode: "set", value: "female" } });
  same("Amy already was, so she is left alone", result.touched, ["jason", "kid", "solo"]);
  same("one request for all three", result.shared.length, 1);
  same("carrying the gender and nothing else", result.shared[0].patch, { gender: "female" });
  same("said in words, with who already was", result.lines, [
    { text: "Gender made Female", count: 3, already: 1 },
  ]);
  same("nothing guarded: the value owes nothing to what was there", result.guarded, []);
}

console.log("\nthe same patch, however it was built, is one request\n");
{
  const result = plan(EVERYONE, {
    printed: { mode: "set", value: false },
    gender: { mode: "set", value: "male" },
  });
  // Jason is already male; everybody else gets both values.
  const groups = result.shared.map((group) => [Object.keys(group.patch).sort(), group.ids]);
  same("two groups: printing alone, and both columns", groups, [
    [["is_active"], ["jason"]],
    [
      ["gender", "is_active"],
      ["amy", "kid", "solo", "tom"],
    ],
  ]);
}

console.log("\ntaking people out of their family\n");
{
  const result = plan([JASON, AMY, SOLO], { family: { mode: "leave", householdId: "" } });
  // His place on the card was 0 already, so it is not written again.
  same("Jason leaves, and carries the address he printed with", patchOf(result, "jason"), {
    household_id: null,
    household_role: null,
    address_line1: "12 Elm St",
    city: "Akron",
    state: "OH",
    postal_code: "44301",
    use_household_address: false,
  });
  same("Amy leaves with the address she already had of her own", patchOf(result, "amy"), {
    household_id: null,
    sort_order: 0,
    household_role: null,
  });
  same("somebody already on their own is left alone", patchOf(result, "solo"), undefined);

  // A family with no address has nothing to hand down, and somebody who
  // printed with it prints with none either way: nothing to write.
  const bare = { ...SIEBERTS, address_line1: null, city: null, state: null, postal_code: null };
  const homeless: BulkContext = {
    ...CONTEXT,
    householdById: new Map([bare, JONESES].map((row) => [row.id, row])),
  };
  same(
    "leaving a family with no address copies nothing",
    patchOf(plan([JASON], { family: { mode: "leave", householdId: "" } }, homeless), "jason"),
    { household_id: null, household_role: null },
  );
  same("and the words say all three things", result.lines, [
    { text: "Taken out of their family", count: 2, already: 1 },
    {
      text: "Given the address they printed with, since they no longer share a family's",
      count: 1,
      already: 0,
    },
  ]);
}

console.log("\nleaving, and given another address in the same edit\n");
{
  const result = plan([JASON], {
    family: { mode: "leave", householdId: "" },
    address: {
      mode: "set",
      value: {
        address_line1: " 3 New Rd ",
        address_line2: "",
        city: "Canton",
        state: "OH",
        postal_code: "44702",
        country: null,
      },
    },
  });
  same("the new address wins over the old family's", patchOf(result, "jason"), {
    household_id: null,
    household_role: null,
    address_line1: "3 New Rd",
    city: "Canton",
    state: "OH",
    postal_code: "44702",
    use_household_address: false,
  });
}

console.log("\nputting people in a family\n");
{
  const result = plan([KID, SOLO, TOM], { family: { mode: "join", householdId: "h2" } });
  const joined = after([KID, SOLO, TOM], result);
  same(
    "the child keeps being a child, so it is not written",
    [joined[0].household_role, patchOf(result, "kid")?.household_role],
    ["child", undefined],
  );
  same(
    "somebody with no part in a family joins as other",
    patchOf(result, "solo")?.household_role,
    "other",
  );
  same(
    "both go after Tom, child before other",
    [patchOf(result, "kid")?.sort_order, patchOf(result, "solo")?.sort_order],
    [1, 2],
  );
  same("Tom, already there, is left alone", patchOf(result, "tom"), undefined);
  same("the line names the family", result.lines[0], {
    text: "Put in The Jones Family",
    count: 2,
    already: 1,
  });
}

console.log("\na family with a gap in it\n");
{
  // Members have come and gone, so the places in use are 0 and 5. Counting
  // the members would put the newcomer on 2 - ahead of the spouse on 5, so a
  // lodger would print above the wife on the family's card.
  const gappy = [
    person("a", { household_id: "h2", household_role: "head", sort_order: 0 }),
    person("b", { household_id: "h2", household_role: "spouse", sort_order: 5 }),
  ];
  const result = plan([SOLO], { family: { mode: "join", householdId: "h2" } }, contextFor(gappy));
  same("the newcomer goes after the highest place in use", patchOf(result, "solo")?.sort_order, 6);
}

console.log("\nthe part somebody plays in a family\n");
{
  const result = plan([KID, SOLO, TOM], { role: { mode: "set", value: "child" } });
  same("only Tom changes", result.touched, ["tom"]);
  same("Kid already was one, and Solo is in no family to be one in", result.lines, [
    { text: "Made Child in their family", count: 1, already: 1 },
  ]);

  // An old import's leftovers: a role with no family. Not this edit's business
  // unless the family or the role was asked about.
  const odd = person("odd", { household_role: "head" });
  same(
    "a stray role is left alone when nobody asked about families",
    plan([odd], { gender: { mode: "set", value: "male" } }).shared[0].patch,
    { gender: "male" },
  );
}

console.log("\naddresses\n");
{
  const family = plan([JASON, AMY, SOLO], {
    address: { mode: "family", value: NO_CHANGES.address.value },
  });
  same("only Amy is unhooked from her own", family.touched, ["amy"]);
  same("and her own lines stay stored, as her form keeps them", patchOf(family, "amy"), {
    use_household_address: true,
  });

  const cleared = plan([AMY, SOLO], {
    address: { mode: "clear", value: NO_CHANGES.address.value },
  });
  same("Amy's own address goes, and she prints with the family's", patchOf(cleared, "amy"), {
    address_line1: null,
    city: null,
    use_household_address: true,
  });
  same("somebody on their own simply has none", patchOf(cleared, "solo"), {
    address_line1: null,
  });

  const typed = plan([SOLO], {
    address: {
      mode: "set",
      value: { ...NO_CHANGES.address.value, address_line1: "  " },
    },
  });
  same("an address of spaces is not one", typed.problems, [
    "Type the address, or choose to remove their own.",
  ]);
}

console.log("\nnotes\n");
{
  const result = plan([JASON, AMY], { notes: { mode: "append", value: " Retreat 2026 " } });
  same("added under what was there", patchOf(result, "jason")?.notes, "Usher\nRetreat 2026");
  same("or as the whole note where there was none", patchOf(result, "amy")?.notes, "Retreat 2026");
  same(
    "both guarded on the version they were worked out from",
    result.guarded.map((row) => [row.id, row.expectedUpdatedAt]),
    [
      ["jason", JASON.updated_at],
      ["amy", AMY.updated_at],
    ],
  );
  same("and so neither goes in a shared request", result.shared, []);

  const again = plan(after([JASON, AMY], result), {
    notes: { mode: "append", value: "Retreat 2026" },
  });
  same("pressing save again does not add the line twice", again.touched, []);
  same("it says they already have it", again.lines, [
    { text: "A line added to their notes", count: 0, already: 2 },
  ]);
}

console.log("\none statement per person, guard and all\n");
{
  // Gender alone would be a shared request; with a line added to the notes it
  // has to go with the guarded write, or the shared one would move the row on
  // and the guarded one would then find it changed - by this very edit.
  const result = plan([JASON], {
    gender: { mode: "set", value: "female" },
    notes: { mode: "append", value: "Retreat" },
  });
  same(
    "one guarded write carrying both",
    result.guarded.map((row) => row.patch),
    [{ gender: "female", notes: "Usher\nRetreat" }],
  );
  same("and no shared one", result.shared, []);
}

console.log("\nbirthdays\n");
{
  const result = plan([JASON, KID, SOLO], { birthday: { mode: "drop-year" } });
  same("the year goes, the day stays", patchOf(result, "jason"), { date_of_birth: "0004-03-02" });
  same("each from their own birthday", patchOf(result, "kid"), { date_of_birth: "0004-01-01" });
  same("nobody's birthday is made up", patchOf(result, "solo"), undefined);
  same("worked out from the row, so guarded", result.guarded.length, 2);

  const again = plan(after([JASON, KID], result), { birthday: { mode: "drop-year" } });
  same("a second press finds nothing left to do", again.touched, []);

  const removed = plan([JASON, SOLO], { birthday: { mode: "clear" } });
  same("removed where there was one", removed.touched, ["jason"]);
  same("and that is not guarded", removed.guarded, []);
}

console.log("\ngroups\n");
{
  const result = plan([JASON, AMY, KID], { addTags: ["t1"], removeTags: ["t2"] });
  same("Amy and Kid join the choir; Jason is in it", result.addLinks, [
    { person_id: "amy", tag_id: "t1" },
    { person_id: "kid", tag_id: "t1" },
  ]);
  same("Kid leaves youth; nobody else was in it", result.removeLinks, [
    { person_id: "kid", tag_id: "t2" },
  ]);
  same("no row is written for a group", [result.shared.length, result.guarded.length], [0, 0]);
  same("but everybody it reaches is counted", result.touched, ["amy", "kid"]);
  same("in words, a group at a time", result.lines, [
    { text: "Added to Choir", count: 2, already: 1 },
    { text: "Taken out of Youth", count: 1, already: 0 },
  ]);
}

console.log("\nphotos, checks and printing\n");
{
  const fit = plan([JASON, SOLO], { photoFit: { mode: "set", value: "fit" } });
  same("only somebody with a photo of their own", fit.touched, ["solo"]);

  const checked = plan([JASON, AMY], {
    check: { mode: "set", on: "2026-03-03", due: "2029-03-03" },
  });
  same("both dates, one request", checked.shared, [
    {
      patch: { background_check_on: "2026-03-03", background_check_due: "2029-03-03" },
      ids: ["jason", "amy"],
    },
  ]);
  same(
    "said with the dates",
    checked.lines[0].text,
    "Background check done 3 March 2026, next due 3 March 2029",
  );

  const doneOnly = plan([JASON], { check: { mode: "set", on: "2026-03-03", due: null } });
  same(
    "a date left empty is said to be taken away",
    doneOnly.lines[0].text,
    "Background check done 3 March 2026, with no renewal date",
  );

  const dueOnly = plan([JASON], { check: { mode: "set", on: null, due: "2026-09-01" } });
  same("a check due and never done is a thing to record", patchOf(dueOnly, "jason"), {
    background_check_due: "2026-09-01",
  });
}

console.log("\nwhat cannot be saved yet\n");
{
  same(
    "every half-filled choice is named",
    plan([JASON], {
      lastName: { mode: "set", value: " " },
      phone: { mode: "set", value: "" },
      email: { mode: "set", value: "" },
      family: { mode: "join", householdId: "" },
      notes: { mode: "append", value: "" },
      check: { mode: "set", on: null, due: null },
    }).problems,
    [
      "Type the last name they should all have.",
      "Type the phone number, or choose to remove it.",
      "Type the email address, or choose to remove it.",
      "Choose the family to put them in.",
      "Type the note.",
      "Enter a background check date, or choose to remove them.",
    ],
  );
  same(
    "and none of them is written in the meantime",
    plan([JASON], { lastName: { mode: "set", value: "" } }).touched,
    [],
  );
}

console.log("\nhow they stand now\n");
{
  const now = describeNow([JASON, AMY, KID, SOLO], CONTEXT);
  same("gender, counted", now.gender, "Female 1 · Male 1 · Not said 2");
  same("last names, most common first", now.lastName, "Siebert 3 · Person 1");
  same("families", now.family, "In a family 3 · On their own 1");
  same(
    "everybody in one family is said by name",
    describeNow([JASON, KID], CONTEXT).family,
    "All in The Siebert Family",
  );
  same("addresses", now.address, "The family's 2 · Their own 2");
  same(
    "one number shared by all is shown",
    describeNow([SOLO], CONTEXT).phone,
    "All (216) 555-0101",
  );
  same("birthdays", now.birthday, "With the year 2 · None 2");
  same(
    "everybody the same is said once",
    describeNow([SOLO, AMY], CONTEXT).gender,
    "Female 1 · Not said 1",
  );
  same("and alone, without a count", describeNow([SOLO, KID], CONTEXT).gender, "Not said");
}
