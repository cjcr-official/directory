import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anyPersonAddedSince, fetchDirectory, fetchProfiles } from "@/lib/queries";
import { buildEntries, sortMembers, type DirectoryData, type DirectoryEntry } from "@/lib/entries";
import type { HouseholdRow, PersonRow, ProfileRow, TagRow } from "@/lib/database.types";
import { message, sortByKey, sortKey } from "@/lib/format";
import { newestArrival } from "@/lib/notifications";

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
  /**
   * The name behind an updated_by id, or null when there is nothing to show.
   *
   * Null covers three ordinary cases and they all want the same silence: the
   * row predates migration 0005, a service-role tool wrote it, or the account
   * that did has since been deleted. A record with no author says when it
   * changed and leaves it there.
   */
  authorName(id: string | null | undefined): string | null;
  reload(): Promise<void>;
}

const DirectoryContext = createContext<DirectoryState | null>(null);

/**
 * How often the app asks whether anybody has been added, while it is in front
 * of somebody. As UpdateGate's version check, and rarer: it is one row.
 */
const LOOK_INTERVAL_MS = 5 * 60 * 1000;

/** Before any record: what "has anybody been added since?" means on an empty directory. */
const EPOCH = "1970-01-01T00:00:00Z";

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
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The roster comes along because updated_by is an account id and every
      // form wants a name. It is a handful of rows next to the congregation,
      // and fetching it here keeps "who changed this" from costing a request
      // per screen. A directory that loads while the roster fails is still a
      // working directory, so its failure is swallowed rather than shown.
      const [directory, roster] = await Promise.all([
        fetchDirectory(),
        fetchProfiles().catch(() => [] as ProfileRow[]),
      ]);
      setProfiles(roster);
      setData(directory);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Notices people somebody else has added, and pulls the rows in again.
   *
   * The congregation is fetched once, which is what makes every screen
   * instant - and also what made a second administrator's afternoon invisible
   * until somebody reloaded the page. Added to the Home Screen that page can
   * be a week old. So while the app is in front of somebody it asks the one
   * cheap question that can be asked here - has anybody been added since the
   * newest row we hold - and only when the answer is yes does it fetch
   * anything.
   *
   * The whole directory comes back rather than the new rows alone: half an
   * arrival is worse than none, and the tray links to a record every other
   * screen would have to know about too.
   *
   * The reply is not needed anywhere in particular, so a failure is dropped.
   * A directory that cannot be refreshed is the one already on screen, and
   * the screens that ask for something say so themselves.
   */
  const newest = useMemo(() => newestArrival(data.people), [data.people]);
  /* Held in a ref so that a new arrival does not tear the timer below down and
     start it again: the question changes, the schedule it is asked on does not. */
  const asking = useRef<string | null>(newest);
  useEffect(() => {
    asking.current = newest;
  }, [newest]);

  useEffect(() => {
    let looking = false;
    const look = () => {
      if (document.visibilityState !== "visible" || looking) return;
      looking = true;
      void anyPersonAddedSince(asking.current ?? EPOCH)
        .then((arrived) => (arrived ? reload() : undefined))
        .catch(() => undefined)
        .finally(() => {
          looking = false;
        });
    };

    const interval = window.setInterval(look, LOOK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", look);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", look);
    };
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

  /**
   * Kept out of `derived` on purpose: that memo re-sorts the congregation and
   * rebuilds every entry, and a roster that arrives a moment later - or an
   * administrator being renamed - is no reason to do any of it again.
   */
  const authorName = useMemo(() => {
    const names = new Map(profiles.map((row) => [row.id, row.full_name.trim() || row.email]));
    return (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);
  }, [profiles]);

  const value = useMemo<DirectoryState>(
    () => ({ ...derived, authorName, loading, ready, error, reload }),
    [derived, authorName, loading, ready, error, reload],
  );

  return <DirectoryContext value={value}>{children}</DirectoryContext>;
}

export function useDirectory(): DirectoryState {
  const context = use(DirectoryContext);
  if (!context) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return context;
}
