export type CsvValue = string | number | boolean | null | undefined;

/**
 * Text a spreadsheet would run as a formula rather than show.
 *
 * Excel, Numbers and Sheets all treat a cell opening with one of these as a
 * formula, so a note typed as "=HYPERLINK(...)" would become a live link - or
 * worse - in the office's copy of the backup. Numbers are safe as they are.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Quotes a field only when it needs it, doubling any embedded quotes. */
function escape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  // A leading apostrophe is the spreadsheet convention for "this is text": it
  // is shown as written and never evaluated.
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds a spreadsheet-ready CSV.
 *
 * Rows are joined with CRLF and the file opens with a byte order mark, because
 * without one Excel on Windows reads UTF-8 as Latin-1 and turns every accented
 * name into mojibake.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
