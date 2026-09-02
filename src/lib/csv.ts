export type CsvValue = string | number | boolean | null | undefined;

/** Quotes a field only when it needs it, doubling any embedded quotes. */
function escape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
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
