/**
 * The counting and the printing that every check script was doing for itself.
 *
 * Ten of them had grown their own copy - a counter, a `check`, and the same
 * three lines at the bottom - in four slightly different dialects, so whether a
 * failure read "FAIL", "1 CHECKS FAILED" or "1 PAIR(S) BELOW THE THRESHOLD"
 * depended on which script happened to find it. This is that, once.
 *
 * Nothing here calls process.exit. The code is set as failures arrive and the
 * tally is printed on the way out, so a script reads the same whether it is the
 * whole of `npm run qr:check` or one import inside `npm run checks` - and the
 * aggregate needs no bookkeeping of its own.
 */

let failures = 0;
let ran = 0;

function record(what: string, pass: boolean, detail: string): void {
  ran += 1;
  if (!pass) {
    failures += 1;
    // Set here rather than at the end, so a script that throws halfway still
    // leaves a non-zero code behind it.
    process.exitCode = 1;
  }
  console.log(`  ${pass ? "ok  " : "FAIL"} ${what}${pass || !detail ? "" : `  ${detail}`}`);
}

/** One assertion. `detail` is printed only where it failed. */
export function check(what: string, pass: boolean, detail = ""): void {
  record(what, pass, detail);
}

/**
 * The same, against an expected value.
 *
 * Compared as JSON rather than with ===, so a plan, a row, or a list of them
 * can be put to it whole instead of a field at a time.
 */
export function same(what: string, got: unknown, want: unknown): void {
  record(
    what,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
  );
}

// The tally, printed once however the run ends - one script or all ten. On exit
// rather than at the bottom of each file, so the aggregate does not print ten
// running totals on its way to the only one anybody wanted.
process.on("exit", () => {
  if (ran === 0) return;
  console.log(failures === 0 ? `\n${ran} checks, nothing amiss` : `\n${failures} of ${ran} FAILED`);
});
