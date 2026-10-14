// Line diff (Paket 7, B1): shared golden fixtures `tests/fixtures/diff-cases.json` (also run by `cargo test`,
// src-tauri/src/diff/tests.rs), invariants, generated parity cases, limits, worker/backend integration and the
// transitional adapter for the DiffPage.
import { installWindow, disableWorkerCleanupInterval, rejectionOf, backendMetrics } from './helpers/setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { DiffService, assertBackendDiff } = await import('../../src/services/Services.ts').then(async () => import('../../src/services/DiffService.ts'));
const { BaseService } = await import('../../src/services/BaseService.ts');
const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
const { computeIntraline } = await import('../../src/utils/diff/intraline.ts');
const { alignSequences, DiffLimitError, DIFF_WORK_LIMIT } = await import('../../src/utils/diff/myers.ts');
const { comparisonKey, isBlankLine } = await import('../../src/utils/diff/whitespace.ts');
const { diffDocumentError, diffInputMismatch } = await import('../../src/utils/diff/validate.ts');
const { splitLines } = await import('../../src/utils/lines.ts');
type DiffDocument = import('../../src/utils/diff/types.ts').DiffDocument;

disableWorkerCleanupInterval(BaseService);
beforeEach(() => installWindow());

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/diff-cases.json', import.meta.url), 'utf8'));

// --- helpers (same notation as the fixtures and the Rust tests) ---

const compactRows = (d: DiffDocument) =>
  d.rows
    .map((r) => (r.kind === 'equal' ? `=${r.old.line}/${r.new.line}` : r.kind === 'delete' ? `-${r.old.line}${r.moveId ? `m${r.moveId}` : ''}` : `+${r.new.line}${r.moveId ? `m${r.moveId}` : ''}`))
    .join(' ');
const compactMoves = (d: DiffDocument) => d.moves.map((m) => `${m.id}:${m.oldLine}>${m.newLine}`);

/** Every invariant of a diff of exactly these texts (structure, all lines once and in order, texts, moves, stats). */
function assertInvariants(d: DiffDocument, oldText: string, newText: string, ignoreWhitespace: boolean) {
  assert.equal(diffDocumentError(d), null);
  const oldLines = splitLines(oldText).lines;
  const newLines = splitLines(newText).lines;
  assert.equal(diffInputMismatch(d, oldLines, newLines, ignoreWhitespace), null);
  for (const row of d.rows) {
    if (row.kind === 'equal') assert.equal(comparisonKey(row.old.text, ignoreWhitespace), comparisonKey(row.new.text, ignoreWhitespace), 'equal rows have equal keys');
  }
  for (const move of d.moves) {
    assert.ok(!isBlankLine(oldLines[move.oldLine - 1]), 'blank lines are never moves');
    const key = comparisonKey(oldLines[move.oldLine - 1], ignoreWhitespace);
    assert.equal(comparisonKey(newLines[move.newLine - 1], ignoreWhitespace), key);
    assert.equal(oldLines.filter((l) => comparisonKey(l, ignoreWhitespace) === key).length, 1, 'move key is unique in the old text');
    assert.equal(newLines.filter((l) => comparisonKey(l, ignoreWhitespace) === key).length, 1, 'move key is unique in the new text');
  }
}

/** Length of a longest common subsequence of the comparison keys (reference for minimality). */
function lcsLength(a: string[], b: string[]) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = a.length - 1; i >= 0; i--) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = b.length - 1; j >= 0; j--) cur[j] = a[i] === b[j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1]);
    prev = cur;
  }
  return prev[0];
}

// --- golden fixtures ---

test('diff fixtures are well-formed', () => {
  const names = new Set<string>();
  assert.ok(fixtures.cases.length >= 50);
  for (const c of fixtures.cases) {
    assert.ok(!names.has(c.name), `duplicate name ${c.name}`);
    names.add(c.name);
  }
  // `documents` repeat fixture cases with their complete JSON
  for (const c of fixtures.documents) assert.ok(names.has(c.name), c.name);
});

