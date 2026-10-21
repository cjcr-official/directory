import type { DirectoryEntry } from "./entries";
import type { PersonRow } from "./database.types";
import { fileAsName, firstName, sortKey } from "./format";

/**
 * A batch of name tags: some of a directory's people rather than all of them.
 *
 * The five newcomers welcomed on Sunday, a tag lost and needing printing
 * again, the people on a retreat. None of them is a reason to change who is
 * in the directory - the book still wants everyone - so the batch is chosen
 * on the name tags screen and changes nothing but which tags come out.
 *
 * It is not saved. It is carried in the address, as `?people=` and the ids
 * chosen, so it survives the trip to the preview and back, and a reload, and
 * is gone the next time somebody opens the tags - when "everyone" is the
 * right answer again. An empty `?people=` is a batch with nobody in it yet,
 * which is different from no batch at all.
 */

export const BATCH_PARAM = "people";

/** The batch in an address, or null when there is none and everyone prints. */
export function batchFromParam(value: string | null): Set<string> | null {
  if (value === null) return null;
  return new Set(value.split(",").filter(Boolean));
}

/** The batch written back into an address. */
export function batchToParam(chosen: Iterable<string>): string {
  return [...chosen].join(",");
}

/**
 * The directory's records cut down to the people in the batch.
 *
 * A family keeps only the members chosen, and drops out when none of them
 * were, so composeTags - which prints one tag per member - prints one per
 * person chosen and nobody else. Somebody chosen who has since left the
 * directory is simply not there to print.
 */
export function onlyBatch(
  entries: DirectoryEntry[],
  chosen: ReadonlySet<string> | null,
): DirectoryEntry[] {
  if (!chosen) return entries;
  return entries.flatMap((entry): DirectoryEntry[] => {
    if (entry.type === "person") return chosen.has(entry.id) ? [entry] : [];
    const members = entry.household.members.filter((member) => chosen.has(member.id));
    return members.length ? [{ ...entry, household: { ...entry.household, members } }] : [];
  });
}

/** Everybody a directory gives a tag, alphabetically, for choosing a batch from. */
export function batchChoices(entries: DirectoryEntry[]): { id: string; label: string }[] {
  const people: PersonRow[] = entries.flatMap((entry) =>
    entry.type === "household" ? entry.household.members : [entry.person],
  );
  return people
    .map((person) => ({
      id: person.id,
      label: fileAsName(person),
      key: sortKey(person.last_name, firstName(person)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
    .map(({ id, label }) => ({ id, label }));
}
