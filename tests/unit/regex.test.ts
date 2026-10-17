// JS regex helpers and their error messages (Paket 5): validation in the native RegExp dialect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installWindow } from './helpers/setup.ts';

const { compileUserRegex, hasValidPatternLength, validateRegexPattern, MAX_PATTERN_LENGTH } = await import('../../src/utils/regex.ts');
const { ProcessingError, processingErrorMessage, ERROR_KEYS, isSuperseded } = await import('../../src/services/ProcessingError.ts');
const { buildMatchPreview, PREVIEW_LIMITS } = await import('../../src/utils/matchPreview.ts');
const { splitLines } = await import('../../src/utils/lines.ts');

installWindow();

test('compileUserRegex: valid patterns incl. lookbehind, lookahead, named groups and backreferences', () => {
  for (const pattern of ['(?<=\\$)\\d+', '(?<!\\\\),', '\\w+(?=:)', '\\d+(?!%)', '(?<year>\\d{4})', '(\\w)\\1', '(?<c>a)\\k<c>', '(?<=a+)b']) {
    assert.ok(compileUserRegex(pattern, 'g') instanceof RegExp, pattern);
  }
  const regex = compileUserRegex('a', 'gi');
  assert.equal(regex.flags, 'gi');
});

test('compileUserRegex: invalid JS patterns are invalid-input errors with the engine message', () => {
  for (const pattern of ['([a-', '(?i)abc', '(?P<x>a)', '(?>a)', 'a++']) {
    assert.throws(
      () => compileUserRegex(pattern, 'g'),
      (e: any) => e instanceof ProcessingError && e.kind === 'invalidInput' && e.message === ERROR_KEYS.invalidRegex && /Invalid regular expression/.test(e.detail ?? ''),
      pattern
    );
  }
});

test('compileUserRegex: empty and too long patterns are rejected (engine-neutral limits)', () => {
  assert.throws(() => compileUserRegex('', 'g'), (e: any) => e.kind === 'invalidInput');
  assert.throws(() => compileUserRegex('a'.repeat(MAX_PATTERN_LENGTH + 1), 'g'), (e: any) => e.kind === 'invalidInput');
  assert.ok(compileUserRegex('a'.repeat(MAX_PATTERN_LENGTH), 'g'));
});

test('hasValidPatternLength checks only the length, not the JS syntax', () => {
  assert.equal(hasValidPatternLength(''), false);
  assert.equal(hasValidPatternLength('a'.repeat(MAX_PATTERN_LENGTH + 1)), false);
  // Rust-only syntax must pass the engine-neutral check (validated by the engine that runs it)
  for (const pattern of ['(?i)abc', '(?>a+)b', '(?P<x>a)(?P=x)', 'a++']) {
    assert.equal(hasValidPatternLength(pattern), true, pattern);
    assert.equal(validateRegexPattern(pattern), false, `${pattern} is no JS regex`);
  }
});

const t = (key: string) => `<${key}>`;

test('processingErrorMessage: an invalid regex shows the engine detail', () => {
  const error = new ProcessingError('invalidInput', ERROR_KEYS.invalidRegex, 'Parsing error at position 4: Invalid character class');
  assert.equal(processingErrorMessage(error, t), '<errors.invalidRegex>: Parsing error at position 4: Invalid character class');
  assert.equal(processingErrorMessage(new ProcessingError('invalidInput', ERROR_KEYS.invalidRegex), t), '<errors.invalidRegex>');
});

test('processingErrorMessage: technical details of other errors are not shown', () => {
  assert.equal(processingErrorMessage(new ProcessingError('backend', ERROR_KEYS.general, 'IPC connection lost'), t), '<errors.processingError>');
  assert.equal(processingErrorMessage(new ProcessingError('worker', ERROR_KEYS.regexRequiresWorker), t), '<errors.regexRequiresWorker>');
});