for (const c of fixtures.cases) {
  test(`diff fixture: ${c.name}`, () => {
    const ignoreWhitespace = c.ignoreWhitespace ?? false;
    const d = computeLineDiff(c.old, c.new, { ignoreWhitespace });
    assert.deepEqual({ rows: compactRows(d), moves: compactMoves(d), stats: d.stats }, { rows: c.rows, moves: c.moves, stats: c.stats });
    assertInvariants(d, c.old, c.new, ignoreWhitespace);
  });
}

for (const c of fixtures.documents) {
  test(`diff document (exact JSON shape): ${c.name}`, () => {
    assert.deepEqual(JSON.parse(JSON.stringify(computeLineDiff(c.old, c.new, { ignoreWhitespace: c.ignoreWhitespace }))), c.document);
  });
}

// --- generated cases: same generator in Rust (`generated_cases`), compared through a digest ---

const GEN_ALPHABET = ['a', 'b', 'c', '', '  a', 'a ', '\t', 'b' + String.fromCodePoint(0xa0), String.fromCodePoint(0xe4), String.fromCodePoint(0x1f600)];
const GEN_SEPARATORS = ['\n', '\r\n', '\r'];

/** xorshift32; every case draws its values in exactly this order (see `generated_cases` in Rust). */
function generatedCases(seed: number, count: number) {
  let state = seed >>> 0;
  const next = (n: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % n;
  };
  const text = (size: number) => {
    const length = next(9);
    const lines = Array.from({ length }, () => GEN_ALPHABET[next(size)]);
    const separator = GEN_SEPARATORS[next(3)];
    const trailing = next(2) === 1;
    return lines.join(separator) + (trailing && length > 0 ? separator : '');
  };
  return Array.from({ length: count }, () => {
    const ignoreWhitespace = next(2) === 1;
    const size = 1 + next(GEN_ALPHABET.length);
    const oldText = text(size);
    const newText = text(size);
    return { oldText, newText, ignoreWhitespace };
  });
}

const fnv1a = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

test('diff generated cases: invariants, minimal alignment and the shared Rust/JS digest', () => {
  const { seed, count, digest } = fixtures.generated;
  let compact = '';
  for (const { oldText, newText, ignoreWhitespace } of generatedCases(seed, count)) {
    const d = computeLineDiff(oldText, newText, { ignoreWhitespace });
    assertInvariants(d, oldText, newText, ignoreWhitespace);
    const keys = (t: string) => splitLines(t).lines.map((l) => comparisonKey(l, ignoreWhitespace));
    assert.equal(d.stats.unchanged, lcsLength(keys(oldText), keys(newText)), 'minimal: as many unchanged lines as the LCS');
    compact += compactRows(d) + '\n';
  }
  assert.equal(fnv1a(compact), digest);
});

// --- whitespace definition ---

test('diff whitespace: exactly the Unicode White_Space property (25 code points)', () => {
  const expected = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  const found: number[] = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (isBlankLine(String.fromCharCode(cp))) found.push(cp);
  }
  assert.deepEqual(found, expected);
  assert.equal(comparisonKey(String.fromCodePoint(0xfeff) + 'a', true), String.fromCodePoint(0xfeff) + 'a', 'U+FEFF is not whitespace (unlike JS \\s)');
  assert.equal(comparisonKey('  a \t b' + String.fromCodePoint(0x3000), true), 'a b');
  assert.equal(comparisonKey('  a \t b', false), '  a \t b');
});

// --- limits ---

test('diff limit: the exact work of an alignment is fixed in the fixtures (same counting as Rust)', () => {
  const { reversedLines, work } = fixtures.limit;
  const a = Int32Array.from({ length: reversedLines }, (_, i) => i);
  const b = Int32Array.from(a).reverse();
  assert.doesNotThrow(() => alignSequences(a, b, reversedLines, work));
  assert.throws(() => alignSequences(a, b, reversedLines, work - 1), DiffLimitError);
});

