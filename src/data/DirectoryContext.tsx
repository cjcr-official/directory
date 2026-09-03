import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { fetchDirectory } from "@/lib/queries";
import { buildEntries, sortMembers, type DirectoryData, type DirectoryEntry } from "@/lib/entries";
import type { HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import { sortByKey, sortKey } from "@/lib/format";

interface DirectoryState {
  loading: boolean;
  /**
   * True once the first load has settled, whether it found rows or failed.
   *
   * Separate from `loading`, which goes true again on every save. This one only
   * ever flips once, and it is what the app waits on before drawing anything -
   * so the shell and a populated page arrive together instead of the shell
   * arriving first with a spinner inside it.
   */
  ready: boolean;
  error: string | null;
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
  /** Raw join rows, for anything that needs the whole graph - the backup. */
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
  /** Every printable record, already in alphabetical order. */
  entries: DirectoryEntry[];
  householdById: Map<string, HouseholdRow>;
  personById: Map<string, PersonRow>;
  membersOf(householdId: string): PersonRow[];
  tagsOfHousehold(householdId: string): string[];
  tagsOfPerson(personId: string): string[];
  reload(): Promise<void>;
}

const DirectoryContext = createContext<DirectoryState | null>(null);

const EMPTY: DirectoryData = {
  households: [],
  people: [],
  tags: [],
  householdTags: [],
  personTags: [],
};

/**
 * Loads the congregation once and keeps it in memory.
 *
 * Every screen reads from here, so a page change costs nothing and the PDF is
 * built from exactly the rows the administrator was just looking at. `reload`
 * is called after each save.
 */
export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<DirectoryData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDirectory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Everything derived from the rows.
   *
   * Keyed on `data` alone, deliberately. Loading is flipped on at the start of
   * every reload and off at the end, and when this was one memo over
   * [data, loading, error] each flip re-sorted the congregation, rebuilt every
   * map and re-ran buildEntries - once over rows that had not changed yet, and
   * again over the new ones. That is twice the work per save, half of it for
   * nothing, on a phone.
   *
   * Splitting it also keeps `entries` referentially stable while a reload is
   * in flight, so the preview screen stops recomposing an entire book because
   * a spinner started.
   */
  const derived = useMemo(() => {
    const householdById = new Map(data.households.map((row) => [row.id, row]));
    const personById = new Map(data.people.map((row) => [row.id, row]));

    const members = new Map<string, PersonRow[]>();
    for (const person of data.people) {
      if (!person.household_id) continue;
      const list = members.get(person.household_id);
      if (list) list.push(person);
      else members.set(person.household_id, [person]);
    }
    for (const [id, list] of members) members.set(id, sortMembers(list));

    const householdTagIds = new Map<string, string[]>();
    for (const link of data.householdTags) {
      const list = householdTagIds.get(link.household_id);
      if (list) list.push(link.tag_id);
      else householdTagIds.set(link.household_id, [link.tag_id]);
    }

    const personTagIds = new Map<string, string[]>();
    for (const link of data.personTags) {
      const list = personTagIds.get(link.person_id);
      if (list) list.push(link.tag_id);
      else personTagIds.set(link.person_id, [link.tag_id]);
    }

    return {
      households: sortByKey(data.households, (row) => sortKey(row.sort_name)),
      people: sortByKey(data.people, (row) => sortKey(row.last_name, row.first_name)),
      tags: data.tags,
      householdTags: data.householdTags,
      personTags: data.personTags,
      entries: buildEntries(data),
      householdById,
      personById,
      membersOf: (householdId: string) => members.get(householdId) ?? [],
      tagsOfHousehold: (householdId: string) => householdTagIds.get(householdId) ?? [],
      tagsOfPerson: (personId: string) => personTagIds.get(personId) ?? [],
    };
  }, [data]);

  const value = useMemo<DirectoryState>(
    () => ({ ...derived, loading, ready, error, reload }),
    [derived, loading, ready, error, reload],
  );

  return <DirectoryContext value={value}>{children}</DirectoryContext>;
}

export function useDirectory(): DirectoryState {
  const context = use(DirectoryContext);
  if (!context) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return context;
}
