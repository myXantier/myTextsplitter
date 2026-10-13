// Result and error contract of the processing services (Paket 4: B2, B3, B4-Frontend, B23, B24).
//
// Backend paths: `service.invoke(args, true)` with a stubbed Tauri IPC (`window.__TAURI_INTERNALS__.invoke`),
// i.e. the same `@tauri-apps/api/core` code path as the desktop app, without Rust.
// Main-thread fallback: `service.invoke(args, false)`; Node has no global `Worker`, so the services use
// `frontendInMainThread` exactly like a browser without Web Worker support.
import { logged, installWindow, disableWorkerCleanupInterval, rejectionOf, backendMetrics, type TauriHandler } from './helpers/setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Services first (same order as the app): BaseService <-> Services import each other
const { SplitService, FilterService, RemoveService, DiffService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { invokeUNSAFE } = await import('../../src/services/tauriInvoke.ts');
const { default: changeResultType } = await import('../../src/other/TypeConverter.ts');
const { convertBackendDiff } = await import('../../src/services/DiffService.ts');
const { isTextV2 } = await import('../../src/services/ProcessingError.ts');

disableWorkerCleanupInterval(BaseService);
beforeEach(() => installWindow());

const SECRET = 'confidential-line-4711';

const filterArgs = (sourceText: string, pattern: string, filterMode = 'keep'): FilterConfig => ({
  sourceText,
  mainParam: pattern,
  configParams: { caseSensitive: true, filterMode, splitMatches: false },
});
const removeArgs = (sourceText: string, pattern: string, removeMode = 'containing', useRegex = false): RemoveConfig => ({
  sourceText,
  mainParam: pattern,
  configParams: { caseSensitive: true, useRegex, trimParts: false, removeMode },
});
const splitArgs = (sourceText: string, delimiter: string, useRegex = false): SplitConfig => ({
  sourceText,
  mainParam: delimiter,
  configParams: { trimParts: false, useRegex, keepEmptyLines: true },
});
const diffArgs = (oldText: string, newText: string): DiffConfig => ({
  sourceText: oldText,
  mainParam: newText,
  configParams: { caseSensitive: true, ignoreWhitespace: false },
});

/** Installs a Tauri backend that answers every command with `answer(cmd, args)` and records the calls. */
function backend(answer: TauriHandler) {
  const calls: string[] = [];
  installWindow((cmd, args) => {
    calls.push(cmd);
    return answer(cmd, args);
  });
  return calls;
}
const processed = (result_text: unknown, removed_lines = 0) => ({ result_text, removed_lines, metrics: backendMetrics });
const assertNoSecretLogged = () =>
  assert.ok(!JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v)).includes(SECRET), 'input text was logged');

// --- B2: Tauri invoke errors must not become empty successful results ---

test('B2: invokeUNSAFE rejects when the Tauri command fails', async () => {
  backend(() => {
    throw 'command failed';
  });
  const error = await rejectionOf(() => invokeUNSAFE('connect_texts', {}));
  assert.ok(error instanceof Error);
  assert.equal(error.kind, 'backend');
});

for (const [name, run] of [
  ['split', () => new SplitService().invoke(splitArgs(SECRET, ','), true)],
  ['filter', () => new FilterService().invoke(filterArgs(SECRET, 'a'), true)],
  ['remove', () => new RemoveService().invoke(removeArgs(SECRET, 'a'), true)],
  ['diff', () => new DiffService().invoke(diffArgs(SECRET, 'x'), true)],
] as const) {
  test(`B2: ${name} backend IPC failure is reported as backend error`, async () => {
    backend(() => {
      throw 'IPC connection lost';
    });
    const error = await rejectionOf(run);
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'backend');
    assertNoSecretLogged();
  });
}

// --- B4 (frontend side): Rust input errors arrive as invalid input, not as technical errors ---

