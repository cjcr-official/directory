/**
 * What a phone has to download before it can show anything.
 *
 * This is the check that would have caught the thing it was written for.
 * pdf-lib is 176 kB gzipped and only two screens need it, so it is meant to
 * arrive when one of them is opened - and it did not. metrics.ts imported it
 * at the top of the file, the preview imports metrics, the shell imports the
 * preview, and so every visitor downloaded a PDF writer before the family
 * list could show a name. Nothing was broken; the app was simply twice the
 * weight it should have been, which is invisible on a desk and not on church
 * hall wifi.
 *
 * Run after a build: npm run build && npm run bundle:check
 */

import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { check } from "./check";

const DIST = "dist";

/** Everything above this, gzipped, and a first load is worth a second look. */
const BUDGET_KB = 200;

/** Chunks that must not be on the critical path, and why. */
const DEFERRED = [{ match: /^pdf-/, why: "pdf-lib: only the preview and the PDF button need it" }];

const html = readFileSync(join(DIST, "index.html"), "utf8");

// Both the entry script and everything modulepreloaded: a preload is a
// download, so it counts towards what a first visit costs.
const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const unique = [...new Set(referenced)];

console.log("\nwhat a first visit downloads before anything is on screen:\n");

let total = 0;
for (const ref of unique.sort()) {
  const bytes = gzipSync(readFileSync(join(DIST, ref)));
  total += bytes.length;
  console.log(`  ${(bytes.length / 1024).toFixed(1).padStart(7)} kB   ${basename(ref)}`);
}
console.log(`  ${"-".repeat(7)}`);
console.log(`  ${(total / 1024).toFixed(1).padStart(7)} kB   total\n`);

for (const { match, why } of DEFERRED) {
  const found = unique.find((ref) => match.test(basename(ref)));
  check(
    found
      ? `${basename(found)} is on the critical path — ${why}`
      : `${match.source} is not downloaded until it is needed`,
    !found,
  );
}

const totalKb = total / 1024;
const within = totalKb <= BUDGET_KB;
check(
  `first load is ${totalKb.toFixed(1)} kB gzipped, ${within ? "under" : "over"} the ${BUDGET_KB} kB budget`,
  within,
);

/*
 * And that the build is not publishing its own source.
 *
 * A source map carries `sourcesContent`, which is every line of TypeScript in
 * this project with its comments attached, and Vite writes a sourceMappingURL
 * into each chunk so a browser fetches it without being asked. Deployed, that
 * put 4.4 MB of source under /assets behind a year-long immutable cache, on an
 * app whose whole job is keeping a congregation's addresses off the open web.
 *
 * It is one word in vite.config.ts and it was on for a long time without
 * anybody noticing, which is exactly the sort of thing this file is for: the
 * build succeeds either way and nothing on screen looks different.
 */
const maps = readdirSync(join(DIST, "assets")).filter((name) => name.endsWith(".map"));
check(
  maps.length
    ? `${maps.length} source map(s) in dist/assets — the deploy would publish this app's source`
    : "no source maps in the build, so the deploy publishes none",
  maps.length === 0,
  maps.join(", "),
);
