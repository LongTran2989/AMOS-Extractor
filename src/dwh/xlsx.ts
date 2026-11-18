// Reads the first worksheet of an Excel (.xlsx) file into a Table of strings, with built-in Node
// modules only (no new dependency): the ZIP container through its central directory and
// node:zlib, the XML with small regular expressions (xlsx parts are machine-written and flat).
// Cells keep what Excel stores: shared/inline strings as text, numbers in their shortest exact
// form, booleans as TRUE/FALSE, and date-formatted numbers as ISO text (YYYY-MM-DD, or
// YYYY-MM-DD HH:MM:SS when the format or value has a time of day).
import { inflateRawSync } from "node:zlib";
import type { Table } from "../stitch/stitch.ts";

const NOT_XLSX = "This is not an Excel (.xlsx) file, or it is damaged. Export from AMOS again, or save it as .csv.";

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: the last 0x06054b50 within the final 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(NOT_XLSX);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("This Excel file is too large to read here (ZIP64). Save it as .csv instead.");
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(NOT_XLSX);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(NOT_XLSX);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`${NOT_XLSX} (unknown compression ${method})`);
  }
  return files;
}

function decodeXml(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9A-Fa-f]+);/g, (_m, e: string) => {
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "amp") return "&";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Text of every <t> run in a string item, skipping phonetic <rPh> runs. */
function runText(xml: string): string {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of noPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 22, 45, 46, 47]);

/** Per style index: undefined (not a date), "date" or "datetime". */
function dateStyles(stylesXml: string | undefined): ("date" | "datetime" | undefined)[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    custom.set(id, decodeXml(attr(m[0], "formatCode") ?? ""));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id)) return BUILTIN_TIME_FORMATS.has(id) ? "datetime" : "date";
    const code = custom.get(id);
    if (code === undefined) return undefined;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").toLowerCase();
    if (!/[dy]/.test(bare)) return /[hs]/.test(bare) ? "datetime" : undefined;
    return /[hs]/.test(bare) ? "datetime" : "date";
  });
}

function serialToIso(serial: number, kind: "date" | "datetime", date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const iso = new Date(epoch + Math.round(serial * 86400000)).toISOString();
  const withTime = kind === "datetime" || !Number.isInteger(serial);
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numberText(v: string): string {
  if (/^-?\d+$/.test(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

/** The first worksheet as a Table: first row = header, every row padded to the header width. */
export function readXlsx(buf: Buffer): Table {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error(NOT_XLSX);
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);

  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const rid = firstSheet ? attr(firstSheet, "r:id") : undefined;
  const rels = text("xl/_rels/workbook.xml.rels");
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], "Id") !== rid) continue;
      const target = attr(m[0], "Target") ?? "";
      sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error(`${NOT_XLSX} (no worksheet)`);

  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => runText(m[1] ?? ""));
  const styles = dateStyles(text("xl/styles.xml"));

  const records: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = `<c${cm[1]}>`;
      const ref = attr(head, "r");
      const at = ref ? colIndex(ref) : next;
      next = at + 1;
      const body = cm[2] ?? "";
      const type = attr(head, "t") ?? "n";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = v === undefined ? "" : shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (v !== undefined) {
        const raw = decodeXml(v);
        const kind = type === "n" ? styles[Number(attr(head, "s") ?? 0)] : undefined;
        value = kind && Number.isFinite(Number(raw)) ? serialToIso(Number(raw), kind, date1904) : type === "n" ? numberText(raw) : raw;
      }
      while (row.length < at) row.push("");
      row[at] = value;
    }
    records.push(row);
  }
  const [header = [], ...rows] = records;
  return { header, rows: rows.map((r) => (r.length < header.length ? [...r, ...Array<string>(header.length - r.length).fill("")] : r)) };
}
