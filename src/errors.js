/**
 * Error handling for sheet-feeder.
 *
 * Every problem is reported as a SheetFeederError with a short `code`
 * (easy for code to check) and a friendly `message` (easy for people to read).
 */

/**
 * A friendly explanation for every error code.
 * The CLI prints these, and they become each error's message.
 */
export const ERROR_MESSAGES = Object.freeze({
  // Errors sent back by the Apps Script
  invalid_json: "The web app couldn't read the request. This is probably a bug in sheet-feeder.",
  secret_not_configured:
    "The Apps Script has no secret yet. Add a script property named SECRET " +
    "(Apps Script editor → Project Settings → Script Properties).",
  unauthorized: "Wrong secret. It must match the SECRET script property in your Apps Script.",
  invalid_rows: "Rows must be a list of rows, where each row is a list of cells or an object.",
  invalid_sheet_name: "The sheet (tab) name must be text, 1 to 100 characters long.",
  busy: "The sheet was busy with other requests for too long. Try again.",

  // Errors found by the npm package itself
  timeout: "The web app took too long to reply.",
  network_error: "Couldn't reach the web app. Check your internet connection and the URL.",
  rate_limited: "Google is rate-limiting requests. Slow down or send rows in bigger batches.",
  server_error: "Google returned a server error. This is usually temporary.",
  http_error: "The web app returned an HTTP error. Check that the URL is correct and ends in /exec.",
  bad_response:
    "The URL didn't reply with sheet-feeder JSON. Check that the URL ends in /exec, " +
    'that "Who has access" is set to "Anyone", and that you deployed a new version after editing the script.',
  closed: "This feeder was closed with close(), so it can't accept more rows.",
});

/**
 * The error type thrown by sheet-feeder.
 *
 * Example:
 *   try { await sheet.append(row); }
 *   catch (error) { if (error.code === "unauthorized") { ... } }
 */
export class SheetFeederError extends Error {
  /**
   * @param {string} code - Short error code, e.g. "unauthorized".
   * @param {Object} [options]
   * @param {string} [options.message] - Custom message (defaults to ERROR_MESSAGES[code]).
   * @param {boolean} [options.retryable] - Whether trying again might work.
   * @param {number} [options.status] - The HTTP status code, if there was one.
   * @param {unknown} [options.cause] - The original error that caused this one.
   */
  constructor(code, options = {}) {
    const message = options.message ?? ERROR_MESSAGES[code] ?? `sheet-feeder error: ${code}`;
    super(message, { cause: options.cause });
    this.name = "SheetFeederError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
