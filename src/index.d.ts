/**
 * TypeScript types for sheet-feeder.
 * These give editors autocomplete and catch mistakes, even in plain JavaScript.
 */

/** Anything that can go in one cell. Objects and lists are saved as JSON text. */
export type CellValue = string | number | boolean | null | undefined | Date | object;

/** A row as a list of cells, left to right: ["Asha", 25] */
export type ArrayRow = CellValue[];

/** A row as an object, matched to the header row: { name: "Asha", age: 25 } */
export type ObjectRow = Record<string, CellValue>;

export type Row = ArrayRow | ObjectRow;

export interface SheetFeederOptions {
  /** Must match the SECRET script property in your Apps Script. */
  secret: string;
  /** Tab to write to. Created if missing. Default: the first tab. */
  sheet?: string;
  /** Send as soon as this many rows are waiting. Default: 1 (send right away). */
  batchSize?: number;
  /** Also send waiting rows every N milliseconds. Default: 0 (off). */
  flushInterval?: number;
  /** Give up on one request after N milliseconds. Default: 15000. */
  timeout?: number;
  /** How many times to retry a temporary failure. Default: 3. */
  retries?: number;
  /** Milliseconds before the first retry; doubles each time. Default: 1000. */
  retryDelay?: number;
  /** Let text starting with "=" run as a formula. Default: false. */
  allowFormulas?: boolean;
  /** Called whenever a batch fails. Default: logs to console.error. */
  onError?: (error: Error) => void;
  /** Custom fetch function (mainly for tests). Default: the built-in fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface AppendResult {
  /** How many rows were written by the request that carried these rows. */
  added: number;
  /** The tab they were written to. */
  sheet?: string;
}

export interface PingResult {
  ok: true;
  name: string;
  version: string;
}

export interface SheetFeeder {
  /** Add one row or a list of rows. Resolves once they're written. */
  append(rows: Row | Row[]): Promise<AppendResult>;
  /** Send every waiting row now. */
  flush(): Promise<AppendResult>;
  /** Send waiting rows and stop accepting new ones. Call before your program exits. */
  close(): Promise<AppendResult>;
  /** Check the web app is deployed and reachable (no secret needed). */
  ping(): Promise<PingResult>;
}

export type SheetFeederErrorCode =
  | "invalid_json"
  | "secret_not_configured"
  | "unauthorized"
  | "invalid_rows"
  | "invalid_sheet_name"
  | "busy"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "server_error"
  | "http_error"
  | "bad_response"
  | "closed"
  | (string & {});

export declare class SheetFeederError extends Error {
  constructor(
    code: SheetFeederErrorCode,
    options?: { message?: string; retryable?: boolean; status?: number; cause?: unknown },
  );
  readonly name: "SheetFeederError";
  /** Short code, e.g. "unauthorized". */
  readonly code: SheetFeederErrorCode;
  /** Whether trying again might work. */
  readonly retryable: boolean;
  /** HTTP status code, if there was one. */
  readonly status?: number;
}

/** A friendly message for every error code. */
export declare const ERROR_MESSAGES: Readonly<Record<string, string>>;

/** Create a feeder connected to one Apps Script web app URL. */
export declare function sheetFeeder(url: string, options: SheetFeederOptions): SheetFeeder;
