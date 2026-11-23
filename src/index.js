/**
 * sheet-feeder: send rows of data to a Google Sheet.
 *
 * Usage:
 *   import { sheetFeeder } from "sheet-feeder";
 *   const sheet = sheetFeeder(process.env.SHEET_URL, { secret: process.env.SHEET_SECRET });
 *   await sheet.append({ name: "Asha", email: "asha@example.com" });
 */

import { SheetFeederError } from "./errors.js";

export { SheetFeederError, ERROR_MESSAGES } from "./errors.js";

/** Settings used when the caller doesn't choose their own. */
const DEFAULTS = {
  sheet: undefined, // tab name; undefined means "the first tab"
  batchSize: 1, // send as soon as this many rows are waiting (1 = send every append right away)
  flushInterval: 0, // also send waiting rows every N milliseconds (0 = off)
  timeout: 15000, // give up on one request after 15 seconds
  retries: 3, // how many times to retry a failed request
  retryDelay: 1000, // wait before the first retry (doubles each time: 1s, 2s, 4s)
  allowFormulas: false, // let text starting with "=" run as a formula in the sheet
  onError: (error) => console.error(`[sheet-feeder] ${error.message}`),
};

/**
 * Creates a feeder connected to one Apps Script web app.
 *
 * @param {string} url - The web app URL (ends in /exec).
 * @param {Object} options - See the README for every option.
 * @param {string} options.secret - Must match the SECRET script property.
 * @returns {{ append: Function, flush: Function, close: Function, ping: Function }}
 */
export function sheetFeeder(url, options = {}) {
  checkUrl(url);
  const settings = { ...DEFAULTS, ...options };
  checkSettings(settings);

  // Tests can pass their own fetch; normally we use Node's built-in one
  const fetchFn = settings.fetch ?? globalThis.fetch;

  let batch = createBatch(); // rows waiting to be sent
  let timer = null; // the flushInterval timer, when one is running
  let queue = Promise.resolve(); // batches are sent one after another, in order
  let closed = false;

  /**
   * Adds one row, or a list of rows.
   * Resolves when the rows have been written to the sheet.
   *
   * @param {Array|Object|Array<Array|Object>} rows
   * @returns {Promise<{ added: number, sheet?: string }>}
   */
  function append(rows) {
    if (closed) {
      return Promise.reject(new SheetFeederError("closed"));
    }

    let list;
    try {
      list = normalizeRows(rows);
    } catch (error) {
      return Promise.reject(error);
    }

    if (list.length === 0) {
      return Promise.resolve({ added: 0 });
    }

    // Add the rows to the current batch, and remember which batch they're in
    const current = batch;
    current.rows.push(...list);

    if (current.rows.length >= settings.batchSize) {
      // The batch is full: send it now
      flush();
    } else if (settings.flushInterval > 0 && timer === null) {
      // Not full yet: send it after flushInterval, whatever happens
      timer = setTimeout(flush, settings.flushInterval);
    }

    return current.promise;
  }

  /**
   * Sends every waiting row now.
   * Resolves when they (and any batch already being sent) are written.
   *
   * @returns {Promise<{ added: number, sheet?: string }>}
   */
  function flush() {
    stopTimer();

    const current = batch;
    if (current.rows.length === 0) {
      // Nothing waiting, but wait for any batch that's still being sent
      return queue.then(() => ({ added: 0 }));
    }

    // Start a fresh batch for rows appended from now on
    batch = createBatch();

    // Send this batch after the previous one finishes, so rows stay in order
    queue = queue.then(async () => {
      try {
        current.resolve(await sendRows(current.rows));
      } catch (error) {
        current.reject(error);
        reportError(error);
      }
    });

    return current.promise;
  }

  /**
   * Sends any waiting rows, then stops accepting new ones.
   * Call this before your program exits so no rows are lost.
   *
   * @returns {Promise<{ added: number, sheet?: string }>}
   */
  function close() {
    closed = true;
    return flush();
  }

  /**
   * Checks the web app is deployed and reachable (no secret needed).
   *
   * @returns {Promise<{ ok: true, name: string, version: string }>}
   */
  function ping() {
    return withRetries(() => request("GET"));
  }

  /** Sends one batch of rows, retrying if it fails for a temporary reason. */
  async function sendRows(rows) {
    const payload = { secret: settings.secret, rows };
    if (settings.sheet !== undefined) payload.sheet = settings.sheet;
    if (settings.allowFormulas) payload.allowFormulas = true;

    const reply = await withRetries(() => request("POST", payload));
    return { added: reply.added, sheet: reply.sheet };
  }

  /**
   * Runs a task, and runs it again if it fails with a retryable error.
   * Waits retryDelay, then twice as long each time (1s, 2s, 4s...).
   * This is called "exponential backoff".
   */
  async function withRetries(task) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        const canRetry =
          error instanceof SheetFeederError && error.retryable && attempt < settings.retries;
        if (!canRetry) throw error;
        await sleep(settings.retryDelay * 2 ** attempt);
      }
    }
  }

  /**
   * Makes one HTTP request to the web app and checks the reply.
   *
   * Google answers web app requests with a redirect to a second URL that
   * holds the reply. fetch follows it automatically (redirect: "follow").
   */
  async function request(method, payload) {
    // AbortController lets us cancel the request if it takes too long
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), settings.timeout);

    let response;
    let text;
    try {
      response = await fetchFn(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        // text/plain is the content type Apps Script accepts most reliably
        headers: payload ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      text = await response.text();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new SheetFeederError("timeout", { retryable: true, cause: error });
      }
      throw new SheetFeederError("network_error", { retryable: true, cause: error });
    } finally {
      clearTimeout(timeoutId);
    }

    // HTTP-level problems
    const status = response.status;
    if (status === 429) {
      throw new SheetFeederError("rate_limited", { retryable: true, status });
    }
    if (status >= 500) {
      throw new SheetFeederError("server_error", { retryable: true, status });
    }
    if (!response.ok) {
      throw new SheetFeederError("http_error", { status });
    }

    // The reply must be our JSON. A Google sign-in or error page is HTML instead.
    let reply;
    try {
      reply = JSON.parse(text);
    } catch {
      throw new SheetFeederError("bad_response", { status });
    }
    if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
      throw new SheetFeederError("bad_response", { status });
    }

    // The script understood us but said no
    if (!reply.ok) {
      const code = typeof reply.error === "string" ? reply.error : "unknown_error";
      // "busy" means another request had the lock, so trying again can work
      throw new SheetFeederError(code, { retryable: code === "busy", status });
    }

    return reply;
  }

  function stopTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reportError(error) {
    try {
      settings.onError?.(error);
    } catch {
      // A broken onError callback must never crash the feeder
    }
  }

  return { append, flush, close, ping };
}

