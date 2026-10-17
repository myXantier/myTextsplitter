// Error and result contract of the text processing (Rust backend, Web Worker, main-thread fallback).
//
// Success: the services resolve with a `myResult` whose `result` was checked at runtime against its `type`
//          (empty strings and empty arrays are valid results).
// Failure: the services reject with a `ProcessingError`; nothing is replaced by `{}`, `[]` or `''`.
// Kept free of app imports so the workers and `npm test` can load it directly.
import { isDiffData, type DiffData } from '../utils/diff/result';
import type { MatchPreviewData } from '../utils/matchPreview';
import { MAX_PATTERN_LENGTH, type PatternProblem } from '../utils/regexPattern';

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
  | 'invalidResult'
  /** A newer processing of the same type was started: this one was stopped or its late result discarded. Not shown. */
  | 'superseded';

const KINDS: readonly ProcessingErrorKind[] = ['invalidInput', 'backend', 'worker', 'timeout', 'invalidResult', 'superseded'];

/** i18n keys used as `message` (the pages translate them with `processingErrorMessage`). */
export const ERROR_KEYS = {
  invalidRegex: 'errors.invalidRegex',
  regexTooComplex: 'errors.regexTooComplex',
  /** A JS regex match would cut a character (surrogate pair) apart: the result would be damaged text. */
  regexSplitsCharacter: 'errors.regexSplitsCharacter',
  /** A plain (non-regex) split delimiter is empty (Paket 10 E4): never a split into characters. */
  emptyDelimiter: 'errors.emptyDelimiter',
  /** A regex pattern is empty (Paket 10 E3; a pattern of spaces is allowed). */
  patternEmpty: 'errors.patternEmpty',
  /** A regex pattern is longer than `MAX_PATTERN_LENGTH` UTF-16 code units (Paket 10 E3). */
  patternTooLong: 'errors.patternTooLong',
  /** The Filter or Remove mode is not supported (unknown or empty). */
  invalidMode: 'errors.invalidMode',
  /** A regex cannot be run without Web Worker (it could block the UI thread). */
  regexRequiresWorker: 'errors.regexRequiresWorker',
  /** A large sort cannot be run without Web Worker (it would block the UI thread, `SORT_MAIN_THREAD_LIMITS`). */
  sortRequiresWorker: 'errors.sortRequiresWorker',
  /** The diff needs more than `DIFF_WORK_LIMIT` work units (many reordered lines). */
  diffTooComplex: 'errors.diffTooComplex',
  timeout: 'errors.processingTimeout',
  superseded: 'errors.processingSuperseded',
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

/** An unknown or empty Filter/Remove mode: invalid input (Rust `TextError::InvalidMode`), never a silent default. */
export const invalidModeError = (detail?: string) => new ProcessingError('invalidInput', ERROR_KEYS.invalidMode, detail);

/** An empty plain split delimiter: invalid input (Rust `TextError::EmptyDelimiter`), checked before the text is processed. */
export const emptyDelimiterError = (detail?: string) => new ProcessingError('invalidInput', ERROR_KEYS.emptyDelimiter, detail);

export const regexSplitsCharacterError = () =>
  new ProcessingError('invalidInput', ERROR_KEYS.regexSplitsCharacter, 'a match boundary lies inside a UTF-16 surrogate pair');

/**
 * An empty or too long regex pattern (Paket 10 E3, Rust `TextError::PatternEmpty` / `PatternTooLong`): invalid input,
 * checked before the pattern is compiled. `length` = UTF-16 code units of the pattern (only in the detail).
 */
export const patternError = (problem: PatternProblem, length?: number) =>
  new ProcessingError(
    'invalidInput',
    ERROR_KEYS[problem],
    problem === 'patternEmpty' ? 'the regex pattern is empty' : `the regex pattern has ${length ?? 'more than ' + MAX_PATTERN_LENGTH} UTF-16 code units (at most ${MAX_PATTERN_LENGTH})`
  );

/** Invalid split input found by the JS split (`SplitInputError.reason`), as the error of the engines. */
export function splitInputError(reason: 'emptyDelimiter' | 'regexSplitsCharacter' | PatternProblem): ProcessingError {
  if (reason === 'emptyDelimiter') return emptyDelimiterError();
  if (reason === 'regexSplitsCharacter') return regexSplitsCharacterError();
  return patternError(reason);
}

export const supersededError = () => new ProcessingError('superseded', ERROR_KEYS.superseded);

/** True for a processing that was replaced by a newer one of the same type (the pages show nothing for it). */
export const isSuperseded = (error: unknown): boolean => error instanceof ProcessingError && error.kind === 'superseded';

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
    if (kind === 'diffTooComplex') return new ProcessingError('invalidInput', ERROR_KEYS.diffTooComplex, detail);
    if (kind === 'invalidMode') return invalidModeError(detail);
    if (kind === 'emptyDelimiter') return emptyDelimiterError(detail);
    if (kind === 'patternEmpty' || kind === 'patternTooLong') return new ProcessingError('invalidInput', ERROR_KEYS[kind], detail);
    // The Rust job slot replaced this request by a newer one before it ran. BaseService reports it as `superseded`
    // when a newer job exists; for the latest job (requests arrived out of order) it stays a visible backend error.
    if (kind === 'superseded') return new ProcessingError('backend', ERROR_KEYS.general, 'superseded by a newer backend request');
    return new ProcessingError('backend', ERROR_KEYS.general, detail ?? String(kind));
  }
  return toProcessingError(error, 'backend');
}

