// Task 2.1: cell formatting and CSV lines for DWH results (plan A.9 "Download all as CSV").
// Values are formatted by the converter's output type, not by the relay's type (#85): the
// relay reports Oracle NUMBER as float and date expressions as datetime2.
import type { SqlType } from "./convert/scope.ts";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function ymd(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function ymdhms(d: Date): string {
  return `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** One cell as text. NULL is empty. Dates are read in UTC (the connection uses useUTC). */
export function formatCell(v: unknown, type: SqlType): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return type === "date" ? ymd(v) : ymdhms(v);
  if (typeof v === "number") {
    if (type === "int" && Number.isInteger(v)) return BigInt(v).toString();
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  return String(v);
}

/** UTF-8 byte order mark, so Excel reads the file as UTF-8. */
export function csvHeaderBytes(): Buffer {
  return Buffer.from([0xef, 0xbb, 0xbf]);
}

/** One CSV line: every field quoted, quotes doubled, CRLF at the end. */
export function csvLine(cells: string[]): string {
  return `${cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")}\r\n`;
}
