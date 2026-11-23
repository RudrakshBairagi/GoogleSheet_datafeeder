/**
 * Tests for the npm package (src/index.js), using a fake web app server.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sheetFeeder, SheetFeederError } from "../src/index.js";
import { startMockServer } from "./helpers/mock-server.js";

const SECRET = "test-secret";
let server;

beforeEach(async () => {
  server = await startMockServer({ secret: SECRET });
});

afterEach(async () => {
  await server.close();
});

/** A feeder with fast retries, and errors collected instead of logged. */
function makeFeeder(options = {}) {
  const errors = [];
  const feeder = sheetFeeder(server.url, {
    secret: SECRET,
    retryDelay: 1,
    onError: (error) => errors.push(error),
    ...options,
  });
  return Object.assign(feeder, { errors });
}

// ---------- Creating a feeder ----------

test("needs a valid URL and a secret", () => {
  assert.throws(() => sheetFeeder("not a url", { secret: "x" }), TypeError);
  assert.throws(() => sheetFeeder("ftp://example.com", { secret: "x" }), TypeError);
  assert.throws(() => sheetFeeder(server.url, {}), TypeError);
  assert.throws(() => sheetFeeder(server.url, { secret: "x", batchSize: 0 }), TypeError);
  assert.throws(() => sheetFeeder(server.url, { secret: "x", onError: "nope" }), TypeError);
});

// ---------- append() ----------

test("append() sends rows and resolves with the result", async () => {
  const feeder = makeFeeder();
  const result = await feeder.append([["Asha", 25], ["Ben", 30]]);
  assert.deepEqual(result, { added: 2, sheet: "Sheet1" });
  assert.deepEqual(server.rows, [["Asha", 25], ["Ben", 30]]);
});

test("append() accepts a single list row or a single object row", async () => {
  const feeder = makeFeeder();
  await feeder.append(["Asha", 25]);
  await feeder.append({ name: "Ben" });
  assert.deepEqual(server.rows, [["Asha", 25], { name: "Ben" }]);
});

test("append() sends the secret, tab name and allowFormulas", async () => {
  const feeder = makeFeeder({ sheet: "Orders", allowFormulas: true });
  const result = await feeder.append(["#101"]);
  assert.equal(result.sheet, "Orders");
  assert.deepEqual(server.requests[0], {
    secret: SECRET,
    rows: [["#101"]],
    sheet: "Orders",
    allowFormulas: true,
  });
});

test("append() with an empty list sends nothing", async () => {
  const feeder = makeFeeder();
  assert.deepEqual(await feeder.append([]), { added: 0 });
  assert.equal(server.requests.length, 0);
});

test("append() rejects values that aren't rows", async () => {
  const feeder = makeFeeder();
  await assert.rejects(feeder.append("hello"), TypeError);
  await assert.rejects(feeder.append([["ok"], "mixed"]), TypeError);
});

// ---------- Errors ----------