for (const [name, run] of [
  ['split', () => new SplitService().invoke(splitArgs('a', '([a-', true), true)],
  ['filter', () => new FilterService().invoke(filterArgs('a', '([a-'), true)],
  ['remove', () => new RemoveService().invoke(removeArgs('a', '([a-', 'containing', true), true)],
] as const) {
  test(`B4: invalid regex from the Rust ${name} command is an invalid-input error`, async () => {
    backend(() => {
      throw { kind: 'invalidRegex', message: 'Parsing error at position 4' };
    });
    const error = await rejectionOf(run);
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'invalidInput');
    assert.equal(error.message, 'errors.invalidRegex');
  });
}

test('B4: regex runtime error from Rust (backtrack limit) is an invalid-input error with its own message', async () => {
  backend(() => {
    throw { kind: 'regexRuntime', message: 'Max limit for backtracking count exceeded' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('abab', '(a|b|ab)*(?=c)'), true));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, 'errors.regexTooComplex');
});

// --- B3: empty results are valid results ---

test('B3: filter backend with non-empty result', async () => {
  backend(() => processed('apple'));
  const result = await new FilterService().invoke(filterArgs('apple\nbanana', 'ap'), true);
  assert.equal(result.type, 'Text');
  assert.equal(result.result, 'apple');
});

test('B3: filter backend removing all lines returns an empty Text result', async () => {
  backend(() => processed(''));
  const result = await new FilterService().invoke(filterArgs('apple\nbanana', 'x'), true);
  assert.deepEqual({ type: result.type, result: result.result }, { type: 'Text', result: '' });
  assert.equal(logged.filter((l) => l.level === 'error').length, 0, 'an empty result is no error');
});

test('B3: remove backend removing all lines returns an empty TextV2 result with the removed count', async () => {
  backend(() => processed('', 2));
  const result = await new RemoveService().invoke(removeArgs('a\nab', 'a'), true);
  assert.equal(result.type, 'TextV2');
  assert.equal((result.result as ProcessedText<string>).result_text, '');
  assert.equal((result.result as ProcessedText<string>).removed_lines, 2);
});

test('B3: split backend with empty text returns an empty ColumnList (empty array)', async () => {
  backend(() => processed([]));
  const result = await new SplitService().invoke(splitArgs('', ','), true);
  assert.deepEqual({ type: result.type, result: result.result }, { type: 'ColumnList', result: [] });
});

test('B3: backend metrics are kept for empty results', async () => {
  backend(() => processed(''));
  const service = new FilterService();
  await service.invoke(filterArgs('apple', 'x'), true);
  assert.equal(service.getMetrics()?.executionTime, backendMetrics.execution_time_ms);
  assert.equal(service.getMetrics()?.memoryUsage, backendMetrics.memory_usage_kb);
});

// --- Unexpected backend results must not be converted into successes ---

for (const [label, answer] of [
  ['empty object', {}],
  ['null', null],
  ['result_text of the wrong type', processed(42)],
  ['missing removed_lines', { result_text: 'x', metrics: backendMetrics }],
] as const) {
  test(`unexpected backend result (${label}) is an invalid-result error`, async () => {
    backend(() => answer);
    const error = await rejectionOf(() => new RemoveService().invoke(removeArgs('a', 'a'), true));
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'invalidResult');
  });
}

test('unexpected split backend result (string instead of columns) is an invalid-result error', async () => {
  backend(() => processed('a\nb'));
  const error = await rejectionOf(() => new SplitService().invoke(splitArgs('a', ','), true));
  assert.equal(error.kind, 'invalidResult');
});

test('unexpected diff backend result (no JSON) is an invalid-result error', async () => {
  backend(() => processed('not json'));
  const error = await rejectionOf(() => new DiffService().invoke(diffArgs('a', 'b'), true));
  assert.equal(error.kind, 'invalidResult');
});

// --- B24: backend and JS paths deliver the same result structure ---

