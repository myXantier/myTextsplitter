// Error propagation from the Web Workers to the services (Paket 4: B22, worker/timeout/communication errors).
//
// The real worker modules run in-process: `self` is a stand-in whose `postMessage` is captured.
// `FakeWorker` (installed as global `Worker` before the services are loaded) forwards messages to these
// real worker handlers, so `service.invoke(args, false)` runs the same code as in the browser
// (BaseService.frontendWithWorker -> worker -> postMessage -> BaseService). Single tests replace the
// worker behaviour (crash, no answer, malformed answer).
import { installWindow, disableWorkerCleanupInterval, rejectionOf, logged } from './helpers/setup.ts';
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const g = globalThis as any;

// --- worker side: `self` stand-in ---
type Handler = (event: { data: unknown }) => void;
let deliver: (message: any) => void = () => {};
g.self = { postMessage: (message: unknown) => deliver(structuredClone(message)), onmessage: null };

const workerHandlers: Record<string, Handler> = {};
for (const name of ['SplitWorker', 'FilterWorker', 'RemoveWorker', 'DiffWorker', 'MatchPreviewWorker']) {
  await import(`../../src/workers/${name}.ts`);
  workerHandlers[name] = g.self.onmessage;
}

/** Sends one job to a worker module and returns every message it posted. */
function runWorker(name: string, args: BaseConfig) {
  const messages: any[] = [];
  deliver = (message) => messages.push(message);
  workerHandlers[name]({ data: { args } });
  return messages;
}

// --- page side: `Worker` stand-in that forwards to the real worker modules ---
// 'manual': the job is only answered when the test calls `worker.answer()` (late answers, parallel jobs).
// 'noConstruct': the constructor throws (e.g. blocked by a content security policy).
type Behaviour = 'real' | 'crash' | 'silent' | 'manual' | 'noConstruct' | { reply: unknown };
let behaviour: Behaviour = 'real';
/** Every worker created by BaseService, in creation order */
let instances: FakeWorker[] = [];

class FakeWorker {
  onmessage: Handler | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: Handler | null = null;
  isWorking = false;
  cleanupTime = 0;
  terminated = false;
  jobs = 0;
  /** 'manual' behaviour: runs the pending job in the real worker module and posts its answer */
  answer: () => void = () => {
    throw new Error('no pending job');
  };
  readonly name: string;

  constructor(url: URL) {
    if (behaviour === 'noConstruct') throw new Error('SecurityError: worker blocked');
    this.name = /(\w+Worker)\.ts$/.exec(String(url))![1];
    instances.push(this);
  }

  postMessage(message: any) {
    if (this.terminated) return; // like a browser: messages to a terminated worker are dropped silently
    if (message?.test) return;
    this.jobs++;
    const current = behaviour;
    const run = () => {
      if (this.terminated) return; // a terminated worker never answers
      deliver = (reply) => this.onmessage?.({ data: reply });
      workerHandlers[this.name](structuredClone({ data: message }));
    };
    if (current === 'manual') {
      this.answer = run;
      return;
    }
    queueMicrotask(() => {
      if (current === 'crash') return this.onerror?.({ message: 'Uncaught ReferenceError: boom' });
      if (current === 'silent') return;
      if (typeof current === 'object') return this.onmessage?.({ data: current.reply });
      run();
    });
  }

  terminate() {
    this.terminated = true;
  }
}
g.Worker = FakeWorker;

