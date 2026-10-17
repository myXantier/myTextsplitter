// File import fixtures (Paket 11 Phase B): `tests/fixtures/file-io-cases.json`, run against the real app by the
// integration tests (`checkFileIo` in tests/e2e/lib/app.mjs, browser and Tauri). This file checks only the fixture data:
//   - the format (bytes, expectations, pending lists that name exactly the paths/fields still differing from the target),
//   - the CURRENT expectations against an independent model of today's code: FileReader.readAsText = the WHATWG "decode"
//     algorithm (BOM sniffing UTF-8 / UTF-16LE / UTF-16BE, otherwise UTF-8, invalid bytes become U+FFFD), the button sets
//     only a truthy content (F2), the drop checks `.txt` (case-sensitive) and then `size > 10 MiB` (F6),
//   - the TARGETS against the contract (docs/analyse/Paket11-PhaseB-Datei-IO-Vertrag.md): `.txt` in any case (D8), at most
//     10 MiB inclusive (D7), strict decoding with the same BOM rule (D3-D6), an empty content is a text (D1).
// Whether the app really behaves like this is checked only by the integration tests, never here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Expectation =
  | { text: string }
  | { generatedText: true }
  | { unchanged: true }
  | { rejected: 'invalidEncoding' | 'tooLarge' | 'unsupportedExtension'; message?: string };
type ImportPath = 'button' | 'drop';
interface Case {
  name: string;
  ref?: string;
  file: string;
  bytes?: string;
  generate?: number;
  expected?: Expectation;
  expectedButton?: Expectation;
  expectedDrop?: Expectation;
  target?: Expectation;
  pending?: { decisions: string[]; phase: string; paths: ImportPath[]; reason: string };
  /** Chromium's FileReader decodes differently from the WHATWG algorithm (`whatwg` = the result of the algorithm). */
  divergence?: { kind: 'chromiumFileReader'; whatwg: string; reason: string };
  note?: string;
}
interface Scenario {
  name: string;
  ref?: string;
  method: 'real' | 'gated' | 'intercepted';
  steps: string;
  current: Record<string, unknown>;
  target: Record<string, unknown>;
  pending?: { decisions: string[]; phase: string; fields: string[]; reason: string };
}

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/file-io-cases.json', import.meta.url), 'utf8'));
const cases: Case[] = fixtures.cases;
const scenarios: Scenario[] = fixtures.scenarios;
const PATHS: ImportPath[] = ['button', 'drop'];
const DECISIONS = new Set(Array.from({ length: 14 }, (_, i) => `D${i + 1}`));
const PHASES = new Set(['C1', 'C2', 'C3']);

/** Same generator as the integration tests: `line` repeated and cut to `size` bytes (ASCII). */
const generated = (size: number) => fixtures.generator.line.repeat(Math.ceil(size / fixtures.generator.line.length)).slice(0, size);
const bytesOf = (c: Case) => (c.generate !== undefined ? new TextEncoder().encode(generated(c.generate)) : Uint8Array.from(c.bytes!.split(' ').filter(Boolean).map((h) => parseInt(h, 16))));

/** Encoding chosen by the BOM (WHATWG "decode"), UTF-8 without one. */
const sniff = (b: Uint8Array) =>
  b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf-8' : b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
/** Today's FileReader.readAsText(file): replacement decoding, the BOM is removed. */
const legacyDecode = (b: Uint8Array) => new TextDecoder(sniff(b)).decode(b);
/** Contract decoding: the same BOM rule, invalid sequences are an error (null). */
const strictDecode = (b: Uint8Array) => {
  try {
    return new TextDecoder(sniff(b), { fatal: true }).decode(b);
  } catch {
    return null;
  }
};

