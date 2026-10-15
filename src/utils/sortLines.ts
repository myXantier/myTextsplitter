// Sort of the Sort page (Paket 9 C1; JS only, there is no Rust implementation). Framework-free.
// Contract and golden fixtures: tests/fixtures/sort-cases.json, line model: tests/fixtures/line-endings-cases.json.
import { joinLines, splitLines } from './lines.ts';
import { isBlankLine } from './diff/whitespace.ts';
import { lineOrder, type SortKind } from './sort/compare.ts';
import { invalidModeError } from '../services/ProcessingError.ts';

export const SORT_METHODS = ['alphabetical', 'alphabeticalReverse', 'natural', 'naturalReverse', 'lengthAsc', 'lengthDesc', 'random'] as const;
export type SortMethod = (typeof SORT_METHODS)[number];

/** Only the methods above, exactly as written; anything else is invalid input (`errors.invalidMode`), never a default. */
export function assertSortMethod(method: unknown): asserts method is SortMethod {
  if (!(SORT_METHODS as readonly unknown[]).includes(method)) throw invalidModeError(`unknown sort method ${JSON.stringify(method)}`);
}

const ORDERS: Record<Exclude<SortMethod, 'random'>, [SortKind, 1 | -1]> = {
  alphabetical: ['alphabetical', 1],
  alphabeticalReverse: ['alphabetical', -1],
  natural: ['natural', 1],
  naturalReverse: ['natural', -1],
  lengthAsc: ['length', 1],
  lengthDesc: ['length', -1],
};

export interface SortOptions {
  /** Random source of `random` (values in [0, 1)); default `Math.random`. Injected by tests for reproducible runs. */
  random?: () => number;
}

/** Uniform shuffle (Fisher-Yates) of a copy. */
export function shuffleLines(lines: readonly string[], random: () => number = Math.random): string[] {
  const result = [...lines];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Stable sort with keys computed once per line; reverse methods negate the comparison, not the result. */
function sortByKey(lines: readonly string[], kind: SortKind, direction: 1 | -1, caseSensitive: boolean): string[] {
  const order = lineOrder(kind, caseSensitive);
  const entries = lines.map((line) => ({ line, key: order.key(line) }));
  entries.sort((a, b) => direction * order.compare(a.key, b.key));
  return entries.map((entry) => entry.line);
}

/**
 * Sorts the lines of `text`. No line is dropped or changed: empty and whitespace-only lines (Unicode White_Space,
 * `isBlankLine`) stay after all other lines in their input order, for every method and direction. The result keeps the
 * line ending and the trailing newline of the input (shared line model). Exception: if the last result line is empty
 * and the input has no trailing newline, a trailing newline is added; without it the text could not tell the empty
 * line apart from a trailing newline and one line would be lost.
 */
export function sortText(text: string, sortMethod: SortMethod, caseSensitive: boolean, options: SortOptions = {}): string {
  assertSortMethod(sortMethod);
  const { lines, ...format } = splitLines(text);
  const data: string[] = [];
  const blank: string[] = [];
  for (const line of lines) (isBlankLine(line) ? blank : data).push(line);

  const sorted =
    sortMethod === 'random' ? shuffleLines(data, options.random) : sortByKey(data, ...ORDERS[sortMethod], caseSensitive);
  const result = sorted.concat(blank);
  const lastLineEmpty = result.length > 0 && result[result.length - 1] === '';
  return joinLines(result, lastLineEmpty ? { ...format, trailingNewline: true } : format);
}