// Services first (same order as the app): BaseService <-> Services import each other
const { SplitService, FilterService, RemoveService, DiffService, MatchPreviewService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
disableWorkerCleanupInterval(BaseService);

beforeEach(() => {
  installWindow();
  behaviour = 'real';
  BaseService.cleanupWorkers();
  instances = [];
});

/** Workers currently in the pool of `type` */
const pooled = (type: string): FakeWorker[] => (BaseService as any).workerPool.get(type) ?? [];
const flush = () => new Promise((resolve) => setImmediate(resolve));

const filterArgs = (sourceText: string, pattern: string, filterMode = 'keep'): FilterConfig => ({
  sourceText,
  mainParam: pattern,
  configParams: { caseSensitive: true, filterMode, splitMatches: false },
});
const removeArgs = (sourceText: string, pattern: string, useRegex = false): RemoveConfig => ({
  sourceText,
  mainParam: pattern,
  configParams: { caseSensitive: true, useRegex, trimParts: false, removeMode: 'containing' },
});
const splitArgs = (sourceText: string, delimiter: string, useRegex = false): SplitConfig => ({
  sourceText,
  mainParam: delimiter,
  configParams: { trimParts: false, useRegex, keepEmptyLines: true },
});

// --- Worker modules ---

test('FilterWorker: non-empty result', () => {
  const [message, ...rest] = runWorker('FilterWorker', filterArgs('apple\nbanana', 'ap'));
  assert.equal(rest.length, 0);
  assert.equal(message.success, true);
  assert.deepEqual({ type: message.result.type, result: message.result.result }, { type: 'Text', result: 'ap' });
});

test('FilterWorker: removing all lines is a successful empty Text result', () => {
  const [message] = runWorker('FilterWorker', filterArgs('apple\nbanana', 'x'));
  assert.equal(message.success, true);
  assert.deepEqual({ type: message.result.type, result: message.result.result }, { type: 'Text', result: '' });
});

test('B22: FilterWorker reports an invalid regex as error (not as empty Column result)', () => {
  const messages = runWorker('FilterWorker', filterArgs('apple', '([a-'));
  assert.equal(messages.length, 1, JSON.stringify(messages));
  assert.equal(messages[0].success, false);
  assert.equal(messages[0].errorKind, 'invalidInput');
  assert.equal(messages[0].error, 'errors.invalidRegex');
});

test('B22: RemoveWorker reports an invalid regex exactly once and without a success message', () => {
  const messages = runWorker('RemoveWorker', removeArgs('a', '([a-', true));
  assert.equal(messages.length, 1, JSON.stringify(messages));
  assert.equal(messages[0].success, false);
  assert.equal(messages[0].errorKind, 'invalidInput');
});

test('B22: SplitWorker reports an invalid regex as error', () => {
  const messages = runWorker('SplitWorker', splitArgs('a', '([a-', true));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, false);
  assert.equal(messages[0].errorKind, 'invalidInput');
});

test('Paket 10 E4/E5: SplitWorker refuses an empty plain delimiter and a cut character with one error, no partial columns', () => {
  for (const [args, error] of [
    [splitArgs('', ''), 'errors.emptyDelimiter'],
    [splitArgs('a\n😀b', ''), 'errors.emptyDelimiter'],
    // The first row is fine, the second one would be cut: the whole job fails
    [splitArgs('a,b\r\nx😀y', '[😀]', true), 'errors.regexSplitsCharacter'],
    [splitArgs('a😀b', '(\\uD83D)\\uDE00', true), 'errors.regexSplitsCharacter'],
  ] as const) {
    const messages = runWorker('SplitWorker', args);
    assert.deepEqual(messages.map((m) => ({ success: m.success, errorKind: m.errorKind, error: m.error, result: m.result })), [
      { success: false, errorKind: 'invalidInput', error, result: null },
    ]);
  }
  // Safe emoji splits keep working
  const [safe] = runWorker('SplitWorker', splitArgs('a😀b🎉c', '(😀)|🎉', true));
  assert.deepEqual(safe.result.result, [['a'], ['😀'], ['b'], [''], ['c']]);
});

test('RemoveWorker: removing all lines is a successful empty TextV2 result', () => {
  const [message] = runWorker('RemoveWorker', removeArgs('a\nab', 'a'));
  assert.equal(message.success, true);
  assert.equal(message.result.type, 'TextV2');
  assert.equal(message.result.result.result_text, '');
  assert.equal(message.result.result.removed_lines, 2);
});

test('SplitWorker: delivers a ColumnList', () => {
  const [message] = runWorker('SplitWorker', splitArgs('a,b', ','));
  assert.deepEqual({ type: message.result.type, result: message.result.result }, { type: 'ColumnList', result: [['a'], ['b']] });
});

