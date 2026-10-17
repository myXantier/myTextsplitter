// Filter/Remove golden fixtures (Paket 8): `tests/fixtures/filter-remove-cases.json`, also run by the Rust engine
// (`cargo test`, src-tauri/src/text_processor.rs). Phase B characterized the behaviour, Phase C1 corrected the
// duplicate trim output, the whitespace set and cut surrogate pairs in the JS Filter. The JS side runs the real worker
// modules (in-process, `self` stand-in), the Remove main-thread fallback and the service path without Web Worker
// (`invoke(args, false)` in Node). The Filter has no main-thread implementation (Paket 10 C6, E10): it is refused there.
// Paket 10 Phase B: targets of not yet implemented decisions (`target` + `pending`) and the pattern preview of the Filter
// page (`preview`: current segments of the real MatchPreviewWorker, its target, checked against the JS Filter verdict).
import { installWindow, disableWorkerCleanupInterval, rejectionOf } from './helpers/setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { FilterService, RemoveService } = await import('../../src/services/Services.ts');
const { BaseService } = await import('../../src/services/BaseService.ts');
const { ERROR_KEYS } = await import('../../src/services/ProcessingError.ts');
const { trimWhitespace, isWhitespaceCodePoint } = await import('../../src/utils/diff/whitespace.ts');
const { splitLines } = await import('../../src/utils/lines.ts');
disableWorkerCleanupInterval(BaseService);
installWindow();

// --- Fixture format ---

type ErrorKind = 'invalidRegex' | 'regexRuntime' | 'invalidMode' | 'patternEmpty' | 'patternTooLong' | 'regexSplitsCharacter';
type FixtureError = { error: ErrorKind };
type FilterExpected = string | FixtureError;
type RemoveExpected = { text: string; removedLines: number } | FixtureError;
type Pattern = string | { repeat: string; count: number };
/** Rows of the pattern preview: `[text, match, text, ..., text]` per line with a non-empty match (`findMatchSegments`). */
type PreviewRows = string[][];
interface Preview {
  segments: PreviewRows | { error: string };
  /** Paket 10 C2: with splitMatches, "keep" would refuse a highlight joined from two halves of a character */
  keepSplitCutsCharacter?: true;
  target?: PreviewRows | { error: string };
  pending?: { decisions: string[]; phase: string; reason: string };
  note?: string;
  resolved?: string;
}

interface Case<O, E> {
  name: string;
  ref?: string;
  input: string;
  pattern: Pattern;
  options: O;
  expected?: E;
  expectedRust?: E;
  expectedJs?: E;
  divergence?: { kind: string; reason: string };
  openQuestion?: string;
  resolved?: string;
  /** Paket 10: result of a not yet implemented decision, the same in both engines. */
  target?: E | { error: string };
  pending?: { decisions: string[]; phase: string; engines: string[]; reason: string };
  /** Paket 10, Filter only: the pattern preview (JS only). */
  preview?: Preview;
}
type FilterOptions = { mode: string; caseSensitive: boolean; splitMatches: boolean };
type RemoveOptions = { removeMode: string; caseSensitive: boolean; useRegex: boolean; trimParts: boolean };
type FilterCase = Case<FilterOptions, FilterExpected>;
type RemoveCase = Case<RemoveOptions, RemoveExpected>;
interface Fixtures {
  description: string;
  filter: FilterCase[];
  remove: RemoveCase[];
}

