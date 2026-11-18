import { test } from "node:test";
import assert from "node:assert/strict";
import { csvHeaderBytes, csvLine, formatCell } from "../../src/dwh/format.ts";

test("csv has BOM and round-trips Vietnamese", () => {
  assert.deepEqual([...csvHeaderBytes()], [0xef, 0xbb, 0xbf]);
  const line = csvLine(["Kiểm tra động cơ", 'say "hi"', ""]);
  assert.equal(line, '"Kiểm tra động cơ","say ""hi""",""\r\n');
  const bytes = Buffer.concat([csvHeaderBytes(), Buffer.from(line, "utf8")]);
  assert.equal(bytes.subarray(3).toString("utf8"), line);
});

test("date-typed column prints YYYY-MM-DD even though the relay returns a datetime", () => {
  const before = process.env.TZ;
  process.env.TZ = "Asia/Ho_Chi_Minh";
  try {
    // The relay returns datetime2; mssql (useUTC) gives a Date at UTC midnight.
    assert.equal(formatCell(new Date(Date.UTC(2026, 10, 17)), "date"), "2026-11-17");
    assert.equal(formatCell(new Date(Date.UTC(1971, 11, 31)), "date"), "1971-12-31");
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("int column from a NUMBER prints without decimals (#85)", () => {
  assert.equal(formatCell(4430989, "int"), "4430989");
  assert.equal(formatCell(4430989.0, "int"), "4430989");
  assert.equal(formatCell(-3, "int"), "-3");
  assert.equal(formatCell(1e21, "int"), "1000000000000000000000");
  // A non-whole value in an int column is shown as it is, never rounded away.
  assert.equal(formatCell(2.5, "int"), "2.5");
});

test("timestamp prints YYYY-MM-DD HH:MM:SS", () => {
  assert.equal(formatCell(new Date(Date.UTC(2026, 10, 17, 9, 5, 7, 450)), "timestamp"), "2026-11-17 09:05:07");
});

test("NULL is an empty cell; text and numbers print as they are", () => {
  assert.equal(formatCell(null, "text"), "");
  assert.equal(formatCell(undefined, "int"), "");
  assert.equal(formatCell("BÌNH XỊT", "text"), "BÌNH XỊT");
  assert.equal(formatCell(0.1, "float"), "0.1");
  assert.equal(formatCell(12.5, "numeric"), "12.5");
  assert.equal(formatCell(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), "unknown"), "2026-01-02 03:04:05");
});
