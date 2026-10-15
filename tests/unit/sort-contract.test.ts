// Sort contract (Paket 9, Phase B): `tests/fixtures/sort-cases.json`, JS only (Sort has no Rust implementation).
// The fixtures hold three kinds of expectations, kept apart:
//   1. current behaviour   - asserted against the real `sortText` (`current`, or `expected` where both agree),
//   2. binding target      - `expected`; checked here for consistency (lines, line format, blank lines, ICU 'de'),
//                            asserted against `sortText` from Phase C on (then `current` is removed),
//   3. open decisions      - `openDecisions`, never asserted as behaviour; only their structure and the current output.
// Findings F1-F9 refer to docs/analyse/Paket9-PhaseA-Sort-Analyse.md, the contract to Paket9-PhaseB-Sortiervertrag.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chiSquare, comparatorLawViolations, mulberry32, orderByClasses, sameMultiset, shuffled, withSeededMathRandom } from './helpers/sort-properties.ts';

const { sortText } = await import('../../src/utils/sortLines.ts');
const natsort = (await import('../../src/utils/sortNatural.ts')).default;
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
  note?: string;
  input: string;
  options: Options;
  expected: string;
  current?: string;
}
interface InvalidMethodCase {
  name: string;
  method: unknown;
  input: string;
  caseSensitive: boolean;
  expected: { error: 'invalidMode' };
  current: string;
}
interface Candidate {
  rule: string;
  expected: string | null;
  losesLine?: boolean;
}
interface OpenDecision {
  id: string;
  question: string;
  input: string;
  options: Options;
  candidates: Record<string, Candidate>;
  recommended: string | null;
  current: string | null;
}
interface PropertyCorpus {
  name: string;
  options: Options;
  classes: string[][];
  currentViolates?: string;
}

const fixtures: {
  locale: string;
  methods: string[];
  rules: Record<string, string>;
  cases: Case[];
  invalidMethods: InvalidMethodCase[];
  openDecisions: OpenDecision[];
  properties: PropertyCorpus[];
  random: { input: string; runs: number; seed: number; chiSquareCritical: number; currentChiSquareAtLeast: number };
} = JSON.parse(readFileSync(new URL('../fixtures/sort-cases.json', import.meta.url), 'utf8'));

const lines = (text: string) => splitLines(text).lines;
const isCollated = (method: string) => method.startsWith('alphabetical') || method.startsWith('natural');
const isReverse = (method: string) => method.endsWith('Reverse') || method === 'lengthDesc';
const codePoints = (line: string) => [...line].length;

/** Collator of the target contract (R2, R3; N1 adds numeric). Fixture consistency only, not a production comparator. */
const targetCollator = (caseSensitive: boolean, numeric = false) =>
  new Intl.Collator(fixtures.locale, { sensitivity: caseSensitive ? 'variant' : 'accent', numeric, ignorePunctuation: false });

/**
 * The current implementation compares with the host's default locale (F5). Its documented output is only checked if the
 * host collates these lines like the fixture locale; otherwise the test is skipped with the reason.
 */
function hostCollatesLikeFixtureLocale(input: readonly string[]): boolean {
  const reference = new Intl.Collator(fixtures.locale);
  const pairs = [...input, ...input.map((line) => line.toLowerCase())];
  return pairs.every((a) => pairs.every((b) => Math.sign(a.localeCompare(b)) === Math.sign(reference.compare(a, b))));
}
const HOST_LOCALE = new Intl.Collator().resolvedOptions().locale;