test('worker without args reports an error', () => {
  const messages: any[] = [];
  deliver = (m) => messages.push(m);
  workerHandlers.FilterWorker({ data: { foo: 1 } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, false);
});

// --- Worker transport in BaseService ---

test('worker path: successful results reach the service', async () => {
  const filtered = await new FilterService().invoke(filterArgs('apple\nbanana', 'x'), false);
  assert.deepEqual({ type: filtered.type, result: filtered.result }, { type: 'Text', result: '' });
  const removed = await new RemoveService().invoke(removeArgs('a\nb', 'a'), false);
  assert.equal(removed.type, 'TextV2');
  assert.equal((removed.result as ProcessedText<string>).result_text, 'b');
  const split = await new SplitService().invoke(splitArgs('a,b', ','), false);
  assert.equal(split.type, 'ColumnList');
  const diff = await new DiffService().invoke({ sourceText: 'a', mainParam: 'b', configParams: { caseSensitive: true, ignoreWhitespace: false } }, false);
  assert.equal(diff.type, 'Diff');
  assert.deepEqual((diff.result as any).document.stats, { unchanged: 0, removed: 1, added: 1, moved: 0 });
  assert.equal((diff.result as any).intraline, null);
});

const diffArgs = (sourceText: string, mainParam: string): DiffConfig => ({ sourceText, mainParam, configParams: { caseSensitive: true, ignoreWhitespace: false } });

test('Paket 7: the diff worker keeps every new line when the new text is longer (former truncation)', async () => {
  for (const [oldText, newText] of [['A', 'A\nB\nC\nD'], ['', 'A\nB'], ['A\nB', 'X\nA\nB\nC']]) {
    const diff = await new DiffService().invoke(diffArgs(oldText, newText), false);
    const document = (diff.result as any).document;
    assert.equal(document.newLineCount, newText.split('\n').length);
    assert.deepEqual(
      document.rows.flatMap((r: any) => (r.kind === 'delete' ? [] : [r.new.text])),
      newText.split('\n'),
    );
  }
  assert.ok(instances.some((w) => w.name === 'DiffWorker'), 'ran in the diff worker');
});

test('Paket 7: one diff worker message per job, even for long texts', () => {
  const messages = runWorker('DiffWorker', diffArgs(Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n'), 'x'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, true);
  assert.equal(messages[0].result.type, 'Diff');
});

test('Paket 7: a too complex diff in the worker is an invalid-input error, no partial result', async () => {
  const lines = Array.from({ length: 12_000 }, (_, i) => `line ${i}`);
  const error = await rejectionOf(() => new DiffService().invoke(diffArgs(lines.join('\n'), [...lines].reverse().join('\n')), false));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, 'errors.diffTooComplex');
});

const diffFixtures = JSON.parse(readFileSync(new URL('../fixtures/diff-cases.json', import.meta.url), 'utf8'));
const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
const diffReply = (document: unknown, intraline: unknown = null) => ({ success: true, type: 'complete', result: { type: 'Diff', result: { document, intraline }, isNull: false, abort: false, __brand: 'myResult' } });

for (const v of diffFixtures.validatedDocuments.filter((v: any) => !v.valid)) {
  test(`Paket 7: corrupted diff worker answer (${v.name}) is invalidResult, no metrics`, async () => {
    behaviour = { reply: diffReply(v.document) };
    const service = new DiffService();
    const error = await rejectionOf(() => service.invoke({ sourceText: v.old, mainParam: v.new, configParams: { caseSensitive: true, ignoreWhitespace: v.ignoreWhitespace } }, false));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

for (const [label, document] of [
  ['the diff of another input', computeLineDiff('a', 'x', { ignoreWhitespace: false })],
  ['a truncated diff (new text cut)', computeLineDiff('a', 'a', { ignoreWhitespace: false })],
] as const) {
  test(`Paket 7: a diff worker answer with ${label} is invalidResult, no metrics`, async () => {
    behaviour = { reply: diffReply(document) };
    const service = new DiffService();
    const error = await rejectionOf(() => service.invoke(diffArgs('a', 'a\nb'), false));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

test('Paket 7: invalid diff worker arguments are a worker error', () => {
  const messages = runWorker('DiffWorker', { sourceText: 'a', mainParam: 1, configParams: {} } as unknown as BaseConfig);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, false);
  assert.equal(messages[0].errorKind, 'worker');
});

for (const [name, run] of [
  ['filter', () => new FilterService().invoke(filterArgs('apple', '([a-'), false)],
  ['remove', () => new RemoveService().invoke(removeArgs('apple', '([a-', true), false)],
  ['split', () => new SplitService().invoke(splitArgs('apple', '([a-', true), false)],
] as const) {
  test(`B22: invalid regex in the ${name} worker reaches the service as invalid-input error`, async () => {
    const error = await rejectionOf(run);
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'invalidInput');
    assert.equal(error.message, 'errors.invalidRegex');
  });
}

test('worker crash (onerror) is reported as worker error', async () => {
  behaviour = 'crash';
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false));
  assert.ok(error instanceof Error);
  assert.equal(error.kind, 'worker');
});

test('worker timeout is reported as timeout error', async () => {
  behaviour = 'silent';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false));
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    mock.timers.tick(10_000);
    const error = await pending;
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'timeout');
  } finally {
    mock.timers.reset();
  }
});

