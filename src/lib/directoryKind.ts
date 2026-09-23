import type { ProjectKind, ProjectRow } from "./database.types";

/**
 * What kind of directory each one is: the main one, a group's, or an event's.
 *
 * There is one main directory, and the database holds that (0012). But every
 * directory saved before 0012 says only "directory", which the app used to
 * call Main whatever it was - a church with a choir booklet and a youth list
 * had three Mains. Which of those is really the main one is not something a
 * migration could know, so it is worked out here, the same way everywhere:
 *
 *   - A directory saved as main is the main one, and any old "directory" is a
 *     group directory.
 *   - With none saved as main, the oldest old "directory" is the main one -
 *     a church makes its directory first and its booklets after - and the
 *     rest are group directories.
 *
 * Saving a directory writes its kind for real, so this guessing fades out as
 * directories are opened and saved.
 */

export type DirectoryKind = "main" | "group" | "event";

export const KIND_NAMES: Record<DirectoryKind, string> = {
  main: "Main",
  group: "Group",
  event: "Event",
};

type Kinded = Pick<ProjectRow, "id" | "kind" | "created_at">;

/** The id of the main directory, or null when there is none. */
export function mainDirectoryId(projects: readonly Kinded[]): string | null {
  const saved = projects.find((row) => row.kind === "main");
  if (saved) return saved.id;
  const old = projects
    .filter((row) => row.kind === "directory")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return old[0]?.id ?? null;
}

/** Each directory's kind, by id, as it should be shown and edited. */
export function directoryKinds(projects: readonly Kinded[]): Map<string, DirectoryKind> {
  const main = mainDirectoryId(projects);
  return new Map(
    projects.map((row) => [row.id, row.id === main ? "main" : kindOf(row.kind)] as const),
  );
}

/** A stored kind as one of the three, leaving the choice of main to the list. */
function kindOf(kind: ProjectKind): DirectoryKind {
  return kind === "event" ? "event" : "group";
}
