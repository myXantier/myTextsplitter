// Optional word diff (Paket 7, B2): shared fixtures `tests/fixtures/intraline-cases.json` (also run by `cargo test`,
// src-tauri/src/diff/intraline_tests.rs), invariants, generated parity cases, limits, and the rule that nothing of the
// word diff runs unless it is requested.
import './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
const { computeIntraline, intralineError, INTRALINE_LIMITS } = await import('../../src/utils/diff/intraline.ts');
const { tokenize } = await import('../../src/utils/diff/tokenize.ts');
type IntralineAnalysis = import('../../src/utils/diff/types.ts').IntralineAnalysis;

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/intraline-cases.json', import.meta.url), 'utf8'));

const OP = { equal: '=', delete: '-', insert: '+' } as const;
/** Same shape as the fixtures */
const fixtureForm = (a: IntralineAnalysis) => ({
  pairs: a.pairs.map((p) => ({
    oldLine: p.oldLine,
    newLine: p.newLine,
    similarity: [p.similarity.common, p.similarity.total],
    ...(p.skipped ? { skipped: p.skipped } : { old: p.old!.map((s) => [OP[s.op], s.text]), new: p.new!.map((s) => [OP[s.op], s.text]) }),
  })),
  skipped: a.skipped,
  work: a.work,
});

/** Analysis of old/new with the invariants that must hold for every result */
function analyze(oldText: string, newText: string, ignoreWhitespace: boolean, limits = INTRALINE_LIMITS) {
  const document = computeLineDiff(oldText, newText, { ignoreWhitespace });
  const before = JSON.stringify(document);
  const analysis = computeIntraline(document, limits);
  assert.equal(JSON.stringify(document), before, 'the line diff is not changed');
  assert.equal(intralineError(analysis, document), null);
  assert.ok(analysis.work <= limits.budget);
  return { document, analysis };
}

test('intraline fixtures: limits are the documented defaults', () => {
  assert.deepEqual(fixtures.limits, INTRALINE_LIMITS);
  assert.deepEqual(INTRALINE_LIMITS, { maxLineTokens: 500, maxPairingCells: 2_500, maxPairWork: 1_000_000, budget: 2_000_000 });
});

for (const t of fixtures.tokens) {
  test(`tokenize: ${JSON.stringify(t.text)}`, () => {
    assert.deepEqual(tokenize(t.text), t.tokens);
    assert.equal(tokenize(t.text).join(''), t.text, 'tokens rebuild the line');
  });
}

for (const c of fixtures.cases) {
  test(`intraline fixture: ${c.name}`, () => {
    const { analysis } = analyze(c.old, c.new, c.ignoreWhitespace ?? false, { ...INTRALINE_LIMITS, ...(c.limits ?? {}) });
    assert.deepEqual(fixtureForm(analysis), { pairs: c.pairs, skipped: c.skipped, work: c.work });
  });
}

// --- generated cases: same generator in Rust (`generated_intraline_cases`), compared through a digest ---

const GEN_WORDS = ['Die', 'Katze', 'l' + String.fromCodePoint(0xe4) + 'uft', ',', '.', 'a', 'b', String.fromCodePoint(0x1f600), 'x1', String.fromCodePoint(0x6211)];
const GEN_SEPARATORS = [' ', '  ', '', '\t'];

function generatedIntralineCases(seed: number, count: number) {
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
    const lines: string[] = [];
    const lineCount = next(5);
    for (let l = 0; l < lineCount; l++) {
      const wordCount = 1 + next(5);
      let line = GEN_WORDS[next(size)];
      for (let w = 1; w < wordCount; w++) line += GEN_SEPARATORS[next(4)] + GEN_WORDS[next(size)];
      lines.push(line);
    }
    return lines.join('\n');
  };
  return Array.from({ length: count }, () => {
    const ignoreWhitespace = next(2) === 1;
    const size = 2 + next(GEN_WORDS.length - 1);
    const small = { maxLineTokens: 3 + next(14), maxPairingCells: 1 + next(9), maxPairWork: 1 + next(80), budget: 10 + next(300) };
    const limits = next(2) === 1 ? INTRALINE_LIMITS : small;
    return { oldText: text(size), newText: text(size), ignoreWhitespace, limits };
  });
}

