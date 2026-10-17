// Regex compatibility fixtures for the JS engine (Paket 5). The same file is run against the Rust engine
// (`cargo test`, src-tauri/src/text_processor.rs). The JS side runs the real FilterWorker module in-process
// (`self` stand-in), i.e. the native RegExp exactly as the Web Worker uses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/setup.ts';

type Expected = string | { error: 'invalidRegex' | 'regexRuntime' };
interface RegexCase {
  name: string;
  category: 'same' | 'different' | 'rustOnly' | 'jsOnly';
  input: string;
  pattern: string;
  mode?: 'keep' | 'remove';
  caseSensitive?: boolean;
  splitMatches?: boolean;
  expected?: Expected;
  expectedRust?: Expected;
  expectedJs?: Expected;
  divergence?: string;
  /** Paket 10: the JS result depends on the JS engine version; it is the expectation or one of `otherJsResults`. */
  jsRuntimeDependent?: { reason: string; otherJsResults: Expected[] };
}

const fixtures: { cases: RegexCase[] } = JSON.parse(readFileSync(new URL('../fixtures/regex-cases.json', import.meta.url), 'utf8'));

const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
await import('../../src/workers/FilterWorker.ts');
const filterWorker: (event: { data: unknown }) => void = g.self.onmessage;

/** Filter result of the JS worker: the text, or `{ error }` like the Rust `TextError` kinds. */
function runJs(c: RegexCase): Expected {
  posted = [];
  filterWorker({
    data: {
      args: {
        sourceText: c.input,
        mainParam: c.pattern,
        configParams: { caseSensitive: c.caseSensitive ?? true, filterMode: c.mode ?? 'keep', splitMatches: c.splitMatches ?? true },
      },
    },
  });
  assert.equal(posted.length, 1, `${c.name}: exactly one worker message`);
  const [message] = posted;
  if (message.success) return message.result.result;
  assert.equal(message.errorKind, 'invalidInput', `${c.name}: ${JSON.stringify(message)}`);
  assert.equal(message.error, 'errors.invalidRegex');
  return { error: 'invalidRegex' };
}

test('regex fixtures are well-formed', () => {
  assert.ok(fixtures.cases.length > 0);
  const names = new Set<string>();
  for (const c of fixtures.cases) {
    assert.ok(!names.has(c.name), `duplicate fixture name: ${c.name}`);
    names.add(c.name);
    assert.ok(['same', 'different', 'rustOnly', 'jsOnly'].includes(c.category), `${c.name}: unknown category ${c.category}`);
    if (c.category === 'same') {
      assert.ok(c.expected !== undefined && c.expectedRust === undefined && c.expectedJs === undefined, `${c.name}: 'same' uses only 'expected'`);
      assert.ok(!c.divergence, `${c.name}: 'same' has no divergence`);
    } else {
      assert.ok(c.expected === undefined && c.expectedRust !== undefined && c.expectedJs !== undefined, `${c.name}: use 'expectedRust' + 'expectedJs'`);
      assert.ok(c.divergence, `${c.name}: per-engine expectations need a 'divergence' explanation`);
      assert.notDeepEqual(c.expectedRust, c.expectedJs, `${c.name}: engine-specific expectations must differ`);
    }
    const isError = (e?: Expected) => typeof e === 'object';
    if (c.category === 'rustOnly') assert.ok(!isError(c.expectedRust) && isError(c.expectedJs), `${c.name}: rustOnly = JS rejects the pattern`);
    if (c.category === 'jsOnly') assert.ok(isError(c.expectedRust) && !isError(c.expectedJs), `${c.name}: jsOnly = Rust rejects the pattern`);
    if (c.category === 'different') assert.ok(!isError(c.expectedRust) && !isError(c.expectedJs), `${c.name}: different = both accept the pattern`);
    const dependent = c.jsRuntimeDependent;
    if (dependent !== undefined) {
      assert.ok(dependent.reason && Array.isArray(dependent.otherJsResults) && dependent.otherJsResults.length > 0, `${c.name}: jsRuntimeDependent needs a reason and otherJsResults`);
      assert.ok(!dependent.otherJsResults.some((other) => JSON.stringify(other) === JSON.stringify(c.expectedJs ?? c.expected)), `${c.name}: otherJsResults repeat the expectation`);
    }
  }
});

for (const c of fixtures.cases) {
  test(`regex (JS, ${c.category}): ${c.name}`, () => {
    const actual = runJs(c);
    const expected = c.expectedJs ?? c.expected;
    // No cross-version guarantee: a runtime-dependent case accepts each documented JS result
    const allowed = [expected, ...(c.jsRuntimeDependent?.otherJsResults ?? [])];
    assert.ok(allowed.some((result) => JSON.stringify(result) === JSON.stringify(actual)), `${JSON.stringify(actual)} is none of ${JSON.stringify(allowed)}`);
  });
}
