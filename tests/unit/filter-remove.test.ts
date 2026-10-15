// Filter/Remove golden fixtures (Paket 8): `tests/fixtures/filter-remove-cases.json`, also run by the Rust engine
// (`cargo test`, src-tauri/src/text_processor.rs). Phase B characterized the behaviour, Phase C1 corrected the
// duplicate trim output, the whitespace set and cut surrogate pairs in the JS Filter. The JS side runs the real worker
// modules (in-process, `self` stand-in), the Remove main-thread fallback, the service path without Web Worker
// (`invoke(args, false)` in Node) and, separately marked, the Filter main-thread implementation that `invoke` never reaches.
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { FilterService, RemoveService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { trimWhitespace, isWhitespaceCodePoint } = await import('../../src/utils/diff/whitespace.ts');
disableWorkerCleanupInterval(BaseService);
installWindow();

// --- Fixture format ---

type ErrorKind = 'invalidRegex' | 'regexRuntime' | 'regexSplitsCharacter';
type FixtureError = { error: ErrorKind };
type FilterExpected = string | FixtureError;
type RemoveExpected = { text: string; removedLines: number } | FixtureError;
type Pattern = string | { repeat: string; count: number };

interface Case<O, E> {
  name: string;
  ref?: string;
  input: string;
  pattern: Pattern;
  options: O;
  expected?: E;
  expectedRust?: E;
  expectedJs?: E;
  expectedJsUnreachableMainThread?: E;
  divergence?: { kind: string; reason: string };
  openQuestion?: string;
}
type FilterOptions = { mode: string; caseSensitive: boolean; splitMatches: boolean };
type RemoveOptions = { removeMode: string; caseSensitive: boolean; useRegex: boolean; trimParts: boolean };
type FilterCase = Case<FilterOptions, FilterExpected>;
type RemoveCase = Case<RemoveOptions, RemoveExpected>;
interface Fixtures {
  description: string;
  filter: FilterCase[];
  remove: RemoveCase[];
}

const CASE_KEYS = ['name', 'ref', 'input', 'pattern', 'options', 'expected', 'expectedRust', 'expectedJs', 'expectedJsUnreachableMainThread', 'divergence', 'openQuestion'];
const OPTION_TYPES = {
  filter: { mode: 'string', caseSensitive: 'boolean', splitMatches: 'boolean' },
  remove: { removeMode: 'string', caseSensitive: 'boolean', useRegex: 'boolean', trimParts: 'boolean' },
} as const;
const DIVERGENCE_KINDS = ['dialect', 'utf16Guard', 'suspectedBug', 'inconsistentDefinition', 'unvalidatedInput'];
const ERROR_KINDS = ['invalidRegex', 'regexRuntime'];
/** Only the JS Filter refuses results with cut surrogate pairs (Rust works on Unicode scalar values). */
const JS_FILTER_ERROR = 'regexSplitsCharacter';
const MESSAGE_OF_ERROR: Record<string, string> = {
  invalidRegex: ERROR_KEYS.invalidRegex,
  regexSplitsCharacter: ERROR_KEYS.regexSplitsCharacter,
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const isErrorOf = (value: unknown, kind: string) => isObject(value) && value.error === kind;
const hasLoneSurrogate = (text: string) => !text.isWellFormed();

/** Problems of one expectation; `engine` is where it applies (only JS Filter expectations may use `regexSplitsCharacter`). */
function expectationProblems(section: 'filter' | 'remove', value: unknown, engine: 'rust' | 'js' | 'shared'): string[] {
  if (isObject(value) && 'error' in value) {
    if (!hasExactKeys(value, ['error'])) return [`invalid error expectation ${JSON.stringify(value)}`];
    if (ERROR_KINDS.includes(value.error as string)) return [];
    if (value.error === JS_FILTER_ERROR) return section === 'filter' && engine === 'js' ? [] : [`${JS_FILTER_ERROR} is only a JS Filter expectation`];
    return [`unknown error kind ${JSON.stringify(value.error)}`];
  }
  if (section === 'remove') {
    return isObject(value) && hasExactKeys(value, ['text', 'removedLines']) && typeof value.text === 'string' && Number.isInteger(value.removedLines) && (value.removedLines as number) >= 0
      ? []
      : [`invalid remove expectation ${JSON.stringify(value)}`];
  }
  return typeof value === 'string' ? [] : [`invalid filter expectation ${JSON.stringify(value)}`];
}

/** All problems of a fixture file; an empty list means well-formed. */
function fixtureProblems(fixtures: unknown): string[] {
  if (!isObject(fixtures) || !hasExactKeys(fixtures, ['description', 'filter', 'remove'])) return ['top level must have exactly description, filter, remove'];
  const problems: string[] = [];
  for (const section of ['filter', 'remove'] as const) {
    const cases = fixtures[section];
    if (!Array.isArray(cases) || !cases.length) {
      problems.push(`${section}: missing or empty`);
      continue;
    }
    const names = new Set<string>();
    for (const c of cases) {
      const where = `${section}/${isObject(c) ? c.name : '?'}`;
      if (!isObject(c)) {
        problems.push(`${where}: not an object`);
        continue;
      }
      const unknown = Object.keys(c).filter((key) => !CASE_KEYS.includes(key));
      if (unknown.length) problems.push(`${where}: unknown keys ${unknown.join(', ')}`);
      if (typeof c.name !== 'string' || !c.name) problems.push(`${where}: name missing`);
      else if (names.has(c.name)) problems.push(`${where}: duplicate name`);
      else names.add(c.name);
      if (typeof c.input !== 'string') problems.push(`${where}: input must be a string`);
      const pattern = c.pattern;
      const patternOk =
        typeof pattern === 'string' ||
        (isObject(pattern) && hasExactKeys(pattern, ['repeat', 'count']) && typeof pattern.repeat === 'string' && pattern.repeat !== '' && Number.isInteger(pattern.count) && (pattern.count as number) > 0);
      if (!patternOk) problems.push(`${where}: pattern must be a string or { repeat, count }`);

      const types: Record<string, string> = OPTION_TYPES[section];
      if (!isObject(c.options) || !hasExactKeys(c.options, Object.keys(types))) {
        problems.push(`${where}: options must state exactly ${Object.keys(types).join(', ')}`);
      } else {
        for (const [key, type] of Object.entries(types)) if (typeof c.options[key] !== type) problems.push(`${where}: option ${key} must be a ${type}`);
      }

      const shared = c.expected !== undefined;
      const perEngine = c.expectedRust !== undefined || c.expectedJs !== undefined;
      if (shared === perEngine) problems.push(`${where}: needs either expected or expectedRust + expectedJs`);
      if (perEngine && (c.expectedRust === undefined || c.expectedJs === undefined)) problems.push(`${where}: expectedRust and expectedJs belong together`);
      if (perEngine !== (c.divergence !== undefined)) problems.push(`${where}: per-engine expectations need a divergence (and only they)`);
      if (perEngine && JSON.stringify(c.expectedRust) === JSON.stringify(c.expectedJs)) problems.push(`${where}: expectedRust equals expectedJs, use expected`);
      const divergence = c.divergence;
      if (divergence !== undefined) {
        if (!isObject(divergence) || !hasExactKeys(divergence, ['kind', 'reason']) || !DIVERGENCE_KINDS.includes(divergence.kind as string) || typeof divergence.reason !== 'string' || !divergence.reason) {
          problems.push(`${where}: divergence must be { kind: ${DIVERGENCE_KINDS.join(' | ')}, reason }`);
        }
      }
      if (shared) problems.push(...expectationProblems(section, c.expected, 'shared').map((p) => `${where}: ${p}`));
      if (c.expectedRust !== undefined) problems.push(...expectationProblems(section, c.expectedRust, 'rust').map((p) => `${where}: expectedRust: ${p}`));
      if (c.expectedJs !== undefined) problems.push(...expectationProblems(section, c.expectedJs, 'js').map((p) => `${where}: expectedJs: ${p}`));
      // A refused cut character and the utf16Guard divergence belong together
      if (isErrorOf(c.expectedJs, JS_FILTER_ERROR) !== (isObject(divergence) && divergence.kind === 'utf16Guard')) {
        problems.push(`${where}: expectedJs ${JS_FILTER_ERROR} requires the divergence kind utf16Guard and vice versa`);
      }
      if (c.expectedJsUnreachableMainThread !== undefined) {
        if (section !== 'filter') problems.push(`${where}: expectedJsUnreachableMainThread is only for the Filter`);
        else if (typeof c.expectedJsUnreachableMainThread !== 'string') problems.push(`${where}: expectedJsUnreachableMainThread must be a text`);
      }
      for (const key of ['ref', 'openQuestion']) if (c[key] !== undefined && (typeof c[key] !== 'string' || !c[key])) problems.push(`${where}: ${key} must be a non-empty string`);
    }
  }
  return problems;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('../fixtures/filter-remove-cases.json', import.meta.url), 'utf8'));

test('filter/remove fixtures are well-formed', () => {
  assert.deepEqual(fixtureProblems(fixtures), []);
});

test('filter/remove fixture check rejects malformed entries', () => {
  const valid = structuredClone(fixtures.filter[0]);
  const validRemove = structuredClone(fixtures.remove[0]);
  const check = (filter: unknown[], remove: unknown[] = [validRemove]) => fixtureProblems({ description: '', filter, remove });
  assert.deepEqual(check([valid]), []);

  const guard = { kind: 'utf16Guard', reason: 'r' };
  const broken: [string, unknown][] = [
    ['implicit splitMatches', { ...valid, options: { mode: 'keep', caseSensitive: true } }],
    ['unknown key', { ...valid, expectedTs: 'x' }],
    ['expected and expectedRust', { ...valid, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'dialect', reason: 'r' } }],
    ['per-engine without divergence', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b' }],
    ['divergence without per-engine', { ...valid, divergence: { kind: 'dialect', reason: 'r' } }],
    ['unknown divergence kind', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'accepted', reason: 'r' } }],
    ['former divergence kind', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'dataIntegrityRisk', reason: 'r' } }],
    ['identical per-engine expectations', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'a', divergence: { kind: 'dialect', reason: 'r' } }],
    ['unknown error kind', { ...valid, expected: { error: 'timeout' } }],
    ['utf16 form is gone', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: { utf16: ['D83D'] }, divergence: guard }],
    ['regexSplitsCharacter as shared expectation', { ...valid, expected: { error: 'regexSplitsCharacter' } }],
    ['regexSplitsCharacter for Rust', { ...valid, expected: undefined, expectedRust: { error: 'regexSplitsCharacter' }, expectedJs: 'a', divergence: guard }],
    ['regexSplitsCharacter without utf16Guard', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: { error: 'regexSplitsCharacter' }, divergence: { kind: 'dialect', reason: 'r' } }],
    ['utf16Guard without regexSplitsCharacter', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: guard }],
    ['invalid pattern repeat', { ...valid, pattern: { repeat: 'a' } }],
  ];
  for (const [label, entry] of broken) {
    const cleaned = JSON.parse(JSON.stringify(entry)); // drops `undefined` keys like the JSON file would
    assert.notDeepEqual(check([cleaned]), [], label);
  }
  assert.notDeepEqual(check([valid, valid]), [], 'duplicate name');
  assert.notDeepEqual(check([valid], [{ ...validRemove, expected: { text: 'x' } }]), [], 'remove expectation without removedLines');
  assert.notDeepEqual(check([valid], [{ ...validRemove, options: { removeMode: 'duplicates', caseSensitive: true, useRegex: false } }]), [], 'implicit trimParts');
  assert.notDeepEqual(check([valid], [{ ...validRemove, expected: undefined, expectedRust: { text: 'a', removedLines: 0 }, expectedJs: { error: 'regexSplitsCharacter' }, divergence: guard }]), [], 'regexSplitsCharacter for Remove');
});

