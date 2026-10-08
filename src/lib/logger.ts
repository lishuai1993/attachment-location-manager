import { App, normalizePath } from "obsidian";

/**
 * Leveled diagnostic logger with a console sink and a file sink.
 *
 * File sink writes to `<pluginDir>/log.txt`, where `pluginDir` is the folder Obsidian
 * actually loaded the plugin from (`manifest.dir`). Composing that path from
 * `manifest.id` instead breaks as soon as the folder is named differently from the id,
 * and writing into a folder that does not exist throws with no visible symptom.
 * The config dir is deliberately used instead of the vault root: it is not indexed by
 * the Vault, so creating/rotating the log file does NOT emit `create`/`rename`/`delete`
 * events. Writing the log into the vault root would push it into the plugin's own
 * `createdQueue`, where it can never match a note link and would permanently block
 * the paste pipeline.
 *
 * ERROR/WARN are always emitted (console + file) so a bug can be diagnosed without
 * having turned the toggle on beforehand. INFO/TRACE follow the runtime toggle.
 */
export enum LogLevel {
  ERROR = "ERROR",
  WARN = "WARN",
  INFO = "INFO",
  TRACE = "TRACE",
}

/** Structured payload of a log line; each entry becomes `key=value`. */
export type LogData = Record<string, unknown>;

/** Replaced with a string literal by esbuild's `define`, so `process` never reaches the bundle. */
declare const __BUILD_ENV__: string;

const PREFIX = "AMG";
const LOG_FILE_NAME = "log.txt";
const BAK_FILE_NAME = "log.txt.bak";
const FLUSH_DEBOUNCE_MS = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SERIALIZE_DEPTH = 4;
const QUOTE_REGEX = /[\s"=,\\]/;

let app: App | null = null;
let logDir = "";
let logPath = "";
let bakPath = "";
let verbose = false;
let sinkDisabled = false;
let sinkFailureReported = false;
let recoveryAttempted = false;
let onSinkFailure: ((reason: string) => void) | null = null;
let pending: string[] = [];
let flushTimer: number | null = null;
let writeChain: Promise<void> = Promise.resolve();
let bytesWritten = 0;
const onceSeen = new Map<string, number>();

export interface LoggerOptions {
  /** Vault-relative plugin folder; the log files live directly inside it. */
  pluginDir: string;
  version: string;
  verbose: boolean;
  /** Called once if the file sink gives up, so the failure is not console-only. */
  onSinkFailure?: (reason: string) => void;
}

/** Absolute-in-vault path of the current log file, empty before `initLogger` runs. */
export function getLogPath(): string {
  return logPath;
}

/** True once the file sink has stopped for this session; the console sink keeps working. */
export function isSinkDisabled(): boolean {
  return sinkDisabled;
}

export function setLogEnabled(value: boolean): void {
  verbose = value;
}

export function log(level: LogLevel, tag: string, message: string, data?: LogData): void {
  if (!isEnabled(level)) {
    return;
  }
  // Callers pass live plugin objects (settings, TFile, caught errors) as `data`; a
  // circular reference or a throwing getter must not be able to break the event
  // handler that was only trying to log.
  try {
    const line = `${PREFIX}|${timestamp()}|${level}|${tag}|${message}${serializeData(data)}\n`;
    emitToConsole(level, line);
    enqueue(line, level === LogLevel.ERROR || level === LogLevel.WARN);
  } catch (err) {
    try {
      console.warn(`${PREFIX}|logger failure reason=${serialize(err)}`);
    } catch {
      // nothing left to do
    }
  }
}

export const trace = (tag: string, message: string, data?: LogData) => log(LogLevel.TRACE, tag, message, data);
export const info = (tag: string, message: string, data?: LogData) => log(LogLevel.INFO, tag, message, data);
export const warn = (tag: string, message: string, data?: LogData) => log(LogLevel.WARN, tag, message, data);
export const error = (tag: string, message: string, data?: LogData) => log(LogLevel.ERROR, tag, message, data);

/**
 * WARN the first time `key` is seen in this plugin session, TRACE afterwards with a
 * `repeat` count. For conditions that are worth knowing about but recur once per
 * file/link — "this file was skipped because it was copied by sync, not pasted" — the
 * fact that it fired is the signal; the fact that it fired 400 times is noise in an
 * always-on sink. `key` is a category, not a path, so the counter is meaningful.
 */
export function warnOnce(key: string, tag: string, message: string, data?: LogData): void {
  const repeats = onceSeen.get(key);
  if (repeats === undefined) {
    onceSeen.set(key, 0);
    warn(tag, message, { ...data, repeat: 0 });
    return;
  }
  onceSeen.set(key, repeats + 1);
  trace(tag, `${message} (repeat)`, { ...data, repeat: repeats + 1 });
}

/**
 * Point the logger at the plugin folder, rotate the previous run's log into
 * `log.txt.bak`, truncate `log.txt` and write the load banner. A failure to write
 * degrades the file sink to console-only output and never propagates to the caller;
 * a failed first write is retried once after creating the folder.
 */
export async function initLogger(targetApp: App, options: LoggerOptions): Promise<void> {
  app = targetApp;
  verbose = options.verbose;
  logDir = normalizePath(options.pluginDir);
  logPath = normalizePath(`${logDir}/${LOG_FILE_NAME}`);
  bakPath = normalizePath(`${logDir}/${BAK_FILE_NAME}`);
  sinkDisabled = false;
  sinkFailureReported = false;
  recoveryAttempted = false;
  onSinkFailure = options.onSinkFailure ?? null;
  pending = [];
  bytesWritten = 0;
  writeChain = Promise.resolve();
  onceSeen.clear();

  try {
    await rotateLogFile();
  } catch (err) {
    handleSinkFailure(err);
  }

  info("sys:log", "plugin load", {
    version: options.version,
    buildEnv: __BUILD_ENV__ === "production" ? "production" : "development",
    debugLogEnabled: options.verbose,
    logPath,
  });
  flushLog();
}

/**
 * Move the current log to `log.txt.bak` and start a fresh one. Also used when the
 * log exceeds the size cap, so a long-running session cannot grow unbounded.
 */
export async function rotateLogFile(): Promise<void> {
  const adapter = app?.vault.adapter;
  if (adapter === undefined || logPath === "" || bakPath === "") {
    return;
  }
  if (!(await adapter.exists(logPath))) {
    return;
  }
  if (await adapter.exists(bakPath)) {
    await adapter.remove(bakPath);
  }
  await adapter.rename(logPath, bakPath);
  await adapter.write(logPath, "");
  bytesWritten = 0;
}

/** Flush buffered lines immediately, e.g. on plugin unload. */
export function flushLog(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushNow();
}

function isEnabled(level: LogLevel): boolean {
  return level === LogLevel.ERROR || level === LogLevel.WARN || verbose;
}

function emitToConsole(level: LogLevel, line: string): void {
  const text = line.trimEnd();
  if (level === LogLevel.ERROR) {
    console.error(text);
  } else if (level === LogLevel.WARN) {
    console.warn(text);
  } else {
    // `debug` rather than `log`: the release guideline allows only warn/error/debug, and the
    // DevTools default view hides `debug` until "Verbose" is on — which is what verbose
    // diagnostics should do. WARN/ERROR above stay visible without that.
    console.debug(text);
  }
}

function enqueue(line: string, immediate: boolean): void {
  if (app === null || sinkDisabled) {
    return;
  }
  pending.push(line);
  if (immediate) {
    flushNow();
    return;
  }
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }
}

