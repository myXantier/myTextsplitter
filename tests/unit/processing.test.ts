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
const { SplitService, FilterService, RemoveService, DiffService, MatchPreviewService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { invokeUNSAFE } = await import('../../src/services/tauriInvoke.ts');
const { default: changeResultType } = await import('../../src/other/TypeConverter.ts');
const { assertBackendDiff } = await import('../../src/services/DiffService.ts');
const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
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

test('Paket 10 E4: emptyDelimiter from the Rust split is an invalid-input error and keeps the metrics of the last result', async () => {
  const service = new SplitService();
  backend(() => processed(['a', 'b']));
  await service.invoke(splitArgs('a,b', ','), true);
  const before = service.getMetrics();
  backend(() => {
    throw { kind: 'emptyDelimiter', message: 'the plain delimiter is empty' };
  });
  const error = await rejectionOf(() => service.invoke(splitArgs('a😀b', ''), true));
  assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: 'errors.emptyDelimiter' });
  assert.deepEqual(service.getMetrics(), before);
});

test('Paket 10 E4: the JS main-thread split refuses an empty plain delimiter, also for an empty text', async () => {
  installWindow();
  for (const text of ['', 'a😀b']) {
    const error = await rejectionOf(() => new SplitService().invoke(splitArgs(text, ''), false));
    assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: 'errors.emptyDelimiter' });
  }
});

test('B4: regex runtime error from Rust (backtrack limit) is an invalid-input error with its own message', async () => {
  backend(() => {
    throw { kind: 'regexRuntime', message: 'Max limit for backtracking count exceeded' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('abab', '(a|b|ab)*(?=c)'), true));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, 'errors.regexTooComplex');
});

test('Rust task failure (panic/cancelled, kind "internal") is a backend error, not an input error', async () => {
  backend(() => {
    throw { kind: 'internal', message: 'text processing task failed: task panicked' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), true));
  assert.equal(error.kind, 'backend');
  assert.equal(error.message, 'errors.processingError');
  assert.equal(error.detail, 'text processing task failed: task panicked');
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

test('B24: diff delivers the same Diff document in backend and main-thread mode', async () => {
  // What the Rust command answers (structured document + metrics); the Rust side is checked by the shared fixtures
  const document = {
    version: 2,
    options: { ignoreWhitespace: false },
    oldLineCount: 1,
    newLineCount: 2,
    rows: [
      { kind: 'equal', old: { line: 1, text: 'one' }, new: { line: 1, text: 'one' } },
      { kind: 'insert', new: { line: 2, text: 'two' } },
    ],
    moves: [],
    stats: { unchanged: 1, removed: 0, added: 1, moved: 0 },
  };
  backend(() => ({ document, intraline: null, metrics: backendMetrics }));
  const fromBackend = await new DiffService().invoke(diffArgs('one', 'one\ntwo'), true);
  assert.equal(fromBackend.type, 'Diff');
  assert.deepEqual(fromBackend.result, { document, intraline: null });

  installWindow();
  const fromJs = await new DiffService().invoke(diffArgs('one', 'one\ntwo'), false);
  assert.equal(fromJs.type, 'Diff');
  assert.deepEqual(fromJs.result, { document, intraline: null });
});

// --- Main-thread fallback (no Web Worker) ---

test('fallback: the main-thread filter implementation returns an empty Text result for removed lines', async () => {
  // Not reachable through `invoke` without Web Worker (Filter always runs a regex), kept as implementation
  const result = await (new FilterService() as any).frontendInMainThread(filterArgs('apple', 'x'));
  assert.deepEqual({ type: result.type, result: result.result }, { type: 'Text', result: '' });
});

// --- Paket 5: no unprotected regex in the UI thread ---

for (const [name, run] of [
  ['split', () => new SplitService().invoke(splitArgs(SECRET, '(?<=\\w),', true), false)],
  ['filter', () => new FilterService().invoke(filterArgs(SECRET, '(?<=\\$)\\d+'), false)],
  ['remove', () => new RemoveService().invoke(removeArgs(SECRET, 'a', 'containing', true), false)],
  ['preview', () => new MatchPreviewService().invoke({ sourceText: SECRET, mainParam: 'a', configParams: { caseSensitive: true } }, false)],
] as const) {
  test(`fallback: a valid regex in ${name} is not run in the main thread without Web Worker`, async () => {
    const error = await rejectionOf(run);
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'worker');
    assert.equal(error.message, 'errors.regexRequiresWorker');
    assertNoSecretLogged();
  });
}

test('fallback: a catastrophic regex is refused at once instead of blocking the main thread', { timeout: 5000 }, async () => {
  // ~2 minutes in V8 if it were executed (no backtracking limit in JS)
  const started = performance.now();
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('ab'.repeat(40), '(a|b|ab)*(?=c)'), false));
  assert.equal(error.message, 'errors.regexRequiresWorker');
  assert.ok(performance.now() - started < 1000);
});

