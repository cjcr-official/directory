import type { DirectoryEntry } from "./entries";
import type { ProjectEntryRow, SelectionMode } from "./database.types";

export interface Selection {
  mode: SelectionMode;
  tagIds: string[];
  /** Explicit picks, in the order they should print. */
  entries: ProjectEntryRow[];
}

/**
 * Works out which records a project prints, and in what order.
 *
 * "all" and "tags" stay alphabetical and pick up new families automatically -
 * add someone to the choir in March and the choir booklet includes them in
 * April without anyone editing the project. "manual" is the escape hatch for a
 * one-off handout where the order matters.
 */
export function resolveEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  if (selection.mode === "manual") {
    const byKey = new Map(all.map((entry) => [`${entry.type}:${entry.id}`, entry]));
    return selection.entries
      .map((row) => byKey.get(`${row.entry_type}:${row.ref_id}`))
      .filter((entry): entry is DirectoryEntry => Boolean(entry));
  }

  if (selection.mode === "tags") {
    if (!selection.tagIds.length) return [];
    const wanted = new Set(selection.tagIds);
    return all.filter((entry) => entry.tagIds.some((tagId) => wanted.has(tagId)));
  }

  return all;
}

/** A short sentence describing the selection, for project cards and headers. */
export function describeSelection(
  selection: Selection,
  tagNames: Map<string, string>,
  count: number,
): string {
  if (selection.mode === "all") {
    return `Everyone in the directory — ${count} record${count === 1 ? "" : "s"}`;
  }
  if (selection.mode === "tags") {
    const names = selection.tagIds.map((id) => tagNames.get(id)).filter(Boolean);
    if (!names.length) return "No groups chosen yet";
    return `${names.join(", ")} — ${count} record${count === 1 ? "" : "s"}`;
  }
  return `${count} hand-picked record${count === 1 ? "" : "s"}`;
}
