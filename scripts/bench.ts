/**
 * Where the time goes on a congregation big enough to feel it.
 *
 * The app holds the whole directory in memory and re-derives everything from
 * it, which is the right shape - but "the whole thing" is cheap at 40 families
 * and not at 400, and the phones this runs on are a good deal slower than the
 * machine this measures on. Numbers first, then decide what is worth changing.
 *
 * Run with: npm run bench
 */

import { buildDemoData } from "@/lib/demo";
import { buildEntries } from "@/lib/entries";
import { sortByKey, sortKey } from "@/lib/format";
import { composeBook } from "@/lib/layout/compose";
import { loadMetrics } from "@/lib/layout/metrics";
import { normalizeSettings } from "@/lib/layout/settings";

const HOUSEHOLDS = 400;
const INDIVIDUALS = 60;

function time(label: string, runs: number, fn: () => unknown): number {
  fn(); // warm
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  const each = (performance.now() - start) / runs;
  console.log(`  ${each.toFixed(2).padStart(8)} ms   ${label}`);
  return each;
}

const data = buildDemoData(HOUSEHOLDS, INDIVIDUALS);
console.log(
  `\n${data.households.length} families, ${data.people.length} people, ` +
    `${data.householdTags.length + data.personTags.length} group links\n`,
);

console.log("what the context does on every change:");
time("sort households", 20, () => sortByKey(data.households, (r) => sortKey(r.sort_name)));
time("sort people", 20, () => sortByKey(data.people, (r) => sortKey(r.last_name, r.first_name)));
time("buildEntries", 20, () => buildEntries(data));

time("group-link maps", 50, () => {
  const byHousehold = new Map<string, string[]>();
  for (const link of data.householdTags) {
    const list = byHousehold.get(link.household_id);
    if (list) list.push(link.tag_id);
    else byHousehold.set(link.household_id, [link.tag_id]);
  }
  return byHousehold;
});

console.log("\nwhat one keystroke in a search box costs:");
time("filter people by name", 50, () => {
  const needle = sortKey("ann");
  return data.people.filter((person) =>
    sortKey(
      person.first_name,
      person.preferred_name,
      person.last_name,
      person.email,
      person.phone,
    ).includes(needle),
  );
});
const sorted = sortByKey(data.people, (r) => sortKey(r.last_name, r.first_name));
time("family edit: candidate members", 20, () => {
  const needle = sortKey("");
  const found = [];
  for (const p of sorted) {
    if (needle && !sortKey(`${p.first_name} ${p.last_name}`, p.email).includes(needle)) continue;
    found.push(p);
    if (found.length === 8) break;
  }
  return found;
});

console.log("\nsortKey itself:");
const names = data.people.map((p) => `${p.first_name} ${p.last_name}`);
time(`sortKey over ${names.length} names`, 100, () => names.map((n) => sortKey(n)));

console.log("\nbuilding the book:");
const entries = buildEntries(data);
const settings = normalizeSettings({});
const metrics = await loadMetrics(settings.typeface);
time(`composeBook (${entries.length} records)`, 5, () => composeBook(entries, settings, metrics));

console.log("");
