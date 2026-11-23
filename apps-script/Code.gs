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
 *   { "rows": [ ["Asha", 25], ["Ben", 30] ] }
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

  // Step 2: check that "rows" is a list of rows
  const rows = body.rows;
  if (!isListOfRows(rows)) {
    return json({ ok: false, error: "invalid_rows" });
  }

  // Step 3: write the rows into the first tab of the spreadsheet
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const added = appendRows(sheet, rows);

  // Step 4: tell the caller how many rows were written
  return json({ ok: true, added: added });
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