for (const [label, reply] of [
  ['success without result', { success: true, type: 'complete', result: null }],
  ['result with invalid data', { success: true, type: 'complete', result: { type: 'Text', result: 42 } }],
  ['result of an unexpected type', { success: true, type: 'complete', result: { type: 'Column', result: [] } }],
  ['unknown message', { hello: 'world' }],
] as const) {
  test(`malformed worker answer (${label}) is an invalid-result error`, async () => {
    behaviour = { reply };
    const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false));
    assert.ok(error instanceof Error);
    assert.equal(error.kind, 'invalidResult');
  });
}

test('worker error message without kind is a worker error', async () => {
  behaviour = { reply: { success: false, type: 'error', error: 'Unknown error', result: null } };
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false));
  assert.equal(error.kind, 'worker');
});

// --- Paket 5: worker lifecycle (timeout, termination, reuse, late answers, parallel jobs) ---
// Tests that would wait for an answer forever with a broken implementation have a time limit.
const limited = { timeout: 3000 };

test('timeout terminates the running worker at once and removes it from the pool', limited, async () => {
  behaviour = 'manual';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false));
    await flush();
    const [worker] = instances;
    assert.equal(worker.terminated, false);
    mock.timers.tick(10_000);
    assert.equal((await pending).kind, 'timeout');
    assert.equal(worker.terminated, true, 'worker.terminate() is called when the timeout fires');
    assert.equal(worker.onmessage, null);
    assert.equal(worker.onerror, null);
    assert.ok(!pooled('filter').includes(worker));
  } finally {
    mock.timers.reset();
  }
});

test('an answer that arrives after the timeout changes nothing; the next job uses a new worker', limited, async () => {
  behaviour = 'manual';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const service = new FilterService();
    const pending = rejectionOf(() => service.invoke(filterArgs('apple', 'ap'), false));
    await flush();
    const [stale] = instances;
    mock.timers.tick(10_000);
    assert.equal((await pending).kind, 'timeout');

    // A result message that was already queued when the worker was terminated
    stale.onmessage?.({ data: { success: true, type: 'complete', result: { type: 'Text', result: 'late', isNull: false, abort: false } } });
    mock.timers.tick(60_000);
    assert.equal(service.getMetrics(), null, 'a late result must not update the metrics');
    assert.ok(!pooled('filter').includes(stale), 'a terminated worker must never return to the pool');

    behaviour = 'real';
    const result = await new FilterService().invoke(filterArgs('apple', 'ap'), false);
    assert.equal(result.result, 'ap');
    assert.equal(instances.length, 2, 'new worker after the timeout');
    assert.equal(stale.jobs, 1, 'the terminated worker got no further job');
  } finally {
    mock.timers.reset();
  }
});