const CASE_KEYS = ['name', 'ref', 'input', 'pattern', 'options', 'expected', 'expectedRust', 'expectedJs', 'divergence', 'openQuestion', 'resolved', 'target', 'pending', 'preview'];
/** Errors a target may use (the current errors without the JS-only regexSplitsCharacter). */
const TARGET_ERROR_KINDS = ['invalidRegex', 'regexRuntime', 'invalidMode', 'patternEmpty', 'patternTooLong'];
/** Paket 10 C2: a match that cuts a character in every Filter mode is a preview error; C3: the pattern errors of E3 */
const PREVIEW_ERROR_KINDS = ['invalidRegex', 'patternEmpty', 'patternTooLong', 'regexSplitsCharacter'];
const PREVIEW_TARGET_ERROR_KINDS = PREVIEW_ERROR_KINDS;
const DECISIONS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11'];
const OPTION_TYPES = {
  filter: { mode: 'string', caseSensitive: 'boolean', splitMatches: 'boolean' },
  remove: { removeMode: 'string', caseSensitive: 'boolean', useRegex: 'boolean', trimParts: 'boolean' },
} as const;
const DIVERGENCE_KINDS = ['dialect', 'utf16Guard', 'suspectedBug', 'inconsistentDefinition', 'unvalidatedInput'];
/** Paket 10 C3 (E3): patternEmpty / patternTooLong for an empty or too long regex pattern, in both engines */
const ERROR_KINDS = ['invalidRegex', 'regexRuntime', 'invalidMode', 'patternEmpty', 'patternTooLong'];
/** Only the JS Filter refuses results with cut surrogate pairs (Rust works on Unicode scalar values). */
const JS_FILTER_ERROR = 'regexSplitsCharacter';
const MESSAGE_OF_ERROR: Record<string, string> = {
  invalidRegex: ERROR_KEYS.invalidRegex,
  invalidMode: ERROR_KEYS.invalidMode,
  patternEmpty: ERROR_KEYS.patternEmpty,
  patternTooLong: ERROR_KEYS.patternTooLong,
  regexSplitsCharacter: ERROR_KEYS.regexSplitsCharacter,
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const isErrorOf = (value: unknown, kind: string) => isObject(value) && value.error === kind;
const hasLoneSurrogate = (text: string) => !text.isWellFormed();

/** Problems of one expectation; `engine` is where it applies (only JS Filter expectations may use `regexSplitsCharacter`). */
function expectationProblems(section: 'filter' | 'remove', value: unknown, engine: 'rust' | 'js' | 'shared'): string[] {
  if (isObject(value) && 'error' in value) {
    if (!hasExactKeys(value, ['error'])) return [`invalid error expectation ${JSON.stringify(value)}`];
    if (ERROR_KINDS.includes(value.error as string)) return [];
    if (value.error === JS_FILTER_ERROR) return section === 'filter' && engine === 'js' ? [] : [`${JS_FILTER_ERROR} is only a JS Filter expectation`];
    return [`unknown error kind ${JSON.stringify(value.error)}`];
  }
  if (section === 'remove') {
    return isObject(value) && hasExactKeys(value, ['text', 'removedLines']) && typeof value.text === 'string' && Number.isInteger(value.removedLines) && (value.removedLines as number) >= 0
      ? []
      : [`invalid remove expectation ${JSON.stringify(value)}`];
  }
  return typeof value === 'string' ? [] : [`invalid filter expectation ${JSON.stringify(value)}`];
}

/** Problems of a `pending` entry (`engines` only for engine targets, not for the JS-only preview). */
function pendingProblems(pending: unknown, withEngines: boolean): string[] {
  const keys = withEngines ? ['decisions', 'phase', 'engines', 'reason'] : ['decisions', 'phase', 'reason'];
  const ok =
    isObject(pending) &&
    hasExactKeys(pending, keys) &&
    Array.isArray(pending.decisions) && pending.decisions.length > 0 && pending.decisions.every((d) => DECISIONS.includes(d as string)) &&
    ['C1', 'C2'].includes(pending.phase as string) &&
    (!withEngines || (Array.isArray(pending.engines) && pending.engines.length > 0 && pending.engines.every((e) => e === 'rust' || e === 'js') && new Set(pending.engines).size === pending.engines.length)) &&
    typeof pending.reason === 'string' && pending.reason !== '';
  return ok ? [] : [`pending must be { ${keys.join(', ')} } (decisions E1..E11, phase C1 | C2${withEngines ? ', engines rust | js' : ''})`];
}

/** The preview rows of `input`: every row rebuilds a line with a non-empty match, in line order; matches are non-empty. */
function previewRowProblems(rows: unknown, input: string, wellFormed: boolean): string[] {
  if (!Array.isArray(rows) || !rows.every((row) => Array.isArray(row) && row.length % 2 === 1 && row.length >= 3 && row.every((s) => typeof s === 'string'))) {
    return [`invalid preview rows ${JSON.stringify(rows)}`];
  }
  const problems: string[] = [];
  const lines = splitLines(input).lines;
  let line = 0;
  for (const row of rows as string[][]) {
    while (line < lines.length && lines[line] !== row.join('')) line++;
    if (line === lines.length) problems.push(`preview row ${JSON.stringify(row)} does not rebuild a line of the input (in order)`);
    line++;
    if (row.some((segment, index) => index % 2 === 1 && segment === '')) problems.push(`empty match segment in ${JSON.stringify(row)}`);
    if (wellFormed && row.some(hasLoneSurrogate)) problems.push(`segment with a lone surrogate in ${JSON.stringify(row)}`);
  }
  return problems;
}

/** Problems of the preview of a Filter case, also against the Filter verdict of the JS worker. */
function previewProblems(c: Record<string, any>): string[] {
  const preview = c.preview;
  if (!isObject(preview) || !('segments' in preview) || Object.keys(preview).some((key) => !['segments', 'keepSplitCutsCharacter', 'target', 'pending', 'note', 'resolved'].includes(key))) {
    return ['preview must be { segments, keepSplitCutsCharacter?, target?, pending?, note?, resolved? }'];
  }
  const problems: string[] = [];
  const outcome = (value: unknown, errors: string[], wellFormed: boolean) =>
    isObject(value) && 'error' in value
      ? hasExactKeys(value, ['error']) && errors.includes(value.error as string) ? [] : [`invalid preview error ${JSON.stringify(value)}`]
      : previewRowProblems(value, c.input, wellFormed);
  // Paket 10 C2: the current preview never shows a lone surrogate
  problems.push(...outcome(preview.segments, PREVIEW_ERROR_KINDS, true));
  if (preview.keepSplitCutsCharacter !== undefined && preview.keepSplitCutsCharacter !== true) problems.push('keepSplitCutsCharacter is true or absent');
  if (preview.resolved !== undefined && (typeof preview.resolved !== 'string' || !preview.resolved || preview.target !== undefined)) problems.push('preview resolved must be a non-empty note without a target');
  if (preview.target !== undefined) {
    problems.push(...outcome(preview.target, PREVIEW_TARGET_ERROR_KINDS, true));
    if (JSON.stringify(preview.target) === JSON.stringify(preview.segments)) problems.push('preview target equals the current segments');
  }
  if ((preview.target !== undefined) !== (preview.pending !== undefined)) problems.push('a preview target needs pending (and only a target)');
  if (preview.pending !== undefined) problems.push(...pendingProblems(preview.pending, false).map((p) => `preview ${p}`));
  if (preview.note !== undefined && (typeof preview.note !== 'string' || !preview.note)) problems.push('preview note must be a non-empty string');
  // Without a target the current segments are already the wanted ones: no lone surrogate
  const final = preview.target ?? preview.segments;
  if (!(isObject(final) && 'error' in final)) problems.push(...previewRowProblems(final, c.input, true).map((p) => `final preview: ${p}`));
  const filterFinal = c.target ?? c.expectedJs ?? c.expected;
  const errorOf = (value: unknown) => (isObject(value) && 'error' in value ? (value.error as string) : null);
  if (errorOf(filterFinal) === 'invalidMode') return [...problems, 'no preview for an invalid mode (the preview has no mode)'];
  // E1 (Paket 10 C2): the preview has no mode. A cut in every mode is its error regexSplitsCharacter; a highlight joined
  // from two halves is refused only by "keep" with split matches (keepSplitCutsCharacter). Together with the mode of the
  // case this gives exactly the verdict of the JS Filter.
  const cutEverywhere = errorOf(final) === 'regexSplitsCharacter';
  const keepSplitCut = preview.keepSplitCutsCharacter === true;
  if (keepSplitCut && (!c.options.splitMatches || cutEverywhere)) problems.push('keepSplitCutsCharacter needs splitMatches and highlights');
  const filterRefuses = errorOf(filterFinal) === 'regexSplitsCharacter';
  const keepWithSplit = c.options.mode === 'keep' && c.options.splitMatches;
  if (filterRefuses !== (cutEverywhere || (keepWithSplit && keepSplitCut))) {
    problems.push(`preview judgement (cut: ${cutEverywhere}, keepSplit: ${keepSplitCut}) contradicts the JS Filter verdict ${JSON.stringify(filterFinal)}`);
  }
  // Other input errors (invalid regex, E3 pattern errors) are the same in the final preview and the final Filter
  if (!cutEverywhere && !filterRefuses && errorOf(final) !== errorOf(filterFinal)) problems.push(`final preview error ${errorOf(final)} differs from the final JS Filter error ${errorOf(filterFinal)}`);
  return problems;
}

/** All problems of a fixture file; an empty list means well-formed. */
function fixtureProblems(fixtures: unknown): string[] {
  if (!isObject(fixtures) || !hasExactKeys(fixtures, ['description', 'filter', 'remove'])) return ['top level must have exactly description, filter, remove'];
  const problems: string[] = [];
  for (const section of ['filter', 'remove'] as const) {
    const cases = fixtures[section];
    if (!Array.isArray(cases) || !cases.length) {
      problems.push(`${section}: missing or empty`);
      continue;
    }
    const names = new Set<string>();
    for (const c of cases) {
      const where = `${section}/${isObject(c) ? c.name : '?'}`;
      if (!isObject(c)) {
        problems.push(`${where}: not an object`);
        continue;
      }
      const unknown = Object.keys(c).filter((key) => !CASE_KEYS.includes(key));
      if (unknown.length) problems.push(`${where}: unknown keys ${unknown.join(', ')}`);
      if (typeof c.name !== 'string' || !c.name) problems.push(`${where}: name missing`);
      else if (names.has(c.name)) problems.push(`${where}: duplicate name`);
      else names.add(c.name);
      if (typeof c.input !== 'string') problems.push(`${where}: input must be a string`);
      const pattern = c.pattern;
      const patternOk =
        typeof pattern === 'string' ||
        (isObject(pattern) && hasExactKeys(pattern, ['repeat', 'count']) && typeof pattern.repeat === 'string' && pattern.repeat !== '' && Number.isInteger(pattern.count) && (pattern.count as number) > 0);
      if (!patternOk) problems.push(`${where}: pattern must be a string or { repeat, count }`);

      const types: Record<string, string> = OPTION_TYPES[section];
      if (!isObject(c.options) || !hasExactKeys(c.options, Object.keys(types))) {
        problems.push(`${where}: options must state exactly ${Object.keys(types).join(', ')}`);
      } else {
        for (const [key, type] of Object.entries(types)) if (typeof c.options[key] !== type) problems.push(`${where}: option ${key} must be a ${type}`);
      }

      const shared = c.expected !== undefined;
      const perEngine = c.expectedRust !== undefined || c.expectedJs !== undefined;
      if (shared === perEngine) problems.push(`${where}: needs either expected or expectedRust + expectedJs`);
      if (perEngine && (c.expectedRust === undefined || c.expectedJs === undefined)) problems.push(`${where}: expectedRust and expectedJs belong together`);
      if (perEngine !== (c.divergence !== undefined)) problems.push(`${where}: per-engine expectations need a divergence (and only they)`);
      if (perEngine && JSON.stringify(c.expectedRust) === JSON.stringify(c.expectedJs)) problems.push(`${where}: expectedRust equals expectedJs, use expected`);
      const divergence = c.divergence;
      if (divergence !== undefined) {
        if (!isObject(divergence) || !hasExactKeys(divergence, ['kind', 'reason']) || !DIVERGENCE_KINDS.includes(divergence.kind as string) || typeof divergence.reason !== 'string' || !divergence.reason) {
          problems.push(`${where}: divergence must be { kind: ${DIVERGENCE_KINDS.join(' | ')}, reason }`);
        }
      }
      if (shared) problems.push(...expectationProblems(section, c.expected, 'shared').map((p) => `${where}: ${p}`));
      if (c.expectedRust !== undefined) problems.push(...expectationProblems(section, c.expectedRust, 'rust').map((p) => `${where}: expectedRust: ${p}`));
      if (c.expectedJs !== undefined) problems.push(...expectationProblems(section, c.expectedJs, 'js').map((p) => `${where}: expectedJs: ${p}`));
      // A refused cut character and the utf16Guard divergence belong together
      if (isErrorOf(c.expectedJs, JS_FILTER_ERROR) !== (isObject(divergence) && divergence.kind === 'utf16Guard')) {
        problems.push(`${where}: expectedJs ${JS_FILTER_ERROR} requires the divergence kind utf16Guard and vice versa`);
      }
      for (const key of ['ref', 'openQuestion', 'resolved']) if (c[key] !== undefined && (typeof c[key] !== 'string' || !c[key])) problems.push(`${where}: ${key} must be a non-empty string`);
      // A resolved (corrected) case has one shared expectation
      if (c.resolved !== undefined && !shared) problems.push(`${where}: a resolved case uses expected`);
      // Paket 10: target of a not yet implemented decision (both engines), checked against the engines in the runners
      if ((c.target !== undefined) !== (c.pending !== undefined)) problems.push(`${where}: a target needs pending (and only a target)`);
      if (c.target !== undefined) {
        const targetError = isObject(c.target) && 'error' in c.target;
        if (targetError && !(hasExactKeys(c.target as Record<string, unknown>, ['error']) && TARGET_ERROR_KINDS.includes((c.target as Record<string, unknown>).error as string))) {
          problems.push(`${where}: invalid target error ${JSON.stringify(c.target)}`);
        } else if (!targetError) problems.push(...expectationProblems(section, c.target, 'shared').map((p) => `${where}: target: ${p}`));
      }
      if (c.pending !== undefined) problems.push(...pendingProblems(c.pending, true).map((p) => `${where}: ${p}`));
      if (c.preview !== undefined) {
        if (section !== 'filter') problems.push(`${where}: preview is only for the Filter`);
        else problems.push(...previewProblems(c).map((p) => `${where}: ${p}`));
      }
    }
  }
  return problems;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('../fixtures/filter-remove-cases.json', import.meta.url), 'utf8'));

