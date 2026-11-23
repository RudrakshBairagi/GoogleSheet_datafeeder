# sheet-feeder

Send rows of data to a Google Sheet from Node.js.

`sheet-feeder` talks to a small Google Apps Script that you deploy inside your own
sheet, so you don't need a Google Cloud project, a service account, or API keys.

> 🚧 Work in progress: this is being built step by step.

## Roadmap

**Phase 1: Setup**
- [x] Project skeleton

**Phase 2: Apps Script**
- [ ] Apps Script that appends rows
- [ ] Secret token check
- [ ] Map object keys to sheet headers

**Phase 3: Client library**
- [ ] `sheetFeeder()` with `append()`
- [ ] Error handling
- [ ] Batching and `flush()`
- [ ] Retries with backoff

**Phase 4: Command-line tool**
- [ ] `npx sheet-feeder init`
- [ ] `npx sheet-feeder test`

**Phase 5: Quality**
- [ ] TypeScript types
- [ ] Tests with a mock server
- [ ] Usage example

**Phase 6: Docs and release**
- [ ] Setup guide
- [ ] API reference and troubleshooting
- [ ] 1.0.0 release prep

## License

MIT
