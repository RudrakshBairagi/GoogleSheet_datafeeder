/**
 * Runs apps-script/Code.gs on your own computer, with fake versions of
 * Google's services (SpreadsheetApp, PropertiesService, LockService,
 * ContentService). This lets us test the Apps Script without Google.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8");

/**
 * Creates a fresh, empty fake spreadsheet with the script loaded.
 *
 * @param {Object} [options]
 * @param {string|null} [options.secret] - The SECRET script property (null = not set).
 */
export function createSandbox({ secret = "s3cret" } = {}) {
  const tabs = [createFakeSheet("Sheet1")];
  const lock = { available: true, releases: 0 };

  const google = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheets: () => tabs,
        getSheetByName: (name) => tabs.find((tab) => tab.getName() === name) ?? null,
        insertSheet: (name) => {
          const tab = createFakeSheet(name);
          tabs.push(tab);
          return tab;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key === "SECRET" ? secret : null),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => lock.available,
        releaseLock: () => {
          lock.releases++;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
  };

  const context = vm.createContext(google);
  vm.runInContext(CODE, context);

  return {
    /** Sends a POST body (object or raw text) and returns the parsed JSON reply. */
    post(body) {
      const contents = typeof body === "string" ? body : JSON.stringify(body);
      return JSON.parse(context.doPost({ postData: { contents } }).text);
    },
    /** Sends a GET and returns the parsed JSON reply. */
    get() {
      return JSON.parse(context.doGet({}).text);
    },
    /** The cells of a tab, as a list of rows. */
    cells(tabName = "Sheet1") {
      return tabs.find((tab) => tab.getName() === tabName)?.data ?? null;
    },
    tabNames: () => tabs.map((tab) => tab.getName()),
    lock,
  };
}

/** A fake sheet tab that stores cells in a list of rows. */
function createFakeSheet(name) {
  const data = [];
  return {
    data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((widest, row) => Math.max(widest, row.length), 0),
    getRange: (row, column, numRows, numColumns) => ({
      setValues(values) {
        if (values.length !== numRows || values.some((r) => r.length !== numColumns)) {
          throw new Error("The data doesn't match the range size");
        }
        values.forEach((cells, i) => {
          const target = (data[row - 1 + i] ??= []);
          cells.forEach((value, j) => {
            target[column - 1 + j] = value;
          });
        });
      },
      getValues() {
        return Array.from({ length: numRows }, (_, i) =>
          Array.from({ length: numColumns }, (_, j) => data[row - 1 + i]?.[column - 1 + j] ?? ""),
        );
      },
    }),
  };
}
