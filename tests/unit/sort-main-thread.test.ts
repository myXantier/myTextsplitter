// SortService without Web Worker (Paket 9 C2): a small text is sorted in the UI thread with the same sortText, a large
// one is refused as `sortRequiresWorker` (SORT_MAIN_THREAD_LIMITS) instead of freezing the page. No `Worker` global here.
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

assert.equal(typeof (globalThis as any).Worker, 'undefined', 'this file tests the path without Web Worker');

const { SortService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { SORT_MAIN_THREAD_LIMITS } = await import('../../src/services/SortService.ts');
disableWorkerCleanupInterval(BaseService);

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/sort-cases.json', import.meta.url), 'utf8'));
beforeEach(() => installWindow());

const sortArgs = (sourceText: string, sortMethod: string, caseSensitive = true): SortConfig => ({
  sourceText,
  mainParam: '',
  configParams: { sortMethod, caseSensitive },
});

test('without Web Worker: every golden case is sorted in the main thread with the same result', async () => {
  for (const c of fixtures.cases) {
    const result = await new SortService().invoke(sortArgs(c.input, c.options.method, c.options.caseSensitive));
    assert.equal(result.result, c.expected, c.name);
  }
});

test('without Web Worker: up to the limits the text is sorted (lines and characters)', async () => {
  const atLineLimit = Array.from({ length: SORT_MAIN_THREAD_LIMITS.lines }, (_, i) => `z${i}`).join('\n');
  const result = await new SortService().invoke(sortArgs(atLineLimit, 'natural'));
  assert.equal(result.result.split('\n')[0], 'z0');
  const atCharLimit = 'b'.repeat(SORT_MAIN_THREAD_LIMITS.chars - 2) + '\na';
  assert.equal((await new SortService().invoke(sortArgs(atCharLimit, 'alphabetical'))).result.length, atCharLimit.length);
});

test('without Web Worker: a larger text is refused as sortRequiresWorker (no empty or partial result)', async () => {
  const tooManyLines = Array.from({ length: SORT_MAIN_THREAD_LIMITS.lines + 1 }, (_, i) => `z${i}`).join('\n');
  const tooManyChars = 'b'.repeat(SORT_MAIN_THREAD_LIMITS.chars) + '\na';
  for (const text of [tooManyLines, tooManyChars]) {
    const service = new SortService();
    const error = await rejectionOf(() => service.invoke(sortArgs(text, 'alphabetical')));
    assert.equal(error.kind, 'worker');
    assert.equal(error.message, ERROR_KEYS.sortRequiresWorker);
    assert.equal(service.getMetrics(), null);
  }
});

test('without Web Worker: an invalid method is still refused first', async () => {
  const error = await rejectionOf(() => new SortService().invoke(sortArgs('b\na', 'bogus')));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, ERROR_KEYS.invalidMode);
});