test('B24: remove delivers TextV2 in backend and main-thread mode', async () => {
  backend(() => processed('b', 1));
  const fromBackend = await new RemoveService().invoke(removeArgs('a\nb', 'a'), true);
  installWindow();
  const fromJs = await new RemoveService().invoke(removeArgs('a\nb', 'a'), false);
  assert.equal(fromBackend.type, 'TextV2');
  assert.equal(fromJs.type, 'TextV2');
  const pick = (r: myResult) => ({ text: (r.result as ProcessedText<string>).result_text, removed: (r.result as ProcessedText<string>).removed_lines });
  assert.deepEqual(pick(fromBackend), pick(fromJs));
});

test('B24: diff delivers the same DiffResult JSON format in backend and main-thread mode', async () => {
  backend(() => processed(JSON.stringify([{ text: 'one', diff_type: 'Unchanged', line_number: 1 }, { text: 'two', diff_type: 'Added', line_number: 2 }])));
  const fromBackend = await new DiffService().invoke(diffArgs('one', 'one\ntwo'), true);
  assert.equal(fromBackend.type, 'Text');
  assert.deepEqual(JSON.parse(fromBackend.result as string), [
    { type: 'unchanged', text: 'one', lineNumber: 1 },
    { type: 'added', text: 'two', lineNumber: 2 },
  ]);

  installWindow();
  const fromJs = await new DiffService().invoke(diffArgs('one', 'one\ntwo'), false);
  assert.equal(fromJs.type, 'Text');
  for (const entry of JSON.parse(fromJs.result as string)) {
    assert.deepEqual(Object.keys(entry).sort(), ['lineNumber', 'text', 'type']);
  }
});

// --- Main-thread fallback (no Web Worker) ---

test('fallback: filter removing all lines returns an empty Text result', async () => {
  const result = await new FilterService().invoke(filterArgs('apple', 'x'), false);
  assert.deepEqual({ type: result.type, result: result.result }, { type: 'Text', result: '' });
});

test('fallback: remove removing all lines returns an empty TextV2 result', async () => {
  const result = await new RemoveService().invoke(removeArgs('a\nab', 'a'), false);
  assert.equal(result.type, 'TextV2');
  assert.deepEqual({ ...(result.result as ProcessedText<string>), metrics: undefined }, { result_text: '', removed_lines: 2, metrics: undefined });
});

test('fallback: split delivers a ColumnList', async () => {
  const result = await new SplitService().invoke(splitArgs('a,b\nc', ','), false);
  assert.deepEqual({ type: result.type, result: result.result }, { type: 'ColumnList', result: [['a', 'c'], ['b', '']] });
});

for (const [name, run] of [
  ['split', () => new SplitService().invoke(splitArgs(SECRET, '([a-', true), false)],
  ['filter', () => new FilterService().invoke(filterArgs(SECRET, '([a-'), false)],
  ['remove', () => new RemoveService().invoke(removeArgs(SECRET, '([a-', 'containing', true), false)],
] as const) {
  test(`fallback: invalid regex in ${name} is an invalid-input error, not an empty result`, async () => {
    const error = await rejectionOf(run);
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'invalidInput');
    assert.equal(error.message, 'errors.invalidRegex');
    assertNoSecretLogged();
  });
}

// --- B23: TypeConverter validates at runtime ---

const result = (type: myResult['type'], value: unknown) => ({ type, result: value, isNull: false, abort: false, __brand: 'myResult' }) as myResult;

test('B23: TypeConverter accepts valid results including empty ones', () => {
  assert.deepEqual(changeResultType(result('Text', ''), 'Text'), { status: 'ok', data: '' });
  assert.deepEqual(changeResultType(result('ColumnList', []), 'ColumnList'), { status: 'ok', data: [] });
  assert.deepEqual(changeResultType(result('Column', []), 'Column'), { status: 'ok', data: [] });
  const v2 = { result_text: '', removed_lines: 3 };
  assert.deepEqual(changeResultType(result('TextV2', v2), 'TextV2'), { status: 'ok', data: v2 });
});

