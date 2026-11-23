/**
 * sheet-feeder: Google Apps Script
 *
 * This script runs inside a Google Sheet. Once deployed as a web app,
 * it gets a URL that other programs can send data to.
 *
 * Setup steps are in apps-script/README.md (or run: npx sheet-feeder init)
 */

// Reported by doGet, so the npm package can check which version is deployed
const VERSION = "1.0.0";

// How long a request waits (in milliseconds) for another request to finish writing
const LOCK_WAIT_MS = 10000;

/**
 * Google calls this function when someone sends a GET request to the URL.
 * It's a simple health check: "is the script deployed and reachable?"
 * It needs no secret because it doesn't read or write any data.
 *
 * @param {Object} e - Information about the request (not used).
 * @returns {TextOutput} {"ok":true,"name":"sheet-feeder","version":"1.0.0"}
 */
function doGet(e) {
  return json({ ok: true, name: "sheet-feeder", version: VERSION });
}

/**
 * Google calls this function automatically whenever someone
 * sends a POST request to the web app URL.
 *
 * Expected request body:
 *   {
 *     "secret": "your-secret",
 *     "sheet": "Orders",
 *     "rows": [ ["Asha", 25], { "name": "Ben", "age": 30 } ],
 *     "allowFormulas": false
 *   }
 *
 * "sheet" is optional. Without it, rows go into the first tab.
 * Each row can be a list of cells, or an object whose keys match the header row.
 * "allowFormulas" is optional. See cleanValue() for why it's off by default.
 *
 * @param {Object} e - Information about the request, including the data sent.
 * @returns {TextOutput} The reply sent back to whoever made the request.
 */
function doPost(e) {
  // Step 1: read the data that was sent and turn it into an object
  const body = parseBody(e);
  if (body === null) {
    return json({ ok: false, error: "invalid_json" });
  }

  // Step 2: make sure the caller knows the secret
  const secret = getSecret();
  if (!secret) {
    // The owner hasn't set a secret yet, so refuse everything to stay safe
    return json({ ok: false, error: "secret_not_configured" });
  }
  if (body.secret !== secret) {
    return json({ ok: false, error: "unauthorized" });
  }

  // Step 3: check that "rows" is a list of rows
  const rows = body.rows;
  if (!isListOfRows(rows)) {
    return json({ ok: false, error: "invalid_rows" });
  }

  // Step 4: wait for our turn, so two requests never write at the same time.
  // Without this, both could read the same "last row" and overwrite each other.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return json({ ok: false, error: "busy" });
  }

  try {
    // Step 5: find the tab to write into (or create it)
    const sheet = getTargetSheet(body.sheet);
    if (sheet === null) {
      return json({ ok: false, error: "invalid_sheet_name" });
    }

    // Step 6: turn object rows into lists of cells, using the header row
    const grid = toGrid(sheet, rows);

    // Step 7: write the rows
    const added = appendRows(sheet, grid, body.allowFormulas === true);

    // Step 8: tell the caller how many rows were written, and where
    return json({ ok: true, added: added, sheet: sheet.getName() });
  } finally {
    // "finally" always runs, even after a return or an error,
    // so the lock is never left stuck
    lock.releaseLock();
  }
}

/**
 * Reads the secret token from Script Properties.
 *
 * The secret is kept out of the code on purpose, so it never ends up
 * on GitHub. Set it in: Project Settings -> Script Properties -> SECRET
 *
 * @returns {string|null} The secret, or null if it hasn't been set.
 */
function getSecret() {
  return PropertiesService.getScriptProperties().getProperty("SECRET");
}

/**
 * Finds the sheet tab to write into.
 *
 *   - No name given     -> use the first tab
 *   - Tab exists        -> use it
 *   - Tab doesn't exist -> create it
 *   - Name is invalid   -> return null
 *
 * @param {*} name - The value of body.sheet (may be missing).
 * @returns {Sheet|null} The tab to use, or null if the name was invalid.
 */
function getTargetSheet(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  // No name given: use the first tab
  if (name === undefined) {
    return spreadsheet.getSheets()[0];
  }

  // A name must be text, not a number or list
  if (typeof name !== "string") {
    return null;
  }

  // Remove spaces from the start and end, e.g. "  Orders " becomes "Orders"
  const cleanName = name.trim();

  // Google Sheets tab names must be 1 to 100 characters long
  if (cleanName.length === 0 || cleanName.length > 100) {
    return null;
  }

  // Use the existing tab if there is one, otherwise create a new tab
  const existing = spreadsheet.getSheetByName(cleanName);
  return existing !== null ? existing : spreadsheet.insertSheet(cleanName);
}

/**
 * Checks that rows looks like [ row, row, ... ], where each row is
 * either a list of cells or an object.
 *
 * @param {*} rows - The value of body.rows.
 * @returns {boolean} true if rows has the right shape.
 */
function isListOfRows(rows) {
  return Array.isArray(rows) && rows.every(function (row) {
    return Array.isArray(row) || isPlainObject(row);
  });
}

/**
 * Checks for an object like { "name": "Asha" } (and not a list or null).
 *
 * @param {*} value - Anything.
 * @returns {boolean} true if value is a plain object.
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turns every row into a list of cells.
 *
 * Lists are kept as they are. Objects are matched to the header row (row 1):
 *   header row:  name | age
 *   object:      { "age": 30, "name": "Ben" }
 *   becomes:     ["Ben", 30]
 *
 * Keys that aren't in the header row yet are added as new columns.
 *
 * @param {Sheet} sheet - The sheet tab being written to.
 * @param {Array} rows - Rows as lists and/or objects.
 * @returns {Array<Array>} Every row as a list of cells.
 */