test('filter/remove fixtures are well-formed', () => {
  assert.deepEqual(fixtureProblems(fixtures), []);
});

test('filter/remove fixture check rejects malformed entries', () => {
  const valid = structuredClone(fixtures.filter[0]);
  const validRemove = structuredClone(fixtures.remove[0]);
  const check = (filter: unknown[], remove: unknown[] = [validRemove]) => fixtureProblems({ description: '', filter, remove });
  assert.deepEqual(check([valid]), []);

  const guard = { kind: 'utf16Guard', reason: 'r' };
  const broken: [string, unknown][] = [
    ['implicit splitMatches', { ...valid, options: { mode: 'keep', caseSensitive: true } }],
    ['unknown key', { ...valid, expectedTs: 'x' }],
    ['expected and expectedRust', { ...valid, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'dialect', reason: 'r' } }],
    ['per-engine without divergence', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b' }],
    ['divergence without per-engine', { ...valid, divergence: { kind: 'dialect', reason: 'r' } }],
    ['unknown divergence kind', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'accepted', reason: 'r' } }],
    ['former divergence kind', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'dataIntegrityRisk', reason: 'r' } }],
    ['identical per-engine expectations', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'a', divergence: { kind: 'dialect', reason: 'r' } }],
    ['unknown error kind', { ...valid, expected: { error: 'timeout' } }],
    ['utf16 form is gone', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: { utf16: ['D83D'] }, divergence: guard }],
    ['regexSplitsCharacter as shared expectation', { ...valid, expected: { error: 'regexSplitsCharacter' } }],
    ['regexSplitsCharacter for Rust', { ...valid, expected: undefined, expectedRust: { error: 'regexSplitsCharacter' }, expectedJs: 'a', divergence: guard }],
    ['regexSplitsCharacter without utf16Guard', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: { error: 'regexSplitsCharacter' }, divergence: { kind: 'dialect', reason: 'r' } }],
    ['utf16Guard without regexSplitsCharacter', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: guard }],
    ['invalid pattern repeat', { ...valid, pattern: { repeat: 'a' } }],
    ['empty resolved note', { ...valid, resolved: '' }],
    ['resolved with per-engine expectations', { ...valid, expected: undefined, expectedRust: 'a', expectedJs: 'b', divergence: { kind: 'dialect', reason: 'r' }, resolved: 'r' }],
    // Paket 10 C6 (E10): there is no main-thread Filter any more
    ['main-thread Filter expectation', { ...valid, expectedJsUnreachableMainThread: 'a' }],
  ];
  for (const [label, entry] of broken) {
    const cleaned = JSON.parse(JSON.stringify(entry)); // drops `undefined` keys like the JSON file would
    assert.notDeepEqual(check([cleaned]), [], label);
  }
  assert.notDeepEqual(check([valid, valid]), [], 'duplicate name');
  assert.notDeepEqual(check([valid], [{ ...validRemove, expected: { text: 'x' } }]), [], 'remove expectation without removedLines');
  assert.notDeepEqual(check([valid], [{ ...validRemove, options: { removeMode: 'duplicates', caseSensitive: true, useRegex: false } }]), [], 'implicit trimParts');
  assert.notDeepEqual(check([valid], [{ ...validRemove, expected: undefined, expectedRust: { text: 'a', removedLines: 0 }, expectedJs: { error: 'regexSplitsCharacter' }, divergence: guard }]), [], 'regexSplitsCharacter for Remove');

  // Paket 10: targets, pending decisions and previews
  const pending = { decisions: ['E3'], phase: 'C2', engines: ['js'], reason: 'r' };
  const previewPending = { decisions: ['E1'], phase: 'C1', reason: 'r' };
  const plain = { name: 'p', input: 'ab', pattern: 'b', options: { mode: 'keep', caseSensitive: true, splitMatches: false }, expected: 'b' };
  assert.deepEqual(check([{ ...plain, target: { error: 'patternTooLong' }, pending }]), []);
  assert.deepEqual(check([{ ...plain, preview: { segments: [['a', 'b', '']] } }]), []);
  const previewBroken: [string, unknown][] = [
    ['target without pending', { ...plain, target: { error: 'patternTooLong' } }],
    ['pending without target', { ...plain, pending }],
    ['unknown target error', { ...plain, target: { error: 'tooLong' }, pending }],
    ['regexSplitsCharacter as target', { ...plain, target: { error: 'regexSplitsCharacter' }, pending }],
    ['unknown decision', { ...plain, target: { error: 'patternTooLong' }, pending: { ...pending, decisions: ['E0'] } }],
    ['unknown phase', { ...plain, target: { error: 'patternTooLong' }, pending: { ...pending, phase: 'B' } }],
    ['unknown engine', { ...plain, target: { error: 'patternTooLong' }, pending: { ...pending, engines: ['ts'] } }],
    ['preview without segments', { ...plain, preview: { note: 'n' } }],
    ['preview with unknown key', { ...plain, preview: { segments: [['a', 'b', '']], expected: [] } }],
    ['preview row that does not rebuild a line', { ...plain, preview: { segments: [['a', 'x', '']] } }],
    ['preview row with an even number of segments', { ...plain, preview: { segments: [['a', 'b']] } }],
    ['preview with an empty match segment', { ...plain, input: 'ab', preview: { segments: [['a', '', 'b']] } }],
    ['preview target without pending', { ...plain, preview: { segments: [['a', 'b', '']], target: [['', 'ab', '']] } }],
    ['preview pending with engines', { ...plain, preview: { segments: [['a', 'b', '']], target: [['', 'ab', '']], pending } }],
    ['preview target equal to the segments', { ...plain, preview: { segments: [['a', 'b', '']], target: [['a', 'b', '']], pending: previewPending } }],
    ['lone surrogate without a target', { ...plain, input: '😀', pattern: '[^a]', expected: '😀', preview: { segments: [['', '\uD83D', '', '\uDE00', '']] } }],
    ['lone surrogate in the target', { ...plain, input: '😀', pattern: '[^a]', expected: '😀', preview: { segments: [['', '\uD83D', '', '\uDE00', '']], target: [['', '\uD83D', '\uDE00']], pending: previewPending } }],
    ['preview error differs from the Filter', { ...plain, preview: { segments: { error: 'invalidRegex' } } }],
    ['preview success although the Filter refuses', { ...plain, expected: undefined, expectedRust: 'b', expectedJs: { error: 'regexSplitsCharacter' }, divergence: guard, preview: { segments: [['a', 'b', '']] } }],
    ['keepSplitCutsCharacter without splitMatches', { ...plain, preview: { segments: [['a', 'b', '']], keepSplitCutsCharacter: true } }],
    ['keepSplitCutsCharacter although keep with split matches succeeds', { ...plain, options: { mode: 'keep', caseSensitive: true, splitMatches: true }, preview: { segments: [['a', 'b', '']], keepSplitCutsCharacter: true } }],
    ['keepSplitCutsCharacter false', { ...plain, options: { mode: 'remove', caseSensitive: true, splitMatches: true }, preview: { segments: [['a', 'b', '']], keepSplitCutsCharacter: false } }],
    ['resolved preview with a target', { ...plain, preview: { segments: [['a', 'b', '']], target: [['', 'ab', '']], pending: previewPending, resolved: 'r' } }],
    ['preview for an invalid mode',{ ...plain, options: { mode: 'x', caseSensitive: true, splitMatches: false }, expected: { error: 'invalidMode' }, preview: { segments: [['a', 'b', '']] } }],
  ];
  for (const [label, entry] of previewBroken) assert.notDeepEqual(check([JSON.parse(JSON.stringify(entry))]), [], label);
  assert.notDeepEqual(check([valid], [{ ...validRemove, preview: { segments: [] } }]), [], 'preview for Remove');
});

