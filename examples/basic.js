/**
 * Basic example: send a few rows to your Google Sheet.
 *
 * Run it (Node 20.6+ can read the .env file for you):
 *   node --env-file=.env examples/basic.js
 */

import { sheetFeeder } from "sheet-feeder";

// The URL and secret come from your .env file (see .env.example)
const sheet = sheetFeeder(process.env.SHEET_URL, {
  secret: process.env.SHEET_SECRET,
  sheet: "Examples", // this tab is created if it doesn't exist
});

// One row as a list of cells
await sheet.append(["Asha", 25, "Delhi"]);

// One row as an object: the keys become column headers
await sheet.append({ name: "Ben", age: 30, city: "Mumbai" });

// Several rows in one request
const result = await sheet.append([
  { name: "Cy", age: 22, city: "Pune" },
  { name: "Dev", age: 27, city: "Jaipur" },
]);

console.log(`Wrote ${result.added} rows to the "${result.sheet}" tab`);
