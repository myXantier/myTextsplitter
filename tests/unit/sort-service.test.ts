// Sort worker and SortService (Paket 9 C2). The real SortWorker module runs in-process behind a `FakeWorker` (same
// pattern as workers.test.ts), so `new SortService().invoke(args)` runs the same code as in the browser and in Tauri:
// BaseService.frontendWithWorker -> SortWorker -> sortText -> postMessage -> BaseService (validation, latest job wins).
// The golden results are those of tests/fixtures/sort-cases.json (Paket 9 C1). Without Web Worker: sort-main-thread.test.ts.
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const g = globalThis as any;

// --- worker side: `self` stand-in ---
type Handler = (event: { data: unknown }) => void;
let deliver: (message: any) => void = () => {};
g.self = { postMessage: (message: unknown) => deliver(structuredClone(message)), onmessage: null };
await import('../../src/workers/SortWorker.ts');
const sortWorker: Handler = g.self.onmessage;

/** Sends one job to the worker module and returns every message it posted. */
function runWorker(args: unknown) {
  const messages: any[] = [];
  deliver = (message) => messages.push(message);
  sortWorker({ data: { args } });
  return messages;
}

// --- page side: `Worker` stand-in that forwards to the real worker module ---
// 'manual': the job is only answered when the test calls `worker.answer()`; { reply }: a fixed (malformed) answer.
type Behaviour = 'real' | 'crash' | 'silent' | 'manual' | { reply: unknown };
let behaviour: Behaviour = 'real';
let instances: FakeWorker[] = [];

class FakeWorker {
  onmessage: Handler | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: Handler | null = null;
  isWorking = false;
  cleanupTime = 0;
  terminated = false;
  answer: () => void = () => {
    throw new Error('no pending job');
  };
  readonly url: string;

  constructor(url: URL) {
    this.url = String(url);
    instances.push(this);
  }