test('isSuperseded recognises only superseded processing errors', () => {
  assert.equal(isSuperseded(new ProcessingError('superseded', ERROR_KEYS.superseded)), true);
  assert.equal(isSuperseded(new ProcessingError('timeout', ERROR_KEYS.timeout)), false);
  assert.equal(isSuperseded(new Error('x')), false);
});

// --- Match preview rows (worker side of MatchPreview, Paket 10 C2) ---

type Limits = typeof PREVIEW_LIMITS;
const preview = (text: string, pattern: string, splitMatches = false, limits?: Partial<Record<keyof Limits, number>>) =>
  buildMatchPreview(splitLines(text).lines, compileUserRegex(pattern, 'g'), splitMatches, limits && { ...PREVIEW_LIMITS, ...limits });
const segmentsOf = (data: { rows: { segments: string[] }[] }) => data.rows.map((row) => row.segments);
const isCut = (error: unknown) => error instanceof ProcessingError && error.message === ERROR_KEYS.regexSplitsCharacter;

/** The text a shown row stands for: shortened segments get their omitted units back from the line, then the hidden rest. */
function rebuild(row: { segments: string[]; elided: { segment: number; at: number; omitted: number }[]; restOmitted: number }, line: string): string {
  let position = 0;
  let text = '';
  row.segments.forEach((segment, index) => {
    const elision = row.elided.find((e) => e.segment === index);
    const full = elision ? segment.slice(0, elision.at) + line.slice(position + elision.at, position + elision.at + elision.omitted) + segment.slice(elision.at) : segment;
    text += full;
    position += full.length;
  });
  return text + line.slice(position, position + row.restOmitted);
}

test('buildMatchPreview: complete preview, alternating text/match segments, line numbers, only lines with matches', () => {
  const data = preview('an apple\nnone\napple\nap ap', 'ap');
  assert.deepEqual(segmentsOf(data), [['an ', 'ap', 'ple'], ['', 'ap', 'ple'], ['', 'ap', ' ', 'ap', '']]);
  assert.deepEqual(data.rows.map((row) => row.line), [1, 3, 4]);
  assert.deepEqual({ matches: data.matches, complete: data.complete, keepSplit: data.keepSplitCutsCharacter }, { matches: 4, complete: true, keepSplit: false });
  // The segments rebuild the shown lines exactly
  for (const row of data.rows) assert.equal(row.segments.join(''), splitLines('an apple\nnone\napple\nap ap').lines[row.line - 1]);
});

test('buildMatchPreview: whole-line and zero-width matches, no matches is a complete empty preview', () => {
  assert.deepEqual(segmentsOf(preview('apple', 'apple')), [['', 'apple', '']]);
  assert.deepEqual(segmentsOf(preview('abc', '(?=b)')), []);
  assert.deepEqual(segmentsOf(preview('baaac', 'a*')), [['b', 'aaa', 'c']]);
  assert.deepEqual(preview('abc\ndef', 'x'), { rows: [], matches: 0, complete: true, keepSplitCutsCharacter: false });
});

test('buildMatchPreview: LF, CRLF and CR lines (line terminators are no part of a row)', () => {
  for (const text of ['a1\nb\nc2', 'a1\r\nb\r\nc2\r\n', 'a1\rb\rc2']) {
    const data = preview(text, '\\d');
    assert.deepEqual({ rows: segmentsOf(data), lines: data.rows.map((row) => row.line) }, { rows: [['a', '1', ''], ['c', '2', '']], lines: [1, 3] }, JSON.stringify(text));
  }
});

test('buildMatchPreview (E1): matches of one surrogate half are refused in every mode, not highlighted', () => {
  for (const [text, pattern] of [['a😀b', '\\uD83D'], ['a😀b', '\\uDE00'], ['a😁b', '[😀]'], ['😀😃', '^.|.$'], ['x😀a', '.a'], ['😀😃', '[^😀]']]) {
    for (const splitMatches of [false, true]) assert.throws(() => preview(text, pattern, splitMatches), isCut, `${text} ${pattern}`);
  }
  // One cut line refuses the whole preview, like the Filter
  assert.throws(() => preview('ok\na😁b', '[😀]'), isCut);
});

