// Split regression tests for the JS engine (Web Worker + main-thread fallback share `splitColumns.ts`).
// The fixtures in `tests/fixtures/split-cases.json` are also run against the Rust engine (`cargo test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { splitLinesToColumns, splitTextToColumns } from '../../src/utils/splitColumns.ts';

interface SplitCase {
  name: string;
  input: string;
  delimiter: string;
  useRegex?: boolean;
  trimParts?: boolean;
  keepEmptyLines?: boolean;
  expected?: string[][];
  expectedRust?: string[][];
  expectedJs?: string[][];
  divergence?: string;
}

const fixtures: { cases: SplitCase[] } = JSON.parse(
  readFileSync(new URL('../fixtures/split-cases.json', import.meta.url), 'utf8')
);

const optionsOf = (c: SplitCase) => ({
  useRegex: c.useRegex ?? false,
  trimParts: c.trimParts ?? false,
  keepEmptyLines: c.keepEmptyLines ?? true,
});

/** Every input row must be represented exactly once in every column. */
function assertRectangular(columns: string[][]) {
  const rows = columns[0]?.length ?? 0;
  columns.forEach((col, i) => assert.equal(col.length, rows, `column ${i + 1} has ${col.length} rows, expected ${rows}`));
}

test('split fixtures are well-formed', () => {
  assert.ok(fixtures.cases.length > 0);
  const names = new Set<string>();
  for (const c of fixtures.cases) {
    assert.ok(!names.has(c.name), `duplicate fixture name: ${c.name}`);
    names.add(c.name);
    const shared = c.expected !== undefined;
    const perEngine = c.expectedRust !== undefined && c.expectedJs !== undefined;
    assert.ok(shared !== perEngine, `${c.name}: use either 'expected' or 'expectedRust' + 'expectedJs'`);
    assert.equal(perEngine, !!c.divergence, `${c.name}: per-engine expectations need a 'divergence' explanation`);
  }
});

for (const c of fixtures.cases) {
  test(`split (JS): ${c.name}`, () => {
    const result = splitTextToColumns(c.input, c.delimiter, optionsOf(c));
    assert.deepEqual(result, c.expectedJs ?? c.expected);
    assertRectangular(result);
  });
}

test('split (JS): worker entry point (pre-split lines) matches the text entry point', () => {
  for (const c of fixtures.cases) {
    assert.deepEqual(splitLinesToColumns(c.input.split('\n'), c.delimiter, optionsOf(c)), splitTextToColumns(c.input, c.delimiter, optionsOf(c)), c.name);
  }
});

test('split (JS): combining columns row by row keeps rows aligned', () => {
  // Same row-wise join as the JS combine (LeftMenuBar.appendColumnFrontend)
  const columns = splitTextToColumns('A,B\nC,D,E\n\nF,G', ',', { useRegex: false, trimParts: false, keepEmptyLines: true });
  const combined = columns[0].map((_, row) => [columns[2][row], columns[0][row]].join(':'));
  assert.deepEqual(combined, [':A', 'E:C', ':', ':F']);
});

test('split (JS): invalid regex throws', () => {
  assert.throws(() => splitTextToColumns('a', '([a-', { useRegex: true, trimParts: false, keepEmptyLines: true }), SyntaxError);
});
