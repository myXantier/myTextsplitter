// Split logic of the JS engine (Web Worker and main-thread fallback).
// Only imports the line model and the pattern rule, so it can be unit-tested with plain Node (`npm test`).
// Shared fixtures with the Rust engine: tests/fixtures/split-cases.json
import { splitLines } from './lines.ts';
import { patternProblem, type PatternProblem } from './regexPattern.ts';

export interface SplitOptions {
  trimParts: boolean;
  useRegex: boolean;
  /** `false` skips completely empty input lines. Whitespace-only lines are not empty and are always kept. */
  keepEmptyLines: boolean;
}

/**
 * Invalid split input found by `splitLinesToColumns` (the worker and the main-thread fallback report it as
 * `invalidInput` with the message key of `reason`). Never a partial result.
 * - `emptyDelimiter`: an empty plain delimiter (Paket 10 E4), checked before any line is processed.
 * - `patternEmpty` / `patternTooLong`: an empty or too long regex pattern (Paket 10 E3), checked before it is compiled.
 * - `regexSplitsCharacter`: a regex split would cut a surrogate pair apart (Paket 10 E5).
 */
export class SplitInputError extends Error {
  readonly reason: 'emptyDelimiter' | 'regexSplitsCharacter' | PatternProblem;

  constructor(reason: SplitInputError['reason']) {
    super(SPLIT_INPUT_MESSAGES[reason]);
    this.name = 'SplitInputError';
    this.reason = reason;
  }
}

const SURROGATE = /[\uD800-\uDFFF]/;
const SPLIT_INPUT_MESSAGES: Record<SplitInputError['reason'], string> = {
  emptyDelimiter: 'the plain delimiter is empty',
  patternEmpty: 'the regex pattern is empty',
  patternTooLong: 'the regex pattern is too long',
  regexSplitsCharacter: 'a split position or capture lies inside a UTF-16 surrogate pair',
};

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** True if `index` lies between the two halves of a surrogate pair of `text`. Lone surrogates of the input are no pair. */
const insidePair = (text: string, index: number): boolean =>
  index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index));

/** True if `text` contains a lone surrogate (no `String.prototype.isWellFormed`: older WebViews lack it). */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(i + 1))) i++;
    else if (isHighSurrogate(unit) || isLowSurrogate(unit)) return true;
  }
  return false;
}

/** A match with indices (flag `d`, ES2022; the project's TypeScript lib predates it): start/end of every capture. */
type MatchWithIndices = RegExpExecArray & { indices?: ([number, number] | undefined)[] };

/** RegExp match indices are missing in very old WebViews. */
const HAS_MATCH_INDICES = (() => {
  try {
    return (new RegExp('', 'd') as RegExp & { hasIndices?: boolean }).hasIndices === true;
  } catch {
    return false;
  }
})();

/**
 * `line.split(regex)` for a line with surrogates, with the effective split positions and captures checked (Paket 10 E5).
 * Follows the steps of `RegExp.prototype[Symbol.split]` (ECMAScript, flags without `u`): a match is tried at q = p, p+1, …;
 * an empty match that ends at the end of the previous split p (e = p) is skipped, so is a match at the end of the line.
 * A global search from q finds the same first match as the sticky attempts at q, q+1, … of the specification, because both
 * take the leftmost position with a match. Every effective split position (start and end of the match) and every
 * non-empty participating capture (inserted as an own part) must lie at a character boundary, otherwise the whole split is refused:
 * no column between the two halves of a character and no lone half in a capture. An empty capture holds no text and only
 * adds an empty column, so its position does not matter. Keeps only the current match.
 * `regex` has the flags of the normal split plus `d`; without match indices a match with non-empty captures cannot be checked and
 * is refused as well (controlled error instead of unprotected processing).
 */