test('filter/remove fixtures cover the Phase A reproductions', () => {
  const refs = new Set([...fixtures.filter, ...fixtures.remove].map((c) => c.ref).filter(Boolean));
  for (const ref of ['R05', 'R06', 'F04', 'F06', 'F12', 'F16', 'F17', 'R07', 'R08', 'R21', 'F31']) assert.ok(refs.has(ref), `missing ${ref}`);
  // Paket 10 Phase A (docs/analyse/Paket10-PhaseA-Regex-Analyse.md): preview R1/R6, pattern rules R5
  for (const ref of ['R1', 'R5', 'R6']) assert.ok(refs.has(ref), `missing ${ref}`);
  const decisions = new Set([...fixtures.filter, ...fixtures.remove].flatMap((c) => [...(c.pending?.decisions ?? []), ...(c.preview?.pending?.decisions ?? [])]));
  // E1 is implemented (Paket 10 C2: resolved previews), E3 in Paket 10 C3: no open decision is left in these fixtures
  assert.deepEqual([...decisions], []);
  const previews = fixtures.filter.filter((c) => c.preview?.resolved);
  assert.ok(previews.length >= 20 && previews.filter((c) => c.preview!.keepSplitCutsCharacter).length >= 4, `${previews.length} resolved previews`);
  const e3 = [...fixtures.filter, ...fixtures.remove].filter((c) => c.resolved?.startsWith('Paket 10 C3 (E3)'));
  assert.equal(e3.length, 7, 'resolved E3 cases');
  assert.ok(e3.every((c) => isErrorOf(c.expected, 'patternEmpty') || isErrorOf(c.expected, 'patternTooLong')));
});

