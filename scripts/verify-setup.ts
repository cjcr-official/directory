import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * Checks that a Supabase project is set up correctly, before you deploy.
 *
 *   npm run verify
 *
 * Reads .env.local (or the environment) and connects with the anon key - the
 * same key the browser gets - so it sees exactly what a stranger would see.
 * Nothing here needs a service role key, and nothing is written.
 */

type Status = "pass" | "fail" | "warn";
const results: { status: Status; label: string; detail?: string }[] = [];

const record = (status: Status, label: string, detail?: string) => {
  results.push({ status, label, detail });
  const mark = status === "pass" ? "  ok  " : status === "warn" ? " note " : " FAIL ";
  console.log(`[${mark}] ${label}`);
  if (detail) console.log(`         ${detail}`);
};

/** Minimal .env parser; we only need two keys and want no dependency. */
function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const fromFile = readEnvFile(path.join(root, ".env.local"));
  const url = process.env.VITE_SUPABASE_URL || fromFile.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || fromFile.VITE_SUPABASE_ANON_KEY;

  console.log("\nChecking your Supabase project\n");

  if (!url || !anonKey) {
    record(
      "fail",
      "Credentials found",
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (copy .env.example).",
    );
    return finish();
  }
  record("pass", "Credentials found", url);

  if (/service_role/.test(anonKey)) {
    record(
      "fail",
      "The key is the anon key, not the service role key",
      "The service role key bypasses every security policy and must never be used here.",
    );
    return finish();
  }

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

  // --- can we reach it, and is the schema there? ---------------------------
  const tables = ["households", "people", "tags", "projects", "profiles"] as const;
  let schemaPresent = true;
  for (const table of tables) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) {
      record("pass", `Table "${table}" exists`);
      continue;
    }
    if (/does not exist|find the table|schema cache/i.test(error.message)) {
      schemaPresent = false;
      record(
        "fail",
        `Table "${table}" is missing`,
        "Run supabase/migrations/0001_initial_schema.sql in the Supabase SQL editor.",
      );
    } else {
      record("fail", `Could not query "${table}"`, error.message);
    }
  }

  // --- the check that actually matters -------------------------------------
  // Only meaningful once the tables exist: an empty result from a table that is
  // not there says nothing about row level security.
  if (!schemaPresent) {
    record(
      "warn",
      "Skipped the security checks",
      "They cannot say anything useful until the schema is in place.",
    );
    return finish();
  }

  const leaks: string[] = [];
  for (const table of ["households", "people", "tags"] as const) {
    const { data, error } = await supabase.from(table).select("*").limit(5);
    if (error) continue;
    if ((data?.length ?? 0) > 0) leaks.push(table);
  }

  if (leaks.length) {
    record(
      "fail",
      "Row level security is NOT protecting your data",
      `Anyone with the app's address can read: ${leaks.join(", ")}. ` +
        "Re-run supabase/migrations/0001_initial_schema.sql, which enables RLS on every table.",
    );
  } else {
    record("pass", "Row level security blocks anonymous reads", "A stranger sees nothing.");
  }

  // --- storage --------------------------------------------------------------
  const bucket = await supabase.storage.from("directory-photos").list("", { limit: 1 });
  if (bucket.error) {
    record("pass", "Photo bucket is not readable anonymously", bucket.error.message);
  } else if ((bucket.data?.length ?? 0) === 0) {
    record("pass", "Photo bucket exists and lists nothing anonymously");
  } else {
    record(
      "fail",
      "Photographs are readable without signing in",
      "Run supabase/migrations/0002_storage.sql, which makes the bucket private.",
    );
  }

  // --- has anyone claimed it yet? ------------------------------------------
  const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
  if (count === null) {
    record("warn", "Could not tell whether an owner exists", "Expected while RLS hides the table.");
  } else if (count === 0) {
    record("warn", "No administrator yet", "The first account to sign up becomes the owner.");
  }

  finish();
}

function finish() {
  const failed = results.filter((r) => r.status === "fail").length;
  console.log("");
  if (failed) {
    console.log(
      `${failed} check${failed === 1 ? "" : "s"} failed. Fix the above, then run again.\n`,
    );
    process.exit(1);
  }
  console.log("Everything checks out. You are ready to deploy.\n");
}

main().catch((error) => {
  console.error("\nCould not reach the project:", error instanceof Error ? error.message : error);
  console.error("Check VITE_SUPABASE_URL is the Project URL from Settings -> API.\n");
  process.exit(1);
});