const currentOf = (c: Case, path: ImportPath) => (path === 'button' ? c.expectedButton : c.expectedDrop) ?? c.expected!;
/** The decided behaviour: the target, or the current expectation of a case that already meets the contract. */
const targetOf = (c: Case, path: ImportPath) => c.target ?? currentOf(c, path);
/** A generated text is compared as text (the fixtures write it as { generatedText: true }). */
const asText = (c: Case, e: Expectation) => ('generatedText' in e ? { text: generated(c.generate!) } : e);
/** The observable result: a message text is part of the current expectation only (the target wording is open). */
const observable = (c: Case, e: Expectation) => {
  const v = asText(c, e);
  return 'rejected' in v ? { rejected: v.rejected } : v;
};

test('file I/O fixtures: format', () => {
  assert.equal(new Set(cases.map((c) => c.name)).size, cases.length, 'case names are unique');
  assert.equal(new Set(cases.map((c) => c.file.toLowerCase())).size, cases.length, 'file names are unique (case-insensitive file systems)');
  assert.equal(fixtures.maxBytes, 10 * 1024 * 1024);
  for (const c of cases) {
    assert.ok((c.bytes === undefined) !== (c.generate === undefined), `${c.name}: bytes or generate`);
    if (c.bytes !== undefined) assert.match(c.bytes, /^(?:[0-9A-F]{2}(?: [0-9A-F]{2})*)?$/, `${c.name}: bytes are upper-case hex pairs`);
    assert.ok(!!c.expected !== !!(c.expectedButton && c.expectedDrop), `${c.name}: expected, or expectedButton + expectedDrop`);
    if (c.expectedButton) assert.notDeepEqual(c.expectedButton, c.expectedDrop, `${c.name}: separate expectations only when the paths differ`);
    for (const path of PATHS) {
      const e = currentOf(c, path);
      assert.equal(Object.keys(e).filter((k) => k !== 'message').length, 1, `${c.name} (${path}): one expectation kind`);
      if ('generatedText' in e) assert.ok(c.generate !== undefined, `${c.name}: generatedText needs generate`);
    }
    assert.ok(!!c.target === !!c.pending, `${c.name}: target and pending come together`);
    if (c.target) assert.ok(!('message' in c.target) && !('unchanged' in c.target), `${c.name}: a target names no message text and never ignores a file`);
  }
});

test('file I/O fixtures: current expectations follow the code of today', () => {
  for (const c of cases) {
    const bytes = bytesOf(c);
    // A documented Chromium difference: the algorithm gives `whatwg`, the fixture holds what Chromium really returns
    if (c.divergence) assert.equal(legacyDecode(bytes), c.divergence.whatwg, `${c.name}: WHATWG result of the divergence`);
    const chromium = c.divergence ? (c.expected as { text: string } | undefined)?.text : undefined;
    assert.ok(!c.divergence || (chromium !== undefined && chromium !== c.divergence.whatwg), `${c.name}: a divergence needs a differing common text`);
    const decoded = chromium ?? legacyDecode(bytes);
    // OpenFileButton: no checks; `if (content) setFileText(content)` (F2)
    assert.deepEqual(observable(c, currentOf(c, 'button')), decoded === '' ? { unchanged: true } : { text: decoded }, `${c.name}: button`);
    // useDragAndDrop: `.txt` (case-sensitive), then `file.size > maxSize`; RemovePage sets every content, also ''
    const drop = !c.file.endsWith('.txt') ? { rejected: 'unsupportedExtension' } : bytes.length > fixtures.maxBytes ? { rejected: 'tooLarge' } : { text: decoded };
    assert.deepEqual(observable(c, currentOf(c, 'drop')), drop, `${c.name}: drop`);
  }
});

test('file I/O fixtures: targets follow the contract', () => {
  for (const c of cases) {
    const bytes = bytesOf(c);
    const strict = strictDecode(bytes);
    // Every check of this list fails for at most one reason, so the order of the checks does not matter here
    const contract = !/\.txt$/i.test(c.file)
      ? { rejected: 'unsupportedExtension' }
      : bytes.length > fixtures.maxBytes
        ? { rejected: 'tooLarge' }
        : strict === null
          ? { rejected: 'invalidEncoding' }
          : { text: strict };
    for (const path of PATHS) assert.deepEqual(observable(c, targetOf(c, path)), contract, `${c.name} (${path})`);
  }
});

