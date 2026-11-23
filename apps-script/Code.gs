/**
 * sheet-feeder: Google Apps Script
 *
 * This script runs inside a Google Sheet. Once deployed as a web app,
 * it gets a URL that other programs can send data to.
 */

/**
 * Google calls this function automatically whenever someone
 * sends a POST request to the web app URL.
 *
 * Expected request body:
 *   {
 *     "secret": "your-secret",
 *     "sheet": "Orders",
 *     "rows": [ ["Asha", 25], ["Ben", 30] ]
 *   }
 *
 * "sheet" is optional. Without it, rows go into the first tab.
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

  // Step 4: find the tab to write into (or create it)
  const sheet = getTargetSheet(body.sheet);
  if (sheet === null) {
    return json({ ok: false, error: "invalid_sheet_name" });
  }

  // Step 5: write the rows
  const added = appendRows(sheet, rows);

  // Step 6: tell the caller how many rows were written, and where
  return json({ ok: true, added: added, sheet: sheet.getName() });
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

  // No name given: use the first tab, like before
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
 * Checks that rows looks like [ [...], [...], ... ].
 *
 * @param {*} rows - The value of body.rows.
 * @returns {boolean} true if rows is a list where every item is also a list.
 */
function isListOfRows(rows) {
  return Array.isArray(rows) && rows.every(function (row) {
    return Array.isArray(row);
  });
}

/**
 * Writes rows below the last row that has data in it.
 *
 * Google Sheets needs every row in one write to have the same number of
 * cells, so shorter rows are padded with empty cells first.
 *
 * @param {Sheet} sheet - The sheet tab to write into.
 * @param {Array<Array>} rows - The rows to write.
 * @returns {number} How many rows were written.
 */
function appendRows(sheet, rows) {
  // Find the longest row; that's how many columns we need
  const width = Math.max(0, ...rows.map(function (row) { return row.length; }));

  // Nothing to write (no rows, or only empty rows)
  if (width === 0) {
    return 0;
  }

  // Make every row the same length, e.g. ["Ben"] becomes ["Ben", ""]
  const grid = rows.map(function (row) {
    return padRow(row, width);
  });

  // getLastRow() is the last row with data, so we start one below it
  const startRow = sheet.getLastRow() + 1;

  // Select a block of cells: (startRow, column 1, how many rows, how many columns)
  const range = sheet.getRange(startRow, 1, grid.length, width);

  // Write all the values in one go (much faster than one cell at a time)
  range.setValues(grid);

  return grid.length;
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
    const isObject = typeof data === "object" && data !== null && !Array.isArray(data);
    return isObject ? data : null;
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
