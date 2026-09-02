// Runs a TypeScript file from scripts/ with the same module resolution the app
// uses (extensionless imports, the "@/" alias). Node's own type stripping does
// not do either, so esbuild bundles to a temp file first.
//
//   node scripts/run.mjs scripts/sample-book.ts [args...]

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/run.mjs <script.ts> [args...]");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");

// The bundle has to live inside the project so that Node resolves its bare
// imports against the project's node_modules.
const cacheDir = path.join(root, "node_modules", ".cache", "church-directory");
fs.mkdirSync(cacheDir, { recursive: true });
const outfile = path.join(cacheDir, `run-${process.pid}.mjs`);
process.on("exit", () => fs.rmSync(outfile, { force: true }));

await build({
  entryPoints: [path.resolve(entry)],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile,
  packages: "external",
  sourcemap: "inline",
  alias: { "@": path.join(root, "src") },
  logLevel: "warning",
});

process.argv = [process.argv[0], path.resolve(entry), ...args];
await import(pathToFileURL(outfile).href);
