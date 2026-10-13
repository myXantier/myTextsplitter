// Error propagation from the Web Workers to the services (Paket 4: B22, worker/timeout/communication errors).
//
// The real worker modules run in-process: `self` is a stand-in whose `postMessage` is captured.
// `FakeWorker` (installed as global `Worker` before the services are loaded) forwards messages to these
// real worker handlers, so `service.invoke(args, false)` runs the same code as in the browser
// (BaseService.frontendWithWorker -> worker -> postMessage -> BaseService). Single tests replace the
// worker behaviour (crash, no answer, malformed answer).
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as any;

// --- worker side: `self` stand-in ---
type Handler = (event: { data: unknown }) => void;
let deliver: (message: any) => void = () => {};
g.self = { postMessage: (message: unknown) => deliver(structuredClone(message)), onmessage: null };

const workerHandlers: Record<string, Handler> = {};
for (const name of ['SplitWorker', 'FilterWorker', 'RemoveWorker', 'DiffWorker']) {
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
type Behaviour = 'real' | 'crash' | 'silent' | { reply: unknown };
let behaviour: Behaviour = 'real';

class FakeWorker {
  onmessage: Handler | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  isWorking = false;
  cleanupTime = 0;
  private name: string;

  constructor(url: URL) {
    this.name = /(\w+Worker)\.ts$/.exec(String(url))![1];
  }

  postMessage(message: any) {
    if (message?.test) return; // liveness probe of BaseService
    const current = behaviour;
    queueMicrotask(() => {
      if (current === 'crash') return this.onerror?.({ message: 'Uncaught ReferenceError: boom' });
      if (current === 'silent') return;
      if (typeof current === 'object') return this.onmessage?.({ data: current.reply });
      deliver = (reply) => this.onmessage?.({ data: reply });
      workerHandlers[this.name](structuredClone({ data: message }));
    });
  }

  terminate() {}
}
g.Worker = FakeWorker;

// Services first (same order as the app): BaseService <-> Services import each other
const { SplitService, FilterService, RemoveService, DiffService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
disableWorkerCleanupInterval(BaseService);

beforeEach(() => {
  installWindow();
  behaviour = 'real';
});

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
  assert.equal(diff.type, 'Text');
  assert.ok(Array.isArray(JSON.parse(diff.result as string)));
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
