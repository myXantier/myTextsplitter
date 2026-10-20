// Global processing state of useBackendProcessor (hotfix after Paket 12): `useProcessingStore.isProcessing` is true
// while at least one operation runs, also right after the start (clearing an old error must not end it), and false
// after the last one ended (success, error, timeout, cancelled). ProcessingStatus shows the mode toggle only when it is
// false. The real hooks run without a renderer (helpers/hook-runtime.ts); backend jobs are answered by a stubbed Tauri
// IPC whose answers the test releases, the sort runs in a worker that only answers on timeout or termination.
import { installWindow, disableWorkerCleanupInterval, rejectionOf, backendMetrics } from './helpers/setup.ts';
import { savedToBuffer, runtimeSettings } from './helpers/hook-runtime.ts';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as any;

/** Sort worker stand-in: never answers (a running sort), records termination. */
const workers: SilentWorker[] = [];
class SilentWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  isWorking = false;
  cleanupTime = 0;
  terminated = false;
  constructor() {
    workers.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}
g.Worker = SilentWorker;

// Services first (same order as the app): BaseService <-> Services import each other
await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { useBackendProcessor } = await import('../../src/hooks/useBackendProcessor.ts');
const { useProcessingState } = await import('../../src/hooks/useProcessingState.ts');
const { useProcessingStore } = await import('../../src/hooks/useProcessingStore.ts');

disableWorkerCleanupInterval(BaseService);

/** Backend calls whose answer the test delivers with `answer` / `fail`. */
type Pending = { cmd: string; answer: (resultText?: string) => void; fail: (error: unknown) => void };
let pending: Pending[] = [];

beforeEach(() => {
  pending = [];
  workers.length = 0;
  savedToBuffer.length = 0;
  installWindow(
    (cmd) =>
      new Promise((resolve, reject) => {
        pending.push({ cmd, answer: (resultText = 'x') => resolve({ result_text: resultText, removed_lines: 0, metrics: backendMetrics }), fail: reject });
      })
  );
  runtimeSettings.processingMode = 'backend';
  useProcessingStore.setState({ isProcessing: false, error: null, metrics: null });
});

afterEach(async () => {
  const leftRunning = isProcessing();
  // A failed test may leave jobs behind: end them, so that the next test starts without running operations
  pending.forEach((p) => p.answer());
  BaseService.cancelPending('sort');
  await flush();
  assert.equal(leftRunning, false, 'a test left a running operation behind');
});

const isProcessing = () => useProcessingStore.getState().isProcessing;
/** Lets started jobs reach the IPC and settled jobs reach the processing state. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};
/** One render of the hook: the functions the page calls. */
const processor = () => useBackendProcessor();

const filterArgs = (sourceText: string): FilterConfig => ({
  sourceText,
  mainParam: 'a',
  configParams: { caseSensitive: true, filterMode: 'keep', splitMatches: false },
});
const removeArgs = (sourceText: string): RemoveConfig => ({
  sourceText,
  mainParam: 'a',
  configParams: { caseSensitive: true, useRegex: false, trimParts: false, removeMode: 'containing' },
});
const sortArgs = (sourceText: string): SortConfig => ({ sourceText, mainParam: '', configParams: { sortMethod: 'alphabetical', caseSensitive: true } });

/** Starts a filter job and waits until its backend call is pending (wrapped: returning the promise would await the job). */
async function startFilter(text = 'a\nb') {
  const job = processor().filterText(filterArgs(text));
  await flush();
  return { job };
}

// --- useProcessingState: the setters behind executeProcessing ---

test('useProcessingState: clearing an old error at the start does not end the processing state', () => {
  const { setProcessing, setError } = useProcessingState();
  useProcessingStore.setState({ error: new Error('old') });
  setProcessing(true);
  setError(null); // executeProcessing: start of a job
  assert.equal(isProcessing(), true, 'the job is still running');
  assert.equal(useProcessingStore.getState().error, null, 'the old error is cleared');
  setProcessing(false);
});

test('useProcessingState: an actual error ends the processing state and is kept', () => {
  const { setProcessing, setError } = useProcessingState();
  const error = new Error('failed');
  setProcessing(true);
  setError(error);
  assert.equal(isProcessing(), false);
  assert.equal(useProcessingStore.getState().error, error);
});

// --- one operation ---

test('single job: processing while it runs, not processing after success', async () => {
  useProcessingStore.setState({ error: new Error('previous run') });
  const { job } = await startFilter();
  assert.equal(pending.length, 1);
  assert.equal(isProcessing(), true, 'a running job is shown as processing');
  assert.equal(useProcessingStore.getState().error, null, 'the error of the previous run is cleared at the start');
  pending[0].answer('a');
  assert.equal((await job).type, 'Text');
  assert.equal(isProcessing(), false);
  assert.deepEqual(savedToBuffer, ['a']);
});

test('single job: an error ends the processing state and is reported', async () => {
  const job = rejectionOf(() => processor().filterText(filterArgs('a')));
  await flush();
  assert.equal(isProcessing(), true);
  pending[0].fail('backend failed');
  const error = await job;
  assert.equal(error.kind, 'backend');
  assert.equal(isProcessing(), false);
  assert.equal(useProcessingStore.getState().error, error);
});

