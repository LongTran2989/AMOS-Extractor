// Task 2.1: the two fixed relay statements (plan A.8 #3) and the preview cap (A.8 #6).
// The Oracle text goes to the relay inside an N'…' string (quotes doubled) so Vietnamese text
// survives; nothing else is ever sent.
import { lex, significant, type Token } from "./lex.ts";
import { ConvertError } from "./convert/errors.ts";
import { OPENQUERY_MAX_LENGTH } from "./convert/index.ts";

/** Values allowed in openquery mode, where they are written into the query text (A.5 #69). */
export const SAFE_VALUE = /^[A-Za-z0-9 ._/-]{1,100}$/;

const PLACEHOLDER = /<([A-Z0-9_]+)>/g;

export interface RelayParam {
  name: string;
  value: string;
  maxLength: number;
}

const quoteForRelay = (text: string) => text.replace(/'/g, "''");

/** Placeholder names used inside the string literals of an Oracle text. */
export function placeholdersIn(exec: string): string[] {
  const names: string[] = [];
  for (const t of lex(exec, "oracle")) {
    if (t.kind !== "string" && t.kind !== "nstring") continue;
    for (const m of t.text.matchAll(PLACEHOLDER)) if (!names.includes(m[1]!)) names.push(m[1]!);
  }
  return names;
}

export function buildRelayStatement(
  exec: string,
  mode: "exec_at" | "openquery",
  params: RelayParam[],
  linkedServer: string,
): { tsql: string; inputs: RelayParam[] } {
  if (!/^[A-Za-z0-9_]+$/.test(linkedServer)) throw new Error("The linked server name in dwh/mapping.yaml may only contain letters, digits and _.");
  const values = new Map<string, RelayParam>();
  for (const p of params) values.set(p.name, { ...p, value: p.value.trim() });
  const valueOf = (name: string): RelayParam => {
    const p = values.get(name);
    if (!p || p.value === "") throw new ConvertError("E_PARAM_MISSING", `Fill in a value for <${name}> before running the query.`);
    if (p.value.length > p.maxLength) {
      throw new ConvertError("E_UNSAFE_PARAM_VALUE", `The value for <${name}> is longer than ${p.maxLength} characters.`);
    }
    if (mode === "openquery" && !SAFE_VALUE.test(p.value)) {
      throw new ConvertError(
        "E_UNSAFE_PARAM_VALUE",
        `The value for <${name}> may only contain letters A-Z, digits, spaces and . _ / - (it was "${p.value}"). Other characters need RPC Out on the DWH link.`,
      );
    }
    return p;
  };

  const tokens: Token[] = lex(exec, "oracle");
  const inputs: RelayParam[] = [];
  const out: string[] = [];
  for (const t of tokens) {
    const isText = t.kind === "string" || t.kind === "nstring";
    if (!isText || !t.text.match(PLACEHOLDER)) {
      out.push(t.text);
      continue;
    }
    if (mode === "openquery") {
      out.push(t.text.replace(PLACEHOLDER, (_m, name: string) => valueOf(name).value));
      continue;
    }
    const whole = /^N?'<([A-Z0-9_]+)>'$/.exec(t.text);
    if (!whole) {
      throw new ConvertError("E_PLACEHOLDER", "A placeholder must be the whole quoted text ('<NAME>') to be sent as a parameter.", t.text);
    }
    const p = valueOf(whole[1]!);
    const name = `p${inputs.length + 1}`;
    inputs.push({ name, value: p.value, maxLength: p.maxLength });
    out.push("?");
  }
  const inner = quoteForRelay(out.join(""));
  if (mode === "openquery") {
    if (inner.length > OPENQUERY_MAX_LENGTH) {
      throw new ConvertError(
        "E_TOO_LONG",
        `With the values filled in, the DWH query is ${inner.length} characters long; the DWH link (OPENQUERY) accepts at most ${OPENQUERY_MAX_LENGTH}. Use shorter values or ask for RPC Out to be enabled.`,
      );
    }
    return { tsql: `SELECT * FROM OPENQUERY([${linkedServer}], N'${inner}')`, inputs: [] };
  }
  return { tsql: `EXEC (N'${inner}'${inputs.map((i) => `, @${i.name}`).join("")}) AT [${linkedServer}]`, inputs };
}

const word = (t: Token | undefined, w: string) => t?.kind === "word" && t.text.toUpperCase() === w;

/**
 * Limits the rows Oracle returns (A.8 #6): FETCH FIRST on Oracle 12c and later (lowering an
 * existing outer FETCH), else a ROWNUM wrapper, which cannot hold duplicate column names.
 */
export function applyPreviewCap(exec: string, version: number, cap: number, hasDuplicateNames: boolean): string {
  if (version < 12) return hasDuplicateNames ? exec : `SELECT * FROM (${exec}) WHERE ROWNUM <= ${cap}`;
  const sig = significant(lex(exec, "oracle"));
  const n = sig.length;
  const tail = (k: number) => sig[n - k];
  // ... FETCH FIRST|NEXT <n> ROWS ONLY at the very end belongs to the outer query.
  if (word(tail(1), "ONLY") && word(tail(2), "ROWS") && tail(3)?.kind === "number" && (word(tail(4), "FIRST") || word(tail(4), "NEXT")) && word(tail(5), "FETCH")) {
    const num = tail(3)!;
    if (Number(num.text) <= cap) return exec;
    return `${exec.slice(0, num.offset)}${cap}${exec.slice(num.offset + num.text.length)}`;
  }
  if (word(tail(1), "ROWS") && tail(2)?.kind === "number" && word(tail(3), "OFFSET")) return `${exec} FETCH NEXT ${cap} ROWS ONLY`;
  return `${exec} FETCH FIRST ${cap} ROWS ONLY`;
}
