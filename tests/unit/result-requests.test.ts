// Request comparison of the processing pages (Paket 12 C1, contract docs/analyse/Paket12-PhaseB-Stale-Results-Vertrag.md §3).
// Expectations are written out per field and per action/mode: they do not use the functions under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameSortRequest,
  sameFilterRequest,
  sameRemoveRequest,
  sameDiffRequest,
  sameSplitRequest,
  sortUsesCase,
  type SortRequest,
  type FilterRequest,
  type RemoveRequest,
  type DiffRequest,
  type SplitRequest,
} from '../../src/utils/resultRequests.ts';

type Same<T> = (a: T, b: T) => boolean;

/** Large texts that differ only in their last character (same length) and in their length. */
const BIG = 'line\n'.repeat(200_000);
const BIG_LAST = BIG.slice(0, -1) + 'x';
const BIG_LONGER = BIG + 'x';
// A second string object with the same content as BIG (not the same reference)
const BIG_COPY = ['line\n'.repeat(100_000), 'line\n'.repeat(100_000)].join('');

/**
 * Checks one comparison for `base`: equal to a structural copy, `false` for every change in `different`, `true` for every
 * change in `ignored`, equal again after returning to the base values, and the arguments stay unchanged. Every change is
 * checked in both argument orders when `symmetric`.
 */
function checkTable<T extends object>(
  same: Same<T>,
  base: T,
  different: Partial<T>[],
  ignored: Partial<T>[],
  label: string,
  symmetric = true,
) {
  const frozen = Object.freeze({ ...base });
  assert.equal(same(frozen, Object.freeze({ ...base })), true, `${label}: identical request`);
  for (const change of different) {
    const changed = Object.freeze({ ...base, ...change });
    assert.equal(same(frozen, changed), false, `${label}: ${JSON.stringify(change).slice(0, 80)} must differ`);
    if (symmetric) assert.equal(same(changed, frozen), false, `${label}: ${JSON.stringify(change).slice(0, 80)} must differ (reversed)`);
    // Back to the base values: equal again
    assert.equal(same(frozen, Object.freeze({ ...changed, ...base })), true, `${label}: back to the base after ${Object.keys(change)}`);
  }
  for (const change of ignored) {
    const changed = Object.freeze({ ...base, ...change });
    assert.equal(same(frozen, changed), true, `${label}: ${JSON.stringify(change)} must be ignored`);
    if (symmetric) assert.equal(same(changed, frozen), true, `${label}: ${JSON.stringify(change)} must be ignored (reversed)`);
  }
}

/** The texts are compared exactly: same content (other string object) is equal, other content or length is not. */
function checkBigTexts<T extends object>(same: Same<T>, base: T, field: keyof T, label: string) {
  const big = { ...base, [field]: BIG } as T;
  assert.equal(same(big, { ...base, [field]: BIG_COPY } as T), true, `${label}: same large text, other string object`);
  assert.equal(same(big, { ...base, [field]: BIG_LAST } as T), false, `${label}: large text, last character changed`);
  assert.equal(same(big, { ...base, [field]: BIG_LONGER } as T), false, `${label}: large text, one character longer`);
}

/** No normalization: line endings, surrounding whitespace and case of the texts all count. */
const TEXT_VARIANTS = ['a\r\nb', 'a\rb', 'a\nb\n', ' a\nb', 'A\nb', 'a\nb '];

// --- Sort ---

const sortBase: SortRequest = { sourceText: 'a\nb', sortMethod: 'alphabetical', caseSensitive: true };
const CASE_METHODS = ['alphabetical', 'alphabeticalReverse', 'natural', 'naturalReverse'] as const;
const NO_CASE_METHODS = ['lengthAsc', 'lengthDesc', 'random'] as const;

test('sort: the case option is used by alphabetical and natural only (as on the Sort page so far)', () => {
  for (const method of CASE_METHODS) assert.equal(sortUsesCase(method), true, method);
  for (const method of NO_CASE_METHODS) assert.equal(sortUsesCase(method), false, method);
});

test('sort: methods with case option - text, method and case count', () => {
  for (const sortMethod of CASE_METHODS) {
    const base: SortRequest = { ...sortBase, sortMethod };
    const otherMethod = sortMethod === 'natural' ? 'alphabetical' : 'natural';
    checkTable(
      sameSortRequest,
      base,
      [{ sourceText: 'b\na' }, { sourceText: '' }, ...TEXT_VARIANTS.map((sourceText) => ({ sourceText })), { sortMethod: otherMethod }, { sortMethod: 'lengthAsc' }, { caseSensitive: false }],
      [],
      `sort ${sortMethod}`,
    );
  }
});