// --- Engines ---

const g = globalThis as any;
let posted: any[] = [];
g.self = { postMessage: (message: unknown) => posted.push(structuredClone(message)), onmessage: null };
const loadWorker = async (path: string) => {
  await import(path);
  return g.self.onmessage as (event: { data: unknown }) => void;
};
const workers = {
  filter: await loadWorker('../../src/workers/FilterWorker.ts'),
  remove: await loadWorker('../../src/workers/RemoveWorker.ts'),
  preview: await loadWorker('../../src/workers/MatchPreviewWorker.ts'),
};

/**
 * Pending rule (Paket 10): the JS engine still differs from the target exactly when `pending.engines` lists it
 * (the Rust runner checks the same for Rust). Keeps the target honest without an intentionally red test.
 */
function assertPendingJs(c: { name: string; target?: unknown; pending?: { engines: string[] } }, actual: unknown) {
  if (c.target === undefined) return;
  const differs = JSON.stringify(actual) !== JSON.stringify(c.target);
  assert.equal(differs, c.pending!.engines.includes('js'), `${c.name}: pending.engines must list js exactly while the JS result differs from the target`);
}

const patternOf = (pattern: Pattern) => (typeof pattern === 'string' ? pattern : pattern.repeat.repeat(pattern.count));

/**
 * Number of executions of a RegExp with the source of `pattern` (exec, test, match, matchAll, replace, search, split)
 * while `run` runs: the user regex must never run in the main thread. Compiling is not counted.
 */