test('single job: a job stopped without successor (cancelPending) ends the processing state', async () => {
  const job = rejectionOf(() => processor().filterText(filterArgs('a')));
  await flush();
  BaseService.cancelPending('filter'); // e.g. FilterPage: empty text while running
  assert.equal(isProcessing(), true, 'the backend still runs until it answers');
  pending[0].answer(); // the late answer is discarded
  assert.equal((await job).kind, 'superseded');
  assert.equal(isProcessing(), false);
  assert.equal(useProcessingStore.getState().error, null, 'a cancelled job shows no error');
});

test('single job: a worker timeout ends the processing state', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const job = rejectionOf(() => processor().sortText(sortArgs('b\na')));
    await flush();
    assert.equal(isProcessing(), true);
    mock.timers.tick(10_000);
    const error = await job;
    assert.equal(error.kind, 'timeout');
    assert.equal(isProcessing(), false);
    assert.equal(workers[0].terminated, true);
  } finally {
    mock.timers.reset();
  }
});

// --- several operations ---

test('two operation types: processing until the last one ended (first ended first)', async () => {
  const { job: filter } = await startFilter();
  const remove = processor().removeLines(removeArgs('a\nb'));
  await flush();
  assert.deepEqual(pending.map((p) => p.cmd), ['filter_text', 'remove_lines']);
  assert.equal(isProcessing(), true);
  pending[0].answer();
  await filter;
  assert.equal(isProcessing(), true, 'remove still runs');
  pending[1].answer();
  await remove;
  assert.equal(isProcessing(), false, 'the last running job ended');
});

test('two operation types: an error of one does not end the processing state of the other', async () => {
  const filter = rejectionOf(() => processor().filterText(filterArgs('a')));
  await flush();
  const remove = processor().removeLines(removeArgs('a\nb'));
  await flush();
  assert.equal(isProcessing(), true, 'both run');
  pending[0].fail('backend failed');
  assert.equal((await filter).kind, 'backend');
  assert.equal(isProcessing(), true, 'remove still runs');
  pending[1].answer();
  await remove;
  assert.equal(isProcessing(), false);
});

test('two operation types: the later one ending first keeps the state of the earlier one', async () => {
  const { job: filter } = await startFilter();
  const remove = processor().removeLines(removeArgs('a\nb'));
  await flush();
  assert.equal(isProcessing(), true, 'both run');
  pending[1].answer();
  await remove;
  assert.equal(isProcessing(), true, 'filter still runs');
  pending[0].answer();
  await filter;
  assert.equal(isProcessing(), false);
});

test('same type: a superseded job ending first does not change the state of its successor', async () => {
  const older = rejectionOf(() => processor().filterText(filterArgs('old')));
  await flush();
  const newer = processor().filterText(filterArgs('new'));
  await flush();
  assert.equal(pending.length, 2);
  pending[0].answer('late'); // the older backend answer arrives first and is discarded
  assert.equal((await older).kind, 'superseded');
  assert.equal(isProcessing(), true, 'the newer job still runs');
  pending[1].answer('new');
  await newer;
  assert.equal(isProcessing(), false);
  assert.deepEqual(savedToBuffer, ['new']);
});

test('same type: a superseded job ending after its successor does not restart or end anything', async () => {
  const older = rejectionOf(() => processor().filterText(filterArgs('old')));
  await flush();
  const newer = processor().filterText(filterArgs('new'));
  await flush();
  const remove = processor().removeLines(removeArgs('a\nb'));
  await flush();
  assert.equal(isProcessing(), true, 'the newer filter and remove run');
  pending[1].answer('new');
  await newer;
  assert.equal(isProcessing(), true, 'remove still runs');
  pending[0].answer('late');
  assert.equal((await older).kind, 'superseded');
  assert.equal(isProcessing(), true, 'the late superseded job does not end the running remove');
  pending[2].answer();
  await remove;
  assert.equal(isProcessing(), false);
  assert.equal(useProcessingStore.getState().error, null);
});

// --- Paket 12 E6: SortPage cancels its running sort on unmount ---

test('sort unmount: cancelPending stops the running sort and ends the processing state', async () => {
  const sort = rejectionOf(() => processor().sortText(sortArgs('b\na')));
  await flush();
  assert.equal(workers.length, 1);
  assert.equal(isProcessing(), true);
  BaseService.cancelPending('sort'); // SortPage unmount cleanup
  assert.equal((await sort).kind, 'superseded');
  assert.equal(workers[0].terminated, true);
  assert.equal(isProcessing(), false);
  assert.equal(useProcessingStore.getState().error, null);
});

test('sort unmount: cancelling the sort keeps the state of another running operation', async () => {
  const sort = rejectionOf(() => processor().sortText(sortArgs('b\na')));
  await flush();
  const { job: filter } = await startFilter();
  BaseService.cancelPending('sort');
  assert.equal((await sort).kind, 'superseded');
  assert.equal(isProcessing(), true, 'filter still runs');
  pending[0].answer();
  await filter;
  assert.equal(isProcessing(), false);
});
