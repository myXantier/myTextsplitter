// Import jobs per text target (Paket 11 C2/C3, src/utils/fileImport.ts): latest import wins, a replaced or disposed
// import changes nothing, the loading state ends only with the current import; a refused file (extension, size) starts no
// job; bytes are decoded strictly. The FileReader is a controllable stand-in here (results delivered in any order);
// reading real files and the textarea lock are checked by `checkFileIo` (E2E).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createFileImporter, decodeText, checkImportFile, MAX_IMPORT_BYTES, InvalidEncodingError } = await import('../../src/utils/fileImport.ts');

/** FileReader stand-in: every read waits until the test delivers its bytes or an error. */
class FakeReader {
  static reads: FakeReader[] = [];
  static throwOnRead = false;
  result: ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  file: unknown;
  readAsArrayBuffer(file: unknown) {
    if (FakeReader.throwOnRead) throw new Error('InvalidStateError');
    this.file = file;
    FakeReader.reads.push(this);
  }
  /** Delivers `content`: a string (UTF-8 encoded) or raw bytes. */
  succeed(content: string | number[]) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content);
    this.result = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}
(globalThis as any).FileReader = FakeReader;

const file = (name = 'input.txt', size = 1) => ({ name, size }) as File;

/** A target that records every effect in order. */
function target() {
  const log: string[] = [];
  const importer = createFileImporter({
    setText: (text: string) => log.push(`text ${JSON.stringify(text)}`),
    onError: (error: string) => log.push(`error ${error}`),
    onLoadingChange: (loading: boolean) => log.push(loading ? 'loading' : 'idle'),
  });
  return { log, importer };
}
const fresh = () => {
  FakeReader.reads = [];
  FakeReader.throwOnRead = false;
};

// --- Decoding (D3-D6) ---

const decode = (hex: string) => decodeText(Uint8Array.from(hex.split(' ').filter(Boolean).map((h) => parseInt(h, 16))));
const refuses = (hex: string) => assert.throws(() => decode(hex), InvalidEncodingError, hex);

test('decode: UTF-8 without and with BOM, the BOM is removed once', () => {
  assert.equal(decode(''), '');
  assert.equal(decode('EF BB BF'), '');
  assert.equal(decode('47 72 C3 BC C3 9F 65'), 'Grüße');
  assert.equal(decode('EF BB BF 47 72 C3 BC C3 9F 65'), 'Grüße');
  assert.equal(decode('EF BB BF EF BB BF 61'), '﻿a', 'a second BOM is content');
  assert.equal(decode('EF BB BF 0D 0A 00 F0 9F 98 80 E2 80 A8'), '\r\n\u0000😀 ');
});

test('decode: UTF-16LE and UTF-16BE with BOM', () => {
  assert.equal(decode('FF FE'), '');
  assert.equal(decode('FE FF'), '');
  assert.equal(decode('FF FE 48 00 E4 00 0D 00 0A 00 3D D8 00 DE'), 'Hä\r\n😀');
  assert.equal(decode('FE FF 00 48 00 E4 00 0A D8 3D DE 00'), 'Hä\n😀');
  assert.equal(decode('FF FE FF FE 41 00'), '﻿A', 'a second UTF-16 BOM is content');
});

test('decode: invalid UTF-8 is refused, never replaced by U+FFFD', () => {
  for (const hex of ['61 FF 62', '61 F0 9F 98', '47 72 FC DF 65', 'ED A0 BD', 'C0 AF', '48 00 E4 00', 'EF BB BF 61 FF']) refuses(hex);
});

test('decode: invalid UTF-16 is refused (lone surrogates, odd byte count: no byte is dropped, F15)', () => {
  for (const hex of ['FF FE 3D D8 41 00', 'FF FE 00 DC 41 00', 'FE FF D8 3D 00 41', 'FF FE 41 00 42', 'FE FF 00 41 42', 'FF FE 41']) refuses(hex);
});

test('decode: a valid U+FFFD and NUL stay; UTF-16 without BOM is not detected', () => {
  assert.equal(decode('61 EF BF BD 62'), 'a�b');
  assert.equal(decode('FF FE FD FF'), '�', 'U+FFFD in UTF-16LE');
  assert.equal(decode('48 00 69 00'), 'H\u0000i\u0000', 'ASCII UTF-16LE without BOM is valid UTF-8 with NUL');
});

// --- File checks before reading (D7, D8) ---

test('file check: .txt in any case, at most 10 MiB inclusive', () => {
  assert.equal(MAX_IMPORT_BYTES, 10 * 1024 * 1024);
  for (const name of ['text.txt', 'text.TXT', 'text.Txt', '.txt', 'a.b.txt']) assert.equal(checkImportFile({ name, size: 1 }), null, name);
  for (const name of ['text.csv', 'README', 'text.txt.csv', 'text.txt ', 'txt']) assert.equal(checkImportFile({ name, size: 1 }), 'unsupportedExtension', name);
  assert.equal(checkImportFile({ name: 'a.txt', size: MAX_IMPORT_BYTES }), null);
  assert.equal(checkImportFile({ name: 'a.txt', size: MAX_IMPORT_BYTES + 1 }), 'tooLarge');
  assert.equal(checkImportFile({ name: 'a.txt', size: 0 }), null);
});