async function userRegexRuns(pattern: string, run: () => Promise<void>): Promise<number> {
  let source: string | null = null;
  try {
    source = new RegExp(pattern).source;
  } catch {
    // An invalid pattern cannot run at all
  }
  const proto = RegExp.prototype as any;
  const keys = ['exec', 'test', Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split];
  const originals = keys.map((key) => proto[key]);
  let runs = 0;
  keys.forEach((key, i) => {
    proto[key] = function (this: RegExp, ...args: unknown[]) {
      if (source !== null && this.source === source) runs++;
      return originals[i].apply(this, args);
    };
  });
  try {
    await run();
  } finally {
    keys.forEach((key, i) => (proto[key] = originals[i]));
  }
  return runs;
}
const filterArgs = (c: { input: string; pattern: Pattern; options: FilterOptions }): FilterConfig => ({
  sourceText: c.input,
  mainParam: patternOf(c.pattern),
  configParams: { caseSensitive: c.options.caseSensitive, filterMode: c.options.mode as FilterConfig['configParams']['filterMode'], splitMatches: c.options.splitMatches },
});
const removeArgs = (c: RemoveCase): RemoveConfig => ({
  sourceText: c.input,
  mainParam: patternOf(c.pattern),
  configParams: { caseSensitive: c.options.caseSensitive, useRegex: c.options.useRegex, trimParts: c.options.trimParts, removeMode: c.options.removeMode },
});

/** The JS errors of the fixtures are invalid input (`invalidInput`) with the message key of the error kind. */
function assertInputError(kind: unknown, message: unknown, expected: ErrorKind, where: string) {
  assert.ok(MESSAGE_OF_ERROR[expected], `${where}: no JS error for ${expected}`);
  assert.deepEqual({ kind, message }, { kind: 'invalidInput', message: MESSAGE_OF_ERROR[expected] }, where);
}

/** Exactly one worker message: a success with the given result type, or an error. */
function runWorker(worker: keyof typeof workers, args: BaseConfig) {
  posted = [];
  workers[worker]({ data: { args } });
  assert.equal(posted.length, 1, `exactly one worker message: ${JSON.stringify(posted)}`);
  return posted[0];
}

