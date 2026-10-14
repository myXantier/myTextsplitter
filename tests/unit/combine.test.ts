// Combine state (Paket 6 follow-up): appending a column is always a new combine state, also when the combined text is
// '' or unchanged. JS mode combines in the frontend, Tauri mode calls `combine_columns` (stubbed Tauri IPC here; the
// Rust command itself is checked against the same fixtures in `cargo test`). Same calls as LeftMenuBar.appendColumnTauri.
import { installWindow, type TauriHandler } from './helpers/setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { appendCombineColumn } = await import('../../src/utils/combineColumns.ts');
const { useCombineHistoryStore } = await import('../../src/hooks/useCombineHistoryStore.ts');
const { invokeUNSAFE } = await import('../../src/services/tauriInvoke.ts');
const { ProcessingError } = await import('../../src/services/ProcessingError.ts');

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/line-endings-cases.json', import.meta.url), 'utf8'));
const fixture = (name: string) => fixtures.combine.find((c: any) => c.name === name) ?? assert.fail(`missing fixture ${name}`);
const LF = { lineEnding: '\n', trailingNewline: false } as const;

const store = () => useCombineHistoryStore.getState();
beforeEach(() => store().clearCombineState());

/** Records the `combine_columns` calls and answers with `answer(args)` (stands in for the Rust command). */
function backend(answer: (args: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const handler: TauriHandler = (cmd, args) => {
    assert.equal(cmd, 'combine_columns');
    calls.push(args);
    return answer(args);
  };
  installWindow(handler);
  return calls;
}

type Mode = 'js' | 'tauri';
/** One click on a column button in the given mode (LeftMenuBar.appendColumnTauri): new state, or unchanged on failure. */
async function clickColumn(mode: Mode, columns: string[][], index: number, separator: string) {
  const { present } = store();
  try {
    store().setCombineState(await appendCombineColumn(columns, present.columns, { index, separator }, LF, mode === 'js' ? null : invokeUNSAFE));
  } catch {
    // LeftMenuBar logs the error and keeps the state
  }
}

for (const mode of ['js', 'tauri'] as const) {
  test(`combine (${mode}): first column with an empty result is a new state`, async () => {
    const c = fixture('one empty value without trailing newline: empty string is a valid result');
    const calls = backend(() => c.expected);
    await clickColumn(mode, c.columns, 0, '');
    assert.deepEqual(store().present, { text: '', columns: [{ index: 0, separator: '' }] });
    assert.equal(store().canUndo(), true);
    assert.equal(calls.length, mode === 'tauri' ? 1 : 0);
  });

  test(`combine (${mode}): unchanged text still records the new column, undo/redo work`, async () => {
    const c = fixture('all-empty column with empty separator leaves the text unchanged');
    backend((args) => ((args.used as unknown[]).length === 1 ? 'a\nb' : c.expected));
    await clickColumn(mode, c.columns, 0, '');
    await clickColumn(mode, c.columns, 1, '');
    const both = { text: 'a\nb', columns: [{ index: 0, separator: '' }, { index: 1, separator: '' }] };
    assert.deepEqual(store().present, both);

    store().undoCombine();
    assert.deepEqual(store().present, { text: 'a\nb', columns: [{ index: 0, separator: '' }] });
    assert.equal(store().canRedo(), true);
    store().redoCombine();
    assert.deepEqual(store().present, both);
    assert.equal(store().canRedo(), false);
    store().undoCombine();
    store().undoCombine();
    assert.deepEqual(store().present, { text: '', columns: [] });
    assert.equal(store().canUndo(), false);
  });
}

test('combine (tauri): sends only the used columns with renumbered indexes and the line format', async () => {
  const calls = backend(() => 'x');
  const columns = [['a'], ['b'], ['c']];
  await appendCombineColumn(columns, [{ index: 2, separator: '' }], { index: 0, separator: ':' }, { lineEnding: '\r\n', trailingNewline: true }, invokeUNSAFE);
  assert.deepEqual(calls, [{
    columns: [['c'], ['a']],
    used: [{ index: 0, separator: '' }, { index: 1, separator: ':' }],
    lineending: '\r\n',
    trailingnewline: true,
  }]);
});

test('combine (tauri): an IPC error keeps the combine state (and its history)', async () => {
  backend(() => 'A');
  await clickColumn('tauri', [['A'], ['B']], 0, '');
  const before = { ...store() };

  backend(() => {
    throw 'IPC connection lost';
  });
  const error = await appendCombineColumn([['A'], ['B']], before.present.columns, { index: 1, separator: ':' }, LF, invokeUNSAFE).catch((e) => e);
  assert.ok(error instanceof ProcessingError && error.kind === 'backend', String(error));
  await clickColumn('tauri', [['A'], ['B']], 1, ':');
  assert.deepEqual(store().present, before.present);
  assert.deepEqual(store().past, before.past);
  assert.equal(store().canRedo(), false);
});

test('combine (tauri): a non-string answer is rejected and keeps the state', async () => {
  for (const answer of [null, undefined, 42, ['a'], { text: 'a' }]) {
    backend(() => answer);
    await assert.rejects(appendCombineColumn([['a']], [], { index: 0, separator: '' }, LF, invokeUNSAFE), /combine_columns returned/);
    await clickColumn('tauri', [['a']], 0, '');
    assert.deepEqual(store().present, { text: '', columns: [] }, JSON.stringify(answer));
    assert.equal(store().canUndo(), false);
  }
});

test('combine: JS and Tauri mode give the same states for the same clicks', async () => {
  const columns = [['A', 'C', ''], ['B', 'D', ''], ['', '', '']];
  const clicks: [number, string][] = [[2, ''], [0, ':'], [1, '']];
  const states: Record<Mode, unknown[]> = { js: [], tauri: [] };
  for (const mode of ['js', 'tauri'] as const) {
    store().clearCombineState();
    // Stand-in for the Rust command: the shared fixtures check that Rust and `combineColumns` agree
    const { combineColumns } = await import('../../src/utils/combineColumns.ts');
    backend((args) => combineColumns(args.columns as string[][], args.used as { index: number; separator: string }[], LF));
    for (const [index, separator] of clicks) {
      await clickColumn(mode, columns, index, separator);
      states[mode].push(structuredClone(store().present));
    }
  }
  assert.deepEqual(states.tauri, states.js);
  assert.deepEqual(states.js.map((s: any) => s.text), ['\n\n', ':A\n:C\n:', ':AB\n:CD\n:']);
});
