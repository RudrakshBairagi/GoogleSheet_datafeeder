# Apps Script setup

`Code.gs` is the part of sheet-feeder that runs **inside your Google Sheet**.
The npm package sends data to it, and it writes the rows.

## Install it (about 3 minutes)

1. Open your Google Sheet and click **Extensions → Apps Script**.
2. Delete the placeholder code and paste in the whole of `Code.gs`. Click **Save**.
3. Click **⚙️ Project Settings** (left sidebar) → **Script Properties** →
   **Add script property**:
   - Property: `SECRET`
   - Value: a long random string (`npx sheet-feeder init` makes one for you)
4. Click **Deploy → New deployment**, choose the type **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Click **Deploy** and authorize the script. If Google says
   *"Google hasn't verified this app"*, click **Advanced → Go to (project) (unsafe) → Allow**.
   It's your own script running in your own account.
6. Copy the **Web app URL** (it ends in `/exec`).

## Updating it later

Changes don't go live until you deploy a new version:
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
This keeps the same URL. ("New deployment" would create a new URL.)

## What it accepts

`POST` with a JSON body:

```json
{
  "secret": "your-secret",
  "sheet": "Orders",
  "rows": [["#101", "Asha", 499], { "order": "#102", "name": "Ben" }],
  "allowFormulas": false
}
```

| Field | Required | Meaning |
|---|---|---|
| `secret` | yes | Must match the `SECRET` script property |
| `rows` | yes | A list of rows. Each row is a list of cells, or an object matched to the header row |
| `sheet` | no | Tab name. Created if missing. Defaults to the first tab |
| `allowFormulas` | no | If `true`, text starting with `=` runs as a formula. Off by default for safety |

`GET` returns `{"ok":true,"name":"sheet-feeder","version":"1.0.0"}` as a health check.

## Replies

| Reply | Meaning |
|---|---|
| `{"ok":true,"added":2,"sheet":"Orders"}` | Rows written |
| `{"ok":false,"error":"invalid_json"}` | Body wasn't a JSON object |
| `{"ok":false,"error":"secret_not_configured"}` | No `SECRET` script property yet |
| `{"ok":false,"error":"unauthorized"}` | Wrong or missing secret |
| `{"ok":false,"error":"invalid_rows"}` | `rows` isn't a list of lists/objects |
| `{"ok":false,"error":"invalid_sheet_name"}` | `sheet` isn't 1–100 characters of text |
| `{"ok":false,"error":"busy"}` | Another request held the lock for over 10 seconds |

Apps Script web apps can't send HTTP status codes like 400, so every reply is
`200 OK` and `ok: true/false` inside the JSON says whether it worked.
