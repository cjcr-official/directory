/**
 * Reading a spreadsheet somebody exported from something else.
 *
 * Two formats, because a church office has whichever one it has: the .xlsx a
 * Planning Center export downloads as, and the .csv the same screen offers
 * beside it. Both come back as the same thing - a list of headers and a row
 * per person, every value a string.
 *
 * The .xlsx path is hand-rolled rather than a library. A workbook is a ZIP of
 * XML and this app already reads ZIPs (unzip.ts, for its own backups), so what
 * is left is two files of machine-written markup: the shared string table and
 * the first sheet. A spreadsheet library would read a hundred things this does
 * not need - formulas, styles, charts, pivot tables - and cost more gzipped
 * than the whole app does now.
 *
 * Nothing here interprets a value. A date in a workbook is a number and a date
 * in a CSV is text, and which columns are dates is a question about Planning
 * Center rather than about spreadsheets: importPlan.ts answers it.
 */

import { readZip } from "./unzip";

export interface SheetTable {
  /** Column headings, in the order the file has them. */
  headers: string[];
  /** One entry per data row, keyed by heading. */
  rows: Record<string, string>[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });
}

/** Every <t> inside one element, joined - a run of styled text is still one string. */
function textOf(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(match[1]);
  return out;
}

/** "AB" is the 28th column. Letters are the only thing a cell reference promises. */
function columnIndex(ref: string): number {
  let at = 0;
  for (const letter of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) {
    at = at * 26 + (letter.charCodeAt(0) - 64);
  }
  return at - 1;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
}

/** A sheet as a grid of strings, with the gaps the file leaves filled in. */
function sheetGrid(xml: string, shared: string[]): string[][] {
  const grid: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // Lazy, because an empty cell is written <c r="B2" s="1"/> and a greedy
    // attribute run swallows that closing slash - leaving the match to look
    // for the next </c>, which belongs to a later cell. One empty cell then
    // shifted every value after it into the wrong column.
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? "";
      const kind = /t="([^"]+)"/.exec(attributes)?.[1] ?? "";

      let value = "";
      if (kind === "s") {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        value = shared[index] ?? "";
      } else if (kind === "inlineStr" || kind === "str") {
        value = textOf(body);
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }

      // Empty cells are simply absent from the file, so the reference is what
      // says which column this is. Without it a row with a gap in the middle
      // would shift everything after it one column to the left.
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value.trim();
    }
    grid.push(cells);
  }
  return grid;
}

/** Splits CSV text, honouring quotes, doubled quotes and newlines inside them. */
function csvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  // A byte order mark would otherwise become part of the first heading, and
  // "Person ID" with an invisible character in front of it matches nothing.
  const body = text.replace(/^﻿/, "");

  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (quoted) {
      if (char !== '"') {
        value += char;
      } else if (body[at + 1] === '"') {
        value += '"';
        at += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value.trim());
      value = "";
    } else if (char === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") value += char;
  }
  row.push(value.trim());
  rows.push(row);

  // A file that ends with a newline leaves one empty row behind it, and so
  // does a blank line anywhere in the middle.
  return rows.filter((line) => line.some((cell) => cell !== ""));
}

/** Headers and rows, from a grid whose first line names the columns. */
function toTable(grid: string[][]): SheetTable {
  const [first = [], ...rest] = grid.filter((line) => line.some((cell) => cell !== ""));
  const headers = first.map((cell) => cell.trim());
  const rows = rest.map((line) => {
    const row: Record<string, string> = {};
    headers.forEach((header, at) => {
      if (header) row[header] = line[at] ?? "";
    });
    return row;
  });
  return { headers: headers.filter(Boolean), rows };
}

/**
 * The first worksheet of a workbook, or the whole of a CSV.
 *
 * The first is the right one: an export is one sheet, and a workbook with
 * several has its data on the one the person was looking at when they saved.
 * They are numbered from 1 in the archive but not necessarily in order, so the
 * lowest-numbered name wins rather than whichever the ZIP happens to list
 * first.
 */
export async function readSheet(name: string, bytes: Uint8Array): Promise<SheetTable> {
  if (/\.csv$/i.test(name)) return toTable(csvGrid(new TextDecoder().decode(bytes)));

  if (!/\.xlsx$/i.test(name)) {
    throw new Error(
      "That file is neither a .xlsx nor a .csv. Export from Planning Center as either one.",
    );
  }

  const entries = await readZip(bytes);
  if (entries.some((entry) => !entry.intact)) {
    throw new Error("That .xlsx is damaged and will not read. Export the file again.");
  }
  const decoder = new TextDecoder();
  const sheets = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!sheets.length) {
    throw new Error("That .xlsx has no worksheet in it. Export the file again.");
  }

  const strings = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const shared = strings ? sharedStrings(decoder.decode(strings.data)) : [];
  return toTable(sheetGrid(decoder.decode(sheets[0].data), shared));
}