test('fallback: operations without regex still run in the main thread', async () => {
  const split = await new SplitService().invoke(splitArgs('a.b', '.'), false);
  assert.deepEqual(split.result, [['a'], ['b']]);
  const removed = await new RemoveService().invoke(removeArgs('a.\nb', 'a.', 'containing', false), false);
  assert.equal((removed.result as ProcessedText<string>).result_text, 'b');
  const duplicates = await new RemoveService().invoke(removeArgs('a\na', '([a-', 'duplicates', true), false);
  assert.equal((duplicates.result as ProcessedText<string>).result_text, 'a');
  const diff = await new DiffService().invoke(diffArgs('a', 'b'), false);
  assert.equal(diff.type, 'Diff');
});

// --- Paket 5: Rust-specific patterns are validated by Rust, not by JS ---

test('backend: a Rust-only pattern is sent to Rust unchanged (no JS pre-validation)', async () => {
  const sent: unknown[] = [];
  backend((_cmd, args) => {
    sent.push(args.delimiter ?? args.pattern);
    return _cmd === 'process_text_block' ? processed(['a', 'b']) : processed('X');
  });
  await new SplitService().invoke(splitArgs('aXb', '(?i)x', true), true);
  await new FilterService().invoke(filterArgs('aXb', '(?>X+)'), true);
  await new RemoveService().invoke(removeArgs('aXb', '(?P<n>x)', 'containing', true), true);
  assert.deepEqual(sent, ['(?i)x', '(?>X+)', '(?P<n>x)']);
});