test('a successful worker returns to the pool at once, is reused, and its timeout timer is cleared', limited, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await new FilterService().invoke(filterArgs('apple', 'ap'), false);
    assert.deepEqual(pooled('filter'), [instances[0]]);
    await new FilterService().invoke(filterArgs('apple', 'ap'), false);
    assert.equal(instances.length, 1, 'worker reused');
    assert.equal(instances[0].jobs, 2);
    mock.timers.tick(60_000);
    assert.equal(instances[0].terminated, false, 'no timeout after success');
    assert.ok(!logged.some((l) => /Timeout/.test(String(l.parts[0]))), 'no timeout logged');
  } finally {
    mock.timers.reset();
  }
});

test('a worker that reported an input error stays usable', limited, async () => {
  assert.equal((await rejectionOf(() => new FilterService().invoke(filterArgs('apple', '([a-'), false))).kind, 'invalidInput');
  const [worker] = instances;
  assert.equal(worker.terminated, false);
  assert.ok(pooled('filter').includes(worker));
});

test('a crashed worker is terminated and not reused', limited, async () => {
  behaviour = 'crash';
  assert.equal((await rejectionOf(() => new FilterService().invoke(filterArgs('a', 'a'), false))).kind, 'worker');
  const [crashed] = instances;
  assert.equal(crashed.terminated, true);
  behaviour = 'real';
  assert.equal((await new FilterService().invoke(filterArgs('apple', 'ap'), false)).result, 'ap');
  assert.equal(instances.length, 2);
});

test('a worker that cannot be created is a worker error (no automatic main-thread fallback)', limited, async () => {
  behaviour = 'noConstruct';
  const error = await rejectionOf(() => new FilterService().invoke(filterArgs('apple', 'ap'), false));
  assert.equal(error.kind, 'worker');
});

test('parallel jobs of different types do not interfere', limited, async () => {
  behaviour = 'manual';
  const split = new SplitService().invoke(splitArgs('a,b', ','), false);
  const filter = new FilterService().invoke(filterArgs('apple', 'ap'), false);
  await flush();
  const [splitWorker, filterWorker] = instances;
  filterWorker.answer();
  splitWorker.answer();
  assert.equal((await filter).result, 'ap');
  assert.deepEqual((await split).result, [['a'], ['b']]);
});

test('a newer job of the same type supersedes the older one: older worker terminated, late answer ignored', limited, async () => {
  behaviour = 'manual';
  const older = rejectionOf(() => new FilterService().invoke(filterArgs('apple', 'ap'), false));
  await flush();
  const newer = new FilterService().invoke(filterArgs('banana', 'an'), false);
  await flush();
  const [olderWorker, newerWorker] = instances;

  assert.equal((await older).kind, 'superseded');
  assert.equal(olderWorker.terminated, true, 'the older worker is stopped');
  olderWorker.answer(); // ignored: terminated
  newerWorker.answer();
  assert.equal((await newer).result, 'anan');
  assert.ok(pooled('filter').includes(newerWorker));
});

test('superseded worker job on the same instance: only the newer result and metrics are applied', limited, async () => {
  behaviour = 'manual';
  const service = new FilterService();
  const older = rejectionOf(() => service.invoke(filterArgs('apple', 'ap'), false));
  await flush();
  const newerArgs = filterArgs('banana', 'an');
  const newer = service.invoke(newerArgs, false);
  await flush();
  const [olderWorker, newerWorker] = instances;
  assert.equal((await older).kind, 'superseded');
  assert.equal(service.getMetrics(), null, 'the superseded job sets no metrics');

  newerWorker.answer();
  olderWorker.answer(); // terminated: no answer
  assert.equal((await newer).result, 'anan');
  assert.equal(service.getMetrics()?.inputSize, new TextEncoder().encode(JSON.stringify(newerArgs)).length);
  assert.equal((service as any).lastMetrics.length, 1);
});

