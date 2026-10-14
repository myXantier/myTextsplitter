// Line diff in the JS engines (Web Worker and main-thread fallback of DiffService). Kept free of service imports
// so the worker bundle does not load BaseService.
import { ProcessingError, ERROR_KEYS } from '../../services/ProcessingError';
import { computeLineDiff } from './lineDiff';
import { DiffLimitError } from './myers';
import type { DiffDocument } from './types';

/** Diff of a `DiffConfig`; exceeding the work limit is an input error (`errors.diffTooComplex`), not a partial result. */
export function diffInJs(args: DiffConfig): DiffDocument {
  try {
    return computeLineDiff(args.sourceText, args.mainParam, { ignoreWhitespace: args.configParams.ignoreWhitespace });
  } catch (error) {
    if (error instanceof DiffLimitError) throw new ProcessingError('invalidInput', ERROR_KEYS.diffTooComplex, error.message);
    throw error;
  }
}