/** A successful JS Filter result: exactly the expected text, never with a cut character. */
function assertFilterText(actual: unknown, expected: string, where: string) {
  assert.equal(actual, expected, where);
  assert.ok(!hasLoneSurrogate(actual as string), `${where}: result is well-formed Unicode`);
}

// --- Filter ---

for (const c of fixtures.filter) {
  const expected = (c.expectedJs ?? c.expected)!;

  test(`filter worker: ${c.name}`, () => {
    const message = runWorker('filter', filterArgs(c));
    assertPendingJs(c, message.success ? message.result.result : { error: Object.entries(ERROR_KEYS).find(([, key]) => key === message.error)?.[0] });
    if (typeof expected === 'object') {
      assert.equal(message.success, false, JSON.stringify(message));
      assertInputError(message.errorKind, message.error, expected.error, c.name);
      return;
    }
    assert.equal(message.success, true, JSON.stringify(message));
    assert.equal(message.result.type, 'Text');
    assertFilterText(message.result.result, expected, 'worker');
  });

  // The pattern preview (MatchPreviewWorker) of the same text and pattern: it has no mode and no splitMatches
  if (!isErrorOf(expected, 'invalidMode')) {
    test(`filter preview worker: ${c.name}`, () => {
      const configParams = { caseSensitive: c.options.caseSensitive, splitMatches: c.options.splitMatches };
      const message = runWorker('preview', { sourceText: c.input, mainParam: patternOf(c.pattern), configParams } as MatchPreviewConfig);
      let segments: unknown;
      let keepSplitCutsCharacter: true | undefined;
      if (message.success) {
        assert.equal(message.result.type, 'MatchPreview');
        const data = message.result.result;
        // The small fixture texts are below every limit: a complete preview without omissions
        const omissions = { complete: data.complete, elided: data.rows.flatMap((r: any) => r.elided), rest: data.rows.map((r: any) => r.restOmitted).filter(Boolean) };
        assert.deepEqual(omissions, { complete: true, elided: [], rest: [] });
        segments = data.rows.map((r: any) => r.segments);
        // Every row rebuilds its original line exactly, without lone surrogates (also for cases without a preview expectation)
        assert.deepEqual(previewRowProblems(segments, c.input, true), []);
        const lines = splitLines(c.input).lines;
        for (const row of data.rows) assert.equal(lines[row.line - 1], row.segments.join(''), 'line number');
        assert.equal(data.matches, (segments as string[][]).reduce((n, row) => n + (row.length - 1) / 2, 0));
        if (data.keepSplitCutsCharacter) keepSplitCutsCharacter = true;
      } else {
        assert.equal(message.errorKind, 'invalidInput', JSON.stringify(message));
        segments = { error: Object.entries(ERROR_KEYS).find(([, key]) => key === message.error)?.[0] };
      }
      if (c.preview) {
        assert.deepEqual({ segments, keepSplitCutsCharacter }, { segments: c.preview.segments, keepSplitCutsCharacter: c.preview.keepSplitCutsCharacter });
      }
    });
  }

  // Without Web Worker (Node) the Filter never runs its regex in the main thread: only the mode check (service) and
  // compiling can fail, then it is refused (keep and remove)
  test(`filter service without Web Worker: ${c.name}`, async () => {
    let error: any;
    const runs = await userRegexRuns(patternOf(c.pattern), async () => {
      error = await rejectionOf(() => new FilterService().invoke(filterArgs(c), false));
    });
    // Mode first (service check), then the pattern rule and the syntax (compiling): the same errors as the worker
    if (typeof expected === 'object' && expected.error !== JS_FILTER_ERROR) assertInputError(error.kind, error.message, expected.error, c.name);
    else assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker });
    assert.equal(runs, 0, 'no user regex runs in the main thread');
  });

  // Paket 10 C6 (E10): the former main-thread Filter is gone; a direct call cannot run its old semantics
  test(`filter main thread is refused, also when called directly: ${c.name}`, async () => {
    let error: any;
    const runs = await userRegexRuns(patternOf(c.pattern), async () => {
      error = await rejectionOf(() => (new FilterService() as any).frontendInMainThread(filterArgs(c)));
    });
    assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker });
    assert.equal(runs, 0, 'no regex at all');
  });
}

test('filter: the main-thread regex spy counts the runs of the user regex (control for the refusal tests)', async () => {
  // The worker module runs in this thread in the tests: its runs are counted, other regexes are not
  const keep = await userRegexRuns('\\d', async () => {
    runWorker('filter', filterArgs({ input: 'a1\nb2', pattern: '\\d', options: { mode: 'keep', caseSensitive: true, splitMatches: false } }));
  });
  const remove = await userRegexRuns('\\d', async () => {
    runWorker('filter', filterArgs({ input: 'a1\nb2', pattern: '\\d', options: { mode: 'remove', caseSensitive: true, splitMatches: false } }));
  });
  const other = await userRegexRuns('\\d', async () => {
    'x'.replace(/x/g, 'y');
  });
  assert.ok(keep > 0 && remove > 0 && other === 0, `${keep} ${remove} ${other}`);
});

