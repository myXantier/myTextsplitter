/** Utility functions for regex handling with the native JS RegExp engine */
import { invalidRegexError, regexSplitsCharacterError } from '../services/ProcessingError';

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

const SURROGATE = /[\uD800-\uDFFF]/;

/** True if `text` contains a UTF-16 surrogate (a character outside the BMP, e.g. an emoji): only then can a match cut one. */
export const hasSurrogates = (text: string): boolean => SURROGATE.test(text);

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** True if `index` lies between the two halves of a surrogate pair of `text` (a cut there splits one character). */
export const splitsSurrogatePair = (text: string, index: number): boolean =>
  index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index));

/**
 * The matches of the global regex `regex` in `text` (as `text.matchAll`), checked for cut characters while they are
 * produced. A generator: it keeps only the end of the previous non-empty match and one open cut, never a list of
 * matches, so the memory does not grow with the number of matches.
 *
 * Without the 'u' flag a RegExp works on UTF-16 code units, so a match can start or end between the two halves of a
 * surrogate pair (e.g. `.` on an emoji). Such a cut is harmless only where the result puts both halves next to each
 * other again: the previous/next non-empty match continues exactly at the cut and `adjacentMatchesStayJoined` is true
 * (matches concatenated, or removed together). Otherwise the result would contain a lone surrogate or recombine halves
 * of different characters: `regexSplitsCharacterError` is thrown instead of returning damaged text. An end cut waits
 * for the next non-empty match and fails when the matches end first, so the error can come after the last match:
 * consumers must iterate to the end before they use their result. Empty matches cut nothing. Lone surrogates that are
 * already part of `text` are no cut (they are not newly damaged).
 */
export function* matchesWithoutCutCharacters(text: string, regex: RegExp, adjacentMatchesStayJoined: boolean): Generator<RegExpMatchArray, void> {
  let previousEnd = -1;
  /** End of the previous non-empty match inside a surrogate pair: the next non-empty match must start exactly there. */
  let openCut = -1;

  for (const match of text.matchAll(regex)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (start !== end) {
      if (openCut >= 0 && start !== openCut) throw regexSplitsCharacterError();
      openCut = -1;
      if (splitsSurrogatePair(text, start) && !(adjacentMatchesStayJoined && previousEnd === start)) throw regexSplitsCharacterError();
      if (splitsSurrogatePair(text, end)) {
        if (!adjacentMatchesStayJoined) throw regexSplitsCharacterError();
        openCut = end;
      }
      previousEnd = end;
    }
    yield match;
  }

  if (openCut >= 0) throw regexSplitsCharacterError();
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