test("a wrong secret fails with code 'unauthorized' and isn't retried", async () => {
  const feeder = sheetFeeder(server.url, { secret: "wrong", retryDelay: 1, onError: () => {} });
  await assert.rejects(feeder.append(["x"]), (error) => {
    assert.ok(error instanceof SheetFeederError);
    assert.equal(error.code, "unauthorized");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(server.requests.length, 1);
});

test("an HTML page instead of JSON fails with 'bad_response'", async () => {
  server.misbehave("html");
  const feeder = makeFeeder();
  await assert.rejects(feeder.append(["x"]), { code: "bad_response" });
});

test("a 404 fails with 'http_error' and isn't retried", async () => {
  server.misbehave("not_found", "not_found");
  const feeder = makeFeeder();
  await assert.rejects(feeder.append(["x"]), { code: "http_error", status: 404 });
});

test("a slow reply fails with 'timeout'", async () => {
  server.misbehave("slow");
  const feeder = makeFeeder({ timeout: 100, retries: 0 });
  await assert.rejects(feeder.append(["x"]), { code: "timeout" });
});

test("an unreachable URL fails with 'network_error'", async () => {
  const url = server.url;
  await server.close();
  const feeder = sheetFeeder(url, { secret: SECRET, retries: 0, onError: () => {} });
  await assert.rejects(feeder.append(["x"]), { code: "network_error" });
  server = await startMockServer({ secret: SECRET }); // so afterEach can close it
});

test("onError is called when a batch fails", async () => {
  const feeder = makeFeeder({ secret: "wrong" });
  await feeder.append(["x"]).catch(() => {});
  assert.equal(feeder.errors.length, 1);
  assert.equal(feeder.errors[0].code, "unauthorized");
});

// ---------- Retries ----------

test("retries server errors, then succeeds", async () => {
  server.misbehave("server_error", "rate_limited");
  const feeder = makeFeeder();
  const result = await feeder.append(["x"]);
  assert.equal(result.added, 1);
  assert.deepEqual(server.rows, [["x"]]);
});

test("retries 'busy' replies", async () => {
  server.misbehave("busy");
  const feeder = makeFeeder();
  assert.equal((await feeder.append(["x"])).added, 1);
});

test("gives up after the configured number of retries", async () => {
  server.misbehave("server_error", "server_error", "server_error");
  const feeder = makeFeeder({ retries: 2 });
  await assert.rejects(feeder.append(["x"]), { code: "server_error", status: 500 });
  assert.deepEqual(server.rows, []);
});

// ---------- Batching ----------

test("batchSize waits until enough rows are queued, then sends them together", async () => {
  const feeder = makeFeeder({ batchSize: 3 });
  const first = feeder.append(["a"]);
  const second = feeder.append(["b"]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(server.requests.length, 0, "nothing sent before the batch is full");

  const third = feeder.append(["c"]);
  const results = await Promise.all([first, second, third]);
  assert.equal(server.requests.length, 1, "one request for the whole batch");
  assert.deepEqual(server.rows, [["a"], ["b"], ["c"]]);
  assert.deepEqual(results[0], { added: 3, sheet: "Sheet1" });
});

test("flushInterval sends a partly full batch after a while", async () => {
  const feeder = makeFeeder({ batchSize: 100, flushInterval: 50 });
  const pending = feeder.append(["a"]);
  assert.equal(server.requests.length, 0);
  await pending;
  assert.deepEqual(server.rows, [["a"]]);
});

test("flush() sends waiting rows straight away", async () => {
  const feeder = makeFeeder({ batchSize: 100 });
  feeder.append(["a"]);
  feeder.append(["b"]);
  const result = await feeder.flush();
  assert.equal(result.added, 2);
  assert.equal(server.requests.length, 1);
});

test("flush() with nothing waiting resolves with 0", async () => {
  const feeder = makeFeeder();
  assert.deepEqual(await feeder.flush(), { added: 0 });
});

test("batches are sent in order", async () => {
  const feeder = makeFeeder({ batchSize: 2 });
  await Promise.all([
    feeder.append(["1"]),
    feeder.append(["2"]),
    feeder.append(["3"]),
    feeder.append(["4"]),
  ]);
  assert.deepEqual(server.rows, [["1"], ["2"], ["3"], ["4"]]);
});

test("close() sends waiting rows, then refuses new ones", async () => {
  const feeder = makeFeeder({ batchSize: 100 });
  feeder.append(["last"]);
  await feeder.close();
  assert.deepEqual(server.rows, [["last"]]);
  await assert.rejects(feeder.append(["too late"]), { code: "closed" });
});

test("a failed batch doesn't crash when nobody awaits append()", async () => {
  const feeder = makeFeeder({ secret: "wrong", batchSize: 1 });
  feeder.append(["fire and forget"]); // not awaited on purpose
  await feeder.flush();
  assert.equal(feeder.errors.length, 1);
});

// ---------- ping() ----------

test("ping() returns the script name and version", async () => {
  const feeder = makeFeeder();
  assert.deepEqual(await feeder.ping(), { ok: true, name: "sheet-feeder", version: "1.0.0" });
});