test('worker timeout, then a new job of the same type is processed by a new worker', limited, async () => {
  behaviour = 'manual';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const timedOut = rejectionOf(() => new FilterService().invoke(filterArgs('apple', 'ap'), false));
    await flush();
    mock.timers.tick(10_000);
    assert.equal((await timedOut).kind, 'timeout');
    const next = new FilterService().invoke(filterArgs('banana', 'an'), false);
    await flush();
    assert.equal(instances.length, 2, 'a new worker for the next job');
    instances[1].answer();
    assert.equal((await next).result, 'anan');
    assert.equal(instances[0].terminated, true);
    assert.deepEqual(pooled('filter'), [instances[1]]);
  } finally {
    mock.timers.reset();
  }
});

test('a job that ends after cleanupWorkers() returns its worker to the current pool (no orphaned worker)', limited, async () => {
  behaviour = 'manual';
  const job = new FilterService().invoke(filterArgs('apple', 'ap'), false);
  await flush();
  BaseService.cleanupWorkers(); // replaces the pool arrays (e.g. mode switch)
  instances[0].answer();
  await job;
  assert.deepEqual(pooled('filter'), [instances[0]]);
  BaseService.cleanupWorkers();
  assert.equal(instances[0].terminated, true, 'the next cleanup reaches it');
});

// --- Match preview (Paket 5): runs in its own worker type ---

const previewArgs = (sourceText: string, pattern: string, caseSensitive = true) => ({ sourceText, mainParam: pattern, configParams: { caseSensitive } });

test('MatchPreviewWorker: delivers match segments as ColumnList', () => {
  const [message] = runWorker('MatchPreviewWorker', previewArgs('an apple\nnone\nAPPLE', 'ap', false));
  assert.equal(message.success, true);
  assert.deepEqual({ type: message.result.type, result: message.result.result }, { type: 'ColumnList', result: [['an ', 'ap', 'ple'], ['', 'AP', 'PLE']] });
});

test('MatchPreviewWorker: invalid regex is an invalid-input error', () => {
  const messages = runWorker('MatchPreviewWorker', previewArgs('apple', '([a-'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].errorKind, 'invalidInput');
});

test('MatchPreviewWorker: the answer is not limited yet (Paket 10 R3, target E7 in Phase C1)', () => {
  // Characterization at a small size: every matching line becomes a row and every match two segments, although the
  // page shows one row at a time. The limits of E7 (docs/analyse/Paket10-PhaseB-Regexvertrag.md) are not built in yet;
  // the full sizes are measured by tests/bench/preview-baseline.mjs, not here.
  const [oneLine] = runWorker('MatchPreviewWorker', previewArgs('ab'.repeat(2_000), 'a'));
  assert.deepEqual([oneLine.result.result.length, oneLine.result.result[0].length], [1, 4_001]);
  const [manyLines] = runWorker('MatchPreviewWorker', previewArgs('xa\n'.repeat(2_000), 'a'));
  assert.equal(manyLines.result.result.length, 2_000);
  assert.ok(manyLines.result.result.every((row: string[]) => row.join('') === 'xa'));
  // Zero-width matches create no segments, a pattern without matches no rows
  const [zeroWidth] = runWorker('MatchPreviewWorker', previewArgs('ab'.repeat(2_000), '(?=a)'));
  assert.deepEqual(zeroWidth.result.result, []);
});

test('MatchPreviewService runs in the preview worker, independent of a running filter job', limited, async () => {
  behaviour = 'manual';
  const filter = new FilterService().invoke(filterArgs('apple', 'ap'), false);
  const preview = new MatchPreviewService().invoke(previewArgs('apple', 'ap'), false);
  await flush();
  const [filterWorker, previewWorker] = instances;
  assert.equal(previewWorker.name, 'MatchPreviewWorker');
  previewWorker.answer();
  filterWorker.answer();
  assert.deepEqual((await preview).result, [['', 'ap', 'ple']]);
  assert.equal((await filter).result, 'ap');
});

