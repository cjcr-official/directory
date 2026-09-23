/**
 * The backup keeps up with the data.
 *
 * A backup goes out of date without anybody touching it: a migration adds a
 * column or a table, a screen starts saving photographs into a new folder, a
 * directory setting starts pointing at new artwork - and the backup page
 * carries on writing files that look complete and are not. Nobody finds out
 * until the restore that brings back everything except the new thing.
 *
 * So this reads the migrations themselves, and the parts of the app that
 * decide where photographs go, and fails until every one of them is either
 * covered by the backup or written down in src/lib/backupSpec.ts as left out
 * on purpose, with the reason. It runs in `npm run checks`, which gates the
 * deploy.
 *
 * Run with: npm run backup:check
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COVER_PATH_KEYS,
  DIRECTORY_TABLES,
  FAMILY_COLUMNS,
  NOT_IN_SPREADSHEET,
  OUTSIDE_BACKUP,
  PERSON_COLUMNS,
  PHOTO_FOLDERS,
} from "@/lib/backupSpec";
import { DEFAULT_SETTINGS } from "@/lib/layout/settings";
import { check, same } from "./check";

// npm runs every script from the repository root, here and in CI - and
// run.mjs bundles this into a cache folder, so its own location says nothing.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Every migration, in the order they are run. */
const migrations = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

/** Line comments out, so a column mentioned in a comment is not a column. */
const code = (sql: string) => sql.replace(/--.*$/gm, "");

// ---------------------------------------------------------------------------
// The schema, as the migrations leave it
// ---------------------------------------------------------------------------

const tables = new Map<string, Set<string>>();

for (const { sql } of migrations) {
  const text = code(sql);

  for (const match of text.matchAll(
    /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi,
  )) {
    const columns = new Set<string>();
    for (const line of match[2].split("\n")) {
      const column = /^\s*(\w+)\s+\w/.exec(line)?.[1];
      if (column && !/^(primary|constraint|unique|check|foreign|exclude)$/i.test(column)) {
        columns.add(column);
      }
    }
    tables.set(match[1], columns);
  }

  for (const statement of text.split(";")) {
    const table = /alter table (?:if exists )?(?:only )?public\.(\w+)/i.exec(statement)?.[1];
    if (!table) continue;
    const columns = tables.get(table) ?? new Set<string>();
    for (const added of statement.matchAll(/add column (?:if not exists )?(\w+)/gi)) {
      columns.add(added[1]);
    }
    for (const dropped of statement.matchAll(/drop column (?:if exists )?(\w+)/gi)) {
      columns.delete(dropped[1]);
    }
    tables.set(table, columns);
  }

  for (const dropped of text.matchAll(/drop table (?:if exists )?public\.(\w+)/gi)) {
    tables.delete(dropped[1]);
  }
}

console.log("\nevery table is backed up, or left out on purpose");
{
  check("the migrations were read", tables.size >= 10, `found ${tables.size} tables`);

  const inBackup = new Set(Object.keys(DIRECTORY_TABLES));
  const leftOut = new Set(Object.keys(OUTSIDE_BACKUP));
  for (const table of [...tables.keys()].sort()) {
    check(
      `${table} is in the backup or listed as left out`,
      inBackup.has(table) !== leftOut.has(table),
      inBackup.has(table)
        ? "it is in both lists"
        : "add it to DIRECTORY_TABLES, or to OUTSIDE_BACKUP with the reason, in src/lib/backupSpec.ts",
    );
  }
  for (const table of [...inBackup, ...leftOut]) {
    check(
      `${table}, named in backupSpec.ts, is a real table`,
      tables.has(table),
      "no migration creates it - remove it from the list",
    );
  }
}