test('buildMatchPreview (E1): adjacent halves are one highlight; with splitMatches "keep" would refuse them', () => {
  for (const [text, pattern, rows] of [
    ['😀x', '.', [['', '😀', '', 'x', '']]],
    ['a😀b', '[😀]', [['a', '😀', 'b']]],
    ['😀🎉', '[^a]', [['', '😀', '', '🎉', '']]],
    ['👨\u200D👩\u200D👧', '.', [['', '👨', '', '\u200D', '', '👩', '', '\u200D', '', '👧', '']]],
  ] as const) {
    for (const splitMatches of [false, true]) {
      const data = preview(text, pattern, splitMatches);
      assert.deepEqual(segmentsOf(data), rows, `${text} ${pattern}`);
      assert.equal(data.keepSplitCutsCharacter, splitMatches, 'reported only with splitMatches');
      assert.ok(data.rows.every((row) => row.segments.every((segment) => segment.isWellFormed())));
    }
  }
  // Whole emoji matches need no joining: nothing to report
  assert.deepEqual(preview('a😀b😃', '😀|😃', true), { rows: [{ line: 1, segments: ['a', '😀', 'b', '😃', ''], elided: [], restOmitted: 0 }], matches: 2, complete: true, keepSplitCutsCharacter: false });
  // ZWJ sequence: removing the joiners keeps whole emoji
  assert.deepEqual(segmentsOf(preview('👨\u200D👩', '\\u200D', true)), [['👨', '\u200D', '👩']]);
});

test('buildMatchPreview (E1): zero-width matches inside and outside a pair, lone surrogates of the input', () => {
  assert.deepEqual(preview('😀', '(?=\\uDE00)', true), { rows: [], matches: 0, complete: true, keepSplitCutsCharacter: false });
  assert.deepEqual(segmentsOf(preview('a😀', '(?=😀)')), []);
  assert.deepEqual(segmentsOf(preview('😀', 'x*', true)), []);
  // Lone surrogates already in the text are not newly damaged
  assert.deepEqual(segmentsOf(preview('\uD83Dx\n\uDE00y', '[xy]', true)), [['\uD83D', 'x', ''], ['\uDE00', 'y', '']]);
  assert.deepEqual(segmentsOf(preview('\uDE00a', '\\uDE00')), [['', '\uDE00', 'a']]);
  // A valid pair next to a lone half is still protected: cut everywhere, or only refused by "keep" with split matches
  assert.throws(() => preview('\uDE00😀', '\\uD83D'), isCut);
  const joined = preview('\uDE00😀', '.', true);
  assert.deepEqual({ rows: segmentsOf(joined), keepSplit: joined.keepSplitCutsCharacter }, { rows: [['', '\uDE00', '', '😀', '']], keepSplit: true });
});

test('buildMatchPreview (E7, limited): many matches in one line cut the row and mark it', () => {
  const line = 'ab'.repeat(50);
  const data = preview(line, 'a', false, { matchesPerRow: 10 });
  const [row] = data.rows;
  assert.deepEqual({ segments: row.segments.length, matches: data.matches, complete: data.complete, rest: row.restOmitted }, { segments: 21, matches: 10, complete: false, rest: 100 - 19 });
  assert.equal(row.segments.at(-1), '', 'the hidden rest is no segment');
  assert.equal(rebuild(row, line), line, 'shown text + omitted rest = the line');
  // Further lines are still searched (only this row was cut)
  const two = preview(`${line}\nxa`, 'a', false, { matchesPerRow: 10 });
  assert.deepEqual({ rows: two.rows.length, complete: two.complete, second: two.rows[1].segments }, { rows: 2, complete: false, second: ['x', 'a', ''] });
});

