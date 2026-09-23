import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * When the last backup was taken, as every administrator sees it.
 *
 * This used to live in the browser that took it, so the office PC could say
 * "yesterday" while every phone said "never", and nobody anywhere was told
 * when backups stopped. It is a row in backup_log now (migration 0011), read
 * by everyone. The browser's own note is kept as well and the later of the two
 * wins, so the page still says something true on a database that has not run
 * 0011 yet.
 */

const LAST_BACKUP_KEY = "church-directory:last-backup";
const TAKEN_EVENT = "church-directory:backup-taken";

/** The README asks for one a month; a few days' grace before saying so. */
export const BACKUP_DUE_DAYS = 35;

function localLast(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    // Private browsing, or storage disabled.
    return null;
  }
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export async function fetchLastBackup(): Promise<string | null> {
  const { data, error } = await supabase
    .from("backup_log")
    .select("taken_at")
    .order("taken_at", { ascending: false })
    .limit(1);
  const shared = error ? null : (data?.[0]?.taken_at ?? null);
  return later(shared, localLast());
}

/**
 * Notes a backup that has just been downloaded. Never throws: the file is
 * already on the person's device, and that is the part that matters.
 */
export async function recordBackup(details: {
  photosIncluded: boolean;
  households: number;
  people: number;
}): Promise<string> {
  const now = new Date().toISOString();
  try {
    localStorage.setItem(LAST_BACKUP_KEY, now);
  } catch {
    // Not worth failing the backup over.
  }
  try {
    await supabase.from("backup_log").insert({
      photos_included: details.photosIncluded,
      households: details.households,
      people: details.people,
    });
  } catch {
    // As above.
  }
  window.dispatchEvent(new Event(TAKEN_EVENT));
  return now;
}

export function isBackupDue(iso: string | null, now = Date.now()): boolean {
  if (!iso) return true;
  const age = now - new Date(iso).getTime();
  return Number.isNaN(age) || age > BACKUP_DUE_DAYS * 86_400_000;
}

/**
 * The last backup, kept current: read once, and again whenever this browser
 * takes one. `loaded` is false until the first answer, so nothing claims a
 * backup is overdue before it knows.
 */
export function useLastBackup(enabled = true): { takenAt: string | null; loaded: boolean } {
  const [state, setState] = useState<{ takenAt: string | null; loaded: boolean }>({
    takenAt: null,
    loaded: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const look = () =>
      void fetchLastBackup().then(
        (takenAt) => live && setState({ takenAt, loaded: true }),
        () => live && setState({ takenAt: localLast(), loaded: true }),
      );
    look();
    window.addEventListener(TAKEN_EVENT, look);
    return () => {
      live = false;
      window.removeEventListener(TAKEN_EVENT, look);
    };
  }, [enabled]);

  return state;
}