test('filter: Rust expectations of refused JS results are well-formed Unicode', () => {
  const cases = fixtures.filter.filter((c) => c.divergence?.kind === 'utf16Guard');
  assert.ok(cases.length >= 4);
  for (const c of cases) {
    // A surrogate escape (\uD83D) is no Unicode scalar value: fancy-regex rejects the pattern (Paket 10 R1)
    if (isErrorOf(c.expectedRust, 'invalidRegex')) continue;
    assert.equal(typeof c.expectedRust, 'string', c.name);
    assert.ok(!hasLoneSurrogate(c.expectedRust as string), c.name);
  }
});

test('filter worker: lone surrogates already in the input are not refused (not newly damaged)', () => {
  const run = (input: string, pattern: string, mode: string, splitMatches: boolean) =>
    runWorker('filter', filterArgs({ input, pattern, options: { mode, caseSensitive: true, splitMatches } }));
  const keep = run('\uD83Dx\n\uDE00y', '[xy]', 'keep', true);
  assert.deepEqual([keep.success, keep.result.result], [true, 'x\ny']);
  const remove = run('\uD83Dx', 'x', 'remove', false);
  assert.deepEqual([remove.success, remove.result.result], [true, '\uD83D']);
  // A valid pair next to a lone half is still protected
  const cut = run('\uDE00😀', '.', 'keep', true);
  assert.deepEqual([cut.success, cut.error], [false, ERROR_KEYS.regexSplitsCharacter]);
});

test('filter worker: the refused result is reported as one error, not as success', () => {
  const message = runWorker('filter', filterArgs({ input: 'ok\n😀x', pattern: '.', options: { mode: 'keep', caseSensitive: true, splitMatches: true } }));
  assert.deepEqual({ success: message.success, errorKind: message.errorKind, error: message.error, result: message.result }, {
    success: false,
    errorKind: 'invalidInput',
    error: ERROR_KEYS.regexSplitsCharacter,
    result: null,
  });
});

// --- Shared whitespace set (Unicode White_Space, same as Rust `str::trim`) ---

test('trimWhitespace uses Unicode White_Space: U+0085 is whitespace, U+FEFF is not', () => {
  for (let unit = 0; unit <= 0xffff; unit++) {
    const char = String.fromCharCode(unit);
    assert.equal(trimWhitespace(`${char}a${char}`) === 'a', isWhitespaceCodePoint(unit), `U+${unit.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  assert.equal(trimWhitespace('\u0085 a　'), 'a');
  assert.equal(trimWhitespace('﻿a﻿'), '﻿a﻿');
  assert.equal(trimWhitespace(' \t '), '');
  // The only differences to String.prototype.trim
  const differences = [];
  for (let unit = 0; unit <= 0xffff; unit++) {
    const char = String.fromCharCode(unit);
    if ((char.trim() === '') !== (trimWhitespace(char) === '')) differences.push(unit.toString(16).toUpperCase());
  }
  assert.deepEqual(differences, ['85', 'FEFF']);
});

// --- Remove ---

const isRegexJob = (c: RemoveCase) => c.options.useRegex && c.options.removeMode !== 'duplicates';
const noMetrics = { execution_time_ms: 0, memory_usage_kb: 0, memory_usage_str: '' };

for (const c of fixtures.remove) {
  const expected = (c.expectedJs ?? c.expected)!;

  test(`remove worker + main thread: ${c.name}`, async () => {
    const message = runWorker('remove', removeArgs(c));
    assertPendingJs(
      c,
      message.success
        ? { text: message.result.result.result_text, removedLines: message.result.result.removed_lines }
        : { error: Object.entries(ERROR_KEYS).find(([, key]) => key === message.error)?.[0] }
    );
    let main: any;
    let mainError: any;
    try {
      main = await (new RemoveService() as any).frontendInMainThread(removeArgs(c));
    } catch (error) {
      mainError = error;
    }

    if ('error' in expected) {
      assert.equal(message.success, false, JSON.stringify(message));
      assertInputError(message.errorKind, message.error, expected.error, `${c.name} (worker)`);
      assertInputError(mainError?.kind, mainError?.message, expected.error, `${c.name} (main thread)`);
      return;
    }
    assert.equal(message.success, true, JSON.stringify(message));
    assert.equal(mainError, undefined, `main thread: ${mainError}`);
    for (const [path, result] of [['worker', message.result], ['main thread', main]]) {
      assert.equal(result.type, 'TextV2', path);
      assert.deepEqual({ text: result.result.result_text, removedLines: result.result.removed_lines }, expected, path);
    }
  });

  // The real service path without Web Worker: duplicates and literal search run in the main thread, a regex never does
  test(`remove service without Web Worker: ${c.name}`, async () => {
    const run = () => new RemoveService().invoke(removeArgs(c), false);
    if ('error' in expected) {
      const error = await rejectionOf(run);
      assertInputError(error.kind, error.message, expected.error, c.name);
    } else if (isRegexJob(c)) {
      const error = await rejectionOf(run);
      assert.deepEqual({ kind: error.kind, message: error.message }, { kind: 'worker', message: ERROR_KEYS.regexRequiresWorker });
    } else {
      const result = await run();
      assert.equal(result.type, 'TextV2');
      assert.deepEqual(result.result, { result_text: expected.text, removed_lines: expected.removedLines, metrics: noMetrics });
    }
  });
}
