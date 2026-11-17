// A.4 step 1: normalise line ends, blank out comments, swap placeholders for sentinels,
// and refuse PostgreSQL string forms the converter does not translate.
import { lex, type Token } from "../lex.ts";
import { ConvertError, locAt } from "./errors.ts";

const PLACEHOLDER = /<([A-Z0-9_]+)>/g;
const SENTINEL = /__PH_([A-Z0-9_]+)__/g;
const INTERVAL_UNITS = /^(YEAR|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND)S?$/i;

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

export function preprocess(source: string): { sql: string; placeholders: string[] } {
  const text = source.replace(/\r\n?/g, "\n");
  const tokens = lex(text, "pg");
  const placeholders: string[] = [];
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
      out.push(
        t.text.replace(PLACEHOLDER, (_m, name: string) => {
          if (!placeholders.includes(name)) placeholders.push(name);
          return `__PH_${name}__`;
        }),
      );
      continue;
    }
    // INTERVAL 'n' WEEK: node-sql-parser drops the WEEK unit, so keep it inside the string.
    if (t.kind === "word" && t.text.toUpperCase() === "INTERVAL") {
      const str = next(i);
      const strIdx = str ? tokens.indexOf(str) : -1;
      const unit = strIdx >= 0 ? next(strIdx) : undefined;
      if (str?.kind === "string" && unit?.kind === "word" && /^WEEKS?$/i.test(unit.text) && INTERVAL_UNITS.test(unit.text)) {
        const unitIdx = tokens.indexOf(unit);
        out.push(t.text, " ", `${str.text.slice(0, -1)} week'`);
        i = unitIdx;
        continue;
      }
    }
    out.push(t.text);
  }
  return { sql: out.join(""), placeholders };
}

/** Puts the original <NAME> text back where the sentinels are. */
export function restorePlaceholders(text: string, placeholders: string[]): string {
  return text.replace(SENTINEL, (m, name: string) => (placeholders.includes(name) ? `<${name}>` : m));
}
