import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlain } from "../../src/dwh/errorsPlain.ts";
import { ConfigMissing } from "../../src/dwh/db.ts";
import { ConvertError } from "../../src/dwh/convert/errors.ts";

const ENV = { DWH_SERVER: "relay-host-17", DWH_USER: "dwh_reader_x", DWH_PASSWORD: "Pa55-w0rd!" } as NodeJS.ProcessEnv;
const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? "")), props);
/** A relay error the way mssql reports it: the ORA- text in a preceding message. */
const relay = (number: number, ora: string) =>
  err({
    name: "RequestError",
    code: "EREQUEST",
    number,
    message: `Cannot execute the query "SELECT ..." against OLE DB provider "OraOLEDB.Oracle" for linked server "DWH_DB".`,
    precedingErrors: [err({ name: "RequestError", number: 7412, message: `OLE DB provider "OraOLEDB.Oracle" for linked server "DWH_DB" returned message "${ora}".` })],
  });

test("relay login failed (18456)", () => {
  const p = toPlain(err({ name: "ConnectionError", code: "ELOGIN", message: "Login failed for user 'dwh_reader_x'.", originalError: err({ number: 18456 }) }), ENV);
  assert.match(p.message, /did not accept the username or password/);
});

test("cannot reach the relay (ESOCKET, connect ETIMEOUT)", () => {
  for (const code of ["ESOCKET", "ETIMEOUT"]) {
    const p = toPlain(err({ name: "ConnectionError", code, message: "Failed to connect to relay-host-17:1433 in 15000ms" }), ENV);
    assert.match(p.message, /Can't reach the DWH server/, code);
  }
});

test("request timeout", () => {
  const p = toPlain(err({ name: "RequestError", code: "ETIMEOUT", message: "Timeout: Request failed to complete in 120000ms" }), ENV);
  assert.match(p.message, /took longer than/);
});

test("ORA-00942 inside a 7320 relay error names the table when Oracle names it", () => {
  const named = toPlain(relay(7320, `ORA-00942: table or view "STG_AMOS"."WP_STATUS" does not exist`), ENV);
  assert.equal(named.message, "The DWH has no table called WP_STATUS. It may not have been copied to the DWH yet.");
  const unnamed = toPlain(relay(7320, "ORA-00942: table or view does not exist"), ENV);
  assert.match(unnamed.message, /^The DWH has no table called \(one of the tables this query uses\)\./);
});

test("ORA-00904 names the column", () => {
  const p = toPlain(relay(7320, `ORA-00904: "WO_HEADER"."STATE_X": invalid identifier`), ENV);
  assert.equal(p.message, "The DWH has no column called WO_HEADER.STATE_X. It may have been renamed. Ask the host to refresh the DWH catalogue.");
});

test("ORA-00932 is the long-text message", () => {
  assert.match(toPlain(relay(7320, "ORA-00932: inconsistent datatypes: expected - got CLOB"), ENV).message, /long-text column/);
});

test("ORA-01013 and a cancelled request mean the query was stopped", () => {
  assert.equal(toPlain(relay(7320, "ORA-01013: user requested cancel of current operation"), ENV).message, "The query was stopped.");
  assert.equal(toPlain(err({ name: "RequestError", code: "ECANCEL", message: "Canceled." }), ENV).message, "The query was stopped.");
  assert.equal(toPlain(new ConvertError("E_STOPPED", "The query was stopped."), ENV).message, "The query was stopped.");
});

test("Oracle network errors and other relay link errors mean the link failed", () => {
  for (const ora of ["ORA-12170: TNS:Connect timeout occurred", "ORA-12541: TNS:no listener", "ORA-03113: end-of-file on communication channel", "ORA-03135: connection lost contact"]) {
    assert.match(toPlain(relay(7399, ora), ENV).message, /link to the Oracle database failed/, ora);
  }
  for (const number of [7399, 7303, 7330]) {
    assert.match(toPlain(err({ name: "RequestError", code: "EREQUEST", number, message: "The OLE DB provider reported an error." }), ENV).message, /link to the Oracle database failed/, String(number));
  }
});

test(".env missing", () => {
  assert.equal(toPlain(new ConfigMissing("DWH_SERVER"), ENV).message, "The host PC is not set up to reach the DWH yet (the settings file is missing).");
});

test("converter and runner refusals keep their own plain message", () => {
  const p = toPlain(new ConvertError("E_MISSING_IN_DWH", "This query is not available in the DWH: it needs WP_STATUS."), ENV);
  assert.equal(p.message, "This query is not available in the DWH: it needs WP_STATUS.");
});

test("anything else", () => {
  const p = toPlain(new TypeError("x is not a function"), ENV);
  assert.equal(p.message, "Something went wrong. The details below can help whoever maintains this tool.");
  assert.match(p.detail, /x is not a function/);
});

test("detail never contains the fake env values", () => {
  const leaky = err({
    name: "ConnectionError",
    code: "ELOGIN",
    message: "Login failed for user 'dwh_reader_x' on relay-host-17 (password Pa55-w0rd!).",
    originalError: err({ number: 18456, message: "Login failed for user 'dwh_reader_x'." }),
  });
  for (const e of [leaky, relay(7320, "ORA-00942: table or view does not exist at relay-host-17"), new Error("dwh_reader_x / Pa55-w0rd!")]) {
    const p = toPlain(e, ENV);
    for (const secret of Object.values(ENV)) {
      assert.ok(!p.detail.includes(secret!) && !p.message.includes(secret!), `${secret} leaked in ${p.detail}`);
    }
  }
});
