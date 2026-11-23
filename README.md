# sheet-feeder

Send rows of data to a Google Sheet from Node.js.

```js
import { sheetFeeder } from "sheet-feeder";

const sheet = sheetFeeder(process.env.SHEET_URL, { secret: process.env.SHEET_SECRET });

await sheet.append({ name: "Asha", email: "asha@example.com", plan: "pro" });
```

- **No Google Cloud project, service account or API keys.** A small script inside your own sheet does the writing.
- **No dependencies.** Uses the `fetch` built into Node.js 18+.
- **Objects become columns.** Keys are matched to the header row, and new keys add new columns.
- **Batching, retries and timeouts** built in.
- **Safe by default.** A secret token is required, and formulas in your data are stored as plain text.

## How it works

```
 Your Node.js app                     Google
┌──────────────────┐   POST JSON   ┌──────────────────────────┐
│ sheet-feeder     │ ────────────► │ Apps Script web app      │
│ sheet.append(…)  │               │ (Code.gs, in your sheet) │
│                  │ ◄──────────── │  checks the secret       │
└──────────────────┘   {"ok":true} │  writes the rows         │
                                   └────────────┬─────────────┘
                                                ▼
                                         📄 Your Google Sheet
```

You deploy `apps-script/Code.gs` inside your sheet as a **web app**. Google gives it a URL.
The npm package sends your rows to that URL, and the script checks the secret and writes them.

## Setup (about 5 minutes)

### 1. Install

```bash
npm install sheet-feeder
```

### 2. Get the setup steps and a secret

```bash
npx sheet-feeder init
```

This prints the steps below with a freshly generated secret filled in.

### 3. Add the script to your Google Sheet

1. Open your sheet and click **Extensions → Apps Script**.
2. Replace the placeholder code with the sheet-feeder script, then **Save**.
   On a Mac, `npx sheet-feeder init --script-only | pbcopy` copies it for you.
3. Click **⚙️ Project Settings → Script Properties → Add script property**.
   Name it `SECRET` and paste in the secret from step 2.

### 4. Deploy it as a web app

1. Click **Deploy → New deployment**, click ⚙️ and choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
3. Allow access. If Google says *"Google hasn't verified this app"*, click
   **Advanced → Go to (project) (unsafe) → Allow**. It's your own script in your own account.
4. Copy the **Web app URL**. It ends in `/exec`.

### 5. Save the URL and secret

Copy `.env.example` to `.env` and fill it in:

```
SHEET_URL=https://script.google.com/macros/s/…/exec
SHEET_SECRET=your-secret
```

Never commit `.env`.

### 6. Check it works

```bash
npx sheet-feeder test
```

```
✔ Web app is reachable (sheet-feeder script v1.0.0)
✔ Wrote 1 test row to the "Sheet1" tab

All good! Your sheet is ready to receive data.
```

## Usage

### Rows as lists or objects

```js
// A list of cells, left to right
await sheet.append(["Asha", 25, "Delhi"]);

// An object: keys are matched to the header row (row 1)
await sheet.append({ name: "Ben", age: 30 });

// Several rows in one request (faster)
await sheet.append([
  { name: "Cy", age: 22 },
  { name: "Dev", age: 27, city: "Pune" }, // "city" becomes a new column
]);
```

When you send objects to an empty tab, the keys become the header row.
Use object rows in tabs that have a header row, or that are empty.

### Choosing a tab

```js
const orders = sheetFeeder(url, { secret, sheet: "Orders" }); // created if it doesn't exist
```

For several tabs, create one feeder per tab.

### Batching (for logging and high-volume data)

```js
const log = sheetFeeder(url, {
  secret,
  batchSize: 50, // send when 50 rows are waiting...
  flushInterval: 5000, // ...or every 5 seconds, whichever comes first
});

log.append({ event: "signup", user: "asha" }); // no need to await

// Before your program exits, send anything still waiting:
await log.close();
```

### Handling errors

```js
import { sheetFeeder, SheetFeederError } from "sheet-feeder";

try {
  await sheet.append(["Asha"]);
} catch (error) {
  if (error instanceof SheetFeederError && error.code === "unauthorized") {
    console.error("Check SHEET_SECRET");
  }
}
```

Temporary problems (timeouts, network errors, Google server errors, a busy sheet)
are retried automatically, waiting 1s, 2s, then 4s.

## API

### `sheetFeeder(url, options)`

Creates a feeder for one web app URL.