test('BaseService.cancelPending stops a running preview (worker terminated, job superseded)', limited, async () => {
  behaviour = 'manual';
  const preview = rejectionOf(() => new MatchPreviewService().invoke(previewArgs('apple', 'ap'), false));
  await flush();
  BaseService.cancelPending('preview');
  assert.equal((await preview).kind, 'superseded');
  assert.equal(instances[0].terminated, true);
});

// --- Paket 7 B3: optional word diff through the worker ---

const { computeIntraline } = await import('../../src/utils/diff/intraline.ts');
const wordDiffArgs = (sourceText: string, mainParam: string, wordDiff: boolean): DiffConfig => ({
  sourceText,
  mainParam,
  configParams: { caseSensitive: true, ignoreWhitespace: false, wordDiff },
});
const KATZE = ['Titel\nDie schnelle braune Katze springt.', 'Neue Einleitung\nTitel\nDie schnelle schwarze Katze läuft.'] as const;

test('Paket 7 B3: the diff worker delivers the word diff only when it is requested', async () => {
  const off = (await new DiffService().invoke(wordDiffArgs(...KATZE, false), false)).result as any;
  assert.equal(off.intraline, null);
  const on = (await new DiffService().invoke(wordDiffArgs(...KATZE, true), false)).result as any;
  assert.deepEqual(on.document, off.document, 'the same line diff in both modes');
  assert.deepEqual(on.intraline, computeIntraline(on.document));
  assert.deepEqual(on.intraline.pairs.map((p: any) => [p.oldLine, p.newLine]), [[2, 3]], 'the introduction line is not paired');
});

test('Paket 7 B3: switching the word diff during a running diff: only the newer job is delivered', limited, async () => {
  behaviour = 'manual';
  const older = rejectionOf(() => new DiffService().invoke(wordDiffArgs(...KATZE, false), false));
  await flush();
  const newer = new DiffService().invoke(wordDiffArgs(...KATZE, true), false);
  await flush();
  const [olderWorker, newerWorker] = instances;
  assert.equal((await older).kind, 'superseded');
  olderWorker.answer(); // ignored: terminated
  newerWorker.answer();
  assert.notEqual(((await newer).result as any).intraline, null, 'the result of the current mode');

  // and back: the late result with word diff is replaced by the newer one without it
  const withWordDiff = rejectionOf(() => new DiffService().invoke(wordDiffArgs(...KATZE, true), false));
  await flush();
  const withoutWordDiff = new DiffService().invoke(wordDiffArgs(...KATZE, false), false);
  await flush();
  assert.equal((await withWordDiff).kind, 'superseded');
  instances.at(-1)!.answer();
  assert.equal(((await withoutWordDiff).result as any).intraline, null);
});

test('Paket 7 B3: a diff worker timeout is reported, the next diff works', limited, async () => {
  behaviour = 'manual';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = rejectionOf(() => new DiffService().invoke(wordDiffArgs(...KATZE, true), false));
    await flush();
    mock.timers.tick(15_000);
    assert.equal((await pending).kind, 'timeout');
    assert.equal(instances[0].terminated, true);
  } finally {
    mock.timers.reset();
  }
  behaviour = 'real';
  const next = await new DiffService().invoke(wordDiffArgs(...KATZE, true), false);
  assert.equal((next.result as any).intraline.pairs.length, 1);
});