function toGrid(sheet, rows) {
  // Only lists? Nothing to convert.
  if (!rows.some(isPlainObject)) {
    return rows;
  }

  // Start from the existing headers, then add any keys we haven't seen
  const headers = readHeaders(sheet);
  const oldCount = headers.length;
  rows.forEach(function (row) {
    if (isPlainObject(row)) {
      Object.keys(row).forEach(function (key) {
        if (headers.indexOf(key) === -1) {
          headers.push(key);
        }
      });
    }
  });

  // Save the header row if it grew
  if (headers.length > oldCount) {
    const headerCells = headers.map(function (header) {
      return cleanValue(header, false);
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headerCells]);
  }

  // Put each object's values in header order; missing keys become empty cells
  return rows.map(function (row) {
    if (Array.isArray(row)) {
      return row;
    }
    return headers.map(function (header) {
      // hasOwnProperty skips built-in names like "constructor"
      return Object.prototype.hasOwnProperty.call(row, header) ? row[header] : "";
    });
  });
}

/**
 * Reads row 1 of the sheet as a list of header names.
 *
 * @param {Sheet} sheet - The sheet tab.
 * @returns {Array<string>} The headers, or [] if the sheet is empty.
 */
function readHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    return [];
  }
  const width = sheet.getLastColumn();
  const firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  return firstRow.map(function (cell) {
    return String(cell);
  });
}

/**
 * Writes rows below the last row that has data in it.
 *
 * Google Sheets needs every row in one write to have the same number of
 * cells, so shorter rows are padded with empty cells first.
 *
 * @param {Sheet} sheet - The sheet tab to write into.
 * @param {Array<Array>} grid - The rows to write, each a list of cells.
 * @param {boolean} allowFormulas - Whether text starting with "=" may run as a formula.
 * @returns {number} How many rows were written.
 */
function appendRows(sheet, grid, allowFormulas) {
  // Find the longest row; that's how many columns we need
  const width = grid.reduce(function (longest, row) {
    return Math.max(longest, row.length);
  }, 0);

  // Nothing to write (no rows, or only empty rows)
  if (width === 0) {
    return 0;
  }

  // Make every row the same length, and make every cell safe to write
  const cells = grid.map(function (row) {
    return padRow(row, width).map(function (value) {
      return cleanValue(value, allowFormulas);
    });
  });

  // getLastRow() is the last row with data, so we start one below it
  const startRow = sheet.getLastRow() + 1;

  // Select a block of cells: (startRow, column 1, how many rows, how many columns)
  // and write all the values in one go (much faster than one cell at a time)
  sheet.getRange(startRow, 1, cells.length, width).setValues(cells);

  return cells.length;
}

/**
 * Adds empty cells to the end of a row until it reaches the given width.
 *
 * Example: padRow(["Ben"], 3) returns ["Ben", "", ""]
 *
 * @param {Array} row - One row of values.
 * @param {number} width - How many cells the row should have.
 * @returns {Array} A new row with the right number of cells.
 */
function padRow(row, width) {
  const padded = row.slice(); // copy, so we don't change the original
  while (padded.length < width) {
    padded.push("");
  }
  return padded;
}

/**
 * Makes one value safe to put in a cell.
 *
 *   null / undefined -> empty cell
 *   object or list   -> its JSON text, e.g. {"a":1}
 *   "=SUM(A1:A3)"    -> stays as plain text, unless allowFormulas is true
 *
 * Why block formulas? If your app logs text typed by its users, someone could
 * type a formula like =IMPORTXML(...) that runs inside your sheet. Adding a '
 * in front tells Google Sheets "this is text, not a formula".
 *
 * @param {*} value - The value to write.
 * @param {boolean} allowFormulas - Whether formulas are allowed.
 * @returns {*} A value Google Sheets can store.
 */
function cleanValue(value, allowFormulas) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "string" && value.charAt(0) === "=" && !allowFormulas) {
    return "'" + value;
  }
  return value;
}

/**
 * Reads the request body and converts it from JSON text into an object.
 *
 * Returns null if:
 *   - nothing was sent
 *   - the text isn't valid JSON
 *   - the JSON isn't an object (for example a number or a list)
 *
 * @param {Object} e - The request information from doPost.
 * @returns {Object|null} The parsed object, or null if it was invalid.
 */
function parseBody(e) {
  // No request info, or no data in it (e.g. an empty request)
  if (!e || !e.postData || !e.postData.contents) {
    return null;
  }

  try {
    // Convert the JSON text into a JavaScript value
    const data = JSON.parse(e.postData.contents);

    // We only accept objects like { "rows": [...] }
    return isPlainObject(data) ? data : null;
  } catch (error) {
    // JSON.parse throws an error when the text isn't valid JSON
    return null;
  }
}

/**
 * Turns a JavaScript object into a JSON reply.
 *
 * Example: json({ ok: true }) sends back {"ok":true}
 *
 * @param {Object} data - Any object we want to send back.
 * @returns {TextOutput} A reply with the JSON content type set.
 */
function json(data) {
  // JSON.stringify turns { ok: true } into the text '{"ok":true}'
  const text = JSON.stringify(data);

  // createTextOutput builds the reply; setMimeType tells the caller it's JSON
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
