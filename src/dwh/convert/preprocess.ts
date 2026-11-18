// A.4 step 1: normalise line ends, blank out comments, swap placeholders for sentinels,
// and refuse PostgreSQL string forms the converter does not translate.
import { lex, type Token } from "../lex.ts";
import { ConvertError, locAt } from "./errors.ts";

const PLACEHOLDER = /<([A-Z0-9_]+)>/g;
export const DEFAULT_MARKER = "__PH_";

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** "__PH_", or "__PH1_", "__PH2_", … when the source already contains the shorter one. */
function pickMarker(text: string): string {
  if (!text.includes(DEFAULT_MARKER)) return DEFAULT_MARKER;
  for (let n = 1; ; n++) if (!text.includes(`__PH${n}_`)) return `__PH${n}_`;
}

export function preprocess(source: string): { sql: string; placeholders: string[]; marker: string } {
  const text = source.replace(/\r\n?/g, "\n");
  const tokens = lex(text, "pg");
  const placeholders: string[] = [];
  const marker = pickMarker(text);
  const out: string[] = [];

  const next = (i: number): Token | undefined => {
    for (let j = i + 1; j < tokens.length; j++) if (tokens[j]!.kind !== "space" && tokens[j]!.kind !== "comment") return tokens[j];
    return undefined;
  };
  const adjacent = (a: Token, b: Token | undefined) => !!b && a.offset + a.text.length === b.offset;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const after = tokens[i + 1];
    if (t.kind === "comment") {
      out.push(blank(t.text));
      continue;
    }
    if (t.kind === "word" && /^[EeUu]$/.test(t.text)) {
      const isE = /^[Ee]$/.test(t.text) && after?.kind === "string" && adjacent(t, after);
      const isU = /^[Uu]$/.test(t.text) && after?.kind === "symbol" && after.text === "&" && adjacent(t, after);
      if (isE || isU) {
        throw new ConvertError(
          "E_UNSUPPORTED",
          `PostgreSQL ${isE ? "E'…' escape strings" : "U&'…' Unicode strings"} are not supported. Write the text as a plain '…' string.`,
          "",
          locAt(text, t.offset),
        );
      }
    }
    if (t.kind === "symbol" && t.text === "$") {
      throw new ConvertError("E_UNSUPPORTED", "PostgreSQL $$…$$ (dollar) quoting is not supported. Write the text as a plain '…' string.", "", locAt(text, t.offset));
    }
    if (t.kind === "symbol" && t.text === "<") {
      const name = tokens[i + 1];
      const close = tokens[i + 2];
      if (
        name && close && adjacent(t, name) && adjacent(name, close) &&
        (name.kind === "word" || name.kind === "number") && /^[A-Z0-9_]+$/.test(name.text) &&
        close.kind === "symbol" && close.text === ">"
      ) {
        throw new ConvertError(
          "E_PLACEHOLDER",
          `The placeholder <${name.text}> must be inside quotes, e.g. '<${name.text}>'.`,
          "",
          locAt(text, t.offset),
        );
      }
    }
    if (t.kind === "string") {
      // AMOS keeps a backslash literally (standard_conforming_strings); node-sql-parser would decode \t, \n, \\.
      if (t.text.includes("\\")) {
        throw new ConvertError("E_UNSUPPORTED", "Text in quotes that contains a backslash (\\) is not supported: it would not be read exactly as AMOS reads it.", "", locAt(text, t.offset));
      }
      out.push(
        t.text.replace(PLACEHOLDER, (_m, name: string) => {
          if (!placeholders.includes(name)) placeholders.push(name);
          return `${marker}${name}__`;
        }),
      );
      continue;
    }
    // INTERVAL 'n' WEEK is not valid PostgreSQL (AMOS refuses it), and node-sql-parser would
    // silently drop the WEEK unit; INTERVAL 'n week' is valid and converted.
    if (t.kind === "word" && t.text.toUpperCase() === "INTERVAL") {
      const str = next(i);
      const strIdx = str ? tokens.indexOf(str) : -1;
      const unit = strIdx >= 0 ? next(strIdx) : undefined;
      if (str?.kind === "string" && unit?.kind === "word" && /^WEEKS?$/i.test(unit.text)) {
        const n = str.text.slice(1, -1).trim();
        throw new ConvertError(
          "E_UNSUPPORTED",
          `INTERVAL '${n}' WEEK is not valid PostgreSQL. Write INTERVAL '${n} week' instead.`,
          "",
          locAt(text, t.offset),
        );
      }
    }
    out.push(t.text);
  }
  return { sql: out.join(""), placeholders, marker };
}

/** Puts the original <NAME> text back where the sentinels (marker + NAME + "__") are. */
export function restorePlaceholders(text: string, placeholders: string[], marker = DEFAULT_MARKER): string {
  if (!placeholders.length) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = [...placeholders].sort((a, b) => b.length - a.length).map(esc).join("|");
  return text.replace(new RegExp(`${esc(marker)}(${names})__`, "g"), (_m, name: string) => `<${name}>`);
}