test('diff limit: too many reordered lines are a controlled input error, never a partial result', async () => {
  const lines = Array.from({ length: 12_000 }, (_, i) => `line ${i}`);
  const args: DiffConfig = { sourceText: lines.join('\n'), mainParam: [...lines].reverse().join('\n'), configParams: { caseSensitive: true, ignoreWhitespace: false } };
  assert.throws(() => computeLineDiff(args.sourceText, args.mainParam, { ignoreWhitespace: false }), DiffLimitError);
  const error = await rejectionOf(() => new DiffService().invoke(args, false));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, 'errors.diffTooComplex');
  assert.equal(DIFF_WORK_LIMIT, 100_000_000);
});

test('diff long texts: mostly equal and completely different texts are not limited', () => {
  const base = Array.from({ length: 100_000 }, (_, i) => `line ${i}`);
  const changed = base.slice();
  for (let i = 0; i < changed.length; i += 997) changed[i] = `changed ${i}`;
  changed.splice(50_000, 0, 'inserted');
  const d = computeLineDiff(base.join('\n'), ['first', ...changed].join('\n'), { ignoreWhitespace: false });
  assert.deepEqual(d.stats, { unchanged: 99_899, removed: 101, added: 103, moved: 0 });
  assert.equal(diffDocumentError(d), null);

  const other = computeLineDiff(base.join('\n'), base.map((l) => `other ${l}`).join('\n'), { ignoreWhitespace: false });
  assert.deepEqual(other.stats, { unchanged: 0, removed: 100_000, added: 100_000, moved: 0 });
});

// --- validator: corrupted or partial documents are rejected ---

test('diff validator rejects partial, inconsistent and foreign documents', () => {
  const valid = computeLineDiff('A\nB\nC', 'A\nC\nB\nD', { ignoreWhitespace: false });
  assert.equal(diffDocumentError(valid), null);
  const broken = (change: (d: any) => void) => {
    const d = structuredClone(valid) as any;
    change(d);
    return diffDocumentError(d);
  };
  assert.ok(broken((d) => d.rows.pop()), 'missing row');
  assert.ok(broken((d) => d.rows.reverse()), 'wrong order');
  assert.ok(broken((d) => (d.stats.added += 1)), 'stats');
  assert.ok(broken((d) => (d.moves = [])), 'move without entry');
  assert.ok(broken((d) => delete d.rows.find((r: any) => r.moveId).moveId), 'move entry without row');
  assert.ok(broken((d) => (d.rows[0].extra = 1)), 'unknown field');
  assert.ok(broken((d) => (d.rows[0].kind = 'changed')), 'unknown kind');
  assert.ok(broken((d) => (d.rows[0].old.line = 0)), 'line 0');
  assert.ok(broken((d) => (d.version = 1)), 'version');
  assert.ok(broken((d) => (d.oldLineCount = 4)), 'line count');
  for (const value of [null, [], 'x', {}, JSON.stringify(valid)]) assert.ok(diffDocumentError(value), String(value));

  // complete and valid, but not the diff of this input
  assert.ok(diffInputMismatch(valid, ['A', 'B'], ['A', 'C', 'B', 'D'], false));
  assert.ok(diffInputMismatch(valid, ['A', 'B', 'X'], ['A', 'C', 'B', 'D'], false));
  assert.ok(diffInputMismatch(valid, ['A', 'B', 'C'], ['A', 'C', 'B', 'D'], true));
  assert.equal(diffInputMismatch(valid, ['A', 'B', 'C'], ['A', 'C', 'B', 'D'], false), null);
});