test('buildMatchPreview (E7, limited): many lines stop at the row limit, later matches are not searched', () => {
  const text = 'xa\n'.repeat(30) + 'late a';
  const data = preview(text, 'a', false, { rows: 10 });
  assert.deepEqual({ rows: data.rows.length, last: data.rows.at(-1)!.line, matches: data.matches, complete: data.complete }, { rows: 10, last: 10, matches: 10, complete: false });
  // Exactly the row limit with the last line: complete
  assert.equal(preview('xa\n'.repeat(10), 'a', false, { rows: 10 }).complete, true);
  // Lines without matches before the first match do not use the budget
  const late = preview('none\n'.repeat(5_000) + 'a', 'a', false, { rows: 1 });
  assert.deepEqual({ rows: segmentsOf(late), line: late.rows[0].line, complete: late.complete }, { rows: [['', 'a', '']], line: 5_001, complete: true });
});

test('buildMatchPreview (E7, limited): the segment and character budgets stop the whole preview', () => {
  const bySegments = preview('aaa\naaa\naaa', 'a', false, { segments: 10 });
  // 7 segments for the first line, the second one gets one highlight (10 segments in all), then the preview stops
  assert.deepEqual(
    { rows: segmentsOf(bySegments), rest: bySegments.rows.map((row) => row.restOmitted), complete: bySegments.complete },
    { rows: [['', 'a', '', 'a', '', 'a', ''], ['', 'a', '']], rest: [0, 2], complete: false }
  );
  assert.ok(bySegments.rows.reduce((n, row) => n + row.segments.length, 0) <= 10);
  const longLines = Array.from({ length: 10 }, () => 'x'.repeat(150) + 'a').join('\n');
  const byChars = preview(longLines, 'a', false, { chars: 500 });
  assert.ok(byChars.rows.length < 10 && !byChars.complete, `${byChars.rows.length} rows`);
});

/** UTF-16 units stored in all segments of an answer (what `PREVIEW_LIMITS.chars` limits) */
const storedChars = (data: { rows: { segments: string[] }[] }) => data.rows.reduce((n, row) => n + row.segments.reduce((m, s) => m + s.length, 0), 0);

test('buildMatchPreview (E7, limited): the final text of a row counts against the character budget', () => {
  // Review case: 1,000 highlights fill the budget exactly, the shortened final text (160 units) no longer fits
  const line = 'a'.repeat(200_000) + 'b'.repeat(10_000);
  const data = buildMatchPreview([line], /a{200}/g, false);
  const [row] = data.rows;
  assert.equal(storedChars(data), PREVIEW_LIMITS.chars);
  assert.deepEqual(
    { matches: data.matches, complete: data.complete, segments: row.segments.length, last: row.segments.at(-1), rest: row.restOmitted, elided: row.elided },
    { matches: 1_000, complete: false, segments: 2_001, last: '', rest: 10_000, elided: [] }
  );
  assert.equal(rebuild(row, line), line, 'shown text + omitted rest = the line');

  // Small budget, one match: the final text of 160 units fits exactly into 161, not into 160
  const one = 'x' + 'b'.repeat(1_000);
  const fits = preview(one, 'x', false, { chars: 161 });
  assert.deepEqual(
    { stored: storedChars(fits), complete: fits.complete, rest: fits.rows[0].restOmitted, elided: fits.rows[0].elided },
    { stored: 161, complete: true, rest: 0, elided: [{ segment: 2, at: 80, omitted: 840 }] }
  );
  const cut = preview(one, 'x', false, { chars: 160 });
  assert.deepEqual(
    { rows: segmentsOf(cut), stored: storedChars(cut), complete: cut.complete, rest: cut.rows[0].restOmitted, elided: cut.rows[0].elided },
    { rows: [['', 'x', '']], stored: 1, complete: false, rest: 1_000, elided: [] }
  );
  assert.equal(rebuild(cut.rows[0], one), one);
  // The case of the review with 161: 'a', 'b' and 160 final units would be 162
  const over = preview('ab' + 'c'.repeat(1_000), 'b', false, { chars: 161 });
  assert.deepEqual({ rows: segmentsOf(over), stored: storedChars(over), rest: over.rows[0].restOmitted, complete: over.complete }, { rows: [['a', 'b', '']], stored: 2, rest: 1_000, complete: false });
});