/** Compact text form of an analysis (same as `compact_analysis` in Rust); segments separated by U+001F */
function compactAnalysis(a: IntralineAnalysis) {
  const sep = String.fromCharCode(31);
  const segments = (s: { op: keyof typeof OP; text: string }[]) => s.map((x) => OP[x.op] + x.text).join(sep);
  const parts = a.pairs.map(
    (p) => `P${p.oldLine}/${p.newLine}:${p.similarity.common}/${p.similarity.total}` + (p.skipped ? `:S${p.skipped}` : `:O${segments(p.old!)}:N${segments(p.new!)}`),
  );
  for (const s of a.skipped) parts.push(`K${s.reason}:${s.old.join(',')}:${s.new.join(',')}`);
  parts.push(`W${a.work}`);
  return parts.join('|');
}

function fnv1a(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

test('intraline generated cases: invariants, every skip path, and the shared Rust/JS digest', () => {
  const { seed, count, digest } = fixtures.generated;
  let compact = '';
  const seen = new Set<string>();
  for (const { oldText, newText, ignoreWhitespace, limits } of generatedIntralineCases(seed, count)) {
    const { analysis } = analyze(oldText, newText, ignoreWhitespace, limits);
    for (const p of analysis.pairs) seen.add(p.skipped ?? 'computed');
    for (const s of analysis.skipped) seen.add(s.reason);
    compact += compactAnalysis(analysis) + '\n';
  }
  assert.deepEqual([...seen].sort(), ['budgetExceeded', 'computed', 'hunkTooLarge', 'lineTooLong', 'tooComplex']);
  assert.equal(fnv1a(new TextEncoder().encode(compact)), digest);
});

// --- optional: nothing runs unless requested ---

test('word diff is optional: the line diff, its engines and its transport do not use it', () => {
  for (const file of ['src/utils/diff/lineDiff.ts', 'src/utils/diff/jsEngine.ts', 'src/utils/diff/validate.ts', 'src/services/DiffService.ts', 'src/workers/DiffWorker.ts', 'src-tauri/src/diff/mod.rs']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const uses = source.split('\n').filter((line) => /import|use |intraline::|tokenize/.test(line) && /intraline|tokenize/.test(line) && !/^\s*(\/\/|#\[|pub mod intraline|mod tokenize)/.test(line));
    assert.deepEqual(uses, [], file);
  }
});

test('word diff is optional: the line diff is the same with and without a later analysis', () => {
  const oldText = 'Titel\nDie schnelle braune Katze springt.\nEnde';
  const newText = 'Neue Einleitung\nTitel\nDie schnelle schwarze Katze läuft.\nEnde';
  const plain = computeLineDiff(oldText, newText, { ignoreWhitespace: false });
  const { document } = analyze(oldText, newText, false);
  assert.deepEqual(document, plain);
});

// --- validator: forged analyses are rejected ---

test('intraline validator rejects forged analyses', () => {
  const { document, analysis } = analyze('rot gelb\nx\nblau gruen', 'rot lila\nx\nblau braun', false);
  assert.equal(analysis.pairs.length, 2);
  const forged = (change: (a: any) => void) => {
    const a = structuredClone(analysis) as any;
    change(a);
    return intralineError(a, document);
  };
  assert.ok(forged((a) => (a.pairs[0].newLine = 3)), 'pair across hunks');
  assert.ok(forged((a) => (a.pairs[1] = { ...a.pairs[0] })), 'line paired twice');
  assert.ok(forged((a) => (a.pairs[0].old[1].text = 'blau')), 'segments do not rebuild the line');
  assert.ok(forged((a) => (a.pairs[0].old[1].op = 'insert')), 'insert on the old side');
  assert.ok(forged((a) => a.pairs[0].old.splice(0, 2, { op: 'equal', text: 'rot ' }, { op: 'equal', text: 'gelb' })), 'adjacent equal segments, changed word as equal');
  assert.ok(forged((a) => (a.pairs[0].similarity = { common: 0, total: 4 })), 'similarity below the threshold');
  assert.ok(forged((a) => delete a.pairs[0].old), 'pair without segments');
  assert.ok(forged((a) => (a.ignoreWhitespace = true)), 'other whitespace option');
  assert.ok(forged((a) => a.skipped.push({ reason: 'lineTooLong', old: [2], new: [] })), 'skip of an equal line');

  const ws = analyze('a  b c d', 'a b  c x', true);
  assert.equal(intralineError(ws.analysis, ws.document), null);
  const wsForged = structuredClone(ws.analysis) as any;
  wsForged.pairs[0].old = [{ op: 'equal', text: 'a' }, { op: 'delete', text: '  ' }, { op: 'equal', text: 'b c ' }, { op: 'delete', text: 'd' }];
  assert.equal(intralineError(wsForged, ws.document), 'whitespace-only change with ignoreWhitespace');

  // Changed and moved: the delete and the insert lie in different hunks, so they are never paired
  const moved = analyze('Katze läuft schnell\nMitte', 'Mitte\nKatze läuft langsam', false);
  assert.equal(moved.analysis.pairs.length, 0);
  const movedDoc = computeLineDiff('A\nB', 'B\nA', { ignoreWhitespace: false });
  assert.ok(intralineError({ ...computeIntraline(movedDoc), pairs: [{ oldLine: 1, newLine: 2, similarity: { common: 1, total: 2 }, old: [{ op: 'equal', text: 'A' }], new: [{ op: 'equal', text: 'A' }] }] }, movedDoc), 'pair of moved lines');
});

// Shared fixtures: valid analyses and forged ones (structure, work, skip reasons, invented similarity, null values)
for (const v of fixtures.invalidAnalyses) {
  test(`intraline validator fixture: ${v.name} -> ${v.valid ? 'valid' : 'rejected'}`, () => {
    const document = computeLineDiff(v.old, v.new, { ignoreWhitespace: v.ignoreWhitespace });
    let error: string | null = 'not run';
    assert.doesNotThrow(() => (error = intralineError(v.analysis, document)), 'never throws on external data');
    if (v.valid) assert.equal(error, null);
    else assert.ok(error, 'must be rejected');
  });
}

test('intraline validator accepts unknown values without throwing', () => {
  const document = computeLineDiff('a', 'b', { ignoreWhitespace: false });
  for (const value of [undefined, null, 0, 'x', [], {}, { version: 1 }, { version: 1, ignoreWhitespace: false, pairs: [null], skipped: [], work: 0 }]) {
    assert.ok(intralineError(value, document), JSON.stringify(value));
  }
});

test('line similarity: punctuation alone never pairs lines with words', () => {
  const pairsOf = (o: string, n: string) => analyze(o, n, false).analysis.pairs.map((p) => [p.oldLine, p.newLine, p.similarity.common, p.similarity.total]);
  assert.deepEqual(pairsOf('Alphabeta.', 'Zyxwvu.'), []);
  assert.deepEqual(pairsOf('Eins, zwei; drei!', 'Vier, fünf; sechs!'), []);
  assert.deepEqual(pairsOf('Hallo, Welt!', 'Hallo Welt!'), [[1, 1, 2, 4]], 'the removed comma still gets a word diff');
  assert.deepEqual(pairsOf('...', '..!'), [[1, 1, 2, 6]], 'punctuation-only lines use their punctuation');
  assert.deepEqual(pairsOf('...', 'Ende...'), [], 'punctuation-only line vs line with words');
});

// --- limits and size ---

test('intraline: many changed lines stay within the budget, a too large analysis stops with budgetExceeded', () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `Satz ${i} mit einigen Wörtern und einem Ende.`);
  const changed = lines.map((l, i) => (i % 2 ? l.replace('Ende', 'Schluss') : l));
  const started = performance.now();
  const { analysis } = analyze(lines.join('\n'), changed.join('\n'), false);
  const ms = performance.now() - started;
  assert.equal(analysis.pairs.length, 1_500);
  assert.equal(analysis.skipped.length, 0);
  assert.ok(ms < 5_000, `${ms} ms`);

  const small = analyze(lines.join('\n'), changed.join('\n'), false, { ...INTRALINE_LIMITS, budget: 20_000 });
  assert.ok(small.analysis.pairs.length > 0 && small.analysis.pairs.length < 1_500);
  assert.ok(small.analysis.skipped.every((s) => s.reason === 'budgetExceeded'));
  assert.equal(small.analysis.pairs.length + small.analysis.skipped.length, 1_500, 'every changed line is paired or listed as skipped');
});
