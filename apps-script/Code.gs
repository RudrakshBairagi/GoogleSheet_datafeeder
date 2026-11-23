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
 * @param {Object} e - Information about the request (we'll use it later).
 * @returns {TextOutput} The reply sent back to whoever made the request.
 */
function doPost(e) {
  // Reply with JSON so the caller can check whether it worked.
  return json({ ok: true });
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