test('filter/remove fixtures cover the Phase A reproductions', () => {
  const refs = new Set([...fixtures.filter, ...fixtures.remove].map((c) => c.ref).filter(Boolean));
  for (const ref of ['R05', 'R06', 'F04', 'F06', 'F12', 'F16', 'F17', 'R07', 'R08', 'R21', 'F31']) assert.ok(refs.has(ref), `missing ${ref}`);
});

// --- Engines ---

const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
const loadWorker = async (path: string) => {
  await import(path);
  return g.self.onmessage as (event: { data: unknown }) => void;
};
const workers = {
  filter: await loadWorker('../../src/workers/FilterWorker.ts'),
  remove: await loadWorker('../../src/workers/RemoveWorker.ts'),
};

const patternOf = (pattern: Pattern) => (typeof pattern === 'string' ? pattern : pattern.repeat.repeat(pattern.count));
const filterArgs = (c: { input: string; pattern: Pattern; options: FilterOptions }): FilterConfig => ({
  sourceText: c.input,
  mainParam: patternOf(c.pattern),
  configParams: { caseSensitive: c.options.caseSensitive, filterMode: c.options.mode as FilterConfig['configParams']['filterMode'], splitMatches: c.options.splitMatches },
});
const removeArgs = (c: RemoveCase): RemoveConfig => ({
  sourceText: c.input,
  mainParam: patternOf(c.pattern),
  configParams: { caseSensitive: c.options.caseSensitive, useRegex: c.options.useRegex, trimParts: c.options.trimParts, removeMode: c.options.removeMode },
});

