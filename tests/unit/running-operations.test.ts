// Global processing state of useBackendProcessor (Paket 5): only the latest operation per type owns it, and a
// finished operation does not end the state of another operation type that is still running.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { startOperation, endOperation, isLatestOperation } = await import('../../src/hooks/runningOperations.ts');

test('same type: the newer operation ends first, the superseded one ends later and changes nothing', () => {
  const older = startOperation('split');
  const newer = startOperation('split');
  assert.equal(isLatestOperation('split', older), false);
  assert.equal(endOperation('split', newer), false, 'nothing runs after the newer one ended');
  assert.equal(endOperation('split', older), false);
  assert.equal(isLatestOperation('split', newer), false);
});

test('same type: a superseded operation that ends first does not end the newer one', () => {
  const older = startOperation('filter');
  const newer = startOperation('filter');
  assert.equal(endOperation('filter', older), true, 'the newer operation is still running');
  assert.equal(isLatestOperation('filter', newer), true);
  assert.equal(endOperation('filter', newer), false);
});

test('different types: a finished operation reports that another type is still running', () => {
  const filter = startOperation('filter');
  const split = startOperation('split');
  assert.equal(endOperation('split', split), true, 'filter still runs: the processing state stays on');
  assert.equal(endOperation('filter', filter), false);
});
