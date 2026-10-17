// Error classification of the integration tests (tests/e2e/lib/harness.mjs, Paket 11 Phase B): an error provoked on
// purpose is excused only as the log entry recorded while its scenario ran, never by its text. Guards against a global
// text filter (e.g. every "Invalid hook call") coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { errorsIn, expectedErrorsIn, withoutExpected } = await import('../e2e/lib/harness.mjs');

const HOOK = /Invalid hook call|Minified React error #321/;
const entry = (kind: string, text: string) => ({ kind, text });

test('e2e errors: only the entries of the scenario window are expected', () => {
  const logs = [
    entry('exception', 'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.'),
    entry('console.log', 'unrelated'),
    // Scenario window [2, 4): the provoked F1 error and an unrelated error
    entry('exception', 'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.'),
    entry('console.error', 'TypeError: something else'),
    // After the scenario: the same hook error again (production text)
    entry('exception', 'Error: Minified React error #321'),
  ];
  const expected = expectedErrorsIn(logs, 2, 4, HOOK);
  assert.deepEqual(expected, [logs[2]], 'only the hook error inside the window');
  assert.equal(expected[0], logs[2], 'the entry itself, not a copy');

  // Equal hook errors before and after the window and the unrelated error in it stay unexpected
  assert.deepEqual(withoutExpected(errorsIn(logs), expected), [logs[0], logs[3], logs[4]]);
});

test('e2e errors: an entry is excused by identity, not by its text', () => {
  const provoked = entry('exception', 'Error: Invalid hook call.');
  const sameText = { ...provoked };
  assert.deepEqual(withoutExpected([provoked, sameText], [provoked]), [sameText]);
  assert.deepEqual(withoutExpected([provoked], []), [provoked], 'nothing is excused without recorded entries');
});

test('e2e errors: a window without a matching error expects nothing', () => {
  const logs = [entry('exception', 'Error: Invalid hook call.'), entry('console.error', 'other')];
  assert.deepEqual(expectedErrorsIn(logs, 1, 2, HOOK), []);
  assert.deepEqual(expectedErrorsIn(logs, 0, 0, HOOK), [], 'an empty window');
});
