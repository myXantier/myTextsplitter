// Diff in the JS engines (Web Worker and main-thread fallback of DiffService). Kept free of service imports
// so the worker bundle does not load BaseService.
import { ProcessingError, ERROR_KEYS } from '../../services/ProcessingError';
import { computeLineDiff } from './lineDiff';
import { computeIntraline } from './intraline';
import { DiffLimitError } from './myers';
import type { DiffData } from './result';
import type { DiffDocument, IntralineAnalysis } from './types';

/**
 * Diff of a `DiffConfig`: the line diff once, and the word diff of it only when `configParams.wordDiff` is true
 * (otherwise nothing of the word diff runs: no tokenizing, no pairing). Exceeding the line diff work limit is an input
 * error (`errors.diffTooComplex`), not a partial result; the word diff has its own limits (skip reasons).
 * `analyze` is replaceable for tests only.
 */
export function diffInJs(args: DiffConfig, analyze: (document: DiffDocument) => IntralineAnalysis = computeIntraline): DiffData {
  let document: DiffDocument;
  try {
    document = computeLineDiff(args.sourceText, args.mainParam, { ignoreWhitespace: args.configParams.ignoreWhitespace });
  } catch (error) {
    if (error instanceof DiffLimitError) throw new ProcessingError('invalidInput', ERROR_KEYS.diffTooComplex, error.message);
    throw error;
  }
  return { document, intraline: args.configParams.wordDiff === true ? analyze(document) : null };
}
