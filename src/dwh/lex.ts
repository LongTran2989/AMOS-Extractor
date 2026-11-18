// Small SQL lexer shared by the pre-processor (PostgreSQL source) and the Oracle-text
// safety scan. It knows string literals ('' escapes), quoted identifiers ("" escapes),
// -- line comments and nested /* */ block comments, so callers can tell code from text.
import { ConvertError, locAt } from "./convert/errors.ts";

export type TokenKind = "word" | "string" | "nstring" | "quoted_ident" | "number" | "symbol" | "comment" | "space";

export interface Token {
  kind: TokenKind;
  text: string;
  offset: number;
}

const MULTI_SYMBOLS = ["->>", "::", "<=", ">=", "<>", "!=", "||", "->", "<<", ">>", "@>", "<@", "!~", "~*", "#>", "&&"];

const isWordStart = (c: string) => /[A-Za-z_\u0080-￿]/.test(c);
const isWordChar = (c: string) => /[A-Za-z0-9_$#\u0080-￿]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

function readQuoted(text: string, start: number, quote: string): number {
  // Returns the offset just after the closing quote; doubled quotes are escapes.
  let i = start + 1;
  for (;;) {
    if (i >= text.length) {
      const what = quote === "'" ? "text in quotes ('…')" : 'a quoted name ("…")';
      throw new ConvertError("E_PARSE", `The query has ${what} that is never closed.`, "", locAt(text, start));
    }
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
}

export function lex(text: string, dialect: "pg" | "oracle"): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const start = i;
    if (/\s/.test(c)) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      tokens.push({ kind: "space", text: text.slice(start, i), offset: start });
      continue;
    }
    if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      tokens.push({ kind: "comment", text: text.slice(start, i), offset: start });
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      let depth = 0;
      while (i < text.length) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      if (depth !== 0) throw new ConvertError("E_PARSE", "The query has a /* comment that is never closed.", "", locAt(text, start));
      tokens.push({ kind: "comment", text: text.slice(start, i), offset: start });
      continue;
    }
    if (c === "'") {
      i = readQuoted(text, i, "'");
      tokens.push({ kind: "string", text: text.slice(start, i), offset: start });
      continue;
    }
    if (dialect === "oracle" && (c === "N" || c === "n") && text[i + 1] === "'") {
      const prev = tokens[tokens.length - 1];
      if (!prev || prev.kind !== "word" || prev.offset + prev.text.length !== start) {
        i = readQuoted(text, i + 1, "'");
        tokens.push({ kind: "nstring", text: text.slice(start, i), offset: start });
        continue;
      }
    }
    if (c === '"') {
      i = readQuoted(text, i, '"');
      tokens.push({ kind: "quoted_ident", text: text.slice(start, i), offset: start });
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(text[i + 1] ?? ""))) {
      while (i < text.length && isDigit(text[i]!)) i++;
      if (text[i] === "." && isDigit(text[i + 1] ?? "")) {
        i++;
        while (i < text.length && isDigit(text[i]!)) i++;
      } else if (text[i] === "." && !isWordStart(text[i + 1] ?? "")) {
        i++; // "1." is a number
      }
      if ((text[i] === "e" || text[i] === "E") && /[0-9+-]/.test(text[i + 1] ?? "")) {
        i += 2;
        while (i < text.length && isDigit(text[i]!)) i++;
      }
      tokens.push({ kind: "number", text: text.slice(start, i), offset: start });
      continue;
    }
    if (isWordStart(c)) {
      while (i < text.length && isWordChar(text[i]!)) i++;
      tokens.push({ kind: "word", text: text.slice(start, i), offset: start });
      continue;
    }
    const multi = MULTI_SYMBOLS.find((s) => text.startsWith(s, i));
    const sym = multi ?? c;
    i += sym.length;
    tokens.push({ kind: "symbol", text: sym, offset: start });
  }
  return tokens;
}

/** Tokens that carry meaning (no spaces, no comments). */
export function significant(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.kind !== "space" && t.kind !== "comment");
}