test('file I/O fixtures: pending names exactly the paths that still differ from the target', () => {
  for (const c of cases) {
    const differing = PATHS.filter((path) => JSON.stringify(observable(c, currentOf(c, path))) !== JSON.stringify(observable(c, targetOf(c, path))));
    assert.deepEqual(c.pending?.paths ?? [], differing, c.name);
    if (c.pending) {
      assert.ok(c.pending.decisions.length > 0 && c.pending.decisions.every((d) => DECISIONS.has(d)), `${c.name}: decisions D1..D14`);
      assert.ok(PHASES.has(c.pending.phase) && c.pending.reason.length > 0, `${c.name}: phase and reason`);
    }
  }
});

test('file I/O fixtures: the required cases are present', () => {
  const has = (predicate: (c: Case, b: Uint8Array) => boolean, what: string) => assert.ok(cases.some((c) => predicate(c, bytesOf(c))), what);
  const starts = (b: Uint8Array, ...head: number[]) => head.every((v, i) => b[i] === v);
  has((_, b) => b.length === 0, 'empty file');
  has((_, b) => b.length === 3 && starts(b, 0xef, 0xbb, 0xbf), 'UTF-8 BOM only');
  has((_, b) => b.length > 3 && starts(b, 0xef, 0xbb, 0xbf), 'UTF-8 with BOM');
  has((_, b) => b.length > 0 && sniff(b) === 'utf-8' && !starts(b, 0xef) && strictDecode(b) !== null && /[^\x00-\x7f]/.test(strictDecode(b)!), 'UTF-8 without BOM');
  has((_, b) => b.length > 2 && starts(b, 0xff, 0xfe) && strictDecode(b) !== null, 'UTF-16LE with BOM');
  has((_, b) => b.length > 2 && starts(b, 0xfe, 0xff) && strictDecode(b) !== null, 'UTF-16BE with BOM');
  has((c) => c.name.startsWith('UTF-16LE without BOM'), 'UTF-16 without BOM');
  has((c) => /Windows-1252/.test(c.name), 'Windows-1252');
  has((c) => /truncated/.test(c.name), 'truncated UTF-8 sequence');
  has((_, b) => strictDecode(b) === null && sniff(b) === 'utf-8', 'invalid UTF-8');
  has((_, b) => [...(strictDecode(b) ?? '')].some((ch) => ch.codePointAt(0)! > 0xffff), 'non-BMP characters');
  has((_, b) => b.includes(0) && sniff(b) === 'utf-8', 'NUL');
  for (const text of ['\n', '\r\n', '\r', 'a\r\nb\nc\rd', 'a\n\n\n', '   ']) has((c) => 'text' in (c.expected ?? {}) && (c.expected as { text: string }).text === text, JSON.stringify(text));
  has((c) => c.generate === fixtures.maxBytes, 'exactly 10 MiB');
  has((c) => c.generate === fixtures.maxBytes + 1, '10 MiB + 1 byte');
  has((c) => c.file.endsWith('.txt'), '.txt');
  has((c) => c.file.endsWith('.TXT'), '.TXT');
});

test('file I/O fixtures: scenarios list exactly the fields that still differ from the target', () => {
  assert.equal(new Set(scenarios.map((s) => s.name)).size, scenarios.length, 'scenario names are unique');
  for (const s of scenarios) {
    assert.deepEqual(Object.keys(s.current).sort(), Object.keys(s.target).sort(), `${s.name}: same fields`);
    assert.ok(['real', 'gated', 'intercepted'].includes(s.method), `${s.name}: method`);
    const differing = Object.keys(s.current).filter((k) => JSON.stringify(s.current[k]) !== JSON.stringify(s.target[k]));
    assert.deepEqual([...(s.pending?.fields ?? [])].sort(), differing.sort(), s.name);
    if (s.pending) {
      assert.ok(s.pending.decisions.every((d) => DECISIONS.has(d)) && PHASES.has(s.pending.phase), `${s.name}: decisions and phase`);
    }
  }
});
