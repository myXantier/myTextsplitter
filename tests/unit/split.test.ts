// Split regression tests for the JS engine (Web Worker + main-thread fallback share `splitColumns.ts`).
// The fixtures in `tests/fixtures/split-cases.json` are also run against the Rust engine (`cargo test`).
// Paket 10 Phase B: the fixtures also state the target of not yet implemented decisions (`target*` + `pending`), checked
// against the real worker module; the current behaviour stays the asserted expectation (no intentionally red tests).
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SplitInputError, splitLinesToColumns, splitTextToColumns } from '../../src/utils/splitColumns.ts';
import { splitLines } from '../../src/utils/lines.ts';

const { SplitService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { MAX_PATTERN_LENGTH } = await import('../../src/utils/regex.ts');
disableWorkerCleanupInterval(BaseService);
installWindow();

type Columns = string[][];
type SplitError = { error: string };
type Outcome = Columns | SplitError;
type Delimiter = string | { repeat: string; count: number };

interface SplitCase {
  name: string;
  input: string;
  delimiter: Delimiter;
  useRegex?: boolean;
  trimParts?: boolean;
  keepEmptyLines?: boolean;
  expected?: Outcome;
  expectedRust?: Outcome;
  expectedJs?: Outcome;
  /** A string is an accepted dialect difference (Paket 5 form). */
  divergence?: string | { kind: string; reason: string };
  resolved?: string;
  ref?: string;
  target?: Outcome;
  targetRust?: Outcome;
  targetJs?: Outcome;
  pending?: { decisions: string[]; phase: string; engines: string[]; reason: string };
}

const fixtures: { description: string; cases: SplitCase[] } = JSON.parse(
  readFileSync(new URL('../fixtures/split-cases.json', import.meta.url), 'utf8')
);

const CASE_KEYS = ['name', 'input', 'delimiter', 'useRegex', 'trimParts', 'keepEmptyLines', 'expected', 'expectedRust', 'expectedJs', 'divergence', 'resolved', 'ref', 'target', 'targetRust', 'targetJs', 'pending'];
const DIVERGENCE_KINDS = ['dialect', 'utf16Guard', 'utf16Damage', 'unvalidatedInput'];
/** Errors of the current engines (Paket 10 C1: emptyDelimiter, JS only: regexSplitsCharacter). */
const CURRENT_ERRORS = ['invalidRegex', 'emptyDelimiter', 'regexSplitsCharacter'];
/** Errors that only a target may use (Paket 10 decisions); `regexSplitsCharacter` is JS only (Rust never cuts a character). */
const TARGET_ERRORS = ['invalidRegex', 'emptyDelimiter', 'emptyPattern', 'patternTooLong', 'regexSplitsCharacter'];
const DECISIONS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isError = (value: unknown): value is SplitError => isObject(value) && 'error' in value;
const delimiterOf = (d: Delimiter) => (typeof d === 'string' ? d : d.repeat.repeat(d.count));
const optionsOf = (c: SplitCase) => ({
  useRegex: c.useRegex ?? false,
  trimParts: c.trimParts ?? false,
  keepEmptyLines: c.keepEmptyLines ?? true,
});
const jsExpectation = (c: SplitCase) => (c.expectedJs ?? c.expected)!;
const jsTarget = (c: SplitCase) => c.targetJs ?? c.target;

/** Problems of one outcome (columns or `{ error }`); `errors` = allowed error kinds. */
function outcomeProblems(value: unknown, errors: string[]): string[] {
  if (isError(value)) return Object.keys(value).length === 1 && errors.includes(value.error as string) ? [] : [`invalid error ${JSON.stringify(value)}`];
  const columns = Array.isArray(value) && value.every((col) => Array.isArray(col) && col.every((v) => typeof v === 'string'));
  if (!columns) return [`invalid columns ${JSON.stringify(value)}`];
  const rows = (value as Columns)[0]?.length ?? 0;
  return (value as Columns).every((col) => col.length === rows) ? [] : ['columns of different length'];
}

/** All problems of the fixture file; an empty list means well-formed. */
function fixtureProblems(file: unknown): string[] {
  if (!isObject(file) || !Array.isArray(file.cases) || !file.cases.length) return ['cases missing'];
  const problems: string[] = [];
  const names = new Set<string>();
  for (const c of file.cases as Record<string, any>[]) {
    const where = String(c?.name);
    const unknown = Object.keys(c).filter((key) => !CASE_KEYS.includes(key));
    if (unknown.length) problems.push(`${where}: unknown keys ${unknown.join(', ')}`);
    if (typeof c.name !== 'string' || !c.name || names.has(c.name)) problems.push(`${where}: missing or duplicate name`);
    names.add(c.name);
    const d = c.delimiter;
    const delimiterOk = typeof d === 'string' || (isObject(d) && Object.keys(d).length === 2 && typeof d.repeat === 'string' && d.repeat !== '' && Number.isInteger(d.count) && (d.count as number) > 0);
    if (!delimiterOk) problems.push(`${where}: delimiter must be a string or { repeat, count }`);

    const shared = c.expected !== undefined;
    const perEngine = c.expectedRust !== undefined || c.expectedJs !== undefined;
    if (shared === perEngine) problems.push(`${where}: use either 'expected' or 'expectedRust' + 'expectedJs'`);
    if (perEngine && (c.expectedRust === undefined || c.expectedJs === undefined)) problems.push(`${where}: expectedRust and expectedJs belong together`);
    if (perEngine !== (c.divergence !== undefined)) problems.push(`${where}: per-engine expectations need a 'divergence' explanation (and only they)`);
    if (perEngine && JSON.stringify(c.expectedRust) === JSON.stringify(c.expectedJs)) problems.push(`${where}: expectedRust equals expectedJs, use expected`);
    for (const key of ['expected', 'expectedRust', 'expectedJs']) if (c[key] !== undefined) problems.push(...outcomeProblems(c[key], CURRENT_ERRORS).map((p) => `${where}: ${key}: ${p}`));
    const divergence = c.divergence;
    if (divergence !== undefined && typeof divergence !== 'string') {
      if (!isObject(divergence) || Object.keys(divergence).length !== 2 || !DIVERGENCE_KINDS.includes(divergence.kind as string) || typeof divergence.reason !== 'string' || !divergence.reason) {
        problems.push(`${where}: divergence must be a string or { kind: ${DIVERGENCE_KINDS.join(' | ')}, reason }`);
      }
    } else if (divergence === '') problems.push(`${where}: empty divergence`);
    for (const key of ['ref', 'resolved']) if (c[key] !== undefined && (typeof c[key] !== 'string' || !c[key])) problems.push(`${where}: ${key} must be a non-empty string`);
    // Only the JS worker refuses a cut character (Rust never cuts one); it always comes with the utf16Guard divergence
    if ([c.expected, c.expectedRust].some((e) => isError(e) && e.error === 'regexSplitsCharacter')) problems.push(`${where}: regexSplitsCharacter is a JS-only expectation`);
    const refusedByJs = isError(c.expectedJs) && c.expectedJs.error === 'regexSplitsCharacter';
    if (refusedByJs !== (isObject(divergence) && divergence.kind === 'utf16Guard')) problems.push(`${where}: expectedJs regexSplitsCharacter requires the divergence kind utf16Guard and vice versa`);

    // Targets of not yet implemented decisions
    const sharedTarget = c.target !== undefined;
    const engineTarget = c.targetRust !== undefined || c.targetJs !== undefined;
    if (sharedTarget && engineTarget) problems.push(`${where}: use either 'target' or 'targetRust' + 'targetJs'`);
    if (engineTarget && (c.targetRust === undefined || c.targetJs === undefined)) problems.push(`${where}: targetRust and targetJs belong together`);
    if (engineTarget && JSON.stringify(c.targetRust) === JSON.stringify(c.targetJs)) problems.push(`${where}: targetRust equals targetJs, use target`);
    if ((sharedTarget || engineTarget) !== (c.pending !== undefined)) problems.push(`${where}: a target needs 'pending' (and only a target)`);
    for (const key of ['target', 'targetRust', 'targetJs']) if (c[key] !== undefined) problems.push(...outcomeProblems(c[key], TARGET_ERRORS).map((p) => `${where}: ${key}: ${p}`));
    if (isError(c.target) && c.target.error === 'regexSplitsCharacter') problems.push(`${where}: regexSplitsCharacter is a JS-only target`);
    if (isError(c.targetRust) && c.targetRust.error === 'regexSplitsCharacter') problems.push(`${where}: regexSplitsCharacter is a JS-only target`);
    const pending = c.pending;
    if (pending !== undefined) {
      const ok =
        isObject(pending) &&
        Object.keys(pending).length === 4 &&
        Array.isArray(pending.decisions) && pending.decisions.length > 0 && pending.decisions.every((d: unknown) => DECISIONS.includes(d as string)) &&
        ['C1', 'C2'].includes(pending.phase as string) &&
        Array.isArray(pending.engines) && pending.engines.length > 0 && pending.engines.every((e: unknown) => e === 'rust' || e === 'js') && new Set(pending.engines).size === pending.engines.length &&
        typeof pending.reason === 'string' && pending.reason !== '';
      if (!ok) problems.push(`${where}: pending must be { decisions: [E1..E11], phase: C1 | C2, engines: [rust | js], reason }`);
    }
    // A JS split position inside a surrogate pair is a data integrity bug: it must have a pending JS target that refuses it
    if (isObject(divergence) && divergence.kind === 'utf16Damage' && !(isError(c.targetJs ?? c.target) && pending?.engines?.includes('js'))) {
      problems.push(`${where}: utf16Damage needs a pending JS target error`);
    }
  }
  return problems;
}

/** Every input row must be represented exactly once in every column. */
function assertRectangular(columns: string[][]) {
  const rows = columns[0]?.length ?? 0;
  columns.forEach((col, i) => assert.equal(col.length, rows, `column ${i + 1} has ${col.length} rows, expected ${rows}`));
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;
const insidePair = (line: string, index: number) => index > 0 && index < line.length && isHigh(line.charCodeAt(index - 1)) && isLow(line.charCodeAt(index));

/**
 * Test oracle (R2/E5), independent of `splitColumns.ts` (native RegExp/String operations only): true if the JS split of a
 * well-formed `line` damages a character. Two kinds of damage count:
 * - a split position (start or end of a delimiter match, also of an empty match or between two adjacent matches, or between
 *   the characters of an empty plain delimiter) inside a surrogate pair: this can add a column between the halves without
 *   any lone surrogate in the output (e.g. `[😀]`, `.`);
 * - a non-empty capture group whose start or end lies inside a surrogate pair: JS split inserts the capture as a column
 *   (an empty capture is an empty column wherever it lies, e.g. `\uD83D()\uDE00`), so a whole
 *   match at character boundaries does not make its captures safe (e.g. `(\uD83D)\uDE00`).
 * As a second, independent check the native `String.prototype.split` output of a well-formed line must be well-formed.
 * Lone surrogates already in the line never count as a pair (`insidePair`).
 */
function jsSplitCutsCharacter(line: string, delimiter: string, useRegex: boolean): boolean {
  // Only for a well-formed line: lone surrogates already in the input are not newly damaged
  const splitOutputIllFormed = () => line.isWellFormed() && line.split(useRegex ? new RegExp(delimiter, 'gm') : delimiter).some((part) => part !== undefined && !part.isWellFormed());
  if (!useRegex) {
    if (delimiter === '') return Array.from({ length: line.length }, (_, index) => index).some((index) => insidePair(line, index));
    for (let index = line.indexOf(delimiter); index >= 0; index = line.indexOf(delimiter, index + 1)) {
      if (insidePair(line, index) || insidePair(line, index + delimiter.length)) return true;
    }
    return splitOutputIllFormed();
  }
  // Flag `d` (match indices) gives the position of every capture; same other flags as the JS split (`gm`)
  for (const match of line.matchAll(new RegExp(delimiter, 'gmd'))) {
    if (insidePair(line, match.index) || insidePair(line, match.index + match[0].length)) return true;
    for (const span of match.indices!.slice(1)) {
      if (span && span[0] !== span[1] && (insidePair(line, span[0]) || insidePair(line, span[1]))) return true;
    }
  }
  return splitOutputIllFormed();
}

test('split oracle: capture groups that hold a surrogate half are damage, even inside a safe whole match', () => {
  for (const pattern of ['(\\uD83D)\\uDE00', '\\uD83D(\\uDE00)', '(\\uD83D)(\\uDE00)', '(?:(\\uD83D)|x)\\uDE00']) {
    assert.equal(jsSplitCutsCharacter('a😀b', pattern, true), true, pattern);
  }
  // The whole match itself is at character boundaries in these cases
  for (const match of 'a😀b'.matchAll(/(\uD83D)\uDE00/g)) assert.deepEqual([match.index, match.index + match[0].length], [1, 3]);
});

test('split oracle: captures of whole characters and ordinary splits are safe', () => {
  for (const [line, pattern] of [['a😀b', '(😀)'], ['a😀🎉b', '(😀)(🎉)'], ['a😀b', '(?:(😀)|(x))'], ['a😀b', '😀'], ['a😀b', '(?=😀)'], ['a😀b', '(?<=😀)'], ['a,b', '(,)']]) {
    assert.equal(jsSplitCutsCharacter(line, pattern, true), false, pattern);
  }
  assert.equal(jsSplitCutsCharacter('a😀b', '😀', false), false);
  assert.equal(jsSplitCutsCharacter('abc', '', false), false);
});

test('split oracle: zero-width splits and columns between the halves stay damage without lone surrogates in the output', () => {
  // Zero-width split inside the pair
  assert.equal(jsSplitCutsCharacter('a😀b', '(?=\\uDE00)', true), true);
  assert.equal(jsSplitCutsCharacter('😀', '(?:)', true), true);
  // Two adjacent matches create a column between the halves; every output value is well-formed
  assert.ok('a😀b'.split(/[😀]/gm).every((part) => part.isWellFormed()));
  assert.equal(jsSplitCutsCharacter('a😀b', '[😀]', true), true);
  assert.ok('😀x'.split(/./gm).every((part) => part.isWellFormed()));
  assert.equal(jsSplitCutsCharacter('😀x', '.', true), true);
  // Empty plain delimiter
  assert.equal(jsSplitCutsCharacter('a😀b', '', false), true);
});

test('split fixtures are well-formed', () => {
  assert.deepEqual(fixtureProblems(fixtures), []);
});

test('split fixture check rejects malformed entries', () => {
  const valid = { name: 'x', input: 'a', delimiter: ',', expected: [['a']] };
  const pending = { decisions: ['E4'], phase: 'C1', engines: ['js'], reason: 'r' };
  const check = (c: unknown) => fixtureProblems({ description: '', cases: [c] });
  assert.deepEqual(check(valid), []);
  assert.deepEqual(check({ ...valid, target: { error: 'emptyDelimiter' }, pending }), []);
  const broken: [string, unknown][] = [
    ['unknown key', { ...valid, expectedTs: [] }],
    ['per-engine without divergence', { ...valid, expected: undefined, expectedRust: [['a']], expectedJs: [['b']] }],
    ['unknown divergence kind', { ...valid, expected: undefined, expectedRust: [['a']], expectedJs: [['b']], divergence: { kind: 'bug', reason: 'r' } }],
    ['target-only error as current error', { ...valid, expected: { error: 'emptyPattern' } }],
    ['unknown target error', { ...valid, target: { error: 'timeout' }, pending }],
    ['target without pending', { ...valid, target: { error: 'emptyDelimiter' } }],
    ['pending without target', { ...valid, pending }],
    ['target and targetJs', { ...valid, target: [['a']], targetJs: [['b']], targetRust: [['c']], pending }],
    ['targetJs without targetRust', { ...valid, targetJs: [['b']], pending }],
    ['regexSplitsCharacter for Rust', { ...valid, targetRust: { error: 'regexSplitsCharacter' }, targetJs: [['a']], pending }],
    ['shared regexSplitsCharacter', { ...valid, target: { error: 'regexSplitsCharacter' }, pending }],
    ['unknown decision', { ...valid, target: [['b']], pending: { ...pending, decisions: ['E12'] } }],
    ['unknown phase', { ...valid, target: [['b']], pending: { ...pending, phase: 'C3' } }],
    ['no engines', { ...valid, target: [['b']], pending: { ...pending, engines: [] } }],
    ['utf16Damage without JS target', { ...valid, expected: undefined, expectedRust: [['a']], expectedJs: [['b']], divergence: { kind: 'utf16Damage', reason: 'r' } }],
    ['ragged columns', { ...valid, expected: [['a'], []] }],
    ['regexSplitsCharacter for Rust', { ...valid, expected: undefined, expectedRust: { error: 'regexSplitsCharacter' }, expectedJs: [['a']], divergence: { kind: 'utf16Guard', reason: 'r' } }],
    ['shared regexSplitsCharacter', { ...valid, expected: { error: 'regexSplitsCharacter' } }],
    ['regexSplitsCharacter without utf16Guard', { ...valid, expected: undefined, expectedRust: [['a']], expectedJs: { error: 'regexSplitsCharacter' }, divergence: { kind: 'dialect', reason: 'r' } }],
    ['utf16Guard without regexSplitsCharacter', { ...valid, expected: undefined, expectedRust: [['a']], expectedJs: [['b']], divergence: { kind: 'utf16Guard', reason: 'r' } }],
    ['delimiter repeat without count', { ...valid, delimiter: { repeat: 'a' } }],
  ];
  for (const [label, entry] of broken) assert.notDeepEqual(check(JSON.parse(JSON.stringify(entry))), [], label);
});

test('split fixtures: exactly the cases whose native JS split cuts a surrogate pair are refused (E5) or marked as damage', () => {
  let refused = 0;
  for (const c of fixtures.cases) {
    const expected = jsExpectation(c);
    // An invalid regex or an empty plain delimiter is refused before any split happens
    if (isError(expected) && expected.error !== 'regexSplitsCharacter') continue;
    const cuts = splitLines(c.input).lines.some((line) => jsSplitCutsCharacter(line, delimiterOf(c.delimiter), c.useRegex ?? false));
    const refusedByJs = isError(expected);
    const marked = typeof c.divergence === 'object' && c.divergence.kind === 'utf16Damage';
    assert.equal(cuts, refusedByJs || marked, c.name);
    if (refusedByJs) refused++;
  }
  assert.ok(refused >= 14, `${refused} refused cases`);
});

test('split fixtures cover the Paket 10 Phase A reproductions and decisions', () => {
  const refs = new Set(fixtures.cases.map((c) => c.ref).filter(Boolean));
  for (const ref of ['R2', 'R5', 'R7']) assert.ok(refs.has(ref), `missing ${ref}`);
  const decisions = new Set(fixtures.cases.flatMap((c) => c.pending?.decisions ?? []));
  // Still open: E3 (pattern rule, C2) and E9 (split flags, C2); E4 and E5 are implemented (Paket 10 C1)
  assert.deepEqual([...decisions].sort(), ['E3', 'E9']);
  const resolved = fixtures.cases.filter((c) => c.resolved?.startsWith('Paket 10 C1'));
  assert.ok(resolved.filter((c) => isError(c.expected) && c.expected.error === 'emptyDelimiter').length >= 6, 'E4 cases');
  assert.ok(resolved.filter((c) => isError(c.expectedJs) && c.expectedJs.error === 'regexSplitsCharacter').length >= 14, 'E5 cases');
});

for (const c of fixtures.cases) {
  test(`split (JS): ${c.name}`, () => {
    const expected = jsExpectation(c);
    const run = () => splitTextToColumns(c.input, delimiterOf(c.delimiter), optionsOf(c));
    if (isError(expected)) {
      // `splitTextToColumns` throws the engine's SyntaxError or a SplitInputError; the worker reports them as invalid input
      if (expected.error === 'invalidRegex') assert.throws(run, SyntaxError);
      else assert.throws(run, (error: unknown) => error instanceof SplitInputError && error.reason === expected.error);
      return;
    }
    const result = run();
    assert.deepEqual(result, expected);
    assertRectangular(result);
  });
}

test('split (JS): worker entry point (pre-split lines) matches the text entry point', () => {
  for (const c of fixtures.cases) {
    if (isError(jsExpectation(c))) continue;
    // BaseWorker splits the text with the shared line model (`splitLines`), not with `split('\n')`
    const delimiter = delimiterOf(c.delimiter);
    assert.deepEqual(splitLinesToColumns(splitLines(c.input).lines, delimiter, optionsOf(c)), splitTextToColumns(c.input, delimiter, optionsOf(c)), c.name);
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

// --- Paket 10 C1 (E5): the checked split is the native split, refused exactly where the independent oracle finds a cut ---

const regexSplit = { useRegex: true, trimParts: false, keepEmptyLines: true };
const plainSplit = { useRegex: false, trimParts: false, keepEmptyLines: true };
/** Parts of one line as `splitLinesToColumns` returns them (one row), or the reason of a refusal. */
function partsOf(line: string, delimiter: string, options: typeof regexSplit): string[] | string {
  try {
    return splitLinesToColumns([line], delimiter, options).map((column) => column[0]);
  } catch (error) {
    if (error instanceof SplitInputError) return error.reason;
    throw error;
  }
}

test('split (JS): checked regex split equals the native split or is refused exactly where the oracle finds a cut', () => {
  const PATTERNS = [
    '.', ',', '😀', '[😀]', '(😀)', '(😀)|(🎉)', '(😀)?,', '(?:x|(😀))', '(\\uD83D)\\uDE00', '\\uD83D(\\uDE00)', '(\\uD83D)(\\uDE00)',
    '\\uD83D', '\\uDE00', '(?:)', 'x*', '(?=😀)', '(?<=😀)', '(?=\\uDE00)', '(?<=\\uD83D)', '$', '^', '\\b', 'a|', '(a)|(b)', '(,)',
    '😀|🎉', '[^a]', '..', '(.)', '(?=a)', '😀*', '(😀)*', '[\\uD800-\\uDBFF]', '[\\uDC00-\\uDFFF]+', '\\u2028', '(?:😀|a)+',
    '\\uD83D()\\uDE00', '(\\uD83D()\\uDE00)', '()', '(😀)()', '.()', '\\uD83D(x)?\\uDE00',
  ];
  const ALPHABET = ['a', 'b', ',', 'x', '😀', '😁', '🎉', ' ', '\uD83D', '\uDE00'];
  let seed = 0x2f6e2b1;
  const random = () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 2 ** 32);
  let refused = 0;
  let checked = 0;
  for (let n = 0; n < 1500; n++) {
    const line = Array.from({ length: 1 + Math.floor(random() * 8) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
    for (const pattern of PATTERNS) {
      const actual = partsOf(line, pattern, regexSplit);
      if (jsSplitCutsCharacter(line, pattern, true)) {
        assert.equal(actual, 'regexSplitsCharacter', `${JSON.stringify(line)} ${pattern}`);
        refused++;
      } else {
        assert.deepEqual(actual, line.split(new RegExp(pattern, 'gm')).map((part) => part ?? ''), `${JSON.stringify(line)} ${pattern}`);
      }
      checked++;
    }
  }
  assert.ok(refused > 1000 && checked - refused > 10000, `${refused} refused of ${checked}`);
});

test('split (JS): empty captures are no cut, non-empty captures and effective split positions inside a pair are', () => {
  // An empty capture inside a removed emoji only adds an empty column (its indices [2, 2] lie inside the pair)
  assert.deepEqual(partsOf('a😀b', '\\uD83D()\\uDE00', regexSplit), ['a', '', 'b']);
  assert.deepEqual(partsOf('a😀b', '(\\uD83D()\\uDE00)', regexSplit), ['a', '😀', '', 'b']);
  // Non-empty captures of one half and a zero-width split inside the pair stay refused
  for (const pattern of ['(\\uD83D)\\uDE00', '\\uD83D(\\uDE00)', '(\\uD83D)(\\uDE00)', '(?=\\uDE00)']) {
    assert.equal(partsOf('a😀b', pattern, regexSplit), 'regexSplitsCharacter', pattern);
  }
  // Whole-emoji captures and optional captures that do not participate are unchanged
  assert.deepEqual(partsOf('a😀b', '(😀)', regexSplit), ['a', '😀', 'b']);
  assert.deepEqual(partsOf('a😀🎉b', '(😀)(🎉)', regexSplit), ['a', '😀', '🎉', 'b']);
  assert.deepEqual(partsOf('a,b😀c', '(😀)?,', regexSplit), ['a', '', 'b😀c']);
  assert.deepEqual(partsOf('a😀b', '\\uD83D(x)?\\uDE00', regexSplit), ['a', '', 'b']);
  // The oracle agrees
  assert.equal(jsSplitCutsCharacter('a😀b', '\\uD83D()\\uDE00', true), false);
  assert.equal(jsSplitCutsCharacter('a😀b', '(\\uD83D()\\uDE00)', true), false);
  assert.equal(jsSplitCutsCharacter('a😀b', '(\\uD83D)\\uDE00', true), true);
});

test('split (JS): no checked split outputs a lone surrogate for a well-formed line', () => {
  for (const line of ['a😀b', '😀😁🎉', 'x😀,😁y', '😀']) {
    for (const pattern of ['.', '(.)', '[😀]', '([😀])', '(\\uD83D)\\uDE00', '(?:)', 'x*', '\\uDE00', '(😀)', '😀']) {
      const parts = partsOf(line, pattern, regexSplit);
      if (Array.isArray(parts)) assert.ok(parts.every((part) => part.isWellFormed()), `${line} ${pattern}: ${JSON.stringify(parts)}`);
    }
  }
});

test('split (JS): lone surrogates already in the input are not refused (not newly damaged)', () => {
  assert.deepEqual(partsOf('a\uD83D,b', ',', plainSplit), ['a\uD83D', 'b']);
  assert.deepEqual(partsOf('a\uD83D,b', '(\\uD83D),', regexSplit), ['a', '\uD83D', 'b']);
  assert.deepEqual(partsOf('\uDE00x\uDE00', 'x', regexSplit), ['\uDE00', '\uDE00']);
  // A valid pair next to a lone half is still protected
  assert.equal(partsOf('\uDE00😀', '.', regexSplit), 'regexSplitsCharacter');
  assert.equal(partsOf('\uD83D😀', '\\uD83D', regexSplit), 'regexSplitsCharacter');
});

test('split (JS): a plain delimiter is only checked when it holds a lone surrogate', () => {
  // A well-formed delimiter can never start or end inside a pair
  assert.deepEqual(partsOf('a😀b😀c', '😀', plainSplit), ['a', 'b', 'c']);
  // A delimiter that is half a character (e.g. pasted) would cut it
  assert.equal(partsOf('a😀b', '\uD83D', plainSplit), 'regexSplitsCharacter');
  assert.equal(partsOf('a😀b', '\uDE00b', plainSplit), 'regexSplitsCharacter');
  assert.deepEqual(partsOf('a\uD83Db', '\uD83D', plainSplit), ['a', 'b']);
});

test('split (JS, E4): an empty plain delimiter is refused before any line, also for no lines; spaces are allowed', () => {
  for (const lines of [[], [''], ['abc'], ['😀']]) {
    assert.throws(() => splitLinesToColumns(lines, '', plainSplit), (error: unknown) => error instanceof SplitInputError && error.reason === 'emptyDelimiter');
  }
  assert.deepEqual(splitLinesToColumns(['a b'], ' ', plainSplit), [['a'], ['b']]);
  // The empty regex pattern is rule E3 (Phase C2): unchanged
  assert.deepEqual(splitLinesToColumns(['ab'], '', regexSplit), [['a'], ['b']]);
});

// --- The real SplitWorker module (in-process, `self` stand-in) ---

const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
await import('../../src/workers/SplitWorker.ts');
const splitWorker: (event: { data: unknown }) => void = g.self.onmessage;

const splitArgs = (c: SplitCase): SplitConfig => ({ sourceText: c.input, mainParam: delimiterOf(c.delimiter), configParams: optionsOf(c) });

/** Outcome of the JS worker in fixture form: the columns, or `{ error }` (invalid input with the message key of the kind). */
function runWorker(c: SplitCase): Outcome {
  posted = [];
  splitWorker({ data: { args: splitArgs(c) } });
  assert.equal(posted.length, 1, `${c.name}: exactly one worker message`);
  const [message] = posted;
  if (message.success) {
    assert.equal(message.result.type, 'ColumnList');
    return message.result.result;
  }
  assert.equal(message.errorKind, 'invalidInput', JSON.stringify(message));
  const kind = Object.entries(ERROR_KEYS).find(([, key]) => key === message.error)?.[0];
  return { error: kind ?? message.error };
}

for (const c of fixtures.cases) {
  test(`split worker: ${c.name}`, () => {
    const actual = runWorker(c);
    assert.deepEqual(actual, jsExpectation(c));
    // Target of a pending decision: JS must still differ exactly when the decision lists the JS engine
    const target = jsTarget(c);
    if (target !== undefined) {
      const differs = JSON.stringify(actual) !== JSON.stringify(target);
      assert.equal(differs, c.pending!.engines.includes('js'), `${c.name}: pending.engines must list js exactly while the JS result differs from its target`);
    }
  });
}

// --- The service without Web Worker (`invoke(args, false)` in Node): plain splits run in the main thread ---

for (const c of fixtures.cases) {
  test(`split service without Web Worker: ${c.name}`, async () => {
    const run = () => new SplitService().invoke(splitArgs(c), false);
    if (!c.useRegex) {
      const expected = jsExpectation(c);
      if (isError(expected)) {
        // E4: the main-thread fallback refuses an empty plain delimiter like the worker
        const error = await rejectionOf(run);
        assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: ERROR_KEYS[expected.error as keyof typeof ERROR_KEYS] });
        return;
      }
      const result = await run();
      assert.deepEqual({ type: result.type, result: result.result }, { type: 'ColumnList', result: expected });
      return;
    }
    // A regex never runs in the UI thread. The compile check there (`compileUserRegex`) also refuses an empty or too
    // long pattern as invalidRegex, which the worker does not check (R5)
    const error = await rejectionOf(run);
    const pattern = delimiterOf(c.delimiter);
    const expected = jsExpectation(c);
    const refusedPattern = (isError(expected) && expected.error === 'invalidRegex') || !pattern || pattern.length > MAX_PATTERN_LENGTH;
    assert.deepEqual(
      { kind: error.kind, message: error.message },
      refusedPattern ? { kind: 'invalidInput', message: ERROR_KEYS.invalidRegex } : { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker }
    );
  });
}
