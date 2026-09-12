/**
 * Every check that needs nothing but this source tree, in one run.
 *
 * These used to be ten `npm run`s chained with &&, which is ten Node starts and
 * ten esbuild bundles of the same files to answer ten questions that each take
 * milliseconds. Imported instead, it is one of each.
 *
 * Every module below does its work as it is imported and records into check.ts,
 * which prints one tally for the lot on the way out. So the order here is only
 * the order the output reads in - the book first, because it is the slowest and
 * the one worth seeing fail early.
 *
 * Each is still runnable on its own - `npm run qr:check` and the rest - which is
 * what you want while you are working on one of them.
 */

import "./invariants";
import "./restore-check";
import "./batch-check";
import "./names-check";
import "./text-check";
import "./contrast-check";
import "./cover-check";
import "./fields-check";
import "./strip-check";
import "./qr-check";
import "./changed-check";
import "./columns-check";
import "./notifications-check";
import "./background-check";