test('B23: TypeConverter converts between line based types', () => {
  assert.deepEqual(changeResultType(result('Text', 'a\nb'), 'Column'), { status: 'ok', data: ['a', 'b'] });
  assert.deepEqual(changeResultType(result('Column', ['a', 'b']), 'Text'), { status: 'ok', data: 'a\nb' });
  assert.deepEqual(changeResultType(result('ColumnList', [['a'], ['b', 'c']]), 'Column'), { status: 'ok', data: ['a', 'b', 'c'] });
});

test('B23: TypeConverter rejects data that does not match its declared type', () => {
  for (const [type, value, target] of [
    ['Text', { foo: 1 }, 'Text'],
    ['Text', undefined, 'Text'],
    ['Column', [1, 2], 'Column'],
    ['ColumnList', ['a'], 'ColumnList'],
    ['TextV2', { result_text: 'x' }, 'TextV2'],
    ['TextV2', 'x', 'TextV2'],
  ] as const) {
    const converted = changeResultType(result(type, value), target);
    assert.equal(converted.status, 'error', `${type} ${JSON.stringify(value)}`);
  }
});

test('B23: TypeConverter rejects unsupported conversions instead of returning {}', () => {
  const converted = changeResultType(result('Text', 'x'), 'TextV2');
  assert.equal(converted.status, 'error');
  assert.equal(changeResultType(result('TextV2', { result_text: 'x', removed_lines: 0 }), 'ColumnList').status, 'error');
});

// --- Strict validation: Rust diff types ---

const rustDiff = (diff_type: unknown) => JSON.stringify([{ text: 'a', diff_type, line_number: 1 }]);

test('diff: all defined Rust diff types are accepted', () => {
  for (const [rust, js] of [['Added', 'added'], ['Removed', 'removed'], ['Moved', 'moved'], ['Unchanged', 'unchanged']]) {
    assert.deepEqual(convertBackendDiff(rustDiff(rust)), [{ type: js, text: 'a', lineNumber: 1 }]);
  }
});

test('diff: unknown types and inherited property names are rejected', () => {
  for (const diffType of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'added', 'Changed', '', null, 1]) {
    assert.throws(() => convertBackendDiff(rustDiff(diffType)), (e: any) => e.kind === 'invalidResult', String(diffType));
  }
});

test('diff: an inherited property name from the backend is an invalid-result error in the service', async () => {
  backend(() => processed(rustDiff('constructor')));
  const error = await rejectionOf(() => new DiffService().invoke(diffArgs('a', 'b'), true));
  assert.equal(error.kind, 'invalidResult');
});

// --- Strict validation: optional Remove metrics ---

test('TextV2: metrics are optional', () => {
  assert.equal(isTextV2({ result_text: 'b', removed_lines: 1 }), true);
});

test('TextV2: valid metrics are accepted', () => {
  assert.equal(isTextV2({ result_text: 'b', removed_lines: 1, metrics: backendMetrics }), true);
  assert.equal(isTextV2({ result_text: 'b', removed_lines: 1, metrics: { execution_time_ms: 0, memory_usage_kb: 0, memory_usage_str: '' } }), true);
});

test('TextV2: invalid metrics are rejected', () => {
  for (const metrics of [null, 'fast', 42, {}, { execution_time_ms: '1', memory_usage_kb: 0 }, { execution_time_ms: 1 }, { execution_time_ms: NaN, memory_usage_kb: 0 }]) {
    assert.equal(isTextV2({ result_text: 'b', removed_lines: 1, metrics }), false, JSON.stringify(metrics));
  }
  assert.equal(changeResultType(result('TextV2', { result_text: 'b', removed_lines: 1, metrics: {} }), 'TextV2').status, 'error');
});

test('TextV2: empty but valid Remove results are accepted', () => {
  assert.equal(isTextV2({ result_text: '', removed_lines: 0 }), true);
  assert.equal(isTextV2({ result_text: '', removed_lines: 3, metrics: backendMetrics }), true);
  assert.deepEqual(changeResultType(result('TextV2', { result_text: '', removed_lines: 3 }), 'TextV2'), { status: 'ok', data: { result_text: '', removed_lines: 3 } });
});
