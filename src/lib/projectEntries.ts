import type { DirectoryEntry } from "./entries";
import type { ProjectEntryRow, SelectionMode } from "./database.types";

export interface Selection {
  mode: SelectionMode;
  tagIds: string[];
  /** Explicit picks, in the order they should print. */
  entries: ProjectEntryRow[];
}

/**
 * Works out which records a project prints.
 *
 * Every mode stays alphabetical, because the point of the book is that you can
 * look someone up in it. "all" and "tags" also pick up new families on their
 * own - add someone to the choir in March and the choir booklet includes them
 * in April without anyone editing the project. "manual" is the escape hatch for
 * a one-off handout, and it filters the alphabetical list rather than following
 * the order the boxes happened to be ticked in.
 */
export function resolveEntries(all: DirectoryEntry[], selection: Selection): DirectoryEntry[] {
  if (selection.mode === "manual") {
    const picked = new Set(selection.entries.map((row) => `${row.entry_type}:${row.ref_id}`));
    return all.filter((entry) => picked.has(`${entry.type}:${entry.id}`));
  }

  if (selection.mode === "tags") {
    if (!selection.tagIds.length) return [];
    const wanted = new Set(selection.tagIds);
    return all.filter((entry) => entry.tagIds.some((tagId) => wanted.has(tagId)));
  }

  return all;
}
