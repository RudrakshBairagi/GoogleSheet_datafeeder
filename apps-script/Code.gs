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
  // For now, just reply "ok" so we can check the connection works.
  return ContentService.createTextOutput("ok");
}