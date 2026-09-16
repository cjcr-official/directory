/**
 * Sending an import to the database.
 *
 * importPlan.ts has already decided what goes; this puts it there. Families
 * first, because a person carries the id of the one they belong to, and in
 * batches for the same reason a restore uses them - a church office on a phone
 * over the hall's wifi.
 */

import { supabase } from "./supabase";
import { readSheet } from "./sheet";
import { planImport } from "./importPlan";
import type { ImportPlan, LiveForImport } from "./importPlan";

export * from "./importPlan";

/** Rows per request, as in restore.ts. */
const CHUNK = 200;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += CHUNK) out.push(rows.slice(at, at + CHUNK));
  return out;
}

export interface ImportProgress {
  label: string;
  done: number;
  total: number;
}

/** Reads a chosen file and works out what importing it would do. */
export async function readImportFile(file: File, live: LiveForImport): Promise<ImportPlan> {
  const table = await readSheet(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!table.rows.length) {
    throw new Error("That file has headings but no people under them.");
  }
  const plan = planImport(file.name, table, live);
  if (!plan.households.length && !plan.people.length && !plan.alreadyHere) {
    throw new Error(
      "Nothing in that file looks like a person. A Planning Center export has a " +
        "First Name and a Last Name column; check the file is the one it downloaded.",
    );
  }
  return plan;
}

export async function applyImport(
  plan: ImportPlan,
  onProgress?: (progress: ImportProgress) => void,
): Promise<{ households: number; people: number }> {
  const total = plan.households.length + plan.people.length;
  let done = 0;

  for (const batch of chunked(plan.households)) {
    const { error } = await supabase.from("households").insert(batch);
    if (error) throw new Error(`families: ${error.message}`);
    done += batch.length;
    onProgress?.({ label: "Adding families…", done, total });
  }

  for (const batch of chunked(plan.people)) {
    const { error } = await supabase.from("people").insert(batch);
    if (error) throw new Error(`people: ${error.message}`);
    done += batch.length;
    onProgress?.({ label: "Adding people…", done, total });
  }

  return { households: plan.households.length, people: plan.people.length };
}