test('sort fixtures are well-formed', () => {
  assert.equal(fixtures.locale, 'de');
  assert.deepEqual(fixtures.methods, ['alphabetical', 'alphabeticalReverse', 'natural', 'naturalReverse', 'lengthAsc', 'lengthDesc', 'random']);
  const names = new Set<string>();
  for (const c of fixtures.cases) {
    assert.ok(!names.has(c.name), `duplicate case name ${c.name}`);
    names.add(c.name);
    assert.ok(fixtures.methods.includes(c.options.method) && c.options.method !== 'random', `${c.name}: deterministic method`);
    assert.equal(typeof c.options.caseSensitive, 'boolean', `${c.name}: explicit caseSensitive`);
    assert.ok(['decision', 'derived'].includes(c.basis), `${c.name}: basis`);
    assert.ok(c.rules.length > 0 && c.rules.every((r) => r in fixtures.rules), `${c.name}: known rules`);
    assert.equal(typeof c.expected, 'string', `${c.name}: full expected text`);
    if (c.current !== undefined) assert.notEqual(c.current, c.expected, `${c.name}: 'current' only where it differs`);
    if (c.icuNumeric) assert.ok(c.options.method.startsWith('natural'), `${c.name}: icuNumeric only for natural`);
  }
  for (const c of fixtures.invalidMethods) {
    assert.ok(!fixtures.methods.includes(c.method as string), `${c.name}: really invalid`);
    assert.deepEqual(c.expected, { error: 'invalidMode' }, c.name);
  }
  const ids = new Set<string>();
  for (const d of fixtures.openDecisions) {
    assert.ok(!ids.has(d.id), `duplicate open decision ${d.id}`);
    ids.add(d.id);
    const keys = Object.keys(d.candidates);
    assert.ok(keys.length >= 2, `${d.id}: at least two candidates`);
    assert.ok(d.recommended === null || keys.includes(d.recommended), `${d.id}: recommended is a candidate`);
  }
  for (const p of fixtures.properties) {
    const all = p.classes.flat();
    assert.equal(new Set(all).size, all.length, `${p.name}: every line belongs to one class`);
    assert.ok(all.every((line) => !isBlankLine(line)), `${p.name}: no blank lines (valid for the current and the target behaviour)`);
  }
});

// --- 2. Binding target: consistency of the golden data ---

for (const c of fixtures.cases) {
  test(`target is consistent: ${c.name}`, () => {
    const input = splitLines(c.input);
    const output = lines(c.expected);
    // No line lost, added or changed; joined in the line format of the input (R9)
    assert.ok(sameMultiset(output, input.lines), 'same lines as the input');
    assert.equal(joinLines(output, input), c.expected, 'line format of the input');
    // R1: blank lines after all other lines, in input order
    const firstBlank = output.findIndex(isBlankLine);
    if (firstBlank >= 0) assert.ok(output.slice(firstBlank).every(isBlankLine), 'blank lines at the end');
    assert.deepEqual(output.filter(isBlankLine), input.lines.filter(isBlankLine), 'blank lines in input order');

    const data = input.lines.filter((line) => !isBlankLine(line));
    const direction = isReverse(c.options.method) ? -1 : 1;
    let reference: ((a: string, b: string) => number) | undefined;
    if (c.options.method.startsWith('alphabetical')) reference = targetCollator(c.options.caseSensitive).compare;
    if (c.icuNumeric) reference = targetCollator(c.options.caseSensitive, true).compare;
    if (c.options.method.startsWith('length')) reference = (a, b) => codePoints(a) - codePoints(b);
    if (reference) {
      const compare = reference;
      const sorted = [...data].sort((a, b) => direction * compare(a, b));
      assert.deepEqual(output.filter((line) => !isBlankLine(line)), sorted, `order of the non-blank lines (${fixtures.locale}, stable)`);
    }
  });
}

// --- 1. Current behaviour of the real sortText ---

for (const c of fixtures.cases) {
  const label = c.current === undefined ? 'current = target' : `current differs (${c.finding ?? c.rules.join(', ')})`;
  test(`current: ${c.name} [${label}]`, (t) => {
    if (isCollated(c.options.method) && !hostCollatesLikeFixtureLocale(lines(c.input))) {
      t.skip(`host locale ${HOST_LOCALE} collates differently from '${fixtures.locale}' (F5)`);
      return;
    }
    assert.equal(sortText(c.input, c.options.method as never, c.options.caseSensitive), c.current ?? c.expected);
  });
}

