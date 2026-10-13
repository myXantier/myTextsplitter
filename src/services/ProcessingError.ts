// Error and result contract of the text processing (Rust backend, Web Worker, main-thread fallback).
//
// Success: the services resolve with a `myResult` whose `result` was checked at runtime against its `type`
//          (empty strings and empty arrays are valid results).
// Failure: the services reject with a `ProcessingError`; nothing is replaced by `{}`, `[]` or `''`.
// Kept free of app imports so the workers and `npm test` can load it directly.

export type ProcessingErrorKind =
  /** The user input cannot be processed, e.g. an invalid regex. */
  | 'invalidInput'
  /** The Tauri command or the IPC failed. */
  | 'backend'
  /** The Web Worker or the main-thread fallback failed. */
  | 'worker'
  /** The Web Worker did not answer in time. */
  | 'timeout'
  /** The processing finished, but its result does not have the expected structure. */
  | 'invalidResult';

const KINDS: readonly ProcessingErrorKind[] = ['invalidInput', 'backend', 'worker', 'timeout', 'invalidResult'];

/** i18n keys used as `message` (the pages translate them with `processingErrorMessage`). */
export const ERROR_KEYS = {
  invalidRegex: 'errors.invalidRegex',
  regexTooComplex: 'errors.regexTooComplex',
  timeout: 'errors.processingTimeout',
  general: 'errors.processingError',
} as const;

export class ProcessingError extends Error {
  readonly kind: ProcessingErrorKind;
  /** Technical detail for logs (never the processed text). */
  readonly detail?: string;

  constructor(kind: ProcessingErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'ProcessingError';
    this.kind = kind;
    this.detail = detail;
  }
}

export const isProcessingErrorKind = (value: unknown): value is ProcessingErrorKind =>
  typeof value === 'string' && (KINDS as readonly string[]).includes(value);

/** Wraps any thrown value; an existing `ProcessingError` is returned unchanged. */
export function toProcessingError(error: unknown, kind: ProcessingErrorKind): ProcessingError {
  if (error instanceof ProcessingError) return error;
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return new ProcessingError(kind, kind === 'timeout' ? ERROR_KEYS.timeout : ERROR_KEYS.general, detail);
}

export const invalidRegexError = (detail?: string) => new ProcessingError('invalidInput', ERROR_KEYS.invalidRegex, detail);

/**
 * Error of a Tauri command. The text commands reject with `{ kind, message }` (Rust `TextError`),
 * all other commands and IPC failures with a string.
 */
export function fromBackendError(error: unknown): ProcessingError {
  if (error instanceof ProcessingError) return error;
  if (error && typeof error === 'object' && 'kind' in error) {
    const { kind, message } = error as { kind: unknown; message?: unknown };
    const detail = typeof message === 'string' ? message : undefined;
    if (kind === 'invalidRegex') return invalidRegexError(detail);
    // The pattern needs too much backtracking for this text (fancy-regex limit): a problem of the input, not of the app
    if (kind === 'regexRuntime') return new ProcessingError('invalidInput', ERROR_KEYS.regexTooComplex, detail);
    return new ProcessingError('backend', ERROR_KEYS.general, detail ?? String(kind));
  }
  return toProcessingError(error, 'backend');
}

/** Logs an error once without input text: invalid input is a warning, everything else an error. */
export function logProcessingError(context: string, error: unknown) {
  const e = error instanceof ProcessingError ? error : toProcessingError(error, 'worker');
  const text = `${context}: ${e.kind} (${e.message})${e.detail ? ` - ${e.detail}` : ''}`;
  if (e.kind === 'invalidInput') window.logger.warn(text);
  else window.logger.error(text);
}

/**
 * Page side of a failed processing: returns the translated message for the snackbar.
 * `ProcessingError`s were already logged (useBackendProcessor / `unwrapResult`); other errors are logged here.
 */
export function processingErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ProcessingError) return t(error.message);
  logProcessingError('Unerwarteter Fehler bei der Verarbeitung', error);
  return t(ERROR_KEYS.general);
}