test('backend: the Rust error message of an invalid regex is kept as detail', async () => {
  backend(() => {
    throw { kind: 'invalidRegex', message: 'Parsing error at position 4: Invalid character class' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', '([a-'), true));
  assert.equal(error.detail, 'Parsing error at position 4: Invalid character class');
});

// --- Paket 5: late results must not overwrite newer ones ---

test('backend: a late result of an older job is discarded (superseded), the newer one is kept', { timeout: 3000 }, async () => {
  let releaseOlder: (value: unknown) => void = () => {};
  let calls = 0;
  backend(() => (++calls === 1 ? new Promise((resolve) => (releaseOlder = resolve)) : processed('newer')));
  const olderService = new FilterService();
  const older = rejectionOf(() => olderService.invoke(filterArgs('a', 'a'), true));
  await new Promise((resolve) => setImmediate(resolve));
  const newer = await new FilterService().invoke(filterArgs('a', 'a'), true);
  releaseOlder(processed('older'));
  const error = await older;
  assert.equal(error.kind, 'superseded');
  assert.equal(newer.result, 'newer');
});

test('backend: an error of an older job is not reported once a newer job runs', { timeout: 3000 }, async () => {
  let failOlder: (reason: unknown) => void = () => {};
  let calls = 0;
  backend(() => (++calls === 1 ? new Promise((_resolve, reject) => (failOlder = reject)) : processed('newer')));
  const older = rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), true));
  await new Promise((resolve) => setImmediate(resolve));
  await new FilterService().invoke(filterArgs('a', 'a'), true);
  failOlder({ kind: 'regexRuntime', message: 'limit' });
  assert.equal((await older).kind, 'superseded');
});

const metricsOf = (execution_time_ms: number) => ({ execution_time_ms, memory_usage_kb: 1, memory_usage_str: '1' });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('backend: the newer job ends first, the older late one does not overwrite result or metrics (same instance)', { timeout: 3000 }, async () => {
  let releaseOlder: (value: unknown) => void = () => {};
  let calls = 0;
  backend(() => (++calls === 1 ? new Promise((resolve) => (releaseOlder = resolve)) : { result_text: 'newer', removed_lines: 0, metrics: metricsOf(5) }));
  const service = new FilterService();
  const older = rejectionOf(() => service.invoke(filterArgs('a', 'a'), true));
  await flush();
  const newer = await service.invoke(filterArgs('a', 'a'), true);
  releaseOlder({ result_text: 'older', removed_lines: 0, metrics: metricsOf(99) });
  assert.equal((await older).kind, 'superseded');
  assert.equal(newer.result, 'newer');
  assert.equal(service.getMetrics()?.executionTime, 5, 'the late older result must not set the metrics');
  assert.equal((service as any).lastMetrics.length, 1);
});

test('backend: the older job ends first while the newer still runs: discarded without metrics', { timeout: 3000 }, async () => {
  const release: ((value: unknown) => void)[] = [];
  backend(() => new Promise((resolve) => release.push(resolve)));
  const service = new SplitService();
  const older = rejectionOf(() => service.invoke(splitArgs('a,b', ','), true));
  await flush();
  const newer = service.invoke(splitArgs('c,d', ','), true);
  await flush();
  release[0]({ result_text: ['x'], removed_lines: 0, metrics: metricsOf(99) });
  assert.equal((await older).kind, 'superseded');
  assert.equal(service.getMetrics(), null, 'no metrics of the superseded job');
  release[1]({ result_text: ['c', 'd'], removed_lines: 0, metrics: metricsOf(7) });
  assert.deepEqual((await newer).result, [['c'], ['d']]);
  assert.equal(service.getMetrics()?.executionTime, 7);
});

test('backend: a request the Rust job slot skipped (kind "superseded") ends silently when a newer job exists', { timeout: 3000 }, async () => {
  let rejectOlder: (reason: unknown) => void = () => {};
  let calls = 0;
  backend(() => (++calls === 1 ? new Promise((_resolve, reject) => (rejectOlder = reject)) : processed('newer')));
  const older = rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), true));
  await flush();
  const newer = new FilterService().invoke(filterArgs('a', 'a'), true);
  rejectOlder({ kind: 'superseded' }); // Rust: replaced while waiting, never ran
  assert.equal((await older).kind, 'superseded', 'no message, no result for the skipped request');
  assert.equal((await newer).result, 'newer');
});

test('backend: "superseded" from Rust for the latest job (out of order) is a visible error, never a success', async () => {
  backend(() => {
    throw { kind: 'superseded' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), true));
  assert.equal(error.kind, 'backend');
  assert.equal(error.message, 'errors.processingError');
});

test('a failing backend detection rejects with the original error and leaves no registered job', { timeout: 3000 }, async () => {
  installWindow();
  const service = new FilterService();
  service.isAvailable = async () => {
    throw new Error('backend detection failed: IPC broken');
  };
  const error = await rejectionOf(() => service.invoke(filterArgs('a', 'a')));
  assert.equal(error.kind, 'backend');
  assert.equal(error.detail, 'backend detection failed: IPC broken');
  assert.equal((BaseService as any).runningJobs.has('filter'), false, 'no job may stay registered');

  backend(() => processed('ok'));
  assert.equal((await new FilterService().invoke(filterArgs('a', 'a'), true)).result, 'ok', 'the next job runs normally');
});

// --- Paket 5: memory metrics that the platform does not provide ---