// Shared fixtures: valid documents and corrupted ones whose counts, texts and statistics match the input
for (const v of fixtures.validatedDocuments) {
  test(`diff validator fixture: ${v.name} -> ${v.valid ? 'valid' : 'rejected'}`, () => {
    const error = diffDocumentError(v.document);
    const mismatch = diffInputMismatch(v.document, splitLines(v.old).lines, splitLines(v.new).lines, v.ignoreWhitespace);
    assert.equal(mismatch, null, 'the document belongs to this input: only its semantics can be wrong');
    if (v.valid) assert.equal(error, null);
    else assert.ok(error, 'must be rejected');
  });
}

test('diff validator: equal rows and moves follow the comparison keys (linear check, no new alignment)', () => {
  assert.equal(diffDocumentError(computeLineDiff(' A\nB', 'A\nB ', { ignoreWhitespace: true })), null);
  const forged: any = computeLineDiff('A', 'B', { ignoreWhitespace: false });
  forged.rows = [{ kind: 'equal', old: { line: 1, text: 'A' }, new: { line: 1, text: 'B' } }];
  forged.stats = { unchanged: 1, removed: 0, added: 0, moved: 0 };
  assert.equal(diffDocumentError(forged), 'equal row with different lines');
  // every generated move passes the rules (checked in both directions)
  for (const c of fixtures.cases) assert.equal(diffDocumentError(computeLineDiff(c.old, c.new, { ignoreWhitespace: c.ignoreWhitespace ?? false })), null, c.name);
});

// --- services: worker / main thread / backend ---

const diffArgs = (oldText: string, newText: string, ignoreWhitespace = false): DiffConfig => ({
  sourceText: oldText,
  mainParam: newText,
  configParams: { caseSensitive: true, ignoreWhitespace },
});

test('diff main thread (no Web Worker): complete Diff result, also for an empty side', async () => {
  for (const [oldText, newText] of [['A', 'A\nB\nC\nD'], ['', 'A\nB'], ['A\nB', ''], ['', '']]) {
    const result = await new DiffService().invoke(diffArgs(oldText, newText), false);
    assert.equal(result.type, 'Diff');
    assert.equal((result.result as any).intraline, null, 'no word diff unless requested');
    assertInvariants((result.result as any).document as DiffDocument, oldText, newText, false);
  }
});

test('diff backend: structured document is accepted and checked against the request', async () => {
  const document = computeLineDiff('one', 'one\ntwo', { ignoreWhitespace: false });
  installWindow(() => ({ document, intraline: null, metrics: backendMetrics }));
  const result = await new DiffService().invoke(diffArgs('one', 'one\ntwo'), true);
  assert.equal(result.type, 'Diff');
  assert.deepEqual(result.result, { document, intraline: null });
});

for (const [name, answer] of [
  ['former JSON string format', () => ({ result_text: '[]', removed_lines: 0, metrics: backendMetrics })],
  ['document as JSON string', () => ({ document: JSON.stringify(computeLineDiff('a', 'b', { ignoreWhitespace: false })), intraline: null, metrics: backendMetrics })],
  ['missing metrics', () => ({ document: computeLineDiff('a', 'b', { ignoreWhitespace: false }), intraline: null })],
  ['missing intraline field (former B1 format)', () => ({ document: computeLineDiff('a', 'b', { ignoreWhitespace: false }), metrics: backendMetrics })],
  ['word diff that was not requested', () => { const document = computeLineDiff('a', 'b', { ignoreWhitespace: false }); return { document, intraline: computeIntraline(document), metrics: backendMetrics }; }],
  ['document of another input', () => ({ document: computeLineDiff('a', 'x', { ignoreWhitespace: false }), intraline: null, metrics: backendMetrics })],
  ['truncated document (new text cut)', () => ({ document: computeLineDiff('a', 'a', { ignoreWhitespace: false }), intraline: null, metrics: backendMetrics })],
  ['other whitespace option', () => ({ document: computeLineDiff('a', 'b', { ignoreWhitespace: true }), intraline: null, metrics: backendMetrics })],
] as const) {
  test(`diff backend: ${name} is an invalid-result error`, async () => {
    installWindow(answer);
    const error = await rejectionOf(() => new DiffService().invoke(diffArgs('a', name.includes('truncated') ? 'a\nb' : 'b'), true));
    assert.equal(error.kind, 'invalidResult');
  });
}

