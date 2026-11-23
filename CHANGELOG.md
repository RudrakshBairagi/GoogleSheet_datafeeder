# Changelog

All notable changes to this project are listed here.
This project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 (2026-11-23)

First release.

### Apps Script
- Receives rows over HTTP POST and appends them below existing data
- Requires a secret token stored in Script Properties (refuses everything if none is set)
- Writes to any tab by name, creating it if needed
- Matches object rows to the header row and adds columns for new keys
- Locks the sheet during writes so simultaneous requests can't overwrite each other
- Stores text starting with `=` as plain text unless `allowFormulas` is set
- `GET` health check that reports the script version

### npm package
- `sheetFeeder(url, options)` with `append()`, `flush()`, `close()` and `ping()`
- Accepts list rows, object rows, or a mix
- Optional batching with `batchSize` and `flushInterval`
- Timeouts, and retries with exponential backoff for temporary errors
- `SheetFeederError` with a `code` and a friendly message for every failure
- TypeScript types
- No dependencies

### CLI
- `sheet-feeder init` prints setup steps with a freshly generated secret
- `sheet-feeder init --script-only` prints the Apps Script code
- `sheet-feeder test` checks the connection and writes a test row
