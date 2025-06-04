import { BaseService } from './BaseService';
import { computeLinearDiff, getWordDiffs, pairDiffResults, groupDiffResults } from '../utils/diff';

export class DiffService extends BaseService {
  constructor() {
    super('diff');
  }

  protected async invokeBackend(args: DiffConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { ignoreWhitespace } = configParams;

    const { invokeUNSAFE } = await import('./tauriInvoke');
    const result = await invokeUNSAFE<ProcessedText<string>>('get_text_diff', {
      oldtext: sourceText,
      newtext: mainParam,
      ignorewhitespace: ignoreWhitespace,
    });

    if (result.result_text) {
      this.setMetrics(result.metrics, sourceText, result.result_text);
      return this.convertToMyResult(result.result_text);
    }
    window.logger.error('[invokeBackend] konnte nicht erfolgreich ausgeführt werden.');
    return this.convertToMyResult('');
  }

  protected async frontendInMainThread(args: DiffConfig): Promise<myResult> {
    try {
      const { sourceText, mainParam, configParams } = args;
      const { ignoreWhitespace } = configParams;

      const results = computeLinearDiff(
        ignoreWhitespace ? sourceText.replace(BaseService.ignoreWhitespaceRegex, '') : sourceText,
        ignoreWhitespace ? mainParam.replace(BaseService.ignoreWhitespaceRegex, '') : mainParam
      );

      return this.convertToMyResult(JSON.stringify(results));
    } catch (error) {
      window.logger.error('Error in DiffService.frontendInMainThread:', error);
      return this.convertToMyResult([]);
    }
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