for (const v of fixtures.validatedDocuments.filter((v: any) => !v.valid)) {
  test(`diff backend: corrupted answer (${v.name}) is invalidResult, its metrics are not applied`, async () => {
    const service = new DiffService();
    installWindow(() => ({ document: v.document, intraline: null, metrics: { ...backendMetrics, execution_time_ms: 99 } }));
    const error = await rejectionOf(() => service.invoke(diffArgs(v.old, v.new, v.ignoreWhitespace), true));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

test('diff backend: a valid document of another input keeps the metrics of the previous job', async () => {
  const service = new DiffService();
  installWindow(() => ({ document: computeLineDiff('a', 'b', { ignoreWhitespace: false }), intraline: null, metrics: { ...backendMetrics, execution_time_ms: 5 } }));
  await service.invoke(diffArgs('a', 'b'), true);
  assert.equal(service.getMetrics()?.executionTime, 5);

  installWindow(() => ({ document: computeLineDiff('a', 'x', { ignoreWhitespace: false }), intraline: null, metrics: { ...backendMetrics, execution_time_ms: 99 } }));
  const error = await rejectionOf(() => service.invoke(diffArgs('a', 'b'), true));
  assert.equal(error.kind, 'invalidResult');
  assert.equal(service.getMetrics()?.executionTime, 5, 'metrics of the failed job are not applied');
});

test('diff backend: diffTooComplex from Rust is the same input error as in JS', async () => {
  installWindow(() => {
    throw { kind: 'diffTooComplex', message: 'diff needs more than 100000000 work units' };
  });
  const error = await rejectionOf(() => new DiffService().invoke(diffArgs('a', 'b'), true));
  assert.equal(error.kind, 'invalidInput');
  assert.equal(error.message, 'errors.diffTooComplex');
});

test('assertBackendDiff accepts null memory metrics', () => {
  const document = computeLineDiff('a', 'b', { ignoreWhitespace: false });
  assert.equal(assertBackendDiff({ document, intraline: null, metrics: { ...backendMetrics, memory_usage_kb: null } }).data.document, document);
});

// --- Paket 7 B3: optional word diff through the Rust IPC contract ---

test('diff backend: the word diff is requested with `worddiff` and checked against the document', async () => {
  const calls: Record<string, unknown>[] = [];
  const document = computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false });
  installWindow((_cmd, args) => {
    calls.push(args);
    return { document, intraline: args.worddiff ? computeIntraline(document) : null, metrics: backendMetrics };
  });
  const off = await new DiffService().invoke(diffArgs('a b c', 'a b x'), true);
  const on = await new DiffService().invoke({ ...diffArgs('a b c', 'a b x'), configParams: { caseSensitive: true, ignoreWhitespace: false, wordDiff: true } }, true);
  assert.deepEqual(calls.map((c) => c.worddiff), [false, true]);
  assert.equal((off.result as any).intraline, null);
  assert.deepEqual((on.result as any).intraline, computeIntraline(document));
});

for (const [name, answer, wordDiff] of [
  ['requested word diff missing', () => ({ document: computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false }), intraline: null, metrics: backendMetrics }), true],
  ['word diff of another document', () => ({ document: computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false }), intraline: computeIntraline(computeLineDiff('q r s', 'q r t', { ignoreWhitespace: false })), metrics: backendMetrics }), true],
  ['word diff with invalid work', () => { const document = computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false }); return { document, intraline: { ...computeIntraline(document), work: -1 }, metrics: backendMetrics }; }, true],
] as const) {
  test(`diff backend: ${name} is invalidResult, no metrics`, async () => {
    installWindow(answer);
    const service = new DiffService();
    const error = await rejectionOf(() => service.invoke({ ...diffArgs('a b c', 'a b x'), configParams: { caseSensitive: true, ignoreWhitespace: false, wordDiff } }, true));
    assert.equal(error.kind, 'invalidResult');
    assert.equal(service.getMetrics(), null);
  });
}

