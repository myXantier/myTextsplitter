// Surrogate guard of the JS Filter (Paket 8 C1): `matchesWithoutCutCharacters` (src/utils/regex.ts) and the real
// FilterWorker module. The guard is a generator that checks every match when it is produced and keeps only the previous
// match end and one open cut (no list of matches); the Filter remove mode drains it and then uses the native `replace`.
// The memory behaviour is documented and measured separately (no timing or memory limits in unit tests).
import { installWindow } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { matchesWithoutCutCharacters } = await import('../../src/utils/regex.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
installWindow();

const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
await import('../../src/workers/FilterWorker.ts');
const filterWorker: (event: { data: unknown }) => void = g.self.onmessage;

const CUT = ERROR_KEYS.regexSplitsCharacter;

/** Filter result text, or the error message key. */
function filter(input: string, pattern: string, mode: 'keep' | 'remove', splitMatches: boolean): string | { error: string } {
  posted = [];
  filterWorker({ data: { args: { sourceText: input, mainParam: pattern, configParams: { caseSensitive: true, filterMode: mode, splitMatches } } } });
  assert.equal(posted.length, 1, 'exactly one worker message');
  const [message] = posted;
  if (!message.success) {
    assert.equal(message.errorKind, 'invalidInput');
    assert.equal(message.result, null, 'no partial result');
    return { error: message.error };
  }
  assert.ok(message.result.result.isWellFormed(), 'a successful result is well-formed Unicode');
  return message.result.result;
}

/** Matches of the guard as [start, text], or the error message key. */
function guard(text: string, pattern: string, adjacentMatchesStayJoined: boolean): [number, string][] | { error: string } {
  try {
    return Array.from(matchesWithoutCutCharacters(text, new RegExp(pattern, 'g'), adjacentMatchesStayJoined), (m) => [m.index!, m[0]]);
  } catch (error: any) {
    return { error: error.message };
  }
}

// 1. One emoji and very many harmless ASCII matches
test('guard: one emoji and many ASCII matches is no cut, same result as without the guard', () => {
  const line = '😀' + 'ab'.repeat(100_000);
  assert.equal(filter(line, 'a', 'remove', false), line.replace(/a/g, ''));
  assert.equal(filter(line, 'a', 'keep', false), 'a'.repeat(100_000));
  assert.equal(filter(`${line}\r\n${line}`, 'b', 'remove', false), `😀${'a'.repeat(100_000)}\r\n😀${'a'.repeat(100_000)}`);
});

test('guard: the check is a lazy iterator, not a list of matches', () => {
  const iterator = matchesWithoutCutCharacters('😀' + 'a'.repeat(1000), /a/g, true);
  assert.equal(Array.isArray(iterator), false);
  assert.equal(typeof iterator.next, 'function');
  assert.deepEqual([iterator.next().value?.index, iterator.next().value?.index], [2, 3], 'matches are produced one by one');
});

// 2. Many directly adjacent matches that together cover surrogate pairs
test('guard: many adjacent matches that together cover every pair', () => {
  const line = '😀x😃🎉'.repeat(2_000);
  assert.equal(filter(line, '.', 'keep', false), line, 'joined again without split');
  assert.equal(filter(line, '.', 'remove', false), '', 'both halves of every pair removed');
  assert.deepEqual(filter(line, '.', 'keep', true), { error: CUT }, 'split matches separate the halves');
});

// 3. Only one half of a pair is matched
test('guard: only one half of a pair matched', () => {
  for (const half of ['\\uD83D', '\\uDE00']) {
    assert.deepEqual(filter('a😀b', half, 'keep', false), { error: CUT }, `keep ${half}`);
    assert.deepEqual(filter('a😀b', half, 'remove', false), { error: CUT }, `remove ${half}`);
  }
  assert.deepEqual(guard('😀', '\\uDE00', true), { error: CUT });
});

// 4. Both halves removed (by adjacent matches or one match)
test('guard: both halves of a pair removed', () => {
  assert.equal(filter('a😀b', '[\\uD83D\\uDE00]', 'remove', false), 'ab', 'two adjacent matches');
  assert.equal(filter('a😀b', '\\uD83D\\uDE00', 'remove', false), 'ab', 'one match');
  assert.equal(filter('a😀b', '[^ab]', 'remove', false), 'ab');
});

// 5. Keep with and without split matches
test('guard: keep with and without split matches', () => {
  assert.equal(filter('a😀b', '[^ab]', 'keep', false), '😀');
  assert.deepEqual(filter('a😀b', '[^ab]', 'keep', true), { error: CUT });
  assert.equal(filter('a😀b😃', '😀|😃', 'keep', true), '😀\n😃', 'whole emoji as matches');
  assert.deepEqual(guard('😀', '.', true), [[0, '\uD83D'], [1, '\uDE00']]);
  assert.deepEqual(guard('😀', '.', false), { error: CUT });
});

// 6. Adjacent non-empty matches together with zero-width matches
test('guard: zero-width matches next to adjacent non-empty matches', () => {
  // Zero-width match after the emoji: the halves stay joined
  assert.deepEqual(guard('😀', '.|(?=$)', true), [[0, '\uD83D'], [1, '\uDE00'], [2, '']]);
  assert.equal(filter('😀', '.|(?=$)', 'keep', false), '😀');
  assert.equal(filter('a😀', '.|(?=$)', 'remove', false), '');
  // Zero-width match between the halves: the regex skips the low half, the next match does not continue at the cut
  assert.deepEqual(guard('😀', '\\uD83D|(?=\\uDE00)', true), { error: CUT });
  assert.deepEqual(filter('😀', '\\uD83D|(?=\\uDE00)', 'keep', false), { error: CUT });
  // Zero-width match before the low half: the high half is not matched at all
  assert.deepEqual(guard('a😀', '(?=\\uD83D\\uDE00)|.', true), { error: CUT });
  // Empty matches alone cut nothing
  assert.deepEqual(guard('😀', 'x*', false), [[0, ''], [1, ''], [2, '']]);
  assert.equal(filter('😀a', 'x*', 'remove', false), '😀a');
});

// 7. Non-adjacent matches and wrong recombination of halves
test('guard: non-adjacent matches cannot recombine halves of different characters', () => {
  assert.deepEqual(guard('😀😃', '^.|.$', true), { error: CUT });
  assert.deepEqual(filter('😀😃', '^.|.$', 'keep', false), { error: CUT });
  // Removing the low half of 😀 and the high half of 😃 would join 😀's high and 😃's low half
  assert.deepEqual(filter('😀😃', '\\uDE00\\uD83D', 'remove', false), { error: CUT });
});

// 8. Error at the end of the match sequence
test('guard: an open cut after the last match fails at the end, after all matches were produced', () => {
  const produced: number[] = [];
  assert.throws(() => {
    for (const match of matchesWithoutCutCharacters('ab😀', /[ab]|\uD83D/g, true)) produced.push(match.index!);
  }, (error: any) => error.message === CUT);
  assert.deepEqual(produced, [0, 1, 2], 'the error comes when the matches end, not earlier');
  assert.deepEqual(filter('ok\nab😀', '[ab]|\\uD83D', 'keep', false), { error: CUT }, 'the whole job fails, the first line is not delivered');
  assert.deepEqual(filter('ab😀', '[ab]|\\uD83D', 'remove', false), { error: CUT });
});

// 9. CRLF
test('guard: CRLF input', () => {
  assert.equal(filter('😀a\r\nb😃\r\n', '[ab]', 'remove', false), '😀\r\n😃\r\n');
  assert.equal(filter('😀a\r\nb😃\r\n', '.', 'keep', false), '😀a\r\nb😃\r\n');
  assert.deepEqual(filter('😀a\r\nb😃\r\n', '.', 'keep', true), { error: CUT });
  assert.equal(filter('😀a\r\nb😃\r\n', '😀|😃', 'keep', true), '😀\r\n😃\r\n');
});

// 10. Inputs without surrogates behave exactly like the plain regex operations
test('guard: inputs without surrogates give the plain replace/matchAll results', () => {
  const lines = ['abc abc', 'Grüße 1, 2 und 33', 'x', '  a b  ', 'äöü ß', 'aaa'];
  for (const pattern of ['a', '\\d+', 'x*', '\\b', '(?=b)', '[^a]', '\\s+', '.']) {
    const regex = new RegExp(pattern, 'g');
    for (const line of lines) {
      const removed = line.replace(regex, '');
      const kept = Array.from(line.matchAll(regex), (m) => m[0]);
      // One non-blank line: an empty remainder drops the line, which is the empty text as well
      assert.equal(filter(line, pattern, 'remove', false), removed, `remove ${pattern} on ${line}`);
      assert.equal(filter(line, pattern, 'keep', false), kept.join(''), `keep ${pattern} on ${line}`);
      assert.equal(filter(line, pattern, 'keep', true), kept.length ? kept.join('\n') : '', `keep split ${pattern} on ${line}`);
      assert.deepEqual(guard(line, pattern, false), Array.from(line.matchAll(regex), (m) => [m.index, m[0]]), `guard ${pattern} on ${line}`);
    }
  }
});

test('guard: lone surrogates already in the input are no cut (not newly damaged)', () => {
  assert.deepEqual(guard('\uD83Dx\uDE00', '[x\\uD83D\\uDE00]', false), [[0, '\uD83D'], [1, 'x'], [2, '\uDE00']]);
  // A valid pair next to a lone half is still protected
  assert.deepEqual(guard('\uDE00😀', '.', false), { error: CUT });
});
