// JS regex helpers and their error messages (Paket 5): validation in the native RegExp dialect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installWindow } from './helpers/setup.ts';

const { compileUserRegex, hasValidPatternLength, validateRegexPattern, MAX_PATTERN_LENGTH } = await import('../../src/utils/regex.ts');
const { ProcessingError, processingErrorMessage, ERROR_KEYS, isSuperseded } = await import('../../src/services/ProcessingError.ts');
const { findMatchSegments } = await import('../../src/utils/matchPreview.ts');

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

// --- Match preview segments (worker side of MatchPreview) ---

test('findMatchSegments: alternating text/match segments, only lines with matches', () => {
  const rows = findMatchSegments(['an apple', 'none', 'apple', 'ap ap'], compileUserRegex('ap', 'g'));
  assert.deepEqual(rows, [
    ['an ', 'ap', 'ple'],
    ['', 'ap', 'ple'],
    ['', 'ap', ' ', 'ap', ''],
  ]);
});

test('findMatchSegments: a whole-line match is shown, zero-width matches are no highlights', () => {
  assert.deepEqual(findMatchSegments(['apple'], compileUserRegex('apple', 'g')), [['', 'apple', '']]);
  assert.deepEqual(findMatchSegments(['abc'], compileUserRegex('(?=b)', 'g')), []);
  assert.deepEqual(findMatchSegments(['baaac'], compileUserRegex('a*', 'g')), [['b', 'aaa', 'c']]);
});