/** Logs an error once without input text: invalid input is a warning, a superseded job debug, everything else an error. */
export function logProcessingError(context: string, error: unknown) {
  const e = error instanceof ProcessingError ? error : toProcessingError(error, 'worker');
  const text = `${context}: ${e.kind} (${e.message})${e.detail ? ` - ${e.detail}` : ''}`;
  if (e.kind === 'superseded') window.logger.debug(text);
  else if (e.kind === 'invalidInput') window.logger.warn(text);
  else window.logger.error(text);
}

/**
 * Page side of a failed processing: returns the translated message for the snackbar.
 * `ProcessingError`s were already logged (useBackendProcessor / `unwrapResult`); other errors are logged here.
 * An invalid regex shows the message of the engine that rejected it (JS `SyntaxError` or fancy-regex parse error);
 * technical details of other errors are only logged.
 */
export function processingErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ProcessingError) {
    return error.message === ERROR_KEYS.invalidRegex && error.detail ? `${t(error.message)}: ${error.detail}` : t(error.message);
  }
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
  // `null`: the platform does not provide the memory metric (Rust `memory_stats()` returned None)
  ((value as BackendMetrics).memory_usage_kb === null || Number.isFinite((value as BackendMetrics).memory_usage_kb));

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

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Structure of a pattern preview: rows of odd length with non-empty matches, valid omissions (`src/utils/matchPreview.ts`). */
export function isMatchPreviewData(value: unknown): value is MatchPreviewData {
  if (!value || typeof value !== 'object') return false;
  const data = value as MatchPreviewData;
  if (!Array.isArray(data.rows) || !isCount(data.matches) || typeof data.complete !== 'boolean' || typeof data.keepSplitCutsCharacter !== 'boolean') return false;
  return data.rows.every(
    (row) =>
      !!row &&
      isCount(row.line) && row.line > 0 &&
      isStringArray(row.segments) && row.segments.length % 2 === 1 && row.segments.length >= 3 &&
      row.segments.every((segment, index) => index % 2 === 0 || segment !== '') &&
      isCount(row.restOmitted) &&
      Array.isArray(row.elided) &&
      row.elided.every((e) => !!e && isCount(e.segment) && e.segment < row.segments.length && isCount(e.at) && e.at <= row.segments[e.segment].length && isCount(e.omitted) && e.omitted > 0)
  );
}

const VALIDATORS: Record<NonNullable<myResultDataType>, (value: unknown) => boolean> = {
  Text: isString,
  Column: isStringArray,
  ColumnList: isStringArrayArray,
  TextV2: isTextV2,
  // Structure and every invariant of the line diff (`src/utils/diff/validate.ts`)
  Diff: isDiffData,
  MatchPreview: isMatchPreviewData,
};

/** Data type of a `myResult` type. */
export interface ResultData {
  Text: string;
  Column: string[];
  ColumnList: string[][];
  TextV2: RemoveResultData;
  Diff: DiffData;
  MatchPreview: MatchPreviewData;
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