test('backend: memory metric not available (null) is accepted and kept as not available', async () => {
  backend(() => ({ result_text: 'a', removed_lines: 0, metrics: { execution_time_ms: 2, memory_usage_kb: null, memory_usage_str: null } }));
  const service = new FilterService();
  const result = await service.invoke(filterArgs('a', 'a'), true);
  assert.equal(result.result, 'a');
  assert.equal(service.getMetrics()?.executionTime, 2);
  assert.equal(service.getMetrics()?.memoryUsage, null);
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

// --- Strict validation: Rust diff rows ---

/** Backend answer for old 'a' / new 'b' (one delete, one insert) whose rows all get the given `kind`. */
const rustDiff = (kind: unknown) => {
  const document: any = computeLineDiff('a', 'b', { ignoreWhitespace: false });
  for (const row of document.rows) row.kind = kind;
  return { document, intraline: null, metrics: backendMetrics };
};

test('diff: all defined Rust row kinds are accepted', () => {
  const document = computeLineDiff('a\nb\nc', 'b\na\nx', { ignoreWhitespace: false });
  assert.deepEqual(new Set(document.rows.map((r) => r.kind)), new Set(['equal', 'delete', 'insert']));
  assert.equal(assertBackendDiff({ document, intraline: null, metrics: backendMetrics }).data.document, document);
});

test('diff: unknown row kinds and inherited property names are rejected', () => {
  for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'Equal', 'changed', 'moved', 'equal', '', null, 1]) {
    assert.throws(() => assertBackendDiff(rustDiff(kind)), (e: any) => e.kind === 'invalidResult', String(kind));
  }
});

test('diff: an inherited property name from the backend is an invalid-result error in the service', async () => {
  backend(() => rustDiff('constructor'));
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

// --- Paket 8 C3: unknown or empty Filter/Remove modes are invalid input, never a silent default ---

for (const [name, run] of [
  ['filter (unknown)', () => new FilterService().invoke(filterArgs('a1', 'a', 'bogus'), true)],
  ['filter (empty)', () => new FilterService().invoke(filterArgs('a1', 'a', ''), true)],
  ['remove (unknown)', () => new RemoveService().invoke(removeArgs('a\nb', 'a', 'bogus'), true)],
  ['remove (empty)', () => new RemoveService().invoke(removeArgs('a\nb', 'a', ''), true)],
] as const) {
  test(`C3: ${name} mode is refused before the Rust command runs`, async () => {
    const calls = backend(() => processed('should not be used'));
    const error = await rejectionOf(run);
    assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: 'errors.invalidMode' });
    assert.deepEqual(calls, [], 'no IPC call for an invalid request');
  });
}

test('C3: invalidMode from the Rust command is an invalid-input error (not a backend error)', async () => {
  backend(() => {
    throw { kind: 'invalidMode', message: 'unknown filter mode "x"' };
  });
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), true));
  assert.deepEqual({ kind: error.kind, message: error.message, detail: error.detail }, { kind: 'invalidInput', message: 'errors.invalidMode', detail: 'unknown filter mode "x"' });
});

test('C3: an invalid mode keeps the metrics of the last valid result (backend and main thread)', async () => {
  backend(() => processed('b', 1));
  const service = new RemoveService();
  await service.invoke(removeArgs('a\nb', 'a'), true);
  const before = service.getMetrics();
  assert.equal(before?.executionTime, backendMetrics.execution_time_ms);

  assert.equal((await rejectionOf(() => service.invoke(removeArgs('a\nb', 'a', 'bogus'), true))).message, 'errors.invalidMode');
  assert.equal(service.getMetrics(), before, 'backend path: metrics unchanged');
  assert.equal((await rejectionOf(() => service.invoke(removeArgs('a\nb', 'a', 'Containing'), false))).message, 'errors.invalidMode');
  assert.equal(service.getMetrics(), before, 'main-thread path: metrics unchanged');
});

test('C3: every supported mode still runs (main-thread Remove, Filter refused only for its regex)', async () => {
  for (const mode of ['duplicates', 'containing', 'notContaining']) {
    const result = await new RemoveService().invoke(removeArgs('a\nb\na', 'a', mode), false);
    assert.equal(result.type, 'TextV2', mode);
  }
  for (const mode of ['keep', 'remove']) {
    const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a', mode), false));
    assert.equal(error.message, 'errors.regexRequiresWorker', mode);
  }
});