/** Data of a successful `myResultConverter` call; a failed conversion is logged and thrown as `invalidResult`. */
export function unwrapResult<T>(converted: Result<T, Error>): T {
  if (converted.status === 'ok') return converted.data;
  const error = new ProcessingError('invalidResult', ERROR_KEYS.general, converted.error.message);
  logProcessingError('Ergebnis konnte nicht übernommen werden', error);
  throw error;
}

// --- Runtime validation of results ---

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isStringArrayArray = (value: unknown): value is string[][] => Array.isArray(value) && value.every(isStringArray);
const isRemovedCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const isMetrics = (value: unknown): value is BackendMetrics =>
  !!value &&
  typeof value === 'object' &&
  Number.isFinite((value as BackendMetrics).execution_time_ms) &&
  Number.isFinite((value as BackendMetrics).memory_usage_kb);

/** Data of a `TextV2` result (Remove): text + number of removed lines; backend `metrics` are optional. */
export interface RemoveResultData {
  result_text: string;
  removed_lines: number;
  metrics?: BackendMetrics;
}

export const isTextV2 = (value: unknown): value is RemoveResultData =>
  !!value &&
  typeof value === 'object' &&
  isString((value as RemoveResultData).result_text) &&
  isRemovedCount((value as RemoveResultData).removed_lines) &&
  // optional, but if present it must be valid
  ((value as RemoveResultData).metrics === undefined || isMetrics((value as RemoveResultData).metrics));

const VALIDATORS: Record<NonNullable<myResultDataType>, (value: unknown) => boolean> = {
  Text: isString,
  Column: isStringArray,
  ColumnList: isStringArrayArray,
  TextV2: isTextV2,
};

/** Data type of a `myResult` type. */
export interface ResultData {
  Text: string;
  Column: string[];
  ColumnList: string[][];
  TextV2: RemoveResultData;
}
export type ResultType = keyof ResultData;

export const matchesResultType = (type: ResultType, data: unknown): boolean => VALIDATORS[type](data);

/** Builds a `myResult` of the given type; throws `invalidResult` if `data` does not match the type. */
export function createResult<K extends ResultType>(type: K, data: ResultData[K]): myResult {
  if (!matchesResultType(type, data)) {
    throw new ProcessingError('invalidResult', ERROR_KEYS.general, `result does not match type ${type}`);
  }
  return {
    type,
    result: data,
    isNull: !data || (Array.isArray(data) && data.length === 0),
    abort: false,
    __brand: 'myResult',
  } as myResult;
}

/** Checks a `myResult` received from another context (Web Worker); throws `invalidResult` if it is not of `expected`. */
export function assertResult(value: unknown, expected: ResultType): myResult {
  const candidate = value as { type?: unknown; result?: unknown } | null;
  if (!candidate || typeof candidate !== 'object' || candidate.type !== expected || !matchesResultType(expected, candidate.result)) {
    const actual = candidate && typeof candidate === 'object' ? String(candidate.type) : typeof value;
    throw new ProcessingError('invalidResult', ERROR_KEYS.general, `expected ${expected} result, got ${actual}`);
  }
  return value as myResult;
}

/**
 * Checks the `ProcessedText` answer of a Rust text command (`result_text` of type `textType`, `removed_lines`, `metrics`);
 * throws `invalidResult` otherwise.
 */
export function assertBackendResult<K extends 'Text' | 'Column'>(value: unknown, textType: K): ProcessedText<ResultData[K]> {
  const candidate = value as ProcessedText<unknown> | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !matchesResultType(textType, candidate.result_text) ||
    !isRemovedCount(candidate.removed_lines) ||
    !isMetrics(candidate.metrics)
  ) {
    throw new ProcessingError('invalidResult', ERROR_KEYS.general, `unexpected backend result (expected ${textType})`);
  }
  return candidate as ProcessedText<ResultData[K]>;
}
