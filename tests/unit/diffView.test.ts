// View model of the diff (Paket 7, B3): unified and split rows from a DiffDocument and an optional word diff.
// The model is a pure function (src/utils/diff/viewModel.ts); the DiffPage only renders it.
import './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { computeLineDiff } = await import('../../src/utils/diff/lineDiff.ts');
const { computeIntraline, INTRALINE_LIMITS } = await import('../../src/utils/diff/intraline.ts');
const { buildDiffView, formatDiffText } = await import('../../src/utils/diff/viewModel.ts');
const { splitLines } = await import('../../src/utils/lines.ts');
type DiffView = import('../../src/utils/diff/viewModel.ts').DiffView;
type DiffViewCell = import('../../src/utils/diff/viewModel.ts').DiffViewCell;

function view(oldText: string, newText: string, options: { wordDiff?: boolean; ignoreWhitespace?: boolean; limits?: Partial<typeof INTRALINE_LIMITS> } = {}) {
  const document = computeLineDiff(oldText, newText, { ignoreWhitespace: options.ignoreWhitespace ?? false });
  const intraline = options.wordDiff ? computeIntraline(document, { ...INTRALINE_LIMITS, ...(options.limits ?? {}) }) : null;
  const built = buildDiffView(document, intraline);
  assert.deepEqual(buildDiffView(document, intraline), built, 'deterministic');
  assertConsistent(built, oldText, newText);
  return built;
}

const SEG = { equal: '', delete: '-', insert: '+' } as const;
const cellForm = (c: DiffViewCell | null) => {
  if (!c) return '.';
  const text = c.segments ? c.segments.map((s) => (SEG[s.op] ? `[${SEG[s.op]}${s.text}]` : s.text)).join('') : c.text;
  return `${c.kind[0]}${c.line}:${text}${c.move ? ` m${c.move.id}>${c.move.otherLine}` : ''}${c.wordDiffSkipped ? ` !${c.wordDiffSkipped}` : ''}`;
};
const unifiedForm = (v: DiffView) => v.unified.map((r) => `${r.oldLine ?? '_'}/${r.newLine ?? '_'} ${cellForm(r)}`);
const splitForm = (v: DiffView) => v.split.map((r) => `${cellForm(r.old)} | ${cellForm(r.new)}`);

/** Both views show every line exactly once on its side, with its original text; equal rows face each other. */
function assertConsistent(v: DiffView, oldText: string, newText: string) {
  const oldLines = splitLines(oldText).lines;
  const newLines = splitLines(newText).lines;
  const check = (cells: (DiffViewCell | null)[], side: 'old' | 'new') => {
    const lines = side === 'old' ? oldLines : newLines;
    const seen = cells.filter((c): c is DiffViewCell => !!c).map((c) => {
      assert.equal(c.text, lines[c.line - 1]);
      if (c.segments) assert.equal(c.segments.map((s) => s.text).join(''), c.text, 'segments rebuild the line');
      return c.line;
    });
    assert.deepEqual(seen, lines.map((_, i) => i + 1), `${side} lines once, in order`);
  };
  check(v.split.map((r) => r.old), 'old');
  check(v.split.map((r) => r.new), 'new');
  // Unified: old side = equal + removed rows, new side = equal + added rows
  assert.deepEqual(v.unified.filter((r) => r.oldLine !== null).map((r) => r.oldLine), oldLines.map((_, i) => i + 1));
  assert.deepEqual(v.unified.filter((r) => r.newLine !== null).map((r) => r.newLine), newLines.map((_, i) => i + 1));
  for (const r of v.split) {
    if (r.old?.kind === 'equal' || r.new?.kind === 'equal') assert.ok(r.old?.kind === 'equal' && r.new?.kind === 'equal', 'equal lines face each other');
    if (r.old?.pairedLine !== undefined || r.new?.pairedLine !== undefined) {
      assert.equal(r.old?.pairedLine, r.new?.line, 'a word diff pair shares one split row');
      assert.equal(r.new?.pairedLine, r.old?.line);
    }
  }
  // Same cells in both views (unified equal rows show the new text)
  const changedCells = (cells: (DiffViewCell | null)[]) => cells.filter((c) => c && c.kind !== 'equal').map((c) => cellForm(c)).sort();
  assert.deepEqual(changedCells(v.unified), changedCells(v.split.flatMap((r) => [r.old, r.new])));
  // Statistics match the rows (a move counted once)
  const { unchanged, removed, added, moved } = v.stats;
  assert.equal(unchanged + removed + moved, oldLines.length);
  assert.equal(unchanged + added + moved, newLines.length);
  assert.equal(v.unified.filter((r) => r.move).length, 2 * moved);
}

