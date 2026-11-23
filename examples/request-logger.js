/**
 * Example: log every request to a web server into a Google Sheet.
 *
 * Rows are batched: they're sent 20 at a time, or every 5 seconds,
 * whichever comes first. That keeps the server fast and stays well
 * within Google's limits.
 *
 * Run it:
 *   node --env-file=.env examples/request-logger.js
 * Then open http://localhost:3000 a few times and watch your sheet.
 */

import http from "node:http";
import { sheetFeeder } from "sheet-feeder";

const log = sheetFeeder(process.env.SHEET_URL, {
  secret: process.env.SHEET_SECRET,
  sheet: "Requests",
  batchSize: 20,
  flushInterval: 5000,
});

const server = http.createServer((req, res) => {
  // Don't await: logging shouldn't slow down the response.
  // If a batch fails, the feeder reports it through onError (console by default).
  log.append({
    time: new Date().toISOString(),
    method: req.method,
    path: req.url,
    userAgent: req.headers["user-agent"] ?? "",
  });

  res.end("Hello! This request was logged to Google Sheets.\n");
});

server.listen(3000, () => console.log("Listening on http://localhost:3000 (Ctrl+C to stop)"));

// On Ctrl+C, send any rows still waiting before exiting
process.on("SIGINT", async () => {
  console.log("\nSending the last rows...");
  server.close();
  await log.close().catch(() => {});
  process.exit(0);
});