test('buildMatchPreview (E7, limited): many rows with shortened final text stay within the character budget', () => {
  const lines = Array.from({ length: 20 }, () => 'a' + 'b'.repeat(500));
  const text = lines.join('\n');
  // 161 units per row: 6 rows fit into 1,000, the 7th keeps its highlight and is cut before its final text
  const limited = preview(text, 'a', false, { chars: 1_000 });
  assert.ok(storedChars(limited) <= 1_000, `${storedChars(limited)} units`);
  assert.deepEqual(
    { rows: limited.rows.length, stored: storedChars(limited), matches: limited.matches, complete: limited.complete, rest: limited.rows.map((row) => row.restOmitted) },
    { rows: 7, stored: 6 * 161 + 1, matches: 7, complete: false, rest: [0, 0, 0, 0, 0, 0, 500] }
  );
  assert.deepEqual(limited.rows.slice(0, 6).map((row) => row.elided), Array(6).fill([{ segment: 2, at: 80, omitted: 340 }]));
  assert.deepEqual(limited.rows[6].elided, []);
  for (const row of limited.rows) assert.equal(rebuild(row, lines[row.line - 1]), lines[row.line - 1]);

  // Within the budget (exactly 20 × 161 units): everything is shown, complete, nothing cut
  const within = preview(text, 'a', false, { chars: 20 * 161 });
  assert.deepEqual(
    { rows: within.rows.length, stored: storedChars(within), complete: within.complete, rest: within.rows.every((row) => row.restOmitted === 0) },
    { rows: 20, stored: 20 * 161, complete: true, rest: true }
  );
  // Default limits: an ordinary preview is unchanged and complete
  const small = preview('an apple\napple pie', 'ap');
  assert.deepEqual({ rows: segmentsOf(small), complete: small.complete, stored: storedChars(small) }, { rows: [['an ', 'ap', 'ple'], ['', 'ap', 'ple pie']], complete: true, stored: 17 });
});

test('buildMatchPreview (E7, limited): a very long line is shown shortened around the matches, never silently', () => {
  const line = 'x'.repeat(100_000) + 'MATCH' + 'y'.repeat(100_000);
  const data = preview(line, 'MATCH');
  const [row] = data.rows;
  assert.deepEqual(row.segments.map((s) => s.length), [2 * PREVIEW_LIMITS.segmentKeep, 5, 2 * PREVIEW_LIMITS.segmentKeep]);
  assert.deepEqual(row.elided, [
    { segment: 0, at: PREVIEW_LIMITS.segmentKeep, omitted: 100_000 - 2 * PREVIEW_LIMITS.segmentKeep },
    { segment: 2, at: PREVIEW_LIMITS.segmentKeep, omitted: 100_000 - 2 * PREVIEW_LIMITS.segmentKeep },
  ]);
  assert.equal(rebuild(row, line), line, 'shown text + marked omissions = the line');
  assert.equal(data.complete, true, 'every match is shown: only text is shortened');
  // A shortened segment never ends inside a surrogate pair
  const emoji = preview('😀'.repeat(200) + 'M', 'M');
  assert.ok(emoji.rows[0].segments.every((segment) => segment.isWellFormed()));
  assert.equal(rebuild(emoji.rows[0], '😀'.repeat(200) + 'M'), '😀'.repeat(200) + 'M');
  // A long match is shortened too
  const long = preview('a' + 'b'.repeat(1_000) + 'c', 'b+');
  assert.deepEqual(long.rows[0].elided.map((e) => e.segment), [1]);
});

test('PREVIEW_LIMITS: the limits measured in Paket 10 Phase B', () => {
  assert.deepEqual({ ...PREVIEW_LIMITS }, { matchesPerRow: 1_000, rows: 1_000, segments: 20_001, segmentChars: 200, segmentKeep: 80, chars: 200_000 });
});