/** The JS errors of the fixtures are invalid input (`invalidInput`) with the message key of the error kind. */
function assertInputError(kind: unknown, message: unknown, expected: ErrorKind, where: string) {
  assert.ok(MESSAGE_OF_ERROR[expected], `${where}: no JS error for ${expected}`);
  assert.deepEqual({ kind, message }, { kind: 'invalidInput', message: MESSAGE_OF_ERROR[expected] }, where);
}

/** Exactly one worker message: a success with the given result type, or an error. */
function runWorker(worker: keyof typeof workers, args: BaseConfig) {
  posted = [];
  workers[worker]({ data: { args } });
  assert.equal(posted.length, 1, `exactly one worker message: ${JSON.stringify(posted)}`);
  return posted[0];
}

/** A successful JS Filter result: exactly the expected text, never with a cut character. */
function assertFilterText(actual: unknown, expected: string, where: string) {
  assert.equal(actual, expected, where);
  assert.ok(!hasLoneSurrogate(actual as string), `${where}: result is well-formed Unicode`);
}

// --- Filter ---

for (const c of fixtures.filter) {
  const expected = (c.expectedJs ?? c.expected)!;

  test(`filter worker: ${c.name}`, () => {
    const message = runWorker('filter', filterArgs(c));
    if (typeof expected === 'object') {
      assert.equal(message.success, false, JSON.stringify(message));
      assertInputError(message.errorKind, message.error, expected.error, c.name);
      return;
    }
    assert.equal(message.success, true, JSON.stringify(message));
    assert.equal(message.result.type, 'Text');
    assertFilterText(message.result.result, expected, 'worker');
  });

  // Without Web Worker (Node) the Filter never runs its regex in the main thread: only compiling can fail
  test(`filter service without Web Worker: ${c.name}`, async () => {
    const error = await rejectionOf(() => new FilterService().invoke(filterArgs(c), false));
    if (isErrorOf(expected, 'invalidRegex')) assertInputError(error.kind, error.message, 'invalidRegex', c.name);
    else assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker });
  });

  if (c.expectedJsUnreachableMainThread !== undefined) {
    // Characterization only: `invoke` never reaches this implementation (see the service test above)
    test(`filter main thread (unreachable, not a product path): ${c.name}`, async () => {
      const result = await (new FilterService() as any).frontendInMainThread(filterArgs(c));
      assert.equal(result.type, 'Text');
      assertFilterText(result.result, c.expectedJsUnreachableMainThread as string, 'unreachable main thread');
    });
  }
}