// --- Import jobs (C2) with the byte reader (C3) ---

test('file import: a successful read sets the exact text and ends the loading state', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  assert.deepEqual(log, ['loading']);
  FakeReader.reads[0].succeed('a\r\n\u0000😀\n');
  assert.deepEqual(log, ['loading', 'text "a\\r\\n\\u0000😀\\n"', 'idle']);
});

test('file import: an empty content and a BOM only are a valid text (D1)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  FakeReader.reads[0].succeed([]);
  importer.importFile(file());
  FakeReader.reads[1].succeed([0xff, 0xfe]);
  assert.deepEqual(log, ['loading', 'text ""', 'idle', 'loading', 'text ""', 'idle']);
});

test('file import: a failed read reports readError, keeps the text and ends the loading state (D13)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  FakeReader.reads[0].fail();
  assert.deepEqual(log, ['loading', 'error readError', 'idle']);
});

test('file import: invalid bytes report invalidEncoding, set no text and end the loading state (D5)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  FakeReader.reads[0].succeed([0x61, 0xff, 0x62]);
  assert.deepEqual(log, ['loading', 'error invalidEncoding', 'idle']);
});

test('file import: a refused file starts no job and keeps a running import current', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file('a.txt'));
  importer.importFile(file('b.csv'));
  importer.importFile(file('c.txt', MAX_IMPORT_BYTES + 1));
  assert.equal(FakeReader.reads.length, 1, 'refused files are not read');
  assert.deepEqual(log, ['loading', 'error unsupportedExtension', 'error tooLarge'], 'the loading state of A stays');
  FakeReader.reads[0].succeed('A');
  assert.deepEqual(log, ['loading', 'error unsupportedExtension', 'error tooLarge', 'text "A"', 'idle']);
});

test('file import: an accepted newer file that fails to decode replaces the running import', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file('a.txt'));
  importer.importFile(file('b.txt'));
  const [a, b] = FakeReader.reads;
  b.succeed([0xff, 0xfe, 0x41]);
  assert.deepEqual(log, ['loading', 'loading', 'error invalidEncoding', 'idle']);
  a.succeed('A');
  assert.deepEqual(log, ['loading', 'loading', 'error invalidEncoding', 'idle'], 'the replaced A is ignored');
});

test('file import: B replaces A, a later success of A is ignored (D9)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  importer.importFile(file());
  const [a, b] = FakeReader.reads;
  b.succeed('B');
  a.succeed('A');
  assert.deepEqual(log, ['loading', 'loading', 'text "B"', 'idle']);
});

test('file import: a later read or decoding error of the replaced A shows no message (D9)', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  importer.importFile(file());
  importer.importFile(file());
  const [a1, a2, b] = FakeReader.reads;
  b.succeed('B');
  a1.fail();
  a2.succeed([0xff]);
  assert.deepEqual(log, ['loading', 'loading', 'loading', 'text "B"', 'idle']);
});

test('file import: a replaced A that finishes first neither sets its text nor ends the loading state of B', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  importer.importFile(file());
  const [a, b] = FakeReader.reads;
  a.succeed('A');
  assert.deepEqual(log, ['loading', 'loading'], 'B still loading');
  a.fail();
  assert.deepEqual(log, ['loading', 'loading']);
  b.fail();
  assert.deepEqual(log, ['loading', 'loading', 'error readError', 'idle'], 'only the current import reports');
});

test('file import: targets are independent', () => {
  fresh();
  const x = target();
  const y = target();
  x.importer.importFile(file());
  y.importer.importFile(file());
  const [rx, ry] = FakeReader.reads;
  ry.succeed('Y');
  rx.succeed('X');
  assert.deepEqual(x.log, ['loading', 'text "X"', 'idle']);
  assert.deepEqual(y.log, ['loading', 'text "Y"', 'idle']);
});

test('file import: after dispose (unmount) a running import changes nothing; activate allows new imports', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  importer.dispose();
  FakeReader.reads[0].succeed('A');
  importer.importFile(file());
  importer.dispose();
  FakeReader.reads[1].fail();
  importer.importFile(file('gone.csv'));
  assert.deepEqual(log, ['loading', 'loading'], 'no text, no message, no state change after dispose');
  importer.activate();
  importer.importFile(file());
  FakeReader.reads[2].succeed('C');
  assert.deepEqual(log, ['loading', 'loading', 'loading', 'text "C"', 'idle']);
});

test('file import: a new import works after an error', () => {
  fresh();
  const { log, importer } = target();
  importer.importFile(file());
  FakeReader.reads[0].succeed([0xc0, 0xaf]);
  importer.importFile(file());
  FakeReader.reads[1].succeed('again');
  assert.deepEqual(log, ['loading', 'error invalidEncoding', 'idle', 'loading', 'text "again"', 'idle']);
});

test('file import: a read that cannot start is a read error of the current import', () => {
  fresh();
  const { log, importer } = target();
  FakeReader.throwOnRead = true;
  importer.importFile(file());
  assert.deepEqual(log, ['loading', 'error readError', 'idle']);
});