// --- Paket 7 B3: a running comparison cancelled by a newer (invalid) action, as the DiffPage does it ---

const { BaseService: Base } = await import('../../src/services/BaseService.ts');

/** Backend whose answer the test releases later (a long Rust job that cannot be stopped). */
function lateBackend() {
  let release: (answer: () => unknown) => void = () => {};
  installWindow(() => new Promise((resolve, reject) => (release = (answer) => { try { resolve(answer()); } catch (e) { reject(e); } })));
  return (answer: () => unknown) => release(answer);
}
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

for (const [ending, answer] of [
  ['successfully', () => ({ document: computeLineDiff('a', 'b', { ignoreWhitespace: false }), intraline: null, metrics: { ...backendMetrics, execution_time_ms: 99 } })],
  ['with a technical error', () => { throw { kind: 'internal', message: 'boom' }; }],
] as const) {
  test(`diff cancelled while running in Rust, the late job ends ${ending}: superseded, no result, no metrics`, async () => {
    const release = lateBackend();
    const service = new DiffService();
    const running = rejectionOf(() => service.invoke(diffArgs('a', 'b'), true));
    await flushTasks();
    Base.cancelPending('diff'); // the DiffPage after a click with empty texts
    release(answer);
    const error = await running;
    assert.equal(error.kind, 'superseded', 'no result and no error message for the old job');
    assert.equal(service.getMetrics(), null);

    // A later valid comparison (also with word diff) works normally
    const document = computeLineDiff('a b c', 'a b x', { ignoreWhitespace: false });
    installWindow(() => ({ document, intraline: computeIntraline(document), metrics: backendMetrics }));
    const next = await service.invoke({ ...diffArgs('a b c', 'a b x'), configParams: { caseSensitive: true, ignoreWhitespace: false, wordDiff: true } }, true);
    assert.equal((next.result as any).intraline.pairs.length, 1);
  });
}

test('diff backend: a failed valid comparison keeps the shown result usable; its word diff is computed afterwards', async () => {
  const service = new DiffService();
  const shown = computeLineDiff('Die Katze schläft', 'Die Katze träumt', { ignoreWhitespace: false });
  installWindow(() => ({ document: shown, intraline: null, metrics: { ...backendMetrics, execution_time_ms: 5 } }));
  await service.invoke(diffArgs('Die Katze schläft', 'Die Katze träumt'), true);

  installWindow(() => {
    throw { kind: 'diffTooComplex', message: 'diff needs more than 100000000 work units' };
  });
  const error = await rejectionOf(() => service.invoke(diffArgs('many', 'reordered'), true));
  assert.equal(error.message, 'errors.diffTooComplex');
  assert.equal(service.getMetrics()?.executionTime, 5, 'the failed comparison sets no metrics');

  const calls: Record<string, unknown>[] = [];
  installWindow((_cmd, args) => {
    calls.push(args);
    return { document: shown, intraline: computeIntraline(shown), metrics: backendMetrics };
  });
  const withWordDiff = await service.invoke({ ...diffArgs('Die Katze schläft', 'Die Katze träumt'), configParams: { caseSensitive: true, ignoreWhitespace: false, wordDiff: true } }, true);
  assert.deepEqual(calls.map((c) => [c.oldtext, c.newtext, c.worddiff]), [['Die Katze schläft', 'Die Katze träumt', true]]);
  assert.equal((withWordDiff.result as any).intraline.pairs.length, 1);
});
