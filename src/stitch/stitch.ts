// Rebuilds the legacy flat WP-sequences output (one row per step x part) from the split
// steps (A) and parts (B) result sets. All values stay strings; nothing is re-typed.

export type Table = { header: string[]; rows: string[][] };

/** Minimal RFC 4180 parser (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      records.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); records.push(row); }
  const [header = [], ...raw] = records;
  return { header, rows: repairRows(raw, header.length) };
}

/**
 * The AMOS export quotes fields containing commas/quotes but NOT fields containing line breaks,
 * so a multi-line value (e.g. a step header) is split into several short records. Glue a short
 * record to the following one with the newline it lost until the field count is right again.
 */
export function repairRows(rows: string[][], width: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    let cur = rows[i]!;
    while (cur.length < width && i + 1 < rows.length) {
      const next = rows[++i]!;
      cur = [...cur.slice(0, -1), cur[cur.length - 1] + "\n" + (next[0] ?? ""), ...next.slice(1)];
    }
    out.push(cur);
  }
  return out;
}

export function toCsv(t: Table): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.header, ...t.rows].map(r => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export type StitchResult = { table: Table; orphanParts: number };

export function stitch(steps: Table, parts: Table, keyCols = ["z_WORKSTEP_LINK_ID"]): StitchResult {
  const idx = (t: Table, name: string, which: string) => {
    const i = t.header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`Column ${name} missing from ${which} CSV`);
    return i;
  };
  const stepKey = keyCols.map(k => idx(steps, k, "steps"));
  const partKey = keyCols.map(k => idx(parts, k, "parts"));
  const keyOf = (r: string[], at: number[]) => at.map(i => r[i] ?? "").join("\u0001");

  // Link id is only a stitch key: never part of the legacy output.
  const dropFromSteps = new Set(["z_workstep_link_id"]);
  const stepOut = steps.header.map((h, i) => i).filter(i => !dropFromSteps.has((steps.header[i] ?? "").toLowerCase()));
  const partOut = parts.header.map((h, i) => i).filter(i => !partKey.includes(i));

  const byKey = new Map<string, string[][]>();
  for (const r of parts.rows) {
    const k = keyOf(r, partKey);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }

  const stepKeys = new Set<string>();
  const rows: string[][] = [];
  // Some exports write NULL as a single space; mirror whatever the steps file uses.
  const nullMark = steps.rows.some(r => r.includes(" ")) ? " " : "";
  const blank = partOut.map(() => nullMark);
  for (const s of steps.rows) {
    const k = keyOf(s, stepKey);
    const base = stepOut.map(i => s[i] ?? "");
    // A step key of "" means the item has no worksteps (LEFT JOIN miss): no parts either.
    const matches = k.replace(/\u0001/g, "") === "" ? undefined : byKey.get(k);
    if (matches) stepKeys.add(k);
    if (!matches) rows.push([...base, ...blank]);
    else for (const p of matches) rows.push([...base, ...partOut.map(i => p[i] ?? "")]);
  }
  let orphanParts = 0;
  for (const [k, ps] of byKey) if (!stepKeys.has(k)) orphanParts += ps.length;

  return {
    table: { header: [...stepOut.map(i => steps.header[i] ?? ""), ...partOut.map(i => parts.header[i] ?? "")], rows },
    orphanParts,
  };
}

/**
 * Export-format noise that must not count as a data difference. Different AMOS exports of the same
 * data differ in: thousands separators (1'797'490 vs 1797490), decimals (10.0 vs 10.00), NULL as
 * "" vs " ", and how line breaks / runs of spaces inside text are written. Values are compared
 * after canonicalising those; everything else (characters, markup, order of columns) must match.
 */
export function normalizeCell(v: string): string {
  const x = v.split(/\s+/).join(" ").trim();
  if (/^-?\d{1,3}(?:'\d{3})+(?:\.\d+)?$/.test(x)) return normalizeCell(x.replace(/'/g, ""));
  if (/^-?\d+\.\d+$/.test(x)) return String(Number(x));
  return x;
}

/** Order-insensitive comparison of two tables (same header, same multiset of rows). */
export function compareTables(a: Table, b: Table): string[] {
  const problems: string[] = [];
  if (a.header.join("|").toLowerCase() !== b.header.join("|").toLowerCase())
    problems.push(`Header differs:\n  ${a.header.join(",")}\n  ${b.header.join(",")}`);
  if (a.rows.length !== b.rows.length) problems.push(`Row count differs: ${a.rows.length} vs ${b.rows.length}`);
  const counts = new Map<string, number>();
  const key = (r: string[]) => JSON.stringify(r.map(normalizeCell));
  for (const r of a.rows) { const k = key(r); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let extra = 0;
  for (const r of b.rows) {
    const k = key(r);
    const n = counts.get(k) ?? 0;
    if (n === 0) extra++; else counts.set(k, n - 1);
  }
  const missing = [...counts.values()].reduce((x, y) => x + y, 0);
  if (extra || missing) problems.push(`Row content differs: ${missing} rows only in first, ${extra} only in second`);
  return problems;
}