function flushNow(): void {
  if (app === null || sinkDisabled || pending.length === 0) {
    return;
  }
  const chunk = pending.join("");
  pending = [];
  // Serialize writes so lines keep their order even though `append` is async.
  writeChain = writeChain.then(() => writeChunk(chunk)).catch((err) => recoverSink(chunk, err));
}

/**
 * A write failed. The commonest cause is a log folder that does not exist — the path is
 * composed from a plugin folder, and a folder named differently from its manifest id
 * leaves `write` with nowhere to go. `DataAdapter.write` does not create parents, so try
 * once to create the folder and replay the chunk; only a second failure gives up.
 */
async function recoverSink(chunk: string, err: unknown): Promise<void> {
  if (!recoveryAttempted) {
    recoveryAttempted = true;
    if (await ensureLogDir()) {
      try {
        await writeChunk(chunk);
        return;
      } catch (retryErr) {
        err = retryErr;
      }
    }
  }
  handleSinkFailure(err);
}

/** Create the log folder if it is missing. `mkdir` throws when it already exists, hence the check. */
async function ensureLogDir(): Promise<boolean> {
  const adapter = app?.vault.adapter;
  if (adapter === undefined || logDir === "") {
    return false;
  }
  try {
    if (await adapter.exists(logDir)) {
      return true;
    }
    await adapter.mkdir(logDir);
    return true;
  } catch {
    return false;
  }
}

async function writeChunk(chunk: string): Promise<void> {
  const adapter = app?.vault.adapter;
  if (adapter === undefined) {
    return;
  }
  const size = byteLength(chunk);
  if (bytesWritten + size > MAX_FILE_BYTES) {
    await rotateLogFile();
  }
  // `append` does not reliably create the file on every adapter, so the first write
  // after a fresh install uses `write` (create/truncate) instead.
  if (bytesWritten === 0 && !(await adapter.exists(logPath))) {
    await adapter.write(logPath, chunk);
  } else {
    await adapter.append(logPath, chunk);
  }
  bytesWritten += size;
}

/** `chunk.length` counts UTF-16 units, which understates UTF-8 logs by up to 3x. */
function byteLength(chunk: string): number {
  return new TextEncoder().encode(chunk).length;
}

function handleSinkFailure(err: unknown): void {
  sinkDisabled = true;
  pending = [];
  if (sinkFailureReported) {
    return;
  }
  sinkFailureReported = true;
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(`${PREFIX}|${timestamp()}|WARN|sys:log|file sink disabled reason=${serialize(reason)}`);
  // The console line is invisible to anyone not watching DevTools, and the settings page
  // otherwise keeps showing a log path that nothing is writing to.
  onSinkFailure?.(reason);
}

function timestamp(): string {
  const m = window.moment;
  if (typeof m === "function") {
    return m().format("YYYY-MM-DD HH:mm:ss.SSS");
  }
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function serializeData(data?: LogData): string {
  if (data === undefined) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${key}=${serialize(value)}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function serialize(value: unknown, depth = 0): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return QUOTE_REGEX.test(value) ? quote(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "function") {
    return "function";
  }
  if (typeof value === "symbol" || typeof value === "bigint") {
    return String(value);
  }
  // Depth cap so a self-referencing object cannot recurse forever. Only the shape of
  // the value matters for triage, not its full contents.
  if (depth >= MAX_SERIALIZE_DEPTH) {
    return Array.isArray(value) ? "[...]" : "{...}";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item, depth + 1)).join(",")}]`;
  }
  if (value instanceof Error) {
    return quote(value.message);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}:${serialize(v, depth + 1)}`);
    return `{${entries.join(",")}}`;
  }
  // Only a host object with no plain-object shape reaches here; naming its type is more
  // useful than letting it read as "[object Object]".
  return `[${typeof value}]`;
}

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, (match) => "\\" + match)
    .replace(/\r?\n/g, "\\n");
  return `"${escaped}"`;
}
