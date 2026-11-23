#!/usr/bin/env node
/**
 * sheet-feeder command-line tool.
 *
 *   npx sheet-feeder init                 Setup steps + a new random secret
 *   npx sheet-feeder init --script-only   Print just the Apps Script code
 *   npx sheet-feeder test <url> <secret>  Check the connection and write a test row
 */

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { sheetFeeder, SheetFeederError } from "../src/index.js";

const HELP = `
sheet-feeder: send rows of data to a Google Sheet

Usage:
  sheet-feeder init                  Show setup steps and generate a secret
  sheet-feeder init --script-only    Print only the Apps Script code
                                     (on a Mac: sheet-feeder init --script-only | pbcopy)
  sheet-feeder test [url] [secret]   Check your setup by writing a test row

Options:
  --sheet <name>   Tab to write the test row to (default: the first tab)
  -h, --help       Show this help
  -v, --version    Show the version

"test" also reads SHEET_URL and SHEET_SECRET from the environment.
`;

// Where the Apps Script file lives, relative to this file
const SCRIPT_PATH = new URL("../apps-script/Code.gs", import.meta.url);

main(process.argv.slice(2)).catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "script-only": { type: "boolean" },
      sheet: { type: "string" },
    },
  });
  const [command, ...rest] = positionals;

  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }
  if (values.help || !command || command === "help") {
    console.log(HELP);
    return;
  }
  if (command === "init") {
    await init(values);
    return;
  }
  if (command === "test") {
    await test(rest, values);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exitCode = 1;
}

/** Prints the setup steps, with a freshly generated secret. */
async function init(values) {
  const script = await readFile(SCRIPT_PATH, "utf8");

  if (values["script-only"]) {
    process.stdout.write(script);
    return;
  }

  // 24 random bytes = 48 hex characters: far too long to guess
  const secret = randomBytes(24).toString("hex");

  console.log(`
Set up sheet-feeder in your Google Sheet
========================================

1. Open your Google Sheet and click Extensions → Apps Script.

2. Replace the code there with the sheet-feeder script.
   Copy it with:   npx sheet-feeder init --script-only | pbcopy   (Mac)
   or open:        ${fileURLToPath(SCRIPT_PATH)}

3. Click ⚙️ Project Settings → Script Properties → Add script property:
     Property:  SECRET
     Value:     ${secret}

4. Click Deploy → New deployment → ⚙️ → Web app, then set:
     Execute as:       Me
     Who has access:   Anyone
   Click Deploy and allow access. If you see "Google hasn't verified this app",
   click Advanced → Go to (project) (unsafe) → Allow. It's your own script.

5. Copy the Web app URL (it ends in /exec) and add both values to your .env file:
     SHEET_URL=<your web app URL>
     SHEET_SECRET=${secret}

6. Check everything works:
     npx sheet-feeder test

Keep the secret private: never commit it to git.
`);
}

/** Checks the web app is reachable, then writes one test row. */
async function test(args, values) {
  const url = args[0] ?? process.env.SHEET_URL;
  const secret = args[1] ?? process.env.SHEET_SECRET;

  if (!url || !secret) {
    console.error("✖ Missing the URL or secret.");
    console.error("  Usage: sheet-feeder test <url> <secret>");
    console.error("  Or set SHEET_URL and SHEET_SECRET in your environment.");
    process.exitCode = 1;
    return;
  }

  // Report errors ourselves (below), so turn off the default logging
  const feeder = sheetFeeder(url, {
    secret,
    sheet: values.sheet,
    retries: 1,
    timeout: 20000,
    onError: () => {},
  });

  try {
    // Step 1: is the script deployed and reachable? (GET, no secret needed)
    const info = await feeder.ping();
    console.log(`✔ Web app is reachable (${info.name} script v${info.version})`);

    // Step 2: can we write? (POST, checks the secret)
    const result = await feeder.append([[new Date().toISOString(), "sheet-feeder test row ✅"]]);
    console.log(`✔ Wrote ${result.added} test row to the "${result.sheet}" tab`);
    console.log("\nAll good! Your sheet is ready to receive data.");
  } catch (error) {
    if (error instanceof SheetFeederError) {
      console.error(`✖ ${error.message}`);
      // Only mention the HTTP status when it's unusual (Apps Script always uses 200)
      const status = error.status && error.status !== 200 ? `, HTTP ${error.status}` : "";
      console.error(`  (error code: ${error.code}${status})`);
    } else {
      console.error(`✖ Unexpected error: ${error.message}`);
    }
    process.exitCode = 1;
  }
}
