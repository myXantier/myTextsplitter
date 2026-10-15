export type OperationType = 'split' | 'diff' | 'filter' | 'remove' | 'sort';

/**
 * Latest started processing per operation type (shared by all pages: the processing status is global). A finished
 * operation only ends the global "processing" state when no other operation type is still running; a superseded
 * operation of the same type never ends it (the newer one owns the state).
 */
const runningOperations = new Map<OperationType, symbol>();

/** Registers a new operation of `type` (replacing an older one of the same type) and returns its token. */
export function startOperation(type: OperationType): symbol {
  const token = Symbol(type);
  runningOperations.set(type, token);
  return token;
}

/** True while `token` is the latest operation of `type` and has not ended. */
export function isLatestOperation(type: OperationType, token: symbol): boolean {
  return runningOperations.get(type) === token;
}

/** Ends `token`'s operation (no effect for a superseded one); returns whether any operation is still running. */
export function endOperation(type: OperationType, token: symbol): boolean {
  if (runningOperations.get(type) === token) runningOperations.delete(type);
  return runningOperations.size > 0;
}
