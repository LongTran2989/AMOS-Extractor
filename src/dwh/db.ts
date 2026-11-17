// Task 2.1: connection settings for the SQL Server relay (plan A.8 #5). Credentials come only
// from the environment (node --env-file=.env); they are never printed, logged or returned.
import sql from "mssql";
import type { RelayPool } from "./run.ts";

export const PREVIEW_TIMEOUT_MS = 120_000;
export const EXPORT_TIMEOUT_MS = 900_000;

/** A required setting is missing. Names the variable, never any value. */
export class ConfigMissing extends Error {
  variable: string;
  constructor(variable: string) {
    super(`The setting ${variable} is missing from the .env file on the host PC.`);
    this.name = "ConfigMissing";
    this.variable = variable;
  }
}

export function dwhConfigFromEnv(env: NodeJS.ProcessEnv): sql.config {
  const need = (name: string): string => {
    const v = env[name];
    if (typeof v !== "string" || v.trim() === "") throw new ConfigMissing(name);
    return v;
  };
  const server = need("DWH_SERVER");
  const user = need("DWH_USER");
  const password = need("DWH_PASSWORD");
  return {
    server,
    user,
    password,
    connectionTimeout: 15_000,
    requestTimeout: PREVIEW_TIMEOUT_MS,
    pool: { max: 4, min: 0 },
    options: {
      trustServerCertificate: true,
      readOnlyIntent: true,
      appName: "amos-dwh-runner",
      useUTC: true,
    },
  };
}

/** Opens a connection pool to the relay. */
export async function openPool(config: sql.config): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool(config).connect();
}

/**
 * Sends one already-built relay statement and collects every row (for small fixed reads: the
 * catalogue and the zero-row compile check). Callers build `tsql` with buildRelayStatement or a
 * fixed template; this function adds nothing to it.
 */
export function runRelay(
  pool: RelayPool,
  tsql: string,
  inputs: { name: string; value: string; maxLength: number }[] = [],
  timeoutMs = PREVIEW_TIMEOUT_MS,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  return new Promise((resolve, reject) => {
    const req = pool.request({ requestTimeout: timeoutMs });
    req.stream = true;
    req.arrayRowMode = true;
    for (const i of inputs) req.input(i.name, sql.NVarChar(i.maxLength), i.value);
    let columns: string[] = [];
    const rows: unknown[][] = [];
    let failure: unknown;
    req.on("recordset", (cols: { name: string }[]) => {
      const list: { name: string }[] = Array.isArray(cols) ? cols : (Object.values(cols ?? {}) as { name: string }[]);
      columns = list.map((c) => c.name);
    });
    req.on("row", (r: unknown[]) => rows.push(r));
    req.on("error", (e: unknown) => (failure ??= e));
    req.on("done", () => (failure ? reject(failure) : resolve({ columns, rows })));
    req.query(tsql, () => {});
  });
}
