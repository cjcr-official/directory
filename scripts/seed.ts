import { createClient } from "@supabase/supabase-js";
import { buildDemoData } from "../src/lib/demo";
import { DEFAULT_SETTINGS } from "../src/lib/layout/settings";

/**
 * Fills a Supabase project with an invented congregation so you can click
 * around a directory that already has something in it.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
 *
 * Uses the service role key because it writes past row level security, so run
 * it from your own machine and never put that key in .env.local or Cloudflare.
 * Pass --clear to empty the tables first.
 */

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Find both under Project Settings -> API in your Supabase dashboard.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function run() {
  const clear = process.argv.includes("--clear");

  if (clear) {
    console.log("clearing existing records…");
    // Order matters: children before parents.
    for (const table of [
      "project_entries",
      "project_tags",
      "projects",
      "person_tags",
      "household_tags",
      "people",
      "households",
      "tags",
    ]) {
      const { error } = await supabase
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      // The join tables have no id column; fall back to deleting everything.
      if (error) {
        const retry = await supabase
          .from(table)
          .delete()
          .gte("tag_id", "00000000-0000-0000-0000-000000000000");
        if (retry.error) console.warn(`  ${table}: ${retry.error.message}`);
      }
    }
  }

  const demo = buildDemoData();

  // The demo generator makes its own readable ids; the database wants uuids,
  // so map them as we go.
  const tagIds = new Map<string, string>();
  const householdIds = new Map<string, string>();
  const personIds = new Map<string, string>();

  console.log(`inserting ${demo.tags.length} groups…`);
  for (const tag of demo.tags) {
    const { data, error } = await supabase
      .from("tags")
      .insert({ name: tag.name, color: tag.color })
      .select("id")
      .single();
    if (error) throw new Error(`tags: ${error.message}`);
    tagIds.set(tag.id, data.id);
  }

  console.log(`inserting ${demo.households.length} families…`);
  for (const household of demo.households) {
    const { id, created_at, updated_at, photo_path, ...rest } = household;
    void created_at;
    void updated_at;
    const { data, error } = await supabase
      .from("households")
      // The demo's photo paths point at files that do not exist in storage;
      // records seed without photographs and print with initials.
      .insert({ ...rest, photo_path: null })
      .select("id")
      .single();
    if (error) throw new Error(`households: ${error.message}`);
    householdIds.set(id, data.id);
    void photo_path;
  }

  console.log(`inserting ${demo.people.length} people…`);
  for (const person of demo.people) {
    const { id, created_at, updated_at, household_id, photo_path, ...rest } = person;
    void created_at;
    void updated_at;
    void photo_path;
    const { data, error } = await supabase
      .from("people")
      .insert({
        ...rest,
        photo_path: null,
        household_id: household_id ? (householdIds.get(household_id) ?? null) : null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`people: ${error.message}`);
    personIds.set(id, data.id);
  }

  const householdTags = demo.householdTags
    .map((link) => ({
      household_id: householdIds.get(link.household_id),
      tag_id: tagIds.get(link.tag_id),
    }))
    .filter((row): row is { household_id: string; tag_id: string } =>
      Boolean(row.household_id && row.tag_id),
    );

  const personTags = demo.personTags
    .map((link) => ({ person_id: personIds.get(link.person_id), tag_id: tagIds.get(link.tag_id) }))
    .filter((row): row is { person_id: string; tag_id: string } =>
      Boolean(row.person_id && row.tag_id),
    );

  if (householdTags.length) {
    const { error } = await supabase.from("household_tags").insert(householdTags);
    if (error) throw new Error(`household_tags: ${error.message}`);
  }
  if (personTags.length) {
    const { error } = await supabase.from("person_tags").insert(personTags);
    if (error) throw new Error(`person_tags: ${error.message}`);
  }

  console.log("creating a main directory and one event booklet…");
  const { error: mainError } = await supabase.from("projects").insert({
    name: "Main Directory",
    kind: "directory",
    description: "Everyone, alphabetically, six records to a sheet.",
    selection_mode: "all",
    settings: {
      ...DEFAULT_SETTINGS,
      churchName: "Fairhaven Community Church",
      coverSubtitle: "Spring 2026",
      footerText: "Please keep this directory for church use only.",
    },
  });
  if (mainError) throw new Error(`projects: ${mainError.message}`);

  const choirTagId = tagIds.get(demo.tags[0].id);
  const { data: booklet, error: bookletError } = await supabase
    .from("projects")
    .insert({
      name: "Choir Booklet",
      kind: "event",
      description: "Just the choir — a handout for rehearsals.",
      selection_mode: "tags",
      settings: {
        ...DEFAULT_SETTINGS,
        coverTitle: "Choir",
        churchName: "Fairhaven Community Church",
        includeIndex: false,
        showBirthdays: true,
      },
    })
    .select("id")
    .single();
  if (bookletError) throw new Error(`projects: ${bookletError.message}`);

  if (choirTagId) {
    const { error } = await supabase
      .from("project_tags")
      .insert({ project_id: booklet.id, tag_id: choirTagId });
    if (error) throw new Error(`project_tags: ${error.message}`);
  }

  console.log(
    `\ndone — ${demo.households.length} families, ${demo.people.length} people, ` +
      `${demo.tags.length} groups, 2 directories.\n` +
      "Sign in to the app and open Directories to print one.",
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