test('filter: Rust expectations of refused JS results are well-formed Unicode', () => {
  const cases = fixtures.filter.filter((c) => c.divergence?.kind === 'utf16Guard');
  assert.ok(cases.length >= 4);
  for (const c of cases) {
    assert.equal(typeof c.expectedRust, 'string', c.name);
    assert.ok(!hasLoneSurrogate(c.expectedRust as string), c.name);
  }
});

test('filter worker: lone surrogates already in the input are not refused (not newly damaged)', () => {
  const run = (input: string, pattern: string, mode: string, splitMatches: boolean) =>
    runWorker('filter', filterArgs({ input, pattern, options: { mode, caseSensitive: true, splitMatches } }));
  const keep = run('\uD83Dx\n\uDE00y', '[xy]', 'keep', true);
  assert.deepEqual([keep.success, keep.result.result], [true, 'x\ny']);
  const remove = run('\uD83Dx', 'x', 'remove', false);
  assert.deepEqual([remove.success, remove.result.result], [true, '\uD83D']);
  // A valid pair next to a lone half is still protected
  const cut = run('\uDE00😀', '.', 'keep', true);
  assert.deepEqual([cut.success, cut.error], [false, ERROR_KEYS.regexSplitsCharacter]);
});

test('filter worker: the refused result is reported as one error, not as success', () => {
  const message = runWorker('filter', filterArgs({ input: 'ok\n😀x', pattern: '.', options: { mode: 'keep', caseSensitive: true, splitMatches: true } }));
  assert.deepEqual({ success: message.success, errorKind: message.errorKind, error: message.error, result: message.result }, {
    success: false,
    errorKind: 'invalidInput',
    error: ERROR_KEYS.regexSplitsCharacter,
    result: null,
  });
});