test('view: insertion and removal; old and new line numbers', () => {
  const v = view('A\nB\nC\nD', 'A\nX\nC\nD\nE');
  assert.deepEqual(unifiedForm(v), ['1/1 e1:A', '2/_ r2:B', '_/2 a2:X', '3/3 e3:C', '4/4 e4:D', '_/5 a5:E']);
  assert.deepEqual(splitForm(v), ['e1:A | e1:A', 'r2:B | a2:X', 'e3:C | e3:C', 'e4:D | e4:D', '. | a5:E']);
  assert.deepEqual(v.stats, { unchanged: 3, removed: 1, added: 2, moved: 0, changed: 0, wordDiffSkippedLines: 0 });
});

test('view: insertion at the document start shifts no line and pairs nothing', () => {
  const v = view('Titel\nDie schnelle braune Katze springt.\nEnde', 'Neue Einleitung\nTitel\nDie schnelle schwarze Katze läuft.\nEnde', { wordDiff: true });
  assert.deepEqual(unifiedForm(v), [
    '_/1 a1:Neue Einleitung',
    '1/2 e2:Titel',
    '2/_ r2:Die schnelle [-braune] Katze [-springt].',
    '_/3 a3:Die schnelle [+schwarze] Katze [+läuft].',
    '3/4 e4:Ende',
  ]);
  assert.deepEqual(splitForm(v), [
    '. | a1:Neue Einleitung',
    'e1:Titel | e2:Titel',
    'r2:Die schnelle [-braune] Katze [-springt]. | a3:Die schnelle [+schwarze] Katze [+läuft].',
    'e3:Ende | e4:Ende',
  ]);
  assert.equal(v.stats.changed, 1);
});

test('view: duplicates (earliest match, the later copy is removed)', () => {
  assert.deepEqual(unifiedForm(view('A\nA\nA\nB', 'A\nA\nB')), ['1/1 e1:A', '2/2 e2:A', '3/_ r3:A', '4/3 e3:B']);
});

test('view: moved lines keep both positions and are counted once', () => {
  const v = view('A\nB\nC\nD', 'A\nC\nD\nB', { wordDiff: true });
  assert.deepEqual(unifiedForm(v), ['1/1 e1:A', '2/_ r2:B m1>4', '3/2 e2:C', '4/3 e3:D', '_/4 a4:B m1>2']);
  assert.deepEqual(splitForm(v), ['e1:A | e1:A', 'r2:B m1>4 | .', 'e3:C | e2:C', 'e4:D | e3:D', '. | a4:B m1>2']);
  assert.deepEqual(v.stats, { unchanged: 3, removed: 0, added: 0, moved: 1, changed: 0, wordDiffSkippedLines: 0 });
});

test('view: two changed words, removed comma, punctuation change', () => {
  assert.deepEqual(splitForm(view('Die schnelle braune Katze springt.', 'Die schnelle schwarze Katze läuft.', { wordDiff: true })), [
    'r1:Die schnelle [-braune] Katze [-springt]. | a1:Die schnelle [+schwarze] Katze [+läuft].',
  ]);
  assert.deepEqual(splitForm(view('Hallo, Welt!', 'Hallo Welt!', { wordDiff: true })), ['r1:Hallo[-,] Welt! | a1:Hallo Welt!']);
  assert.deepEqual(splitForm(view('Ist das so?', 'Ist das so!', { wordDiff: true })), ['r1:Ist das so[-?] | a1:Ist das so[+!]']);
});

test('view: several changed lines in one hunk; pairs face each other, unpaired lines stay plain', () => {
  const v = view('Kapitel eins beginnt hier\nDie Katze schläft\nEnde des Kapitels', 'Die Katze träumt\nEnde des zweiten Kapitels', { wordDiff: true });
  assert.deepEqual(splitForm(v), [
    'r1:Kapitel eins beginnt hier | .',
    'r2:Die Katze [-schläft] | a1:Die Katze [+träumt]',
    'r3:Ende des Kapitels | a2:Ende des [+zweiten ]Kapitels',
  ]);
  assert.deepEqual(unifiedForm(v).slice(0, 3), ['1/_ r1:Kapitel eins beginnt hier', '2/_ r2:Die Katze [-schläft]', '3/_ r3:Ende des Kapitels']);
  assert.equal(v.stats.changed, 2);
});