// F9 / R8: unknown methods are silently accepted today (target: { error: 'invalidMode' })
for (const c of fixtures.invalidMethods) {
  test(`current: invalid method is accepted silently (F9): ${c.name}`, () => {
    assert.equal(sortText(c.input, c.method as never, c.caseSensitive), c.current);
  });
}

// --- 3. Open decisions: structure and current output, never asserted as target ---

for (const d of fixtures.openDecisions) {
  test(`open decision ${d.id}: candidates are complete, current output documented`, (t) => {
    const input = lines(d.input);
    for (const [key, candidate] of Object.entries(d.candidates)) {
      assert.ok(candidate.rule.length > 0, `${key}: rule`);
      if (candidate.expected === null) {
        assert.equal(d.options.method, 'random', `${key}: only random has no golden result`);
        continue;
      }
      if (candidate.losesLine) assert.equal(lines(candidate.expected).length, input.length - 1, `${key}: loses exactly one line`);
      else assert.ok(sameMultiset(lines(candidate.expected), input), `${key}: same lines as the input`);
    }
    if (d.current === null) return;
    if (!hostCollatesLikeFixtureLocale(input)) {
      t.skip(`host locale ${HOST_LOCALE} collates differently from '${fixtures.locale}' (F5)`);
      return;
    }
    assert.equal(sortText(d.input, d.options.method as never, d.options.caseSensitive), d.current);
  });
}

// --- Properties: seeded permutations of equivalence-class corpora ---

const PERMUTATIONS = 40;