function splitCheckingSurrogates(line: string, regex: RegExp): (string | undefined)[] {
  const parts: (string | undefined)[] = [];
  const size = line.length;
  let p = 0;
  let q = 0;
  while (q < size) {
    regex.lastIndex = q;
    const match = regex.exec(line) as MatchWithIndices | null;
    if (!match || match.index >= size) break;
    const start = match.index;
    const end = Math.min(start + match[0].length, size);
    if (end === p) {
      // Empty match at the end of the previous split (start = q = p): split ignores it and tries the next position
      q = start + 1;
      continue;
    }
    if (insidePair(line, start) || insidePair(line, end)) throw new SplitInputError('regexSplitsCharacter');
    if (match.length > 1) {
      const indices = match.indices;
      for (let group = 1; group < match.length; group++) {
        // A non-participating or empty capture holds no text: it only adds an empty column, wherever it lies
        if (!match[group]) continue;
        const span = indices?.[group];
        if (!span || insidePair(line, span[0]) || insidePair(line, span[1])) throw new SplitInputError('regexSplitsCharacter');
      }
    }
    parts.push(line.slice(p, start), ...match.slice(1));
    p = end;
    q = p;
  }
  parts.push(line.slice(p));
  return parts;
}

/** Plain delimiter: only a delimiter with a lone surrogate can start or end inside a pair (a well-formed one cannot). */
function assertPlainSplitKeepsCharacters(line: string, delimiter: string) {
  for (let index = line.indexOf(delimiter); index >= 0; index = line.indexOf(delimiter, index + delimiter.length)) {
    if (insidePair(line, index) || insidePair(line, index + delimiter.length)) throw new SplitInputError('regexSplitsCharacter');
  }
}

/**
 * Splits every line into parts; `columns[i][row]` is the i-th part of input row `row`.
 * `lines` are data lines of the shared line model (`splitLines`): without terminators, no row for a trailing newline.
 * Each processed row is represented exactly once in every column (missing parts are `''`).
 * Throws a `SyntaxError` for an invalid regex and a `SplitInputError` for an empty plain delimiter, an empty or too long
 * regex pattern or a split that would cut a character (surrogate pair); all before any result is returned.
 */
export function splitLinesToColumns(lines: string[], delimiter: string, options: SplitOptions): string[][] {
  const { trimParts, useRegex, keepEmptyLines } = options;
  // Paket 10 E4/E3: checked first, also for an empty text; the regex pattern rule before the pattern is compiled
  if (!useRegex && delimiter === '') throw new SplitInputError('emptyDelimiter');
  const problem = useRegex ? patternProblem(delimiter) : null;
  if (problem) throw new SplitInputError(problem);
  // Paket 10 E9: flag g only, like Rust (no multiline: ^ and $ only at the start and end of the data line, not at U+2028/U+2029)
  const regex = useRegex ? new RegExp(delimiter, 'g') : null;
  /** The same regex with match indices, only built for lines with surrogates */
  let checkedRegex: RegExp | null = null;
  const plainNeedsCheck = !useRegex && hasLoneSurrogate(delimiter);
  const columns: string[][] = [];
  let rows = 0;

  lines.forEach((line) => {
    if (!keepEmptyLines && line === '') return;

    let rawParts: (string | undefined)[];
    if (regex && SURROGATE.test(line)) {
      // Match indices (flag `d`) allocate per match: only for a pattern with capture groups (`<pattern>|` matches '' and
      // yields one entry per group)
      checkedRegex ??= new RegExp(delimiter, HAS_MATCH_INDICES && new RegExp(`${delimiter}|`).exec('')!.length > 1 ? 'gd' : 'g');
      rawParts = splitCheckingSurrogates(line, checkedRegex);
    } else {
      if (plainNeedsCheck && SURROGATE.test(line)) assertPlainSplitKeepsCharacters(line, delimiter);
      rawParts = line.split(regex ?? delimiter);
    }
    // Capture groups that did not participate in the match are `undefined`
    const parts = rawParts.map((part) => part ?? '');
    parts.forEach((part, index) => {
      // A new column must also hold a value for all previous rows (B1)
      if (!columns[index]) columns[index] = new Array<string>(rows).fill('');
      columns[index].push(trimParts ? part.trim() : part);
    });

    // Sicherstellen, dass alle Spalten gleich lang sind
    for (let i = parts.length; i < columns.length; i++) {
      columns[i].push(''); // Fehlende Werte mit "" auffüllen
    }
    rows++;
  });

  return columns;
}

export function splitTextToColumns(text: string, delimiter: string, options: SplitOptions): string[][] {
  return splitLinesToColumns(splitLines(text).lines, delimiter, options);
}
