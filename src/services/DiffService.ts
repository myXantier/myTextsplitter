import { BaseService } from './BaseService';
import { computeLinearDiff, getWordDiffs, pairDiffResults, groupDiffResults } from '../utils/diff';
import { ProcessingError, ERROR_KEYS, assertBackendResult, createResult } from './ProcessingError';

// Map instead of an object literal: inherited properties (`constructor`, `__proto__`, …) must not count as diff types
const BACKEND_DIFF_TYPES = new Map<unknown, DiffResult['type']>([
  ['Added', 'added'],
  ['Removed', 'removed'],
  ['Moved', 'moved'],
  ['Unchanged', 'unchanged'],
]);

/**
 * Converts the Rust diff JSON (`{ text, diff_type: 'Added', line_number }`) into the `DiffResult` format of the
 * JS engine (`{ type: 'added', text, lineNumber }`), so both paths deliver the same structure (B24).
 * Throws `invalidResult` for anything else.
 */
export function convertBackendDiff(json: string): DiffResult[] {
  const invalid = (detail: string) => new ProcessingError('invalidResult', ERROR_KEYS.general, `unexpected diff result: ${detail}`);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw invalid('no JSON');
  }
  if (!Array.isArray(data)) throw invalid('no array');

  return data.map((item) => {
    const type = BACKEND_DIFF_TYPES.get(item?.diff_type);
    if (!type || typeof item.text !== 'string' || !Number.isInteger(item.line_number)) throw invalid('entry');
    return { type, text: item.text, lineNumber: item.line_number };
  });
}

export class DiffService extends BaseService {
  protected readonly resultType = 'Text';

  constructor() {
    super('diff');
  }

  protected async invokeBackend(args: DiffConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { ignoreWhitespace } = configParams;

    const { invokeUNSAFE } = await import('./tauriInvoke');
    const response = await invokeUNSAFE<unknown>('get_text_diff', {
      oldtext: sourceText,
      newtext: mainParam,
      ignorewhitespace: ignoreWhitespace,
    });

    const result = assertBackendResult(response, 'Text');
    const diffJson = JSON.stringify(convertBackendDiff(result.result_text));
    this.setMetrics(result.metrics, sourceText, result.result_text);
    return createResult('Text', diffJson);
  }

  protected async frontendInMainThread(args: DiffConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { ignoreWhitespace } = configParams;

    const results = computeLinearDiff(
      ignoreWhitespace ? sourceText.replace(BaseService.ignoreWhitespaceRegex, '') : sourceText,
      ignoreWhitespace ? mainParam.replace(BaseService.ignoreWhitespaceRegex, '') : mainParam
    );

    return createResult('Text', JSON.stringify(results));
  }

  /** Process word-level diffs between two lines of text */
  public getWordDiffs(oldLine: string, newLine: string) {
    return getWordDiffs(oldLine, newLine);
  }

  /** Group diff results by type (added, removed, unchanged) */
  public groupDiffResults(diffResults: DiffResult[]) {
    return groupDiffResults(diffResults);
  }

  /** Pair diff results for side-by-side comparison */
  public pairDiffResults(diffResults: DiffResult[]) {
    return pairDiffResults(diffResults);
  }
}