// --- Shared whitespace set (Unicode White_Space, same as Rust `str::trim`) ---

test('trimWhitespace uses Unicode White_Space: U+0085 is whitespace, U+FEFF is not', () => {
  for (let unit = 0; unit <= 0xffff; unit++) {
    const char = String.fromCharCode(unit);
    assert.equal(trimWhitespace(`${char}a${char}`) === 'a', isWhitespaceCodePoint(unit), `U+${unit.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  assert.equal(trimWhitespace('\u0085 a　'), 'a');
  assert.equal(trimWhitespace('﻿a﻿'), '﻿a﻿');
  assert.equal(trimWhitespace(' \t '), '');
  // The only differences to String.prototype.trim
  const differences = [];
  for (let unit = 0; unit <= 0xffff; unit++) {
    const char = String.fromCharCode(unit);
    if ((char.trim() === '') !== (trimWhitespace(char) === '')) differences.push(unit.toString(16).toUpperCase());
  }
  assert.deepEqual(differences, ['85', 'FEFF']);
});

// --- Remove ---

const isRegexJob = (c: RemoveCase) => c.options.useRegex && c.options.removeMode !== 'duplicates';
const noMetrics = { execution_time_ms: 0, memory_usage_kb: 0, memory_usage_str: '' };

for (const c of fixtures.remove) {
  const expected = (c.expectedJs ?? c.expected)!;

  test(`remove worker + main thread: ${c.name}`, async () => {
    const message = runWorker('remove', removeArgs(c));
    let main: any;
    let mainError: any;
    try {
      main = await (new RemoveService() as any).frontendInMainThread(removeArgs(c));
    } catch (error) {
      mainError = error;
    }

    if ('error' in expected) {
      assert.equal(message.success, false, JSON.stringify(message));
      assertInputError(message.errorKind, message.error, expected.error, `${c.name} (worker)`);
      assertInputError(mainError?.kind, mainError?.message, expected.error, `${c.name} (main thread)`);
      return;
    }
    assert.equal(message.success, true, JSON.stringify(message));
    assert.equal(mainError, undefined, `main thread: ${mainError}`);
    for (const [path, result] of [['worker', message.result], ['main thread', main]]) {
      assert.equal(result.type, 'TextV2', path);
      assert.deepEqual({ text: result.result.result_text, removedLines: result.result.removed_lines }, expected, path);
    }
  });

  // The real service path without Web Worker: duplicates and literal search run in the main thread, a regex never does
  test(`remove service without Web Worker: ${c.name}`, async () => {
    const run = () => new RemoveService().invoke(removeArgs(c), false);
    if ('error' in expected) {
      const error = await rejectionOf(run);
      assertInputError(error.kind, error.message, expected.error, c.name);
    } else if (isRegexJob(c)) {
      const error = await rejectionOf(run);
      assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker });
    } else {
      const result = await run();
      assert.equal(result.type, 'TextV2');
      assert.deepEqual(result.result, { result_text: expected.text, removed_lines: expected.removedLines, metrics: noMetrics });
    }
  });
}
