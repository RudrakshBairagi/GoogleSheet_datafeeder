/**
 * Google calls this function automatically whenever someone
 * sends a POST request to the web app URL.
 *
 * Expected request body:
 *   { "sheet": "Orders", "rows": [ ["Asha", 25], ["Ben", 30] ] }
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

  // Step 2: check that "rows" is a list of rows
  const rows = body.rows;
  if (!isListOfRows(rows)) {
    return json({ ok: false, error: "invalid_rows" });
  }

  // Step 3: find the tab to write into (or create it)
  const sheet = getTargetSheet(body.sheet);
  if (sheet === null) {
    return json({ ok: false, error: "invalid_sheet_name" });
  }

  // Step 4: write the rows
  const added = appendRows(sheet, rows);

  // Step 5: tell the caller how many rows were written, and where
  return json({ ok: true, added: added, sheet: sheet.getName() });
}