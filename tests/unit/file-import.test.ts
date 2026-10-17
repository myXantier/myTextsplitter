// Import jobs per text target (Paket 11 C2, src/utils/fileImport.ts): latest import wins, a replaced or disposed import
// changes nothing, the loading state ends only with the current import. The FileReader is a controllable stand-in here
// (results delivered in any order); reading real files and the textarea lock are checked by `checkFileIo` (E2E).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createFileImporter } = await import('../../src/utils/fileImport.ts');

/** FileReader stand-in: every read waits until the test delivers its result. */
class FakeReader {
  static reads: FakeReader[] = [];
  static throwOnRead = false;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  file: unknown;
  readAsText(file: unknown) {
    if (FakeReader.throwOnRead) throw new Error('InvalidStateError');
    this.file = file;
    FakeReader.reads.push(this);
  }
  succeed(text: string) {
    this.result = text;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}
(globalThis as any).FileReader = FakeReader;

/** A target that records every effect in order. */
function target() {
  const log: string[] = [];
  const importer = createFileImporter({
    setText: (text: string) => log.push(`text ${JSON.stringify(text)}`),
    onError: () => log.push('error'),
    onLoadingChange: (loading: boolean) => log.push(loading ? 'loading' : 'idle'),
  });
  return { log, importer };
}
const fresh = () => {
  FakeReader.reads = [];
  FakeReader.throwOnRead = false;
};

test('file import: a successful read sets the exact text and ends the loading state', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  assert.deepEqual(log, ['loading']);
  FakeReader.reads[0].succeed('a\r\n\u0000😀\n');
  assert.deepEqual(log, ['loading', 'text "a\\r\\n\\u0000😀\\n"', 'idle']);
});

test('file import: an empty content is a valid text (D1)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('empty' as any);
  FakeReader.reads[0].succeed('');
  assert.deepEqual(log, ['loading', 'text ""', 'idle']);
});

test('file import: a failed read reports the error, keeps the text and ends the loading state (D13)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  FakeReader.reads[0].fail();
  assert.deepEqual(log, ['loading', 'error', 'idle']);
});

test('file import: B replaces A, a later success of A is ignored (D9)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  importer.importFile('B' as any);
  const [a, b] = FakeReader.reads;
  b.succeed('B');
  a.succeed('A');
  assert.deepEqual(log, ['loading', 'loading', 'text "B"', 'idle']);
});

test('file import: a later error of the replaced A shows no message (D9)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  importer.importFile('B' as any);
  const [a, b] = FakeReader.reads;
  b.succeed('B');
  a.fail();
  assert.deepEqual(log, ['loading', 'loading', 'text "B"', 'idle']);
});

test('file import: a replaced A that finishes first neither sets its text nor ends the loading state of B', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  importer.importFile('B' as any);
  const [a, b] = FakeReader.reads;
  a.succeed('A');
  assert.deepEqual(log, ['loading', 'loading'], 'B still loading');
  a.fail();
  assert.deepEqual(log, ['loading', 'loading']);
  b.fail();
  assert.deepEqual(log, ['loading', 'loading', 'error', 'idle'], 'only the current import reports');
});

test('file import: targets are independent', () => {
  fresh();
  const x = target();
  const y = target();
  x.importer.importFile('X' as any);
  y.importer.importFile('Y' as any);
  const [rx, ry] = FakeReader.reads;
  ry.succeed('Y');
  rx.succeed('X');
  assert.deepEqual(x.log, ['loading', 'text "X"', 'idle']);
  assert.deepEqual(y.log, ['loading', 'text "Y"', 'idle']);
});

test('file import: after dispose (unmount) a running import changes nothing; activate allows new imports', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  importer.dispose();
  FakeReader.reads[0].succeed('A');
  importer.importFile('B' as any);
  importer.dispose();
  FakeReader.reads[1].fail();
  assert.deepEqual(log, ['loading', 'loading'], 'no text, no message, no state change after dispose');
  importer.activate();
  importer.importFile('C' as any);
  FakeReader.reads[2].succeed('C');
  assert.deepEqual(log, ['loading', 'loading', 'loading', 'text "C"', 'idle']);
});

test('file import: a new import works after an error', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile('A' as any);
  FakeReader.reads[0].fail();
  importer.importFile('A' as any);
  FakeReader.reads[1].succeed('again');
  assert.deepEqual(log, ['loading', 'error', 'idle', 'loading', 'text "again"', 'idle']);
});

test('file import: a read that cannot start is an error of the current import', () => {
  fresh();
  const { log, importer } = target();
  FakeReader.throwOnRead = true;
  importer.importFile('A' as any);
  assert.deepEqual(log, ['loading', 'error', 'idle']);
});