| Option | Default | Description |
|---|---|---|
| `secret` | *required* | Must match the `SECRET` script property |
| `sheet` | first tab | Tab to write to. Created if missing |
| `batchSize` | `1` | Send when this many rows are waiting. `1` sends every append straight away |
| `flushInterval` | `0` | Also send waiting rows every N ms. `0` turns it off |
| `timeout` | `15000` | Give up on a request after N ms |
| `retries` | `3` | Retries for temporary errors |
| `retryDelay` | `1000` | Wait before the first retry, in ms. Doubles each time |
| `allowFormulas` | `false` | Let text starting with `=` run as a formula |
| `onError` | logs to console | `(error) => void`, called whenever a batch fails |

### Feeder methods

| Method | Description |
|---|---|
| `append(rows)` | Add one row or a list of rows. Resolves with `{ added, sheet }` once written |
| `flush()` | Send all waiting rows now |
| `close()` | Send waiting rows and stop accepting new ones |
| `ping()` | Check the script is reachable. Resolves with `{ ok, name, version }` |

### Values

| You send | The cell gets |
|---|---|
| text, numbers, `true`/`false` | the same value |
| `null` / `undefined` | an empty cell |
| an object or list | its JSON text, e.g. `{"a":1}` |
| `"=SUM(A1:A3)"` | the text `=SUM(A1:A3)` (a formula only with `allowFormulas: true`) |
| a `Date` | its ISO text, e.g. `2026-11-23T10:00:00.000Z` |

### Error codes

Every error is a `SheetFeederError` with `code`, `message`, `retryable` and (when known) `status`.

| Code | Meaning | Retried? |
|---|---|---|
| `unauthorized` | Wrong secret | No |
| `secret_not_configured` | No `SECRET` script property yet | No |
| `invalid_rows` | Rows have the wrong shape | No |
| `invalid_sheet_name` | Tab name isn't 1–100 characters of text | No |
| `bad_response` | The URL didn't reply with sheet-feeder JSON | No |
| `http_error` | HTTP error such as 404 (usually a wrong URL) | No |
| `closed` | `append()` after `close()` | No |
| `busy` | Sheet locked by other requests for over 10s | Yes |
| `timeout` | No reply in time | Yes |
| `network_error` | Couldn't connect | Yes |
| `rate_limited` | HTTP 429 from Google | Yes |
| `server_error` | HTTP 5xx from Google | Yes |

## CLI

```bash
npx sheet-feeder init                   # setup steps + a new secret
npx sheet-feeder init --script-only     # just the Apps Script code
npx sheet-feeder test [url] [secret]    # check the connection, write a test row
npx sheet-feeder test --sheet Orders    # ...to a specific tab
```

`test` reads `SHEET_URL` and `SHEET_SECRET` from the environment if you don't pass them.

## Troubleshooting

| Problem | Fix |
|---|---|
| `bad_response` | Make sure the URL ends in `/exec` and **Who has access** is **Anyone**. |
| Changes to the script don't take effect | Deploy a new version: **Deploy → Manage deployments → ✏️ Edit → New version → Deploy**. |
| `unauthorized` | `SHEET_SECRET` must exactly match the `SECRET` script property, with no extra spaces. |
| `secret_not_configured` | Add the `SECRET` script property (Project Settings → Script Properties). |
| An authorization error page | Open the script, run `doPost` once with **▶ Run**, and allow access. |
| Rows land in the wrong columns | Object rows are matched to row 1. Check the header names match your keys exactly. |
| Formulas show as text | That's the safe default. Pass `allowFormulas: true` if the data is trusted. |
| Slow | Each request takes 1–3 seconds. Send many rows per `append()`, or use batching. |

## Limits and things to know

- **Speed:** each request takes about 1–3 seconds, so sheet-feeder suits logs, forms and reports, not real-time streaming.
- **Google quotas:** Apps Script has daily usage quotas and limits on simultaneous executions. Batching helps you stay within them.
- **Duplicates on retry:** if a request times out after Google already wrote the rows, the retry writes them again. For data where duplicates matter, include an ID column.
- **Security:** anyone with the URL *and* the secret can add rows. They can't read your sheet. If the secret leaks, change the `SECRET` script property.

## Development

```bash
git clone https://github.com/RudrakshBairagi/GoogleSheet_datafeeder.git
cd GoogleSheet_datafeeder
npm test
```

There's nothing to install. The tests run the client against a fake web app server
(`test/helpers/mock-server.js`), and run `Code.gs` against fake Google services
(`test/helpers/apps-script-sandbox.js`), so no Google account is needed.

```
apps-script/Code.gs   the script that runs inside Google Sheets
src/index.js          the npm package: sheetFeeder(), batching, retries
src/errors.js         SheetFeederError and friendly messages
src/index.d.ts        TypeScript types
bin/cli.js            the sheet-feeder command (init, test)
examples/             runnable examples
test/                 automated tests
```

## License

MIT
