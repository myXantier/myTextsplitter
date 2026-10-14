/** Utility functions for regex handling with the native JS RegExp engine */
import { invalidRegexError } from '../services/ProcessingError';

export const MAX_PATTERN_LENGTH = 10_000;

/** Engine-neutral precheck (non-empty, at most MAX_PATTERN_LENGTH). No syntax check: Rust and JS have different dialects. */
export const hasValidPatternLength = (pattern: string): boolean => !!pattern && pattern.length <= MAX_PATTERN_LENGTH;

/** True if the native JS RegExp engine accepts the pattern (JS dialect only, not valid for the Rust backend) */
export const validateRegexPattern = (pattern: string): boolean => {
  if (!hasValidPatternLength(pattern)) return false;

  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/**
 * Compiles a user pattern with the native JS RegExp engine. Throws an `invalidInput` ProcessingError that keeps
 * the engine's message as detail. Compiling is safe in any thread; *executing* a user regex is not (see BaseService).
 */
export function compileUserRegex(pattern: string, flags: string): RegExp {
  if (!hasValidPatternLength(pattern)) throw invalidRegexError();
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw invalidRegexError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Executes a regex synchronously. There is **no** timeout protection (a timer in the same thread cannot stop a
 * running regex): call it only in a Web Worker for user patterns. Not used by the active text processing.
 */
export const safeRegexExec = (pattern: string, input: string): RegExpExecArray | null => {
  if (!validateRegexPattern(pattern)) return null;
  return new RegExp(pattern).exec(input);
};

/** Escape a string by replacing <, >, &, ', ", `, \ and / with HTML entities. */
export const escapeString = (str: string) => {
  return str
    .replace(/&/g, `&amp;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#x27;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/\//g, `&#x2F;`)
    .replace(/\\/g, `&#x5C;`)
    .replace(/`/g, `&#96;`);
};

/** Escape a string by replacing <, >, &, ', ", `, \ and / with HTML entities. */
export const unescapeString = (str: string) => {
  return str
    .replace(/&quot;/g, `"`)
    .replace(/&#x27;/g, `'`)
    .replace(/&lt;/g, `<`)
    .replace(/&gt;/g, `>`)
    .replace(/&#x2F;/g, `/`)
    .replace(/&#x5C;/g, `\\`)
    .replace(/&#96;/g, "`")
    .replace(/&amp;/g, `&`); // <-- must be last
};