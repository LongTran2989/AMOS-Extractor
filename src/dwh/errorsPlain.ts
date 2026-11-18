// Task 2.3: turn relay, Oracle and runner errors into plain messages (plan A.9 table).
// `detail` keeps the technical text for whoever maintains the tool, with the .env values
// (server, user, password) removed.
import { ConfigMissing } from "./db.ts";
import { ConvertError } from "./convert/errors.ts";

const MESSAGES = {
  login: "The DWH did not accept the username or password saved on the host PC. Ask whoever set up the .env file to check them.",
  unreachable: "Can't reach the DWH server. Is the host PC on the company network or VPN?",
  timeout: "The DWH took longer than 2 minutes. Try fewer workpacks or a shorter date range, or try again later.",
  noTable: (t: string) => `The DWH has no table called ${t}. It may not have been copied to the DWH yet.`,
  noColumn: (c: string) => `The DWH has no column called ${c}. It may have been renamed. Ask the host to refresh the DWH catalogue.`,
  longText: "A long-text column was used in a comparison or sort, which the DWH can't do.",
  stopped: "The query was stopped.",
  link: "The DWH's link to the Oracle database failed. Try again in a few minutes; if it keeps happening, tell the DWH administrator.",
  noEnv: "The host PC is not set up to reach the DWH yet (the settings file is missing).",
  other: "Something went wrong. The details below can help whoever maintains this tool.",
} as const;

const LINK_ORA = new Set(["ORA-12170", "ORA-12541", "ORA-03113", "ORA-03135"]);
const LINK_RELAY_NUMBERS = new Set([7399, 7303, 7330]);

interface ErrLike {
  name?: string;
  code?: string;
  number?: number;
  message?: string;
  originalError?: ErrLike;
  precedingErrors?: ErrLike[];
}

/** Every message and number in an error and the errors it wraps. */
function flatten(e: ErrLike | undefined, out: ErrLike[] = [], depth = 0): ErrLike[] {
  if (!e || typeof e !== "object" || depth > 5) return out;
  out.push(e);
  flatten(e.originalError, out, depth + 1);
  for (const p of e.precedingErrors ?? []) flatten(p, out, depth + 1);
  return out;
}

function scrub(text: string, env: NodeJS.ProcessEnv): string {
  let out = text;
  for (const name of ["DWH_PASSWORD", "DWH_USER", "DWH_SERVER"]) {
    const v = env[name];
    if (v && v.length >= 2) out = out.split(v).join(`<${name}>`);
  }
  return out;
}

const unquote = (s: string) => s.replace(/"/g, "");

export function toPlain(err: unknown, env: NodeJS.ProcessEnv = process.env): { message: string; detail: string } {
  const all = flatten(err as ErrLike);
  const text = all.map((e) => e.message ?? "").join("\n");
  const codes = all.map((e) => e.code).filter(Boolean) as string[];
  const numbers = all.map((e) => e.number).filter((n): n is number => typeof n === "number");
  const top = (err ?? {}) as ErrLike;
  const detailParts = [
    top.name && top.code ? `${top.name} ${top.code}` : (top.name ?? ""),
    numbers.length ? `numbers: ${[...new Set(numbers)].join(", ")}` : "",
    text,
  ].filter(Boolean);
  const detail = scrub(detailParts.join("\n"), env);
  const plain = (message: string) => ({ message: scrub(message, env), detail });

  if (err instanceof ConfigMissing) return plain(MESSAGES.noEnv);
  if (err instanceof ConvertError) return plain(err.code === "E_STOPPED" ? MESSAGES.stopped : err.plain);

  const ora = [...text.matchAll(/ORA-\d{5}/g)].map((m) => m[0]);
  if (ora.includes("ORA-01013") || codes.includes("ECANCEL")) return plain(MESSAGES.stopped);
  if (ora.includes("ORA-00942")) {
    const named = /ORA-00942: table or view ((?:"[^"]+"\.)?"([^"]+)")/.exec(text);
    return plain(MESSAGES.noTable(named ? unquote(named[2]!) : "(one of the tables this query uses)"));
  }
  if (ora.includes("ORA-00904")) {
    const named = /ORA-00904: ((?:"[^"]+"\.)?"[^"]+")/.exec(text);
    return plain(MESSAGES.noColumn(named ? unquote(named[1]!) : "(one of the columns this query uses)"));
  }
  if (ora.includes("ORA-00932")) return plain(MESSAGES.longText);
  if (ora.some((o) => LINK_ORA.has(o))) return plain(MESSAGES.link);

  if (numbers.includes(18456) || codes.includes("ELOGIN")) return plain(MESSAGES.login);
  if (top.name === "ConnectionError" && (codes.includes("ESOCKET") || codes.includes("ETIMEOUT"))) return plain(MESSAGES.unreachable);
  if (codes.includes("ESOCKET")) return plain(MESSAGES.unreachable);
  if (top.name === "RequestError" && codes.includes("ETIMEOUT")) return plain(MESSAGES.timeout);
  if (numbers.some((n) => LINK_RELAY_NUMBERS.has(n))) return plain(MESSAGES.link);
  return plain(MESSAGES.other);
}
