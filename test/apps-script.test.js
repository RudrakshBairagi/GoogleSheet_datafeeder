/**
 * Tests for apps-script/Code.gs, run with fake Google services.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox } from "./helpers/apps-script-sandbox.js";

const SECRET = "s3cret";

test("GET returns a health check", () => {
  const script = createSandbox();
  assert.deepEqual(script.get(), { ok: true, name: "sheet-feeder", version: "1.0.0" });
});

test("refuses everything when no secret is configured", () => {
  const script = createSandbox({ secret: null });
  assert.deepEqual(script.post({ rows: [["x"]] }), { ok: false, error: "secret_not_configured" });
});

test("rejects a body that isn't a JSON object", () => {
  const script = createSandbox();
  assert.equal(script.post("not json").error, "invalid_json");
  assert.equal(script.post("[1,2,3]").error, "invalid_json");
  assert.equal(script.post("").error, "invalid_json");
});

test("rejects a missing or wrong secret", () => {
  const script = createSandbox();
  assert.equal(script.post({ rows: [["x"]] }).error, "unauthorized");
  assert.equal(script.post({ secret: "wrong", rows: [["x"]] }).error, "unauthorized");
  assert.deepEqual(script.cells(), []);
});

test("rejects rows with the wrong shape", () => {
  const script = createSandbox();
  assert.equal(script.post({ secret: SECRET }).error, "invalid_rows");
  assert.equal(script.post({ secret: SECRET, rows: "oops" }).error, "invalid_rows");
  assert.equal(script.post({ secret: SECRET, rows: [["ok"], 42] }).error, "invalid_rows");
});

test("rejects invalid tab names", () => {
  const script = createSandbox();
  assert.equal(script.post({ secret: SECRET, sheet: 42, rows: [["x"]] }).error, "invalid_sheet_name");
  assert.equal(script.post({ secret: SECRET, sheet: "  ", rows: [["x"]] }).error, "invalid_sheet_name");
  assert.equal(
    script.post({ secret: SECRET, sheet: "x".repeat(101), rows: [["x"]] }).error,
    "invalid_sheet_name",
  );
});

test("appends list rows, padding short ones", () => {
  const script = createSandbox();
  const reply = script.post({ secret: SECRET, rows: [["Asha", 25, "Delhi"], ["Ben"]] });
  assert.deepEqual(reply, { ok: true, added: 2, sheet: "Sheet1" });
  assert.deepEqual(script.cells(), [
    ["Asha", 25, "Delhi"],
    ["Ben", "", ""],
  ]);
});

test("writes below existing rows", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [["first"]] });
  script.post({ secret: SECRET, rows: [["second"]] });
  assert.deepEqual(script.cells(), [["first"], ["second"]]);
});

test("an empty list adds nothing", () => {
  const script = createSandbox();
  assert.deepEqual(script.post({ secret: SECRET, rows: [] }), { ok: true, added: 0, sheet: "Sheet1" });
});

test("creates a tab once and reuses it, ignoring extra spaces", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, sheet: "Orders", rows: [["#101"]] });
  const reply = script.post({ secret: SECRET, sheet: "  Orders ", rows: [["#102"]] });
  assert.equal(reply.sheet, "Orders");
  assert.deepEqual(script.tabNames(), ["Sheet1", "Orders"]);
  assert.deepEqual(script.cells("Orders"), [["#101"], ["#102"]]);
});

test("object rows create headers and line up with them", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [{ name: "Asha", age: 25 }] });
  script.post({ secret: SECRET, rows: [{ age: 30, name: "Ben" }] });
  assert.deepEqual(script.cells(), [
    ["name", "age"],
    ["Asha", 25],
    ["Ben", 30],
  ]);
});

test("new keys add new header columns", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [{ name: "Asha" }] });
  script.post({ secret: SECRET, rows: [{ name: "Ben", city: "Pune" }] });
  assert.deepEqual(script.cells(), [
    ["name", "city"],
    ["Asha"],
    ["Ben", "Pune"],
  ]);
});

test("list rows and object rows can be mixed", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [{ name: "Asha", age: 25 }, ["raw", "row"]] });
  assert.deepEqual(script.cells(), [
    ["name", "age"],
    ["Asha", 25],
    ["raw", "row"],
  ]);
});

test("cleans values: empty values, nested objects, formulas", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [[null, { a: 1 }, [1, 2], "=SUM(1,2)", true]] });
  assert.deepEqual(script.cells(), [["", '{"a":1}', "[1,2]", "'=SUM(1,2)", true]]);
});

test("allowFormulas keeps formulas as formulas", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, allowFormulas: true, rows: [["=SUM(1,2)"]] });
  assert.deepEqual(script.cells(), [["=SUM(1,2)"]]);
});

test("built-in property names don't leak into cells", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [{ constructor: "x" }] });
  script.post({ secret: SECRET, rows: [{ other: "y" }] });
  assert.deepEqual(script.cells()[2], ["", "y"]);
});

test("replies busy when the lock can't be taken", () => {
  const script = createSandbox();
  script.lock.available = false;
  assert.deepEqual(script.post({ secret: SECRET, rows: [["x"]] }), { ok: false, error: "busy" });
  assert.deepEqual(script.cells(), []);
});

test("always releases the lock, even when the tab name is invalid", () => {
  const script = createSandbox();
  script.post({ secret: SECRET, rows: [["x"]] });
  script.post({ secret: SECRET, sheet: 42, rows: [["x"]] });
  assert.equal(script.lock.releases, 2);
});
