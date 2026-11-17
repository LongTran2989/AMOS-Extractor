// A stand-in for an mssql pool and its streaming requests (no network). Each request plays a
// script of columns and rows chosen from the T-SQL text it is sent.
import { EventEmitter } from "node:events";
import type { RelayPool } from "../../src/dwh/run.ts";

export interface Script {
  columns: string[];
  rows: unknown[][];
  fail?: Error;
  /** Send the columns and rows first, then fail (a connection lost mid-download). */
  failAfterRows?: boolean;
}

export class FakeRequest extends EventEmitter {
  stream = false;
  arrayRowMode = false;
  inputs: { name: string; value: unknown }[] = [];
  sent?: string;
  cancelled = false;
  private pick: (tsql: string) => Script;
  constructor(pick: (tsql: string) => Script) {
    super();
    this.pick = pick;
  }
  input(name: string, _type: unknown, value: unknown) {
    this.inputs.push({ name, value });
    return this;
  }
  query(tsql: string, _cb?: unknown) {
    this.sent = tsql;
    const s = this.pick(tsql);
    setImmediate(() => void this.play(s));
  }
  cancel() {
    this.cancelled = true;
    return true;
  }
  pause() {}
  resume() {}
  private async play(s: Script) {
    if (s.fail && !s.failAfterRows) {
      this.emit("error", s.fail);
      this.emit("done", {});
      return;
    }
    this.emit("recordset", s.columns.map((name, index) => ({ index, name })));
    for (const r of s.rows) {
      if (this.cancelled) break;
      this.emit("row", r);
      await new Promise((res) => setImmediate(res));
    }
    if (this.cancelled) this.emit("error", Object.assign(new Error("Canceled."), { code: "ECANCEL" }));
    else if (s.fail) this.emit("error", s.fail);
    this.emit("done", {});
  }
}

export type FakePool = RelayPool & { made: FakeRequest[] };

export function scriptedPool(pick: (tsql: string) => Script): FakePool {
  const made: FakeRequest[] = [];
  return {
    made,
    request: () => {
      const r = new FakeRequest(pick);
      made.push(r);
      return r;
    },
  };
}

export function fakePool(columns: string[], rows: unknown[][], fail?: Error): FakePool {
  return scriptedPool(() => (fail ? { columns, rows, fail } : { columns, rows }));
}

export const neverPool: RelayPool = {
  request: () => {
    throw new Error("the pool must not be used");
  },
};
