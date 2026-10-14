// Real termination of a running regex (Paket 5): the app's FilterWorker module runs in a Node worker thread
// (`worker_threads`, wrapped in the Web Worker API), so a catastrophic regex really blocks that thread.
// BaseService must stop it with `terminate()` when its timeout fires, and the next job must work again.
//
// The worker timeout is shortened for the test; every test has a time limit, so a broken implementation
// fails instead of hanging (the regex alone would run for about two minutes).
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker as ThreadWorker } from 'node:worker_threads';

const g = globalThis as any;
const threadEntry = new URL('./helpers/thread-worker.ts', import.meta.url);
const threads: { thread: ThreadWorker; exited: Promise<number> }[] = [];

/** Web Worker API on top of a Node worker thread */
class ThreadBackedWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: ((event: { data: unknown }) => void) | null = null;
  isWorking = false;
  cleanupTime = 0;
  private thread: ThreadWorker;

  constructor(url: URL) {
    this.thread = new ThreadWorker(threadEntry, { workerData: { module: String(url) } });
    const exited = new Promise<number>((resolve) => this.thread.once('exit', resolve));
    threads.push({ thread: this.thread, exited });
    this.thread.on('message', (data) => this.onmessage?.({ data }));
    this.thread.on('error', (error) => this.onerror?.({ message: error.message }));
  }

  postMessage(message: unknown) {
    this.thread.postMessage(message);
  }

  terminate() {
    void this.thread.terminate();
  }
}
g.Worker = ThreadBackedWorker;

const { FilterService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
disableWorkerCleanupInterval(BaseService);

beforeEach(() => installWindow());
after(async () => {
  BaseService.cleanupWorkers();
  await Promise.all(threads.map(({ thread }) => thread.terminate()));
});

const filterArgs = (sourceText: string, pattern: string): FilterConfig => ({
  sourceText,
  mainParam: pattern,
  configParams: { caseSensitive: true, filterMode: 'keep', splitMatches: false },
});

/** FilterService with a short worker timeout */
function shortTimeoutService(ms: number) {
  const service = new FilterService();
  (service as any).workerTimeouts = { ...(service as any).workerTimeouts, filter: ms };
  return service;
}

test('real worker: normal filter job', { timeout: 15_000 }, async () => {
  const result = await shortTimeoutService(10_000).invoke(filterArgs('apple\nbanana', 'an'), false);
  assert.equal(result.result, 'anan');
});

test('real worker: a catastrophic regex is stopped by the timeout and the thread really ends', { timeout: 15_000 }, async () => {
  const started = performance.now();
  const error = await rejectionOf(() => shortTimeoutService(500).invoke(filterArgs('ab'.repeat(40), '(a|b|ab)*(?=c)'), false));
  assert.equal(error.kind, 'timeout');
  assert.ok(performance.now() - started < 5000, 'rejected shortly after the timeout');

  // The thread that ran the regex has exited (terminate() really stopped the running regex)
  const busy = threads.at(-1)!;
  const exitCode = await Promise.race([busy.exited, new Promise((resolve) => setTimeout(() => resolve('still running'), 5000))]);
  assert.notEqual(exitCode, 'still running');

  // The main thread was not blocked meanwhile and the next job works with a new worker
  const result = await shortTimeoutService(10_000).invoke(filterArgs('apple', 'ap'), false);
  assert.equal(result.result, 'ap');
});
