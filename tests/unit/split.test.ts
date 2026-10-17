// Split regression tests for the JS engine (Web Worker + main-thread fallback share `splitColumns.ts`).
// The fixtures in `tests/fixtures/split-cases.json` are also run against the Rust engine (`cargo test`).
// Paket 10 Phase B: the fixtures also state the target of not yet implemented decisions (`target*` + `pending`), checked
// against the real worker module; the current behaviour stays the asserted expectation (no intentionally red tests).
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { splitLinesToColumns, splitTextToColumns } from '../../src/utils/splitColumns.ts';
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
const DIVERGENCE_KINDS = ['dialect', 'utf16Damage', 'unvalidatedInput'];
/** Errors of the current engines. */
const CURRENT_ERRORS = ['invalidRegex'];
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
 * - a capture group whose start or end lies inside a surrogate pair: JS split inserts the capture as a column, so a whole
 *   match at character boundaries does not make its captures safe (e.g. `(\uD83D)\uDE00`).
 * As a second, independent check the native `String.prototype.split` output must be well-formed Unicode.
 */
function jsSplitCutsCharacter(line: string, delimiter: string, useRegex: boolean): boolean {
  const splitOutputIllFormed = () => line.split(useRegex ? new RegExp(delimiter, 'gm') : delimiter).some((part) => part !== undefined && !part.isWellFormed());
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
      if (span && (insidePair(line, span[0]) || insidePair(line, span[1]))) return true;
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
    ['target error as current error', { ...valid, expected: { error: 'emptyDelimiter' } }],
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
    ['delimiter repeat without count', { ...valid, delimiter: { repeat: 'a' } }],
  ];
  for (const [label, entry] of broken) assert.notDeepEqual(check(JSON.parse(JSON.stringify(entry))), [], label);
});

test('split fixtures: utf16Damage marks exactly the cases whose JS split cuts a surrogate pair (R2)', () => {
  for (const c of fixtures.cases) {
    if (isError(jsExpectation(c))) continue; // no split happens
    const cuts = splitLines(c.input).lines.some((line) => jsSplitCutsCharacter(line, delimiterOf(c.delimiter), c.useRegex ?? false));
    const marked = typeof c.divergence === 'object' && c.divergence.kind === 'utf16Damage';
    assert.equal(cuts, marked, c.name);
  }
});

test('split fixtures cover the Paket 10 Phase A reproductions and decisions', () => {
  const refs = new Set(fixtures.cases.map((c) => c.ref).filter(Boolean));
  for (const ref of ['R2', 'R5', 'R7']) assert.ok(refs.has(ref), `missing ${ref}`);
  const decisions = new Set(fixtures.cases.flatMap((c) => c.pending?.decisions ?? []));
  for (const decision of ['E3', 'E4', 'E5', 'E9']) assert.ok(decisions.has(decision), `missing ${decision}`);
});

for (const c of fixtures.cases) {
  test(`split (JS): ${c.name}`, () => {
    const expected = jsExpectation(c);
    const run = () => splitTextToColumns(c.input, delimiterOf(c.delimiter), optionsOf(c));
    if (isError(expected)) {
      // `splitTextToColumns` throws the engine's SyntaxError; the worker reports it as invalidRegex
      assert.throws(run, SyntaxError);
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
      const result = await run();
      assert.deepEqual({ type: result.type, result: result.result }, { type: 'ColumnList', result: jsExpectation(c) });
      return;
    }
    // A regex never runs in the UI thread. The compile check there (`compileUserRegex`) also refuses an empty or too
    // long pattern as invalidRegex, which the worker does not check (R5)
    const error = await rejectionOf(run);
    const pattern = delimiterOf(c.delimiter);
    const refusedPattern = isError(jsExpectation(c)) || !pattern || pattern.length > MAX_PATTERN_LENGTH;
    assert.deepEqual(
      { kind: error.kind, message: error.message },
      refusedPattern ? { kind: 'invalidInput', message: ERROR_KEYS.invalidRegex } : { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker }
    );
  });
}