test('sort: line length and random - the case option is ignored, text and method count', () => {
  for (const sortMethod of NO_CASE_METHODS) {
    const base: SortRequest = { ...sortBase, sortMethod };
    const otherMethod = sortMethod === 'random' ? 'lengthAsc' : 'random';
    checkTable(sameSortRequest, base, [{ sourceText: 'b\na' }, { sortMethod: otherMethod }, { sortMethod: 'alphabetical' }], [{ caseSensitive: false }], `sort ${sortMethod}`);
  }
});

test('sort: every pair of different methods differs', () => {
  const methods = [...CASE_METHODS, ...NO_CASE_METHODS];
  for (const a of methods) {
    for (const b of methods) {
      assert.equal(sameSortRequest({ ...sortBase, sortMethod: a }, { ...sortBase, sortMethod: b }), a === b, `${a} / ${b}`);
    }
  }
});

test('sort: large texts', () => checkBigTexts(sameSortRequest, sortBase, 'sourceText', 'sort'));

// --- Filter ---

const filterBase: FilterRequest = { action: 'keep', sourceText: 'apple\nbanana', pattern: 'an', caseSensitive: true, splitMatches: false, processingMode: 'backend' };

test('filter keep: action, text, pattern, case, splitMatches and engine count', () => {
  checkTable(
    sameFilterRequest,
    filterBase,
    [
      { action: 'remove' },
      { sourceText: 'apple' },
      ...TEXT_VARIANTS.map((sourceText) => ({ sourceText })),
      { pattern: 'a' },
      { pattern: 'AN' },
      { pattern: 'an ' },
      { caseSensitive: false },
      { splitMatches: true },
      { processingMode: 'fallback' },
    ],
    [],
    'filter keep',
  );
});

test('filter remove: splitMatches is ignored, everything else counts', () => {
  const base: FilterRequest = { ...filterBase, action: 'remove' };
  checkTable(
    sameFilterRequest,
    base,
    [{ action: 'keep' }, { sourceText: 'apple' }, { pattern: 'a' }, { caseSensitive: false }, { processingMode: 'fallback' }],
    [{ splitMatches: true }],
    'filter remove',
  );
  // Both splitMatches values are ignored in either direction
  assert.equal(sameFilterRequest({ ...base, splitMatches: true }, { ...base, splitMatches: false }), true);
});

test('filter: different actions are never the same request (also when every other value is equal)', () => {
  for (const splitMatches of [false, true]) {
    for (const processingMode of ['backend', 'fallback'] as const) {
      const keep: FilterRequest = { ...filterBase, splitMatches, processingMode };
      assert.equal(sameFilterRequest(keep, { ...keep, action: 'remove' }), false);
      assert.equal(sameFilterRequest({ ...keep, action: 'remove' }, keep), false);
    }
  }
});

test('filter: large texts and patterns', () => {
  checkBigTexts(sameFilterRequest, filterBase, 'sourceText', 'filter text');
  checkBigTexts(sameFilterRequest, filterBase, 'pattern', 'filter pattern');
});

// --- Remove ---

const removeBase: RemoveRequest = { action: 'duplicates', sourceText: 'a\na\nb', pattern: 'x', useRegex: false, caseSensitive: true, trim: true, processingMode: 'backend' };

test('remove duplicates: text, case and trim count; pattern, regex and engine are ignored', () => {
  for (const useRegex of [false, true]) {
    checkTable(
      sameRemoveRequest,
      { ...removeBase, useRegex },
      [{ action: 'containing' }, { action: 'notContaining' }, { sourceText: 'a\nb' }, ...TEXT_VARIANTS.map((sourceText) => ({ sourceText })), { caseSensitive: false }, { trim: false }],
      [{ pattern: 'y' }, { pattern: '' }, { useRegex: !useRegex }, { processingMode: 'fallback' }, { pattern: 'y', useRegex: !useRegex, processingMode: 'fallback' }],
      `remove duplicates (useRegex ${useRegex})`,
    );
  }
});

