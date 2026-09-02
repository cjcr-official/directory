import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { fetchDirectory } from "@/lib/queries";
import { buildEntries, sortMembers, type DirectoryData, type DirectoryEntry } from "@/lib/entries";
import type { HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import { sortKey } from "@/lib/format";

interface DirectoryState {
  loading: boolean;
  error: string | null;
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
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
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<DirectoryState>(() => {
    const householdById = new Map(data.households.map((row) => [row.id, row]));
    const personById = new Map(data.people.map((row) => [row.id, row]));

    const members = new Map<string, PersonRow[]>();
    for (const person of data.people) {
      if (!person.household_id) continue;
      const list = members.get(person.household_id) ?? [];
      list.push(person);
      members.set(person.household_id, list);
    }
    for (const [id, list] of members) members.set(id, sortMembers(list));

    const householdTagIds = new Map<string, string[]>();
    for (const link of data.householdTags) {
      householdTagIds.set(link.household_id, [
        ...(householdTagIds.get(link.household_id) ?? []),
        link.tag_id,
      ]);
    }

    const personTagIds = new Map<string, string[]>();
    for (const link of data.personTags) {
      personTagIds.set(link.person_id, [...(personTagIds.get(link.person_id) ?? []), link.tag_id]);
    }

    return {
      loading,
      error,
      households: [...data.households].sort((a, b) =>
        sortKey(a.sort_name).localeCompare(sortKey(b.sort_name)),
      ),
      people: [...data.people].sort((a, b) =>
        sortKey(a.last_name, a.first_name).localeCompare(sortKey(b.last_name, b.first_name)),
      ),
      tags: data.tags,
      entries: buildEntries(data),
      householdById,
      personById,
      membersOf: (householdId) => members.get(householdId) ?? [],
      tagsOfHousehold: (householdId) => householdTagIds.get(householdId) ?? [],
      tagsOfPerson: (personId) => personTagIds.get(personId) ?? [],
      reload,
    };
  }, [data, loading, error, reload]);

  return <DirectoryContext value={value}>{children}</DirectoryContext>;
}

export function useDirectory(): DirectoryState {
  const context = use(DirectoryContext);
  if (!context) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return context;
}