for (const [label, reply, wordDiff] of [
  ['word diff missing although requested', () => diffReply(computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false })), true],
  ['word diff although not requested', () => { const d = computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false }); return diffReply(d, computeIntraline(d)); }, false],
  ['word diff of another document', () => diffReply(computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false }), computeIntraline(computeLineDiff('q r s', 'q r t', { ignoreWhitespace: false }))), true],
  ['forged word diff segments', () => {
    const d = computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false });
    const a = structuredClone(computeIntraline(d)) as any;
    a.pairs[0].old = [{ op: 'delete', text: 'a b c' }];
    return diffReply(d, a);
  }, true],
] as const) {
  test(`Paket 7 B3: diff worker answer with ${label} is invalidResult, no metrics`, async () => {
    behaviour = { reply: reply() };
    const service = new DiffService();
    const error = await rejectionOf(() => service.invoke(wordDiffArgs('a b c', 'a b x', wordDiff), false));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

test('Paket 7 B3: a running diff worker cancelled by a newer invalid action: terminated, late answer ignored, next diff works', limited, async () => {
  behaviour = 'manual';
  const service = new DiffService();
  const running = rejectionOf(() => service.invoke(wordDiffArgs(...KATZE, true), false));
  await flush();
  const [worker] = instances;
  BaseService.cancelPending('diff'); // the DiffPage after a click with empty texts
  assert.equal((await running).kind, 'superseded');
  assert.equal(worker.terminated, true);
  worker.answer(); // ignored: terminated
  assert.equal(service.getMetrics(), null);

  behaviour = 'real';
  const next = await service.invoke(wordDiffArgs(...KATZE, false), false);
  assert.equal((next.result as any).intraline, null);
  const withWordDiff = await service.invoke(wordDiffArgs(...KATZE, true), false);
  assert.equal((withWordDiff.result as any).intraline.pairs.length, 1);
});

test('Paket 7 B3: a failed valid comparison in the worker (too complex) keeps the metrics; word diff of the shown texts works', async () => {
  const service = new DiffService();
  await service.invoke(wordDiffArgs('Die Katze schläft', 'Die Katze träumt', false), false);
  const metrics = service.getMetrics();
  const lines = Array.from({ length: 12_000 }, (_, i) => `line ${i}`);
  const error = await rejectionOf(() => service.invoke(wordDiffArgs(lines.join('\n'), [...lines].reverse().join('\n'), false), false));
  assert.equal(error.message, 'errors.diffTooComplex');
  assert.equal(service.getMetrics(), metrics, 'the failed comparison sets no metrics');
  const shown = await service.invoke(wordDiffArgs('Die Katze schläft', 'Die Katze träumt', true), false);
  assert.equal((shown.result as any).intraline.pairs[0].old.find((s: any) => s.op === 'delete').text, 'schläft');
});

// --- Paket 8 C3: invalid modes in the worker path ---

test('C3: an invalid mode is refused before a worker is started', async () => {
  for (const run of [
    () => new FilterService().invoke(filterArgs('a1', '[0-9]', 'bogus'), false),
    () => new RemoveService().invoke({ ...removeArgs('a\nb', 'a'), configParams: { ...removeArgs('a\nb', 'a').configParams, removeMode: '' } }, false),
  ]) {
    const error = await rejectionOf(run);
    assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: 'errors.invalidMode' });
  }
  assert.equal(instances.length, 0, 'no worker created');
});

test('C3: an invalidMode answer of the worker keeps its kind and message, the metrics stay', async () => {
  const service = new FilterService();
  await service.invoke(filterArgs('a1\nb2', '[0-9]'), false);
  const before = service.getMetrics();
  assert.ok(before);

  behaviour = { reply: { success: false, type: 'error', error: 'errors.invalidMode', errorKind: 'invalidInput', errorDetail: 'unknown filter mode "x"', result: null } };
  const error = await rejectionOf(() => service.invoke(filterArgs('a1', '[0-9]'), false));
  assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'invalidInput', message: 'errors.invalidMode' });
  assert.equal(service.getMetrics(), before, 'metrics of the failed job are not applied');
});

test('C3: the real worker modules answer an invalid mode with invalidMode (one error message, no result)', () => {
  const filter = runWorker('FilterWorker', filterArgs('a1', '[0-9]', 'Keep'));
  const remove = runWorker('RemoveWorker', { ...removeArgs('a', 'a'), configParams: { ...removeArgs('a', 'a').configParams, removeMode: 'keep' } });
  for (const messages of [filter, remove]) {
    assert.equal(messages.length, 1);
    assert.deepEqual([messages[0].success, messages[0].errorKind, messages[0].error, messages[0].result], [false, 'invalidInput', 'errors.invalidMode', null]);
  }
});