for (const action of ['containing', 'notContaining'] as const) {
  const other = action === 'containing' ? 'notContaining' : 'containing';

  test(`remove ${action}, plain search: text, pattern, regex and case count; trim and engine are ignored`, () => {
    checkTable(
      sameRemoveRequest,
      { ...removeBase, action, useRegex: false },
      [{ action: other }, { action: 'duplicates' }, { sourceText: 'a\nb' }, { pattern: 'y' }, { pattern: 'X' }, { useRegex: true }, { caseSensitive: false }],
      [{ trim: false }, { processingMode: 'fallback' }],
      `remove ${action} plain`,
    );
  });

  test(`remove ${action}, regex: the engine counts as well; trim is ignored`, () => {
    checkTable(
      sameRemoveRequest,
      { ...removeBase, action, useRegex: true },
      [{ action: other }, { action: 'duplicates' }, { sourceText: 'a\nb' }, { pattern: 'y' }, { useRegex: false }, { caseSensitive: false }, { processingMode: 'fallback' }],
      [{ trim: false }],
      `remove ${action} regex`,
    );
  });
}

test('remove: regex and engine combinations of containing (engine only with regex)', () => {
  const base: RemoveRequest = { ...removeBase, action: 'containing' };
  const cases: [Partial<RemoveRequest>, Partial<RemoveRequest>, boolean][] = [
    [{ useRegex: false, processingMode: 'backend' }, { useRegex: false, processingMode: 'fallback' }, true],
    [{ useRegex: true, processingMode: 'backend' }, { useRegex: true, processingMode: 'fallback' }, false],
    [{ useRegex: true, processingMode: 'fallback' }, { useRegex: true, processingMode: 'fallback' }, true],
    [{ useRegex: false, processingMode: 'backend' }, { useRegex: true, processingMode: 'backend' }, false],
    [{ useRegex: true, processingMode: 'backend' }, { useRegex: false, processingMode: 'fallback' }, false],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(sameRemoveRequest({ ...base, ...a }, { ...base, ...b }), expected, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
    assert.equal(sameRemoveRequest({ ...base, ...b }, { ...base, ...a }), expected, `${JSON.stringify(b)} / ${JSON.stringify(a)}`);
  }
});

test('remove: different actions are never the same request, also when only ignored options differ', () => {
  const actions = ['duplicates', 'containing', 'notContaining'] as const;
  for (const a of actions) {
    for (const b of actions) {
      assert.equal(sameRemoveRequest({ ...removeBase, action: a }, { ...removeBase, action: b }), a === b, `${a} / ${b}`);
    }
  }
});

test('remove: large texts and patterns', () => {
  checkBigTexts(sameRemoveRequest, removeBase, 'sourceText', 'remove duplicates text');
  checkBigTexts(sameRemoveRequest, { ...removeBase, action: 'containing' }, 'sourceText', 'remove containing text');
  checkBigTexts(sameRemoveRequest, { ...removeBase, action: 'containing' }, 'pattern', 'remove containing pattern');
});

// --- Diff ---

const diffBase: DiffRequest = { sourceText: 'Die Katze schläft', newText: 'Die Katze träumt', ignoreWhitespace: false };

test('diff: old text, new text and ignoreWhitespace count, each on its own', () => {
  checkTable(
    sameDiffRequest,
    diffBase,
    [
      { sourceText: 'Die Katze träumt' },
      { newText: 'Die Katze schläft' },
      { sourceText: 'Die Katze schläft ' },
      { newText: 'die Katze träumt' },
      { ignoreWhitespace: true },
      // Swapped texts are another comparison
      { sourceText: diffBase.newText, newText: diffBase.sourceText },
      { sourceText: '' },
      { newText: '' },
    ],
    [],
    'diff',
  );
  for (const sourceText of TEXT_VARIANTS) assert.equal(sameDiffRequest({ ...diffBase, sourceText: 'a\nb' }, { ...diffBase, sourceText }), false, JSON.stringify(sourceText));
});

test('diff: word diff and display options are no part of the request', () => {
  // Extra properties of a caller (not part of DiffRequest) never change the result
  const withDisplay = { ...diffBase, wordDiff: true, diffViewType: 'split', showLineNumbers: false, rowLimit: 4000 } as DiffRequest;
  assert.equal(sameDiffRequest(diffBase, withDisplay), true);
  assert.equal(sameDiffRequest(withDisplay, { ...diffBase, wordDiff: false } as DiffRequest), true);
});

test('diff: large texts on both sides', () => {
  checkBigTexts(sameDiffRequest, diffBase, 'sourceText', 'diff old text');
  checkBigTexts(sameDiffRequest, diffBase, 'newText', 'diff new text');
});

// --- Split ---

const splitBase: SplitRequest = { sourceText: 'a_b\nc_d', delimiter: '_', useRegex: false, trimParts: false, keepEmptyLines: true, processingMode: 'backend' };

test('split, plain delimiter: text, delimiter and options count; the engine is ignored', () => {
  checkTable(
    sameSplitRequest,
    splitBase,
    [
      { sourceText: 'a_b' },
      ...TEXT_VARIANTS.map((sourceText) => ({ sourceText })),
      { delimiter: '-' },
      { delimiter: '_ ' },
      { delimiter: ' ' },
      { useRegex: true },
      { trimParts: true },
      { keepEmptyLines: false },
    ],
    [{ processingMode: 'fallback' }],
    'split plain',
  );
});

test('split, regex: the engine counts as well', () => {
  checkTable(
    sameSplitRequest,
    { ...splitBase, delimiter: '\\s+', useRegex: true },
    [{ sourceText: 'a_b' }, { delimiter: '\\s' }, { useRegex: false }, { trimParts: true }, { keepEmptyLines: false }, { processingMode: 'fallback' }],
    [],
    'split regex',
  );
});

test('split: regex and engine combinations (engine only with regex)', () => {
  const cases: [Partial<SplitRequest>, Partial<SplitRequest>, boolean][] = [
    [{ useRegex: false, processingMode: 'backend' }, { useRegex: false, processingMode: 'fallback' }, true],
    [{ useRegex: true, processingMode: 'backend' }, { useRegex: true, processingMode: 'fallback' }, false],
    [{ useRegex: true, processingMode: 'fallback' }, { useRegex: true, processingMode: 'fallback' }, true],
    [{ useRegex: false, processingMode: 'fallback' }, { useRegex: true, processingMode: 'fallback' }, false],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(sameSplitRequest({ ...splitBase, ...a }, { ...splitBase, ...b }), expected, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
    assert.equal(sameSplitRequest({ ...splitBase, ...b }, { ...splitBase, ...a }), expected, `${JSON.stringify(b)} / ${JSON.stringify(a)}`);
  }
});

test('split: keepEmptyLines is the derived boolean (both values count), trimLine and display options are no part', () => {
  assert.equal(sameSplitRequest({ ...splitBase, keepEmptyLines: true }, { ...splitBase, keepEmptyLines: false }), false);
  assert.equal(sameSplitRequest({ ...splitBase, keepEmptyLines: false }, { ...splitBase, keepEmptyLines: false }), true);
  const withDisplay = { ...splitBase, trimLine: true, showLineNumbers: true, fontSize: 'text-lg', combineSeparator: ';' } as SplitRequest;
  assert.equal(sameSplitRequest(splitBase, withDisplay), true);
  assert.equal(sameSplitRequest(withDisplay, { ...splitBase, trimLine: false } as SplitRequest), true);
});

test('split: large texts and delimiters', () => {
  checkBigTexts(sameSplitRequest, splitBase, 'sourceText', 'split text');
  checkBigTexts(sameSplitRequest, splitBase, 'delimiter', 'split delimiter');
});

// --- All ---

test('the comparisons do not change their arguments (frozen and deep-equal afterwards)', () => {
  const pairs: [Same<any>, object][] = [
    [sameSortRequest, sortBase],
    [sameFilterRequest, filterBase],
    [sameRemoveRequest, removeBase],
    [sameRemoveRequest, { ...removeBase, action: 'containing', useRegex: true }],
    [sameDiffRequest, diffBase],
    [sameSplitRequest, { ...splitBase, useRegex: true }],
  ];
  for (const [same, base] of pairs) {
    const a = Object.freeze({ ...base, sourceText: BIG });
    const b = Object.freeze({ ...base, sourceText: BIG_LAST });
    const before = [JSON.stringify(a), JSON.stringify(b)];
    // Frozen arguments: a write would throw in strict mode (ES modules)
    same(a, b);
    same(b, a);
    same(a, a);
    assert.deepEqual([JSON.stringify(a), JSON.stringify(b)], before);
  }
});
