// Line endings (Paket 6): shared fixtures `tests/fixtures/line-endings-cases.json`, also run by the Rust engine
// (`cargo test`: line_endings.rs, text_processor.rs, diff/tests.rs). The JS side runs the line model, the real worker
// modules (in-process, `self` stand-in, as in regex-compat.test.ts) and the main-thread fallbacks of the services.
import { installWindow, disableWorkerCleanupInterval } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { splitLines, joinLines, lineFormatOf } = await import('../../src/utils/lines.ts');
const { combineColumns } = await import('../../src/utils/combineColumns.ts');
const { sortText } = await import('../../src/utils/sortLines.ts');
const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
const { splitTextToColumns } = await import('../../src/utils/splitColumns.ts');
const { FilterService, RemoveService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
disableWorkerCleanupInterval(BaseService);
installWindow();

interface RemoveExpected {
  text: string;
  removedLines: number;
}
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/line-endings-cases.json', import.meta.url), 'utf8'));
const splitFixtures = JSON.parse(readFileSync(new URL('../fixtures/split-cases.json', import.meta.url), 'utf8'));

// --- Worker modules (each registers `self.onmessage` when imported) ---
const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
const loadWorker = async (path: string) => {
  await import(path);
  return g.self.onmessage as (event: { data: unknown }) => void;
};
const workers = {
  split: await loadWorker('../../src/workers/SplitWorker.ts'),
  filter: await loadWorker('../../src/workers/FilterWorker.ts'),
  remove: await loadWorker('../../src/workers/RemoveWorker.ts'),
  diff: await loadWorker('../../src/workers/DiffWorker.ts'),
};
/** Result data of one worker run (the worker answers with exactly one message). */
function runWorker(worker: keyof typeof workers, args: BaseConfig) {
  posted = [];
  workers[worker]({ data: { args } });
  assert.equal(posted.length, 1, JSON.stringify(posted));
  assert.equal(posted[0].success, true, JSON.stringify(posted[0]));
  return posted[0].result.result;
}

const filterArgs = (c: any): FilterConfig => ({
  sourceText: c.input,
  mainParam: c.pattern,
  configParams: { caseSensitive: true, filterMode: c.mode ?? 'keep', splitMatches: c.splitMatches ?? true },
});
const removeArgs = (c: any): RemoveConfig => ({
  sourceText: c.input,
  mainParam: c.pattern ?? '',
  configParams: { caseSensitive: true, useRegex: c.useRegex ?? false, trimParts: c.trimParts ?? false, removeMode: c.removeMode },
});
/** Which lines are unchanged and which are changes (the complete diff result is checked by diff.test.ts). */
const diffSummary = (document: import('../../src/utils/diff/types.ts').DiffDocument) => ({
  unchanged: document.rows.flatMap((r) => (r.kind === 'equal' ? [r.new.text] : [])).sort(),
  changes: document.rows.flatMap((r) => (r.kind === 'delete' ? [`removed:${r.old.text}`] : r.kind === 'insert' ? [`added:${r.new.text}`] : [])).sort(),
});

test('line-ending fixtures are well-formed', () => {
  for (const section of ['lines', 'filter', 'remove', 'combine', 'diff', 'sort']) {
    assert.ok(fixtures[section]?.length > 0, `section ${section} is missing`);
    const names = new Set<string>();
    for (const c of fixtures[section]) {
      assert.ok(!names.has(c.name), `${section}: duplicate fixture name ${c.name}`);
      names.add(c.name);
      const perEngine = c.expectedRust !== undefined && c.expectedJs !== undefined;
      assert.equal(perEngine, !!c.divergence, `${section}/${c.name}: per-engine expectations need a 'divergence' explanation`);
    }
  }
  for (const c of fixtures.lines) assert.ok(['\n', '\r\n', '\r'].includes(c.lineEnding), c.name);
});

// --- Line model ---

for (const c of fixtures.lines) {
  test(`line model: ${c.name}`, () => {
    const actual = splitLines(c.input);
    assert.deepEqual(actual, { lines: c.lines, lineEnding: c.lineEnding, trailingNewline: c.trailingNewline });
    assert.equal(joinLines(actual.lines, actual), c.joined);
    assert.deepEqual(lineFormatOf(c.input), { lineEnding: c.lineEnding, trailingNewline: c.trailingNewline });
    assert.ok(actual.lines.every((line: string) => !/[\r\n]/.test(line)), 'no line contains a terminator');
  });
}

test('line model: joinLines without lines is empty, also with a trailing newline', () => {
  assert.equal(joinLines([], { lineEnding: '\r\n', trailingNewline: true }), '');
  assert.equal(joinLines([''], { lineEnding: '\r\n', trailingNewline: true }), '\r\n');
  assert.equal(joinLines([''], { lineEnding: '\n', trailingNewline: false }), '', 'one empty line without terminator is ""');
});

test('line model: a large CRLF text round-trips', () => {
  const text = 'a,1\r\nb,2\r\n'.repeat(50_000);
  const split = splitLines(text);
  assert.equal(split.lines.length, 100_000);
  assert.equal(joinLines(split.lines, split), text);
});

// --- Split: the shared split fixtures through the worker module (BaseWorker splits the lines) ---

for (const c of splitFixtures.cases) {
  const expected = c.expectedJs ?? c.expected;
  // Error expectations (Paket 10, e.g. an invalid regex) are checked by split.test.ts
  if (!Array.isArray(expected)) continue;
  test(`split worker: ${c.name}`, () => {
    const configParams = { useRegex: c.useRegex ?? false, trimParts: c.trimParts ?? false, keepEmptyLines: c.keepEmptyLines ?? true };
    const delimiter = typeof c.delimiter === 'string' ? c.delimiter : c.delimiter.repeat.repeat(c.delimiter.count);
    assert.deepEqual(runWorker('split', { sourceText: c.input, mainParam: delimiter, configParams } as SplitConfig), expected);
    assert.deepEqual(splitTextToColumns(c.input, delimiter, configParams), expected, 'main-thread entry point');
  });
}

// --- Filter (worker; the main-thread Filter is not reachable with a regex, see FilterService) ---

for (const c of fixtures.filter) {
  test(`filter worker: ${c.name}`, () => {
    assert.equal(runWorker('filter', filterArgs(c)), c.expectedJs ?? c.expected);
  });
}

test('filter main-thread implementation uses the line format of the input', async () => {
  const service = new FilterService() as any;
  const result = await service.frontendInMainThread(filterArgs({ input: 'a1\r\nb2\r\n', pattern: '\\d', mode: 'remove' }));
  assert.equal(result.result, 'a\r\nb\r\n');
});

// --- Remove (worker and main-thread fallback) ---

for (const c of fixtures.remove) {
  test(`remove worker + main thread: ${c.name}`, async () => {
    const expected: RemoveExpected = c.expectedJs ?? c.expected;
    const worker = runWorker('remove', removeArgs(c));
    assert.deepEqual({ text: worker.result_text, removedLines: worker.removed_lines }, expected, 'worker');
    const main = (await (new RemoveService() as any).frontendInMainThread(removeArgs(c))).result;
    assert.deepEqual({ text: main.result_text, removedLines: main.removed_lines }, expected, 'main thread');
  });
}

test('remove: main-thread fallback through invoke (no Web Worker in Node) keeps CRLF', async () => {
  const result = await new RemoveService().invoke(removeArgs({ input: 'x\r\ny\r\nx\r\n', removeMode: 'duplicates' }), false);
  assert.deepEqual(result.result, {
    result_text: 'x\r\ny\r\n',
    removed_lines: 1,
    metrics: { execution_time_ms: 0, memory_usage_kb: 0, memory_usage_str: '' },
  });
});

// --- Combine ---

for (const c of fixtures.combine) {
  test(`combine: ${c.name}`, () => {
    assert.equal(combineColumns(c.columns, c.used, { lineEnding: c.lineEnding, trailingNewline: c.trailingNewline }), c.expected);
  });
}

test('combine: split -> combine with the line format of the split text', () => {
  const text = 'A,B\r\nC,D,E\r\n\r\nF,G\r\n';
  const columns = splitTextToColumns(text, ',', { useRegex: false, trimParts: false, keepEmptyLines: true });
  const used = [{ index: 2, separator: '' }, { index: 0, separator: ':' }];
  assert.equal(combineColumns(columns, used.slice(0, 1), lineFormatOf(text)), '\r\nE\r\n\r\n\r\n');
  assert.equal(combineColumns(columns, used, lineFormatOf(text)), ':A\r\nE:C\r\n:\r\n:F\r\n');
});

// --- Diff (worker and main thread) ---

for (const c of fixtures.diff) {
  test(`diff worker + main thread: ${c.name}`, () => {
    const expected = { unchanged: [...c.unchanged].sort(), changes: [...c.changes].sort() };
    const args: DiffConfig = { sourceText: c.old, mainParam: c.new, configParams: { caseSensitive: true, ignoreWhitespace: false } };
    assert.deepEqual(diffSummary(runWorker('diff', args).document), expected, 'worker');
    assert.deepEqual(diffSummary(computeLineDiff(c.old, c.new, { ignoreWhitespace: false })), expected, 'main thread');
  });
}

// --- Sort (JS only: there is no Rust implementation) ---

for (const c of fixtures.sort) {
  test(`sort: ${c.name}`, () => {
    assert.equal(sortText(c.input, c.method, c.caseSensitive ?? true), c.expected);
  });
}

test('sort: random keeps all lines and the line format', () => {
  const sorted = sortText('a\r\nb\r\nc\r\n', 'random', true);
  assert.ok(sorted.endsWith('\r\n'));
  assert.deepEqual(splitLines(sorted).lines.sort(), ['a', 'b', 'c']);
});