test('view: unrelated lines are never paired or highlighted', () => {
  const v = view('foo bar baz\nAlphabeta.', 'eins zwei drei\nZyxwvu.', { wordDiff: true });
  assert.ok(v.unified.every((r) => !r.segments && r.pairedLine === undefined));
  assert.deepEqual(splitForm(v), ['r1:foo bar baz | a1:eins zwei drei', 'r2:Alphabeta. | a2:Zyxwvu.'], 'placed side by side in order, not compared');
});

test('view: word diff on and off show the same lines; off has no segments and no word diff counts', () => {
  const oldText = 'Die Katze schläft.\nX\nrot gelb';
  const newText = 'Die Katze träumt.\nX\nrot lila\nneu';
  const on = view(oldText, newText, { wordDiff: true });
  const off = view(oldText, newText);
  const plain = (v: DiffView) => v.unified.map((r) => `${r.kind} ${r.oldLine}/${r.newLine} ${r.text}`);
  assert.deepEqual(plain(on), plain(off));
  assert.equal(off.wordDiff, false);
  assert.ok(off.unified.every((r) => !r.segments && r.pairedLine === undefined && !r.wordDiffSkipped));
  assert.equal(off.stats.changed, 0);
  assert.equal(on.stats.changed, 2);
  assert.deepEqual({ ...on.stats, changed: 0 }, off.stats);
});

test('view: skipped word diff is marked per line and summarized', () => {
  const v = view('a b c\nd e f\ng h i', 'a b x\nd e y\ng h z', { wordDiff: true, limits: { maxPairingCells: 8 } });
  assert.ok(v.unified.filter((r) => r.kind !== 'equal').every((r) => r.wordDiffSkipped === 'hunkTooLarge' && !r.segments));
  assert.deepEqual(v.wordDiffSkips, { hunkTooLarge: 6 });
  assert.equal(v.stats.wordDiffSkippedLines, 6);
  const complex = view('a b c d e f', 'f e d c b a', { wordDiff: true, limits: { maxPairWork: 5 } });
  assert.deepEqual(splitForm(complex), ['r1:a b c d e f !tooComplex | a1:f e d c b a !tooComplex'], 'a too complex pair still faces its partner, without segments');
  assert.deepEqual(complex.wordDiffSkips, { tooComplex: 2 });
});

test('view: large diff with word diff stays complete; budget limits are visible', () => {
  const lines = Array.from({ length: 20_000 }, (_, i) => `Zeile ${i} mit einem Wort.`);
  const changed = lines.map((l, i) => (i % 3 ? l : l.replace('Wort', 'Satz')));
  const started = performance.now();
  const v = view(lines.join('\n'), changed.join('\n'), { wordDiff: true, limits: { budget: 50_000 } });
  assert.ok(performance.now() - started < 10_000);
  assert.equal(v.unified.length, 20_000 + Math.ceil(20_000 / 3));
  assert.ok(v.stats.changed > 0 && v.wordDiffSkips.budgetExceeded! > 0, JSON.stringify(v.wordDiffSkips));
  assert.equal(v.stats.changed * 2 + v.stats.wordDiffSkippedLines, 2 * Math.ceil(20_000 / 3), 'every changed line is either highlighted or listed as skipped');
});

test('view: copy text is a readable unified diff (no JSON, no markup)', () => {
  const v = view('A\nB\nC', 'A\nC\nB\nD', { wordDiff: true });
  assert.equal(formatDiffText(v), '  A\n- B\n  C\n+ B\n+ D');
  assert.equal(formatDiffText(view('', 'x\n\ny')), '+ x\n+ \n+ y');
  assert.equal(formatDiffText(view('', '')), '');
});

test('view: equal rows with ignored whitespace keep both original texts in the split view', () => {
  const v = view('  A\nB', 'A\nB  ', { ignoreWhitespace: true });
  assert.deepEqual(splitForm(v), ['e1:  A | e1:A', 'e2:B | e2:B  ']);
  assert.deepEqual(unifiedForm(v), ['1/1 e1:A', '2/2 e2:B  '], 'unified shows the new text');
});

// Every shared fixture of both engines: consistent views with and without word diff
const diffCases = JSON.parse(readFileSync(new URL('../fixtures/diff-cases.json', import.meta.url), 'utf8')).cases;
const intralineCases = JSON.parse(readFileSync(new URL('../fixtures/intraline-cases.json', import.meta.url), 'utf8')).cases;
test('view: all shared diff and word diff fixtures give consistent unified and split views', () => {
  for (const c of [...diffCases, ...intralineCases]) {
    for (const wordDiff of [false, true]) view(c.old, c.new, { wordDiff, ignoreWhitespace: c.ignoreWhitespace ?? false, limits: c.limits });
  }
});