  postMessage(message: any) {
    if (this.terminated) return;
    const current = behaviour;
    const run = () => {
      if (this.terminated) return;
      deliver = (reply) => this.onmessage?.({ data: reply });
      sortWorker(structuredClone({ data: message }));
    };
    if (current === 'manual') {
      this.answer = run;
      return;
    }
    queueMicrotask(() => {
      if (current === 'crash') return this.onerror?.({ message: 'Uncaught RangeError: boom' });
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

const { SortService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { countLines } = await import('../../src/services/SortService.ts');
const { sortText, SORT_METHODS } = await import('../../src/utils/sortLines.ts');
const { splitLines } = await import('../../src/utils/lines.ts');
const { isBlankLine } = await import('../../src/utils/diff/whitespace.ts');
disableWorkerCleanupInterval(BaseService);

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/sort-cases.json', import.meta.url), 'utf8'));
const lineFixtures = JSON.parse(readFileSync(new URL('../fixtures/line-endings-cases.json', import.meta.url), 'utf8'));

/** Every Tauri command the services send (Sort must never use one). */
let tauriCalls: string[] = [];

beforeEach(() => {
  tauriCalls = [];
  installWindow((cmd) => {
    tauriCalls.push(cmd);
    if (cmd === 'is_backend_available') return true;
    throw new Error(`unexpected Tauri command ${cmd}`);
  });
  behaviour = 'real';
  BaseService.cleanupWorkers();
  instances = [];
});

const pooled = (): FakeWorker[] => (BaseService as any).workerPool.get('sort') ?? [];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const limited = { timeout: 5000 };
const sortArgs = (sourceText: string, sortMethod: string, caseSensitive = true): SortConfig => ({
  sourceText,
  mainParam: '',
  configParams: { sortMethod, caseSensitive },
});
const lines = (text: string) => splitLines(text).lines;
const sameLines = (a: string, b: string) => JSON.stringify(lines(a).sort()) === JSON.stringify(lines(b).sort());

// --- Worker module ---

test('SortWorker: every golden case of sort-cases.json (all deterministic methods)', () => {
  for (const c of fixtures.cases) {
    const messages = runWorker(sortArgs(c.input, c.options.method, c.options.caseSensitive));
    assert.equal(messages.length, 1, `${c.name}: one message per job`);
    assert.deepEqual(messages[0].result, { type: 'Text', result: c.expected, isNull: c.expected === '', abort: false, __brand: 'myResult' }, c.name);
  }
});

test('SortWorker: every method, random included (Fisher-Yates: same lines, blank lines at the end)', () => {
  // Blank lines in input order: '  ' first, then the empty line, which ends the result (OD-8: trailing newline added)
  const input = 'b\r\n  \r\n😀\r\na\r\n\r\nB';
  for (const method of SORT_METHODS) {
    const [message] = runWorker(sortArgs(input, method));
    assert.equal(message.success, true, method);
    const output = lines(message.result.result);
    assert.ok(sameLines(message.result.result, input), `${method}: same lines`);
    assert.deepEqual(output.slice(-2), ['  ', ''], `${method}: blank lines at the end`);
    assert.ok(message.result.result.endsWith('\r\n'), `${method}: CRLF and the trailing newline for the empty last line (OD-8)`);
  }
});

test('SortWorker: empty text and whitespace-only text are valid results', () => {
  assert.equal(runWorker(sortArgs('', 'natural'))[0].result.result, '');
  assert.equal(runWorker(sortArgs('  \n\t', 'alphabetical'))[0].result.result, '  \n\t');
});

test('SortWorker: an invalid method is an invalidMode answer (one message, no result)', () => {
  for (const method of ['bogus', '', 'Natural', null]) {
    const messages = runWorker(sortArgs('b\na', method as never));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].success, false);
    assert.equal(messages[0].errorKind, 'invalidInput');
    assert.equal(messages[0].error, ERROR_KEYS.invalidMode);
    assert.equal(messages[0].result, null);
  }
});

test('SortWorker: invalid arguments are a worker error', () => {
  for (const args of [null, { sourceText: 1, configParams: { sortMethod: 'natural', caseSensitive: true } }, { sourceText: 'a', configParams: { sortMethod: 'natural' } }]) {
    const [message] = args === null ? runWorker(undefined) : runWorker(args);
    assert.equal(message.success, false);
    assert.equal(message.errorKind, 'worker');
  }
});

// --- Service: same TypeScript sort in every processing mode ---

test('SortService: worker results equal sortText for every golden case, in JS and in Rust processing mode', async () => {
  for (const c of fixtures.cases) {
    const args = sortArgs(c.input, c.options.method, c.options.caseSensitive);
    for (const tryBackend of [false, true]) {
      const result = await new SortService().invoke(args, tryBackend);
      assert.equal(result.result, c.expected, `${c.name} (tryBackend ${tryBackend})`);
      assert.equal(result.result, sortText(c.input, c.options.method, c.options.caseSensitive));
    }
  }
  // Rust mode (Tauri) uses the same sort worker: no Tauri command was sent, every job ran in the worker module
  assert.deepEqual(tauriCalls, []);
  assert.ok(instances.length > 0 && instances.every((w) => w.url.endsWith('SortWorker.ts')));
});

test('SortService: an invalid method is refused before a worker is started', async () => {
  for (const method of ['bogus', 'ALPHABETICAL', '']) {
    const error = await rejectionOf(() => new SortService().invoke(sortArgs('b\na', method)));
    assert.equal(error.kind, 'invalidInput');
    assert.equal(error.message, ERROR_KEYS.invalidMode);
  }
  const error = await rejectionOf(() => new SortService().invoke({ sourceText: 'a', mainParam: '', configParams: { sortMethod: 'natural' } } as never));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(instances.length, 0);
});

test('SortService: an empty result is valid (empty text), whitespace-only text is sorted', async () => {
  const empty = await new SortService().invoke(sortArgs('', 'alphabetical'));
  assert.equal(empty.type, 'Text');
  assert.equal(empty.result, '');
  assert.equal((await new SortService().invoke(sortArgs(' \n\n\t\n', 'lengthDesc'))).result, ' \n\n\t\n');
});

for (const [label, reply] of [
  ['success without result', { success: true, type: 'complete', result: null }],
  ['result of another type', { success: true, type: 'complete', result: { type: 'Column', result: ['a'] } }],
  ['non-string text', { success: true, type: 'complete', result: { type: 'Text', result: 42 } }],
  ['a line is missing (cut result)', { success: true, type: 'complete', result: { type: 'Text', result: 'a\nb' } }],
  ['an extra line', { success: true, type: 'complete', result: { type: 'Text', result: 'a\nb\nc\nd' } }],
  ['unknown message', { hello: 'world' }],
] as const) {
  test(`SortService: malformed worker answer (${label}) is an invalid-result error, no metrics`, async () => {
    behaviour = { reply };
    const service = new SortService();
    const error = await rejectionOf(() => service.invoke(sortArgs('c\nb\na', 'alphabetical')));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

test('SortService: an error keeps the metrics of the last successful job; the next valid job works', limited, async () => {
  const service = new SortService();
  await service.invoke(sortArgs('b\na', 'alphabetical'));
  const metrics = service.getMetrics();
  assert.ok(metrics);

  behaviour = 'crash';
  const crashed = await rejectionOf(() => service.invoke(sortArgs('d\nc', 'alphabetical')));
  assert.equal(crashed.kind, 'worker');
  assert.equal(service.getMetrics(), metrics, 'metrics of the successful job stay');
  assert.equal(instances[instances.length - 1].terminated, true, 'a crashed worker is not reused');

  behaviour = 'real';
  assert.equal((await service.invoke(sortArgs('d\nc', 'alphabetical'))).result, 'c\nd');
});

// --- Latest job wins ---

test('SortService: a newer sort supersedes the running one (worker terminated, late answer ignored)', limited, async () => {
  behaviour = 'manual';
  const service = new SortService();
  const older = rejectionOf(() => service.invoke(sortArgs('b\na\nc', 'alphabetical')));
  await flush();
  const newer = service.invoke(sortArgs('x10\nx2', 'natural'));
  await flush();
  const [olderWorker, newerWorker] = instances;

  assert.equal((await older).kind, 'superseded');
  assert.equal(olderWorker.terminated, true);
  assert.equal(service.getMetrics(), null, 'a superseded job sets no metrics');
  olderWorker.answer(); // terminated: never answers
  newerWorker.answer();
  assert.equal((await newer).result, 'x2\nx10');
  assert.equal(service.getMetrics()?.inputSize, new TextEncoder().encode(JSON.stringify(sortArgs('x10\nx2', 'natural'))).length);
  assert.deepEqual(pooled(), [newerWorker]);
});

test('SortService: rapid jobs - only the last of several is delivered', limited, async () => {
  behaviour = 'manual';
  const jobs = ['natural', 'lengthAsc', 'alphabeticalReverse'].map((method) => rejectionOf(() => new SortService().invoke(sortArgs('bb\na\nccc', method))));
  await flush();
  const last = new SortService().invoke(sortArgs('bb\na\nccc', 'lengthDesc'));
  await flush();
  for (const job of jobs) assert.equal((await job).kind, 'superseded');
  instances.forEach((worker) => worker.answer());
  assert.equal((await last).result, 'ccc\nbb\na');
  assert.equal(instances.filter((w) => !w.terminated).length, 1);
});

test('SortService: cancelPending (empty text on the page) stops the running sort', limited, async () => {
  behaviour = 'manual';
  const running = rejectionOf(() => new SortService().invoke(sortArgs('b\na', 'alphabetical')));
  await flush();
  BaseService.cancelPending('sort');
  assert.equal((await running).kind, 'superseded');
  assert.equal(instances[0].terminated, true);
});

test('SortService: a worker timeout is reported, the next sort runs in a new worker', limited, async () => {
  behaviour = 'manual';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const timedOut = rejectionOf(() => new SortService().invoke(sortArgs('b\na', 'alphabetical')));
    await flush();
    mock.timers.tick(10_000);
    const error = await timedOut;
    assert.equal(error.kind, 'timeout');
    assert.equal(error.message, ERROR_KEYS.timeout);
    assert.equal(instances[0].terminated, true);

    const next = new SortService().invoke(sortArgs('b\na', 'alphabetical'));
    await flush();
    assert.equal(instances.length, 2);
    instances[1].answer();
    assert.equal((await next).result, 'a\nb');
  } finally {
    mock.timers.reset();
  }
});

// --- Line count check ---

test('countLines equals the line model (splitLines) on every input and output of the fixtures', () => {
  const texts = [
    ...fixtures.cases.flatMap((c: { input: string; expected: string }) => [c.input, c.expected]),
    ...lineFixtures.lines.map((c: { input: string }) => c.input),
    '', '\n', '\r', '\r\n', 'a', 'a\r', '\r\r\n\n', 'a\r\nb\rc\nd',
  ];
  for (const text of texts) assert.equal(countLines(text), splitLines(text).lines.length, JSON.stringify(text));
});

test('every golden result has the line count of its input (what checkResult relies on)', () => {
  for (const c of fixtures.cases) assert.equal(countLines(c.expected), countLines(c.input), c.name);
  assert.ok(fixtures.cases.some((c: { expected: string }) => lines(c.expected).some(isBlankLine)));
});