for (const p of fixtures.properties) {
  const corpus = p.classes.flat();
  const run = (seed: number) => {
    const input = shuffled(corpus, mulberry32(seed));
    const actual = lines(sortText(input.join('\n'), p.options.method as never, p.options.caseSensitive));
    return { input, actual, expected: orderByClasses(p.classes, input) };
  };

  test(`property corpus is consistent with the target: ${p.name}`, () => {
    const direction = isReverse(p.options.method) ? -1 : 1;
    let compare: ((a: string, b: string) => number) | undefined;
    if (p.options.method.startsWith('alphabetical')) compare = targetCollator(p.options.caseSensitive).compare;
    if (p.options.method.startsWith('natural') && corpus.every((line) => !/[-.]/.test(line))) {
      compare = targetCollator(p.options.caseSensitive, true).compare;
    }
    if (p.options.method.startsWith('length')) compare = (a, b) => codePoints(a) - codePoints(b);
    if (!compare) return; // signed and decimal numbers (N2, N3): no reference, the classes are written by hand
    p.classes.forEach((left, i) =>
      p.classes.forEach((right, j) => {
        for (const a of left) for (const b of right) {
          // `|| 0`: a reversed tie is -0
          assert.equal(Math.sign(direction * compare(a, b)) || 0, Math.sign(i - j), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
      })
    );
  });

  test(`property (current): ${p.name}${p.currentViolates ? ` violates the target (${p.currentViolates})` : ''}`, (t) => {
    if (isCollated(p.options.method) && !hostCollatesLikeFixtureLocale(corpus)) {
      t.skip(`host locale ${HOST_LOCALE} collates differently from '${fixtures.locale}' (F5)`);
      return;
    }
    let mismatches = 0;
    for (let seed = 1; seed <= PERMUTATIONS; seed++) {
      const { input, actual, expected } = run(seed);
      // Never violated, also not today: no line lost, added or changed
      assert.ok(sameMultiset(actual, input), `seed ${seed}: same lines`);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches++;
      else if (!p.currentViolates) {
        // Deterministic and idempotent: sorting the result again changes nothing
        const again = lines(sortText(actual.join('\n'), p.options.method as never, p.options.caseSensitive));
        assert.deepEqual(again, actual, `seed ${seed}: idempotent`);
      }
    }
    if (p.currentViolates) assert.ok(mismatches > 0, `documented violation ${p.currentViolates} no longer reproduces`);
    else assert.equal(mismatches, 0, 'classes in order, ties in input order, for every input order');
  });
}

// --- Findings of Phase A, reproduced ---

test('F1: the current natural comparator (case-sensitive) is not transitive: a, B, ä form a cycle', () => {
  const cmp = natsort({});
  assert.ok(cmp('a', 'B') > 0 && cmp('B', 'ä') > 0 && cmp('a', 'ä') < 0, 'B < a, ä < B, but a < ä');
  const laws = comparatorLawViolations(cmp, ['a', 'B', 'ä']);
  assert.ok(laws.transitivity.length > 0, 'transitivity violated');
  // The result depends on the input order (target for all orders: a, ä, B)
  assert.equal(sortText('a\nB\nä', 'natural', true), 'ä\nB\na');
  assert.equal(sortText('a\nä\nB', 'natural', true), 'a\nä\nB');
});

test('F1: without dates, the current natural comparator ignoring case keeps the comparator laws', () => {
  const corpus = fixtures.properties.find((p) => p.name === 'natural CI')!.classes.flat();
  assert.deepEqual(comparatorLawViolations(natsort({ insensitive: true }), corpus), { antisymmetry: [], transitivity: [] });
});

test('F2: the date detection of the current natural comparator is asymmetric (V8 Date.parse)', () => {
  const cmp = natsort({ insensitive: true });
  // Both directions say "smaller": antisymmetry violated
  assert.ok(cmp('2020-01-01', 'Jan 1, 2020') < 0 && cmp('Jan 1, 2020', '2020-01-01') < 0);
  assert.ok(comparatorLawViolations(cmp, ['2020-01-01', 'Jan 1, 2020']).antisymmetry.length > 0);
  // Every input order is swapped
  assert.equal(sortText('2020-01-01\nJan 1, 2020', 'natural', false), 'Jan 1, 2020\n2020-01-01');
  assert.equal(sortText('Jan 1, 2020\n2020-01-01', 'natural', false), '2020-01-01\nJan 1, 2020');
});

test('F3: the current shuffle is biased (seeded Math.random, chi-square far above the critical value)', () => {
  const { input, runs, seed, chiSquareCritical, currentChiSquareAtLeast } = fixtures.random;
  const counts = new Map<string, number>();
  withSeededMathRandom(seed, () => {
    for (let i = 0; i < runs; i++) {
      const result = sortText(input, 'random', true);
      // Every run keeps all lines and the line format
      assert.ok(sameMultiset(lines(result), lines(input)));
      counts.set(result, (counts.get(result) ?? 0) + 1);
    }
  });
  const observed = [...counts.values()];
  while (observed.length < 6) observed.push(0); // permutations that never occurred
  const statistic = chiSquare(observed);
  assert.ok(statistic > chiSquareCritical, `chi-square ${statistic.toFixed(1)}`);
  assert.ok(statistic >= currentChiSquareAtLeast, `documented bias: chi-square ${statistic.toFixed(1)} (${JSON.stringify(Object.fromEntries(counts))})`);
});

test('F3: the seeded test shuffle itself is uniform (reference for Phase C)', () => {
  const { runs, seed, chiSquareCritical } = fixtures.random;
  const random = mulberry32(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const key = shuffled(['a', 'b', 'c'], random).join('');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  assert.ok(chiSquare([...counts.values()]) < chiSquareCritical, `chi-square ${chiSquare([...counts.values()]).toFixed(1)}`);
});

test(`F5: alphabetical follows the host locale (${HOST_LOCALE}), not a fixed locale`, () => {
  // The rules really differ between locales (ICU data): Swedish sorts ä after z
  assert.ok(new Intl.Collator('de').compare('ä', 'z') < 0);
  assert.ok(new Intl.Collator('sv').compare('ä', 'z') > 0);
  // The current result equals a stable sort with the host's default collator, whatever that is
  const sample = ['z', 'ä', 'a', 'ö', 'o', 'y', 'ü', 'u', 'å', 'ı', 'i', 'I', 'İ', 'ch', 'c', 'h'];
  const host = new Intl.Collator();
  assert.equal(sortText(sample.join('\n'), 'alphabetical', true), [...sample].sort(host.compare).join('\n'));
});
