// Sort contract (Paket 9): `tests/fixtures/sort-cases.json`, JS only (Sort has no Rust implementation).
// Phase B wrote the target by hand, Phase C1 implemented it (src/utils/sortLines.ts, src/utils/sort/). Checked here:
//   - every golden case against the real sortText, plus the consistency of the golden data itself (same lines, line
//     format, blank lines at the end, order against Intl.Collator('de') / code points where that is the reference),
//   - the comparator laws (antisymmetry, transitivity) of every order on a corpus of critical lines,
//   - property corpora: seeded permutations give the classes in order, ties in input order, idempotent results,
//   - the shuffle (Fisher-Yates) with a seeded random source and a chi-square test,
//   - invalid methods (invalidMode) and the regressions F1, F2, F5 of the Phase A report.
// Contract: docs/analyse/Paket9-PhaseB-Sortiervertrag.md.
import './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chiSquare, comparatorLawViolations, mulberry32, orderByClasses, sameMultiset, shuffled } from './helpers/sort-properties.ts';

const { sortText, assertSortMethod, shuffleLines, SORT_METHODS } = await import('../../src/utils/sortLines.ts');
const { lineOrder, codePointLength } = await import('../../src/utils/sort/compare.ts');
const { naturalTokens } = await import('../../src/utils/sort/naturalKey.ts');
const { ProcessingError, ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { splitLines, joinLines } = await import('../../src/utils/lines.ts');
const { isBlankLine } = await import('../../src/utils/diff/whitespace.ts');

// --- Fixture format ---

interface Options {
  method: string;
  caseSensitive: boolean;
}
interface Case {
  name: string;
  basis: 'decision' | 'derived';
  rules: string[];
  finding?: string;
  icuNumeric?: boolean;
  resolved?: string;
  note?: string;
  input: string;
  options: Options;
  expected: string;
}
interface InvalidMethodCase {
  name: string;
  method: unknown;
  input: string;
  caseSensitive: boolean;
  expected: { error: 'invalidMode' };
}
interface PropertyCorpus {
  name: string;
  options: Options;
  classes: string[][];
}

const fixtures: {
  locale: string;
  methods: string[];
  rules: Record<string, string>;
  cases: Case[];
  invalidMethods: InvalidMethodCase[];
  properties: PropertyCorpus[];
  random: { input: string; runs: number; seed: number; chiSquareCritical: number; blankLinesInput: string };
} = JSON.parse(readFileSync(new URL('../fixtures/sort-cases.json', import.meta.url), 'utf8'));

const CASE_KEYS = ['name', 'basis', 'rules', 'finding', 'icuNumeric', 'resolved', 'note', 'input', 'options', 'expected'];
const lines = (text: string) => splitLines(text).lines;
const run = (input: string, options: Options) => sortText(input, options.method as never, options.caseSensitive);
const isReverse = (method: string) => method.endsWith('Reverse') || method === 'lengthDesc';

/** Collator of the contract (R2, R3; numeric for the icuNumeric cases). Fixture consistency only. */
const referenceCollator = (caseSensitive: boolean, numeric = false) =>
  new Intl.Collator(fixtures.locale, { sensitivity: caseSensitive ? 'variant' : 'accent', numeric, ignorePunctuation: false });

/** Line format of a result: the input format; a trailing newline is added if the last line is empty (R9, OD-8 B). */
function resultFormat(input: string, output: readonly string[]) {
  const { lineEnding, trailingNewline } = splitLines(input);
  return { lineEnding, trailingNewline: trailingNewline || output[output.length - 1] === '' };
}

test('sort fixtures are well-formed', () => {
  assert.equal(fixtures.locale, 'de');
  // (this argument order: deepEqual would narrow the type of its first argument, fixtures.methods)
  assert.deepEqual([...SORT_METHODS], fixtures.methods);
  const names = new Set<string>();
  for (const c of fixtures.cases) {
    assert.ok(!names.has(c.name), `duplicate case name ${c.name}`);
    names.add(c.name);
    assert.deepEqual(Object.keys(c).filter((key) => !CASE_KEYS.includes(key)), [], `${c.name}: unknown keys (Phase B 'current' is gone)`);
    assert.ok(fixtures.methods.includes(c.options.method) && c.options.method !== 'random', `${c.name}: deterministic method`);
    assert.equal(typeof c.options.caseSensitive, 'boolean', `${c.name}: explicit caseSensitive`);
    assert.ok(['decision', 'derived'].includes(c.basis), `${c.name}: basis`);
    assert.ok(c.rules.length > 0 && c.rules.every((r) => r in fixtures.rules), `${c.name}: known rules`);
    assert.equal(typeof c.expected, 'string', `${c.name}: full expected text`);
    if (c.icuNumeric) assert.ok(c.options.method.startsWith('natural'), `${c.name}: icuNumeric only for natural`);
  }
  for (const c of fixtures.invalidMethods) {
    assert.ok(!fixtures.methods.includes(c.method as string), `${c.name}: really invalid`);
    assert.deepEqual(c.expected, { error: 'invalidMode' }, c.name);
  }
  for (const p of fixtures.properties) {
    const all = p.classes.flat();
    assert.equal(new Set(all).size, all.length, `${p.name}: every line belongs to one class`);
    assert.ok(all.every((line) => !isBlankLine(line)), `${p.name}: no blank lines`);
  }
});

// --- Golden cases ---

for (const c of fixtures.cases) {
  test(`sort: ${c.name}`, () => {
    const actual = run(c.input, c.options);
    assert.equal(actual, c.expected);
    // Sorting the result again changes nothing (stable order, blank lines already at the end)
    assert.equal(run(actual, c.options), actual, 'idempotent');
  });

  test(`golden data is consistent: ${c.name}`, () => {
    const input = lines(c.input);
    const output = lines(c.expected);
    // No line lost, added or changed; joined in the line format of the input (R9, OD-8 B)
    assert.ok(sameMultiset(output, input), 'same lines as the input');
    assert.equal(joinLines(output, resultFormat(c.input, output)), c.expected, 'line format');
    // R1: blank lines after all other lines, in input order
    const firstBlank = output.findIndex(isBlankLine);
    if (firstBlank >= 0) assert.ok(output.slice(firstBlank).every(isBlankLine), 'blank lines at the end');
    assert.deepEqual(output.filter(isBlankLine), input.filter(isBlankLine), 'blank lines in input order');

    let reference: ((a: string, b: string) => number) | undefined;
    if (c.options.method.startsWith('alphabetical')) reference = referenceCollator(c.options.caseSensitive).compare;
    if (c.icuNumeric) reference = referenceCollator(c.options.caseSensitive, true).compare;
    if (c.options.method.startsWith('length')) reference = (a, b) => [...a].length - [...b].length;
    if (reference) {
      const compare = reference;
      const direction = isReverse(c.options.method) ? -1 : 1;
      const sorted = input.filter((line) => !isBlankLine(line)).sort((a, b) => direction * compare(a, b));
      assert.deepEqual(output.filter((line) => !isBlankLine(line)), sorted, `order (${fixtures.locale}, stable)`);
    }
  });
}

// --- Invalid methods (R8) ---

for (const c of fixtures.invalidMethods) {
  test(`invalid method is refused: ${c.name}`, () => {
    assert.throws(
      () => sortText(c.input, c.method as never, c.caseSensitive),
      (error: unknown) => error instanceof ProcessingError && error.kind === 'invalidInput' && error.message === ERROR_KEYS.invalidMode
    );
  });
}

test('every listed method is accepted, exactly as written', () => {
  for (const method of SORT_METHODS) assert.doesNotThrow(() => assertSortMethod(method));
  for (const method of [undefined, 0, {}, 'ALPHABETICAL', ' random', 'lengthasc']) assert.throws(() => assertSortMethod(method), ProcessingError);
});

// --- Comparator laws ---

/** Critical lines: case, accents, ß, NFC/NFD, ignorables, signs, decimals, spellings, hex, dates, big numbers, digits. */
const LAW_CORPUS = [
  'a', 'A', 'ä', 'Ä', 'b', 'B', 'B2', 'b10', 'a1', 'a-', 'a-5', 'a -5', 'a 5', 'a 05', 'a 5.0', 'x(3)', 'x(-5)', '-', '-0', '0', '00',
  '01', '1', '1.0', '1.00', '1.10', '1.2', '1.2.10', '-1.5', '-1', '-10', '+5', '−5', ' 2', ' 10', '9', '0x1F', '0x2', '0xA',
  '1e5', '2020-12-01', '2020-02-10', 'Jan 1, 2020', 'Datei-2', 'Datei-10', 'Datei2', 'v1.2', 'v1.10', 'Preis 1.125', 'Preis 1.25',
  'ß', 'ss', 'SS', 'ẞ', 'é', 'é', 'É', '😀', '中', '﻿', '​', 'a​1', '０', 'a０', 'ab', 'a b',
  'a_1', 'a.1', '20000000000000000001', '20000000000000000000', '0.30000000000000000001', '0.3', '٣', 'a٣', 'Apfel 2', 'Äpfel 1',
];

for (const kind of ['alphabetical', 'natural', 'length'] as const) {
  for (const caseSensitive of [true, false]) {
    test(`comparator laws: ${kind} ${caseSensitive ? 'CS' : 'CI'} is antisymmetric and transitive`, () => {
      const order = lineOrder(kind, caseSensitive);
      const keys = new Map(LAW_CORPUS.map((line) => [line, order.key(line)]));
      const compare = (a: string, b: string) => order.compare(keys.get(a), keys.get(b));
      assert.deepEqual(comparatorLawViolations(compare, LAW_CORPUS), { antisymmetry: [], transitivity: [] });
      // Deterministic: the same keys give the same result
      for (const a of LAW_CORPUS) assert.equal(compare(a, a), 0);
    });
  }
}

test('comparator laws: antisymmetry on every line of the golden cases (pairs)', () => {
  const corpus = [...new Set(fixtures.cases.flatMap((c) => lines(c.input)))];
  for (const kind of ['alphabetical', 'natural', 'length'] as const) {
    for (const caseSensitive of [true, false]) {
      const order = lineOrder(kind, caseSensitive);
      const keys = corpus.map((line) => order.key(line));
      for (let i = 0; i < corpus.length; i++) {
        for (let j = 0; j < corpus.length; j++) {
          const forward = Math.sign(order.compare(keys[i], keys[j]));
          assert.equal(forward, -Math.sign(order.compare(keys[j], keys[i])) || 0, `${kind}: ${JSON.stringify(corpus[i])} vs ${JSON.stringify(corpus[j])}`);
        }
      }
    }
  }
});

test('natural tokens: signs, decimals and digit runs', () => {
  const num = (sign: number, int: string, frac = '') => ({ sign, int, frac });
  assert.deepEqual(naturalTokens('-2.50'), [num(-1, '2', '5')]);
  assert.deepEqual(naturalTokens('Preis 1.125'), ['Preis 0', num(1, '1', '125')]);
  assert.deepEqual(naturalTokens('v1.10'), ['v0', num(1, '1'), '.0', num(1, '10')]);
  assert.deepEqual(naturalTokens('1.2.10'), [num(1, '1'), '.0', num(1, '2'), '.0', num(1, '10')]);
  assert.deepEqual(naturalTokens('Datei-2'), ['Datei-0', num(1, '2')]);
  assert.deepEqual(naturalTokens('x -5'), ['x 0', num(-1, '5')]);
  assert.deepEqual(naturalTokens('-0'), [num(0, '')]);
  assert.deepEqual(naturalTokens('007.500'), [num(1, '7', '5')]);
  assert.deepEqual(naturalTokens('1.'), [num(1, '1'), '.']);
  assert.deepEqual(naturalTokens('.5'), ['.0', num(1, '5')]);
  assert.deepEqual(naturalTokens('0x1F'), [num(0, ''), 'x0', num(1, '1'), 'F']);
  assert.deepEqual(naturalTokens('−5'), ['−0', num(1, '5')]);
});

test('code point length', () => {
  assert.equal(codePointLength('😀'), 1);
  assert.equal(codePointLength('a😀b'), 3);
  assert.equal(codePointLength('é'), 2);
  assert.equal(codePointLength('\ud800'), 1);
  assert.equal(codePointLength('\ud800\ud800'), 2);
  assert.equal(codePointLength('\udc00\ud800'), 2);
  assert.equal(codePointLength(''), 0);
});

// --- Properties: seeded permutations of equivalence-class corpora ---

const PERMUTATIONS = 40;

for (const p of fixtures.properties) {
  const corpus = p.classes.flat();

  test(`property corpus is consistent with the reference order: ${p.name}`, () => {
    const direction = isReverse(p.options.method) ? -1 : 1;
    let compare: ((a: string, b: string) => number) | undefined;
    if (p.options.method.startsWith('alphabetical')) compare = referenceCollator(p.options.caseSensitive).compare;
    if (p.options.method.startsWith('natural') && corpus.every((line) => !/[-.]/.test(line))) {
      compare = referenceCollator(p.options.caseSensitive, true).compare;
    }
    if (p.options.method.startsWith('length')) compare = (a, b) => [...a].length - [...b].length;
    if (!compare) return; // signs and decimals (N2, N3): no reference, the classes are written by hand
    p.classes.forEach((left, i) =>
      p.classes.forEach((right, j) => {
        for (const a of left) for (const b of right) {
          // `|| 0`: a reversed tie is -0
          assert.equal(Math.sign(direction * compare(a, b)) || 0, Math.sign(i - j), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
      })
    );
  });

  test(`property: ${p.name} (classes in order, ties in input order, any input order)`, () => {
    for (let seed = 1; seed <= PERMUTATIONS; seed++) {
      const input = shuffled(corpus, mulberry32(seed));
      const actual = lines(run(input.join('\n'), p.options));
      assert.ok(sameMultiset(actual, input), `seed ${seed}: same lines`);
      assert.deepEqual(actual, orderByClasses(p.classes, input), `seed ${seed}`);
      assert.deepEqual(lines(run(actual.join('\n'), p.options)), actual, `seed ${seed}: idempotent`);
    }
  });
}

// --- Shuffle (Fisher-Yates, R1 for blank lines) ---

test('random: uniform with a seeded source (chi-square below the 0.999 quantile)', () => {
  const { input, runs, seed, chiSquareCritical } = fixtures.random;
  const random = mulberry32(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const result = sortText(input, 'random', true, { random });
    assert.ok(sameMultiset(lines(result), lines(input)), 'no line lost or duplicated');
    counts.set(result, (counts.get(result) ?? 0) + 1);
  }
  assert.equal(counts.size, 6, 'every permutation occurs');
  const statistic = chiSquare([...counts.values()]);
  assert.ok(statistic < chiSquareCritical, `chi-square ${statistic.toFixed(1)} (${JSON.stringify(Object.fromEntries(counts))})`);
});

test('random: every line is equally likely at every position (10 lines, chi-square per position)', () => {
  const input = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const random = mulberry32(7);
  const positions = input.map(() => Array<number>(10).fill(0));
  for (let i = 0; i < 20000; i++) {
    lines(sortText(input.join('\n'), 'random', false, { random })).forEach((line, position) => positions[input.indexOf(line)][position]++);
  }
  // 9 degrees of freedom: 0.999 quantile 27.877
  for (const counts of positions) assert.ok(chiSquare(counts) < 27.877, `chi-square ${chiSquare(counts).toFixed(1)}: ${counts}`);
});

test('random: the same seed gives the same order, blank lines stay at the end in input order', () => {
  const { blankLinesInput } = fixtures.random;
  const input = splitLines(blankLinesInput).lines;
  const blank = input.filter(isBlankLine);
  const results = new Set<string>();
  for (let seed = 1; seed <= 50; seed++) {
    const result = sortText(blankLinesInput, 'random', true, { random: mulberry32(seed) });
    assert.equal(result, sortText(blankLinesInput, 'random', true, { random: mulberry32(seed) }), 'reproducible');
    const output = lines(result);
    assert.ok(sameMultiset(output, input));
    assert.deepEqual(output.slice(-blank.length), blank, 'blank lines at the end');
    results.add(result);
  }
  assert.equal(results.size, 6, 'the three data lines are shuffled');
});

test('random: default source, line format and no mutation of the input', () => {
  const sorted = sortText('a\r\nb\r\n\r\nc\r\n', 'random', true);
  assert.ok(sorted.endsWith('\r\n\r\n'), 'empty line at the end, CRLF kept');
  assert.deepEqual(lines(sorted).slice(0, 3).sort(), ['a', 'b', 'c']);
  const data = ['x', 'y', 'z'];
  shuffleLines(data, mulberry32(1));
  assert.deepEqual(data, ['x', 'y', 'z']);
  // A random source returning 1 (out of range) must not lose a line
  assert.deepEqual([...shuffleLines(data, () => 1)].sort(), data);
});

// --- Regressions of the Phase A findings ---

test('F1: natural case-sensitive gives a, ä, B for every input order', () => {
  for (const order of [['a', 'B', 'ä'], ['a', 'ä', 'B'], ['B', 'a', 'ä'], ['B', 'ä', 'a'], ['ä', 'a', 'B'], ['ä', 'B', 'a']]) {
    assert.equal(sortText(order.join('\n'), 'natural', true), 'a\nä\nB', order.join(','));
  }
});

test('F2: no date interpretation, the order does not depend on the input order', () => {
  assert.equal(sortText('2020-01-01\nJan 1, 2020', 'natural', false), '2020-01-01\nJan 1, 2020');
  assert.equal(sortText('Jan 1, 2020\n2020-01-01', 'natural', false), '2020-01-01\nJan 1, 2020');
});

test(`F5: alphabetical uses the locale 'de', not the host locale (${new Intl.Collator().resolvedOptions().locale})`, () => {
  assert.ok(new Intl.Collator('sv').compare('ä', 'z') > 0, 'locales really differ (ICU data)');
  const sample = ['z', 'ä', 'a', 'ö', 'o', 'y', 'ü', 'u', 'å', 'ı', 'i', 'I', 'İ', 'ch', 'c', 'h'];
  assert.equal(sortText(sample.join('\n'), 'alphabetical', true), [...sample].sort(new Intl.Collator('de').compare).join('\n'));
});
