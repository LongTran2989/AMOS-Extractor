import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCatalogueSane, type Catalogue, type CatalogueColumn } from "../../src/dwh/catalogue.ts";

const col = (table: string, name = "ID"): CatalogueColumn => ({
  table, name, columnId: 1, dataType: "NUMBER", dataLength: 22, charLength: 0, precision: null, scale: null, nullable: true,
});
const cat = (tables: string[]): Catalogue => ({ takenAt: "2026-11-18T00:00:00Z", columns: tables.map((t) => col(t)) });

test("an empty catalogue read is refused", () => {
  assert.throws(() => assertCatalogueSane(cat([]), undefined), /no columns/);
  assert.throws(() => assertCatalogueSane(cat([]), cat(["A"])), /no columns/);
});

test("a read that loses more than half the tables of the current snapshot is refused", () => {
  const before = cat(["A", "B", "C", "D", "E"]);
  assert.throws(() => assertCatalogueSane(cat(["A", "B"]), before), /2 tables.*5/);
  assert.doesNotThrow(() => assertCatalogueSane(cat(["A", "B", "C"]), before));
  assert.doesNotThrow(() => assertCatalogueSane(cat(["A"]), undefined), "first snapshot: nothing to compare with");
});