/**
 * Turns whatever the caller passed into a list of rows.
 *
 *   append(["Asha", 25])                  -> one row
 *   append({ name: "Asha" })              -> one row
 *   append([["Asha", 25], ["Ben", 30]])   -> two rows
 *   append([{ name: "Asha" }, ["Ben"]])   -> two rows
 */
function normalizeRows(rows) {
  if (isPlainObject(rows)) {
    return [rows];
  }
  if (!Array.isArray(rows)) {
    throw new TypeError("append() expects a row (list or object) or a list of rows");
  }

  const isRow = (item) => Array.isArray(item) || isPlainObject(item);

  // A list of rows: every item is itself a row
  if (rows.every(isRow)) {
    return rows;
  }
  // A single row of cells: no item is a row
  if (!rows.some(isRow)) {
    return [rows];
  }
  // A mix like [["a"], "b"] is probably a mistake
  throw new TypeError("append() got a list that mixes rows and single values");
}

/**
 * Creates an empty batch, plus a promise that settles when it's sent.
 * Everyone who appended to this batch waits on the same promise.
 */
function createBatch() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // If nobody awaits append(), a failed batch must not crash Node with an
  // "unhandled rejection". onError still reports it.
  promise.catch(() => {});
  return { rows: [], promise, resolve, reject };
}

function checkUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("sheetFeeder() needs the web app URL as its first argument");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("The web app URL must start with https://");
  }
}

function checkSettings(settings) {
  if (typeof settings.secret !== "string" || settings.secret === "") {
    throw new TypeError("sheetFeeder() needs options.secret (the SECRET from your Apps Script)");
  }
  checkNumber("batchSize", settings.batchSize, 1);
  checkNumber("flushInterval", settings.flushInterval, 0);
  checkNumber("timeout", settings.timeout, 1);
  checkNumber("retries", settings.retries, 0);
  checkNumber("retryDelay", settings.retryDelay, 0);
  if (settings.onError !== undefined && typeof settings.onError !== "function") {
    throw new TypeError("options.onError must be a function");
  }
}

function checkNumber(name, value, min) {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`options.${name} must be a whole number, ${min} or more`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
