// Split logic of the JS engine (Web Worker and main-thread fallback).
// Only imports the line model, so it can be unit-tested with plain Node (`npm test`).
// Shared fixtures with the Rust engine: tests/fixtures/split-cases.json
import { splitLines } from './lines.ts';

export interface SplitOptions {
  trimParts: boolean;
  useRegex: boolean;
  /** `false` skips completely empty input lines. Whitespace-only lines are not empty and are always kept. */
  keepEmptyLines: boolean;
}

/**
 * Splits every line into parts; `columns[i][row]` is the i-th part of input row `row`.
 * `lines` are data lines of the shared line model (`splitLines`): without terminators, no row for a trailing newline.
 * Each processed row is represented exactly once in every column (missing parts are `''`).
 * Throws a `SyntaxError` for an invalid regex.
 */
export function splitLinesToColumns(lines: string[], delimiter: string, options: SplitOptions): string[][] {
  const { trimParts, useRegex, keepEmptyLines } = options;
  const regex = useRegex ? new RegExp(delimiter, 'gm') : null;
  const columns: string[][] = [];
  let rows = 0;

  lines.forEach((line) => {
    if (!keepEmptyLines && line === '') return;

    // Capture groups that did not participate in the match are `undefined`
    const parts = line.split(regex ?? delimiter).map((part) => part ?? '');
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