console.log("\nevery directory table goes back in with a replace");
{
  const last = [...migrations]
    .reverse()
    .find(({ sql }) => /function public\.replace_directory\s*\(/i.test(sql));
  check("replace_directory is defined", last !== undefined);
  const body = code(last?.sql ?? "");
  for (const table of Object.keys(DIRECTORY_TABLES)) {
    check(
      `replace_directory refills ${table}`,
      new RegExp(`insert into public\\.${table}\\b`, "i").test(body),
      `add it to replace_directory in a new migration (last defined in ${last?.name})`,
    );
    const emptied =
      new RegExp(`delete from public\\.${table}\\b`, "i").test(body) ||
      // The link tables go by cascade with the records they link.
      /_tags$|_entries$/.test(table);
    check(`replace_directory empties ${table} first`, emptied);
  }
}

console.log("\nevery directory table is written into, and read back from, directory.json");
{
  const writer = readFileSync(join(ROOT, "src/lib/backup.ts"), "utf8");
  const reader = readFileSync(join(ROOT, "src/lib/restorePlan.ts"), "utf8");
  for (const [table, { inFile }] of Object.entries(DIRECTORY_TABLES)) {
    check(
      `${table} is written as "${inFile}"`,
      new RegExp(`\\b${inFile}\\b`).test(writer.slice(writer.indexOf('"directory.json"'))),
    );
    check(`${table} is read back as "${inFile}"`, new RegExp(`raw\\.${inFile}\\b`).test(reader));
  }
}

console.log("\nevery family and person column is in its spreadsheet, or left out on purpose");
{
  const sheets = {
    households: { file: "families.csv", columns: FAMILY_COLUMNS.map((column) => column.column) },
    people: { file: "people.csv", columns: PERSON_COLUMNS.map((column) => column.column) },
  } as const;

  for (const [table, { file, columns }] of Object.entries(sheets)) {
    const shown = new Set(columns.filter(Boolean) as string[]);
    const leftOut = NOT_IN_SPREADSHEET[table as keyof typeof NOT_IN_SPREADSHEET];
    for (const column of [...(tables.get(table) ?? [])].sort()) {
      check(
        `${table}.${column} is in ${file} or listed as left out`,
        shown.has(column) || column in leftOut,
        `add a column to ${table === "households" ? "FAMILY_COLUMNS" : "PERSON_COLUMNS"}, ` +
          `or a line to NOT_IN_SPREADSHEET.${table} saying why, in src/lib/backupSpec.ts`,
      );
    }
    for (const column of [...shown, ...Object.keys(leftOut)]) {
      check(
        `${table}.${column}, named in backupSpec.ts, is a real column`,
        tables.get(table)?.has(column) ?? false,
        "no migration adds it - remove it from the list",
      );
    }
  }
}

console.log("\nevery photograph is saved where a backup looks");
{
  // Anything that saves into the bucket names a folder from PHOTO_FOLDERS -
  // the type makes uploadPhoto do it - but a new call to .upload() somewhere
  // else would not be held to that.
  const uploaders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && /\.upload\(/.test(readFileSync(path, "utf8"))) {
        uploaders.push(path.slice(ROOT.length + 1));
      }
    }
  };
  walk(join(ROOT, "src"));
  same("only photos.ts and the restore save into storage", uploaders.sort(), [
    "src/lib/photos.ts",
    "src/lib/restore.ts",
  ]);

  const photos = readFileSync(join(ROOT, "src/lib/photos.ts"), "utf8");
  check(
    "uploadPhoto takes its folder from PHOTO_FOLDERS",
    /kind:\s*PhotoFolder\b/.test(photos),
    "a folder typed out by hand can be one the backup never looks in",
  );
  check("there is a folder for every kind of record photo", PHOTO_FOLDERS.length >= 3);
}

console.log("\nevery directory setting that points at artwork is backed up");
{
  const pointers = Object.keys(DEFAULT_SETTINGS).filter((key) => /Path$/.test(key));
  same(
    "COVER_PATH_KEYS names every setting ending in Path",
    [...COVER_PATH_KEYS].sort(),
    pointers.sort(),
  );
}
